// Portal de clientes (/api/portal). Solo cuentas con rol CLIENTE.
//
// Todo se filtra por la empresa de la cuenta (`req.empresa`, la carga
// `cargarEmpresaPortal`), nunca por ids que mande el navegador: un cliente
// que cambie el id de la URL solo obtiene 404.
//
// Qué ve el cliente y qué no:
//  - Proyectos ligados a su empresa (no archivados): avance, fechas y la lista
//    de actividades con su estado, sin responsables ni comentarios internos.
//  - Documentos: solo los archivos del proyecto marcados "visible para el
//    cliente" por el equipo. Los de tareas y eventos nunca.
//  - Contratos de su empresa en revisión, vigentes o terminados (no
//    borradores ni cancelados), sin notas internas, y sus PDF.
//  - Reuniones marcadas con su empresa.
//  - La conversación de cada proyecto con el equipo (mensajes_portal), que va
//    aparte de los comentarios internos.
const prisma = require('../lib/prisma');
const archivosContrato = require('../services/contratosArchivos.service');
const { configEnCache } = require('../services/configuracion.service');
const { ESTADOS_PROYECTO_OCULTOS } = require('../utils/estados.utils');
const { subirArchivo, borrarBlobs, esBlobVercel, esLocal } = require('../utils/blob.utils');
const { invalidarCacheUsuario } = require('../middlewares/auth.middleware');

const ESTADOS_CONTRATO_VISIBLES = ['EN_REVISION', 'VIGENTE', 'TERMINADO'];
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MENSAJE = 4000;
const DIA_MS = 24 * 60 * 60 * 1000;

const idDe = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const fallo = (res, error, contexto) => {
  console.error(`[portal.${contexto}]`, error);
  return res.status(500).json({ error: 'No se pudo cargar la información' });
};

// ---------------------------------------------------------------------------
// Middleware: la empresa de la cuenta debe existir, ser cliente y estar activa.
// Desactivar la empresa en el directorio corta el acceso de sus contactos.
// ---------------------------------------------------------------------------
const cargarEmpresaPortal = async (req, res, next) => {
  if (req.usuario?.rol !== 'CLIENTE') {
    return res.status(403).json({ error: 'El portal es solo para cuentas de clientes', codigo: 'SOLO_CLIENTES' });
  }
  try {
    const empresa = req.usuario.empresaId
      ? await prisma.empresa.findUnique({
        where: { id: req.usuario.empresaId },
        select: { id: true, nombre: true, nombreComercial: true, tipo: true, estado: true },
      })
      : null;
    if (!empresa || empresa.estado !== 'ACTIVO' || empresa.tipo === 'PROVEEDOR') {
      return res.status(403).json({ error: 'Tu acceso al portal está suspendido. Contacta a tu ejecutivo.', codigo: 'PORTAL_SUSPENDIDO' });
    }
    req.empresa = empresa;
    res.set('Cache-Control', 'private, no-store');
    return next();
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------
const filtroProyectos = (req) => ({ clienteId: req.empresa.id, estado: { notIn: ['ARCHIVADO'] } });

const selectProyecto = {
  id: true, nombre: true, descripcion: true, estado: true, fechaInicio: true, fechaFin: true, creadoEn: true,
  creador: { select: { nombre: true, email: true, puesto: true, fotoPerfilUrl: true } },
  tareas: { select: { estado: true, venceEn: true, completadoEn: true } },
};

/** Avance, conteos y próxima fecha límite a partir de las tareas. */
const resumenProyecto = (proyecto) => {
  const { tareas = [], creador, ...resto } = proyecto;
  const total = tareas.length;
  const hechas = tareas.filter((t) => t.estado === 'HECHO').length;
  const enCurso = tareas.filter((t) => t.estado === 'EN_PROGRESO').length;
  const ahora = Date.now();
  const proximas = tareas
    .filter((t) => t.estado !== 'HECHO' && t.venceEn && new Date(t.venceEn).getTime() >= ahora - DIA_MS)
    .map((t) => new Date(t.venceEn).getTime())
    .sort((a, b) => a - b);
  const ultimaEntrega = tareas
    .filter((t) => t.estado === 'HECHO' && t.completadoEn)
    .map((t) => new Date(t.completadoEn).getTime())
    .sort((a, b) => b - a)[0];
  return {
    ...resto,
    cerrado: ESTADOS_PROYECTO_OCULTOS.includes(resto.estado),
    responsable: creador ? { nombre: creador.nombre, email: creador.email, puesto: creador.puesto, fotoPerfilUrl: creador.fotoPerfilUrl } : null,
    tareas: total,
    tareasHechas: hechas,
    tareasEnCurso: enCurso,
    tareasVencidas: tareas.filter((t) => t.estado !== 'HECHO' && t.venceEn && new Date(t.venceEn).getTime() < ahora).length,
    avance: total ? Math.round((hechas / total) * 100) : 0,
    proximaFecha: proximas.length ? new Date(proximas[0]).toISOString() : null,
    ultimaEntrega: ultimaEntrega ? new Date(ultimaEntrega).toISOString() : null,
  };
};

const selectDocumento = {
  id: true, nombre: true, url: true, tipo: true, tamano: true, creadoEn: true,
  proyecto: { select: { id: true, nombre: true } },
  usuario: { select: { nombre: true } },
};

// Solo archivos del proyecto (no de tareas ni eventos) que el equipo compartió.
const filtroDocumentos = (req, proyectoId) => ({
  visibleCliente: true,
  tareaId: null,
  eventoId: null,
  proyecto: proyectoId ? { id: proyectoId, ...filtroProyectos(req) } : filtroProyectos(req),
});

const selectReunion = {
  id: true, titulo: true, descripcion: true, modalidad: true, ubicacion: true, urlReunion: true,
  instruccionesAcceso: true, fechaInicio: true, fechaFin: true, todoElDia: true,
  proyecto: { select: { id: true, nombre: true, clienteId: true } },
  usuario: { select: { nombre: true } },
  creador: { select: { nombre: true } },
};

const formatearReunion = (req) => ({ proyecto, usuario, creador, ...evento }) => ({
  ...evento,
  // Si el proyecto ya no es de este cliente no se revela su nombre.
  proyecto: proyecto && proyecto.clienteId === req.empresa.id ? { id: proyecto.id, nombre: proyecto.nombre } : null,
  organizador: (creador || usuario)?.nombre || null,
});

const reunionesDe = async (req, { desde, hasta, proyectoId, take } = {}) => {
  const eventos = await prisma.evento.findMany({
    where: {
      empresaId: req.empresa.id,
      ...(proyectoId ? { proyectoId } : {}),
      ...(desde || hasta ? { fechaInicio: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) } } : {}),
    },
    orderBy: { fechaInicio: desde ? 'asc' : 'desc' },
    take,
    select: selectReunion,
  });
  return eventos.map(formatearReunion(req));
};

const selectMensaje = {
  id: true, contenido: true, deCliente: true, creadoEn: true,
  autor: { select: { id: true, nombre: true, puesto: true, fotoPerfilUrl: true } },
};

const selectContrato = {
  id: true, folio: true, titulo: true, tipo: true, estado: true, descripcion: true,
  monto: true, moneda: true, incluyeIva: true, periodicidadPago: true,
  fechaFirma: true, fechaInicio: true, fechaFin: true, renovacionAutomatica: true,
  proyecto: { select: { id: true, nombre: true, clienteId: true } },
  responsable: { select: { nombre: true, email: true } },
  archivos: {
    orderBy: { creadoEn: 'desc' },
    select: { id: true, nombreOriginal: true, tamano: true, tipoDocumento: true, creadoEn: true },
  },
};

const formatearContrato = (req) => ({ proyecto, ...contrato }) => ({
  ...contrato,
  proyecto: proyecto && proyecto.clienteId === req.empresa.id ? { id: proyecto.id, nombre: proyecto.nombre } : null,
});

// ---------------------------------------------------------------------------
// GET /api/portal/resumen — pantalla de inicio del portal
// ---------------------------------------------------------------------------
const resumen = async (req, res) => {
  try {
    const ahora = new Date();
    const contratosActivos = configEnCache().modulos?.contratos !== false;
    const [proyectos, documentos, reuniones, contratos, mensajes] = await Promise.all([
      prisma.proyecto.findMany({ where: filtroProyectos(req), orderBy: { creadoEn: 'desc' }, select: selectProyecto }),
      prisma.adjunto.findMany({ where: filtroDocumentos(req), orderBy: { creadoEn: 'desc' }, take: 5, select: selectDocumento }),
      reunionesDe(req, { desde: new Date(ahora.getTime() - 2 * 60 * 60 * 1000), take: 3 }),
      contratosActivos
        ? prisma.contrato.findMany({
          where: { empresaId: req.empresa.id, estado: { in: ESTADOS_CONTRATO_VISIBLES } },
          select: { id: true, estado: true, fechaFin: true },
        })
        : [],
      // Últimos mensajes del equipo en sus proyectos (actividad reciente).
      prisma.mensajePortal.findMany({
        where: { deCliente: false, proyecto: filtroProyectos(req) },
        orderBy: { creadoEn: 'desc' },
        take: 4,
        select: { ...selectMensaje, proyecto: { select: { id: true, nombre: true } } },
      }),
    ]);

    const lista = proyectos.map(resumenProyecto);
    const abiertos = lista.filter((p) => !p.cerrado);
    return res.json({
      empresa: { id: req.empresa.id, nombre: req.empresa.nombreComercial || req.empresa.nombre },
      proyectos: lista,
      totales: {
        proyectosActivos: abiertos.length,
        proyectosTerminados: lista.length - abiertos.length,
        avancePromedio: abiertos.length ? Math.round(abiertos.reduce((s, p) => s + p.avance, 0) / abiertos.length) : null,
        contratosVigentes: contratos.filter((c) => c.estado === 'VIGENTE').length,
        reunionesProximas: reuniones.filter((r) => new Date(r.fechaInicio) >= ahora).length,
      },
      documentosRecientes: documentos,
      proximasReuniones: reuniones,
      mensajesRecientes: mensajes,
      contratosActivos,
    });
  } catch (error) {
    return fallo(res, error, 'resumen');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/proyectos
// ---------------------------------------------------------------------------
const proyectos = async (req, res) => {
  try {
    const filas = await prisma.proyecto.findMany({
      where: filtroProyectos(req),
      orderBy: { creadoEn: 'desc' },
      select: { ...selectProyecto, _count: { select: { mensajesPortal: true } } },
    });
    return res.json({ proyectos: filas.map(({ _count, ...p }) => ({ ...resumenProyecto(p), mensajes: _count.mensajesPortal })) });
  } catch (error) {
    return fallo(res, error, 'proyectos');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/proyectos/:id — avance, actividades, documentos y reuniones
// ---------------------------------------------------------------------------
const proyecto = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(404).json({ error: 'Proyecto no encontrado' });
  try {
    const fila = await prisma.proyecto.findFirst({ where: { id, ...filtroProyectos(req) }, select: selectProyecto });
    if (!fila) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [actividades, documentos, reuniones] = await Promise.all([
      prisma.tarea.findMany({
        where: { proyectoId: id },
        orderBy: [{ numeroActividad: 'asc' }, { fechaInicio: 'asc' }, { id: 'asc' }],
        // Sin responsables, descripciones ni comentarios: solo el avance.
        select: { id: true, numeroActividad: true, titulo: true, estado: true, fechaInicio: true, venceEn: true, completadoEn: true },
      }),
      prisma.adjunto.findMany({ where: filtroDocumentos(req, id), orderBy: { creadoEn: 'desc' }, select: selectDocumento }),
      reunionesDe(req, { proyectoId: id, take: 20 }),
    ]);

    return res.json({ proyecto: { ...resumenProyecto(fila), actividades, documentos, reuniones } });
  } catch (error) {
    return fallo(res, error, 'proyecto');
  }
};

// ---------------------------------------------------------------------------
// GET/POST /api/portal/proyectos/:id/mensajes
// ---------------------------------------------------------------------------
const proyectoDelCliente = (req, id) => prisma.proyecto.findFirst({
  where: { id, ...filtroProyectos(req) },
  select: { id: true, nombre: true, area: true, creadorId: true, miembros: { select: { id: true } } },
});

const mensajes = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(404).json({ error: 'Proyecto no encontrado' });
  try {
    if (!await proyectoDelCliente(req, id)) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const filas = await prisma.mensajePortal.findMany({
      where: { proyectoId: id },
      orderBy: { creadoEn: 'asc' },
      take: 500,
      select: selectMensaje,
    });
    return res.json({ mensajes: filas });
  } catch (error) {
    return fallo(res, error, 'mensajes');
  }
};

/**
 * Avisa al equipo del proyecto: su creador, sus miembros y los
 * administradores que lo pueden administrar. Nunca lanza.
 */
const avisarEquipo = async (proyectoBase, autor, empresa) => {
  try {
    const { normalizarAreas } = require('../utils/permissions.utils');
    const { areasDe, AREA_GENERAL, puede } = require('../utils/permisosArea.utils');
    const areas = normalizarAreas(proyectoBase.area);
    const admins = await prisma.usuario.findMany({
      where: { rol: 'ADMIN', OR: [{ estado: 'activo' }, { estado: null }] },
      select: { id: true, area: true },
    });
    const destinatarios = new Set([
      proyectoBase.creadorId,
      ...proyectoBase.miembros.map((m) => m.id),
      // Admin global (ADMINISTRACION) o de un área del proyecto.
      ...admins.filter((a) => areasDe(a).some((x) => x === AREA_GENERAL || areas.includes(x))).map((a) => a.id),
    ]);
    destinatarios.delete(autor.id);
    if (!destinatarios.size) return;
    // Solo a quien puede abrir la conversacion (pestaña "Cliente": "clientes.ver").
    const equipo = (await prisma.usuario.findMany({
      where: { id: { in: [...destinatarios] }, rol: { in: ['ADMIN', 'MIEMBRO'] }, OR: [{ estado: 'activo' }, { estado: null }] },
      select: { id: true, rol: true, area: true, permisos: true, permisosFinanzas: true },
    })).filter((u) => puede(u, 'clientes.ver'));
    if (!equipo.length) return;
    const nombreEmpresa = empresa.nombreComercial || empresa.nombre;
    await prisma.notificacion.createMany({
      data: equipo.map(({ id }) => ({
        usuarioId: id,
        mensaje: `${autor.nombre} (${nombreEmpresa}) escribió en "${proyectoBase.nombre}"`,
        tipo: 'MENSAJE_PORTAL',
        proyectoId: proyectoBase.id,
        actorNombre: autor.nombre,
      })),
    });
  } catch (error) {
    console.error('[portal.avisarEquipo]', error);
  }
};

const enviarMensaje = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(404).json({ error: 'Proyecto no encontrado' });
  const contenido = typeof req.body?.contenido === 'string' ? req.body.contenido.replace(/\r\n/g, '\n').trim() : '';
  if (!contenido) return res.status(400).json({ error: 'Escribe un mensaje' });
  if (contenido.length > MAX_MENSAJE) return res.status(400).json({ error: `El mensaje no puede pasar de ${MAX_MENSAJE} caracteres` });
  try {
    const proyectoBase = await proyectoDelCliente(req, id);
    if (!proyectoBase) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const mensaje = await prisma.mensajePortal.create({
      data: { proyectoId: id, autorId: req.usuario.id, contenido, deCliente: true },
      select: selectMensaje,
    });
    await avisarEquipo(proyectoBase, req.usuario, req.empresa);
    return res.status(201).json({ mensaje });
  } catch (error) {
    return fallo(res, error, 'enviarMensaje');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/documentos — todo lo compartido, de todos sus proyectos
// ---------------------------------------------------------------------------
const documentos = async (req, res) => {
  try {
    const filas = await prisma.adjunto.findMany({ where: filtroDocumentos(req), orderBy: { creadoEn: 'desc' }, take: 300, select: selectDocumento });
    return res.json({ documentos: filas });
  } catch (error) {
    return fallo(res, error, 'documentos');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/reuniones — próximas y de los últimos 6 meses
// ---------------------------------------------------------------------------
const reuniones = async (req, res) => {
  try {
    const ahora = new Date();
    // Una reunión en curso sigue en "próximas" hasta su hora de fin.
    const corte = new Date(ahora.getTime() - 2 * 60 * 60 * 1000);
    const [proximas, pasadas] = await Promise.all([
      reunionesDe(req, { desde: corte, take: 50 }),
      reunionesDe(req, { desde: undefined, hasta: corte, take: 30 }),
    ]);
    const limitePasadas = ahora.getTime() - 183 * DIA_MS;
    return res.json({
      proximas,
      pasadas: pasadas.filter((r) => new Date(r.fechaInicio).getTime() >= limitePasadas),
    });
  } catch (error) {
    return fallo(res, error, 'reuniones');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/contratos y GET /api/portal/contratos/archivos/:archivoId
// ---------------------------------------------------------------------------
const contratoModuloApagado = (res) => res.status(404).json({ error: 'Los contratos no están disponibles', codigo: 'MODULO_DESACTIVADO' });

const contratos = async (req, res) => {
  if (configEnCache().modulos?.contratos === false) return contratoModuloApagado(res);
  try {
    const filas = await prisma.contrato.findMany({
      where: { empresaId: req.empresa.id, estado: { in: ESTADOS_CONTRATO_VISIBLES } },
      orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
      select: selectContrato,
    });
    return res.json({ contratos: filas.map(formatearContrato(req)) });
  } catch (error) {
    return fallo(res, error, 'contratos');
  }
};

const archivoContrato = async (req, res) => {
  if (configEnCache().modulos?.contratos === false) return contratoModuloApagado(res);
  const { archivoId } = req.params;
  if (!REGEX_UUID.test(String(archivoId || ''))) return res.status(404).json({ error: 'Archivo no encontrado' });
  try {
    const registro = await prisma.contratoArchivo.findFirst({
      where: { id: archivoId, contrato: { empresaId: req.empresa.id, estado: { in: ESTADOS_CONTRATO_VISIBLES } } },
    });
    if (!registro) return res.status(404).json({ error: 'Archivo no encontrado' });

    let contenido;
    try {
      contenido = await archivosContrato.leer(registro.archivo);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(410).json({ error: 'El archivo ya no está disponible' });
      throw error;
    }
    const disposicion = req.query.descargar ? 'attachment' : 'inline';
    const nombreAscii = registro.nombreOriginal.replace(/[^\x20-\x7e]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(contenido.length),
      'Content-Disposition': `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(registro.nombreOriginal)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(contenido);
  } catch (error) {
    return fallo(res, error, 'archivoContrato');
  }
};

// ---------------------------------------------------------------------------
// GET /api/portal/perfil — datos de la cuenta, su empresa, su equipo y cifras
// PUT /api/portal/perfil — nombre, cargo, teléfono y foto (el correo no: es
// el acceso y lo cambia el equipo)
// ---------------------------------------------------------------------------
const selectPerfil = {
  id: true, nombre: true, email: true, telefono: true, puesto: true, fotoPerfilUrl: true,
  creadoEn: true, ultimoLoginEn: true,
};

const perfil = async (req, res) => {
  try {
    const [usuario, empresa, proyectosEmpresa, documentos, mensajesEnviados, reuniones] = await Promise.all([
      prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: selectPerfil }),
      prisma.empresa.findUnique({
        where: { id: req.empresa.id },
        select: { nombre: true, nombreComercial: true, rfc: true, ciudad: true, sitioWeb: true, telefono: true, sector: true },
      }),
      prisma.proyecto.findMany({
        where: filtroProyectos(req),
        select: { id: true, nombre: true, estado: true, creador: { select: { id: true, nombre: true, email: true, puesto: true, fotoPerfilUrl: true } } },
      }),
      prisma.adjunto.count({ where: filtroDocumentos(req) }),
      prisma.mensajePortal.count({ where: { autorId: req.usuario.id } }),
      prisma.evento.count({ where: { empresaId: req.empresa.id } }),
    ]);

    // El equipo: quien lleva cada proyecto, con los proyectos que lleva.
    const equipo = new Map();
    proyectosEmpresa.forEach((p) => {
      if (!p.creador) return;
      const fila = equipo.get(p.creador.id) || { ...p.creador, proyectos: [] };
      fila.proyectos.push({ id: p.id, nombre: p.nombre });
      equipo.set(p.creador.id, fila);
    });

    return res.json({
      usuario,
      empresa,
      equipo: [...equipo.values()].map(({ id, ...resto }) => resto),
      cifras: {
        proyectos: proyectosEmpresa.filter((p) => !ESTADOS_PROYECTO_OCULTOS.includes(p.estado)).length,
        documentos,
        mensajesEnviados,
        reuniones,
      },
    });
  } catch (error) {
    return fallo(res, error, 'perfil');
  }
};

const LIMITES_PERFIL = { nombre: 255, puesto: 255, telefono: 40 };

const actualizarPerfil = async (req, res) => {
  try {
    const { nombre, puesto, telefono, removeFoto } = req.body || {};
    const limpio = (valor) => (typeof valor === 'string' ? valor.trim() : '');
    if (!limpio(nombre)) return res.status(400).json({ error: 'Escribe tu nombre' });
    for (const [campo, max] of Object.entries(LIMITES_PERFIL)) {
      if (limpio(req.body?.[campo]).length > max) return res.status(400).json({ error: `El campo ${campo} es demasiado largo` });
    }
    if (limpio(telefono) && !/^[0-9+()\s.-]{7,40}$/.test(limpio(telefono))) {
      return res.status(400).json({ error: 'El teléfono solo puede llevar números, espacios y + ( ) -' });
    }

    const actual = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { fotoPerfilUrl: true } });
    const data = { nombre: limpio(nombre), puesto: limpio(puesto) || null, telefono: limpio(telefono) || null };
    let fotoAnterior = null;
    if (req.file) {
      data.fotoPerfilUrl = await subirArchivo(req.file, 'perfiles');
      fotoAnterior = actual?.fotoPerfilUrl;
    } else if (removeFoto === 'true') {
      data.fotoPerfilUrl = null;
      fotoAnterior = actual?.fotoPerfilUrl;
    }

    const usuario = await prisma.usuario.update({ where: { id: req.usuario.id }, data, select: selectPerfil });
    if (fotoAnterior && (esLocal(fotoAnterior) || esBlobVercel(fotoAnterior)) && fotoAnterior !== usuario.fotoPerfilUrl) {
      await borrarBlobs([fotoAnterior]);
    }
    invalidarCacheUsuario(req.usuario.id);
    return res.json({ mensaje: 'Perfil actualizado', usuario });
  } catch (error) {
    console.error('[portal.actualizarPerfil]', error);
    return res.status(500).json({ error: 'No se pudo guardar tu perfil' });
  }
};

module.exports = {
  cargarEmpresaPortal,
  resumen,
  proyectos,
  proyecto,
  mensajes,
  enviarMensaje,
  documentos,
  reuniones,
  contratos,
  archivoContrato,
  perfil,
  actualizarPerfil,
};
