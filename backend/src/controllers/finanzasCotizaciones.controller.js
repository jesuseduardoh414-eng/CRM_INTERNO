// Finanzas / Cotizaciones: recibidas de proveedores o enviadas a clientes.
// Cada archivo es una version que no se reemplaza ni se borra (la 1 es la
// original): si la cotizacion cambia, se sube una version nueva con su monto y
// una nota de que cambio. Permisos (finanzas.cotizaciones.*, revisados en las
// rutas): ver; crear = subir cotizaciones y versiones; editar = corregir los
// datos; aprobar = cambiar el estado; eliminar = borrar la cotizacion
// completa; acceso = elegir quien la ve. De fabrica solo el administrador
// general corrige, aprueba, elimina y elige. Los archivos van en disco
// (documentos.service.js).
//
// Quien ve cada una: F.accesoCotizaciones. Una restringida solo la ven
// quienes esten en su lista (areas, roles o personas, como en la base de
// conocimiento), aunque no tengan el permiso de ver cotizaciones; quien no la
// ve recibe 404 en todo, tambien al corregirla, aprobarla o borrarla.
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const documentos = require('../services/documentos.service');
const { configEnCache } = require('../services/configuracion.service');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const { normalizarAcceso } = require('../utils/accesoConocimiento.utils');
const F = require('../utils/finanzas.utils');
const papelera = require('../services/papelera.service');

const almacen = documentos.cotizaciones;
// Las cuentas que pueden estar en una lista de acceso (las del CRM).
const ROLES_CRM = ['ADMIN', 'MIEMBRO'];

const selectVersion = {
  id: true, numero: true, monto: true, nota: true, nombreOriginal: true, mime: true, tamano: true, creadoEn: true,
  subidoPor: { select: F.selectUsuarioCorto },
  ...F.selectOrigen,
};

const incluirListado = {
  empresa: { select: F.selectEmpresaCorta },
  cliente: { select: F.selectEmpresaCorta },
  creadoPor: { select: F.selectUsuarioCorto },
  versiones: { orderBy: { numero: 'asc' }, select: { numero: true, monto: true, creadoEn: true } },
};

/** Quien elige quien ve cada cotizacion (y por eso ve las listas). */
const gestionaAcceso = (usuario) => F.puedeFin(usuario, 'cotizaciones', 'acceso');

/** Detalle: la lista de acceso solo para quien la gestiona. */
const incluirDetalle = (usuario) => ({
  empresa: { select: F.selectEmpresaCorta },
  cliente: { select: F.selectEmpresaCorta },
  creadoPor: { select: F.selectUsuarioCorto },
  versiones: { orderBy: { numero: 'asc' }, select: selectVersion },
  ...(gestionaAcceso(usuario) ? { accesos: { select: { id: true, area: true, rol: true, usuarioId: true, usuario: { select: F.selectUsuarioCorto } } } } : {}),
});

/** where de una cotizacion por id, solo si la persona la ve. */
const visible = (id, usuario) => combinarWhere({ id }, F.accesoCotizaciones(usuario));

const montoONull = (m) => (m === null || m === undefined ? null : F.aNumero(m));

/** Monto de la original y de la ultima version, y cuanto cambio. */
const resumenVersiones = (versiones) => {
  const original = versiones[0];
  const ultima = versiones[versiones.length - 1];
  const montoOriginal = montoONull(original?.monto);
  const montoActual = montoONull(ultima?.monto);
  return {
    totalVersiones: versiones.length,
    montoOriginal,
    montoActual,
    diferencia: montoOriginal !== null && montoActual !== null ? F.sumar([montoActual, -montoOriginal]) : null,
    ultimaVersionEn: ultima?.creadoEn ?? null,
  };
};

const serializarListado = (c) => {
  const { versiones, ...resto } = c;
  return { ...resto, fecha: F.fechaATexto(c.fecha), ...resumenVersiones(versiones) };
};

const serializarDetalle = (c) => ({
  ...c,
  fecha: F.fechaATexto(c.fecha),
  ...resumenVersiones(c.versiones),
  versiones: c.versiones.map((v) => ({ ...v, monto: montoONull(v.monto) })),
});

// ---------------------------------------------------------------------------
// Validacion de los datos (no del archivo). Con `parcial` solo lo que viene.
// ---------------------------------------------------------------------------
const normalizar = async (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('tipo')) {
    const tipo = String(body.tipo || '').toUpperCase();
    if (!F.TIPOS_COTIZACION.includes(tipo)) errores.push('Indica si la cotización es recibida (de un proveedor) o enviada (a un cliente)');
    else data.tipo = tipo;
  }
  if (!parcial || viene('titulo')) {
    const titulo = F.textoOpcional(body.titulo, 255);
    if (!titulo || titulo.length < 3) errores.push('El título es obligatorio (mínimo 3 caracteres)');
    else data.titulo = titulo;
  }
  if (viene('descripcion')) data.descripcion = F.textoOpcional(body.descripcion, 4000);
  if (!parcial || viene('moneda')) {
    const moneda = String(body.moneda || F.MONEDA_BASE).toUpperCase();
    if (!F.MONEDAS.includes(moneda)) errores.push('Moneda no válida');
    else data.moneda = moneda;
  }
  if (!parcial || viene('fecha')) {
    const fecha = F.leerFecha(body.fecha);
    if (fecha === false) errores.push('La fecha no es válida (AAAA-MM-DD)');
    else data.fecha = fecha || F.hoyFecha();
  }
  // Proveedor o cliente: ficha del directorio y/o nombre libre (foto del momento).
  let empresa = null;
  if (viene('empresaId')) {
    const empresaId = body.empresaId === null || body.empresaId === '' ? null : F.leerId(body.empresaId);
    if (body.empresaId && !empresaId) errores.push('Proveedor o cliente no válido');
    else if (empresaId) {
      empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, nombreComercial: true } });
      if (!empresa) errores.push('El proveedor o cliente no existe en el directorio');
      else data.empresaId = empresa.id;
    } else data.empresaId = null;
  }
  if (viene('contraparteNombre')) data.contraparteNombre = F.textoOpcional(body.contraparteNombre, 255);
  if (empresa && !data.contraparteNombre) data.contraparteNombre = empresa.nombreComercial || empresa.nombre;
  // Para que cliente es (en una recibida; en una enviada el cliente es la contraparte).
  const cliente = await F.leerCliente(body.clienteId);
  if (cliente.error) errores.push(cliente.error);
  else if (cliente.clienteId !== undefined) data.clienteId = cliente.clienteId;
  if (!parcial && !data.empresaId && !data.contraparteNombre) errores.push('Indica de qué proveedor es o a qué cliente se envió');
  return { data, errores };
};

/** Monto (opcional) y nota de una version. La nota es obligatoria desde la 2. */
const normalizarVersion = (body = {}, { esOriginal }) => {
  const errores = [];
  let monto = null;
  if (body.monto !== undefined && body.monto !== null && body.monto !== '') {
    monto = F.leerMonto(body.monto);
    if (monto === false) { errores.push('El monto debe ser un número mayor que cero'); monto = null; }
  }
  const nota = F.textoOpcional(body.nota, 2000) || null;
  if (!esOriginal && (!nota || nota.length < 3)) errores.push('Explica qué cambió en esta versión (mínimo 3 caracteres)');
  return { monto, nota, errores };
};

/** Valida el archivo subido. Devuelve { ext } o { error }. */
const leerArchivo = (file) => {
  if (!file) return { error: 'Selecciona el archivo de la cotización (PDF, imagen, Word o Excel)' };
  const ext = documentos.detectar(file.buffer, file.originalname);
  if (!ext) return { error: 'El archivo no es un PDF, imagen, Word, Excel o PowerPoint válido, o está dañado' };
  return { ext };
};

const datosArchivo = (file, ext, nombreInterno) => ({
  nombreOriginal: documentos.limpiarNombre(file.originalname, ext),
  archivo: nombreInterno,
  mime: documentos.TIPOS[ext],
  tamano: file.size,
  sha256: documentos.huella(file.buffer),
});

// ---------------------------------------------------------------------------
// Quien la ve: { restringido, reglas: [{ area, rol, usuarioId }] }, validado
// como en la base de conocimiento (utils/accesoConocimiento.utils.js).
// ---------------------------------------------------------------------------

/** Acceso que manda el formulario, si viene. Sin el permiso `acceso`: { prohibido: true }. */
const leerAcceso = async (entrada, usuario) => {
  if (entrada === undefined) return { acceso: null, errores: [] };
  if (!gestionaAcceso(usuario)) return { prohibido: true };
  const { restringido, filas, errores } = await normalizarAcceso(entrada, {
    areas: (configEnCache().reglas?.areas || []).map((a) => a.clave),
    existentes: async (ids) => (await prisma.usuario.findMany({ where: { id: { in: ids }, rol: { in: ROLES_CRM } }, select: { id: true } })).map((u) => u.id),
  });
  return { acceso: errores.length ? null : { restringido, filas }, errores };
};

/** En multipart el acceso llega como texto JSON. */
const accesoDeFormulario = (valor) => {
  if (valor === undefined || valor === '') return undefined;
  try {
    return JSON.parse(valor);
  } catch {
    return null; // normalizarAcceso lo rechaza
  }
};

/** Datos de Prisma para guardar el acceso al crear (o reemplazarlo). */
const datosAcceso = (acceso, { reemplazar = false } = {}) => {
  if (!acceso) return {};
  return {
    restringido: acceso.restringido,
    accesos: reemplazar ? { deleteMany: {}, create: acceso.filas } : { create: acceso.filas },
  };
};

/** El acceso en palabras, para la bitacora: "solo Marketing (toda el área), Ana López". */
const describirAcceso = async ({ restringido, filas }) => {
  if (!restringido) return 'todos los que ven cotizaciones';
  if (!filas.length) return 'solo quien la registró y el administrador general';
  const areas = new Map((configEnCache().reglas?.areas || []).map((a) => [a.clave, a.nombre || a.clave.charAt(0) + a.clave.slice(1).toLowerCase()]));
  const ids = filas.filter((f) => f.usuarioId).map((f) => f.usuarioId);
  const personas = ids.length ? await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } }) : [];
  const nombres = new Map(personas.map((p) => [p.id, p.nombre]));
  const partes = filas.map((f) => {
    if (f.usuarioId) return nombres.get(f.usuarioId) || `persona #${f.usuarioId}`;
    const rol = f.rol === 'admin' ? 'administradores' : 'miembros';
    if (!f.area) return `${rol} de todas las áreas`;
    return `${areas.get(f.area) || f.area} (${f.rol ? `solo ${rol}` : 'toda el área'})`;
  });
  return `solo ${partes.join(', ')}`;
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/cotizaciones?q=&tipo=&estado=&anio=&page=&limit=
// &relacionadoCon= (empresa como contraparte o como cliente: ficha del cliente)
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').toUpperCase();
    const estado = String(req.query.estado || '').toUpperCase();
    const anio = F.leerAnio(req.query.anio, null);
    const filtroTipo = F.TIPOS_COTIZACION.includes(tipo) ? { tipo } : null;
    // Solo las que la persona ve, tambien en los conteos.
    const visibles = F.accesoCotizaciones(req.usuario);
    const where = combinarWhere(
      visibles,
      construirBusqueda(req.query.q, ['folio', 'titulo', 'contraparteNombre', 'descripcion']),
      filtroTipo,
      F.ESTADOS_COTIZACION.includes(estado) ? { estado } : null,
      anio ? { fecha: { gte: F.rangoAnio(anio).inicio, lt: F.rangoAnio(anio).fin } } : null,
      F.relacionadoCon(req.query.relacionadoCon),
    );
    const [cotizaciones, porEstado] = await Promise.all([
      prisma.cotizacion.findMany({ where, include: incluirListado, orderBy: [{ fecha: 'desc' }, { id: 'desc' }] }),
      // Conteos de la cabecera: con el tipo elegido, sin los demas filtros.
      prisma.cotizacion.groupBy({ by: ['estado'], where: combinarWhere(visibles, filtroTipo), _count: { _all: true } }),
    ]);
    const lista = cotizaciones.map(serializarListado);
    const { items, meta } = paginar(lista, parsearPaginacion(req.query, { limitePorDefecto: 25 }));
    const conteos = Object.fromEntries(F.ESTADOS_COTIZACION.map((e) => [e, porEstado.find((g) => g.estado === e)?._count._all ?? 0]));
    return res.json(meta ? { cotizaciones: items, meta, conteos } : { cotizaciones: items, conteos });
  } catch (error) {
    console.error('[finanzas.cotizaciones.listar]', error);
    return res.status(500).json({ error: 'Error al listar las cotizaciones' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/cotizaciones/:id
// ---------------------------------------------------------------------------
const obtener = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const cotizacion = await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), include: incluirDetalle(req.usuario) });
    if (!cotizacion) return res.status(404).json({ error: 'Cotización no encontrada' });
    return res.json({ cotizacion: serializarDetalle(cotizacion) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.obtener]', error);
    return res.status(500).json({ error: 'Error al leer la cotización' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/cotizaciones/compartidas  -> { total }
// Cuantas ve la persona. El menu pregunta con esto a quien no tiene el
// permiso de ver cotizaciones: si le compartieron alguna, le aparece.
// ---------------------------------------------------------------------------
const compartidas = async (req, res) => {
  try {
    const total = await prisma.cotizacion.count({ where: F.accesoCotizaciones(req.usuario) || undefined });
    return res.json({ total });
  } catch (error) {
    console.error('[finanzas.cotizaciones.compartidas]', error);
    return res.status(500).json({ error: 'Error al revisar las cotizaciones' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/cotizaciones/con-permiso  (permiso "acceso") -> { ids }
// Personas activas con el permiso de ver cotizaciones: las que ven una sin
// restringir. La ventana de acceso las usa para decir quienes la veran.
// ---------------------------------------------------------------------------
const conPermiso = async (_req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { estado: 'activo', rol: { in: ROLES_CRM } },
      select: { id: true, rol: true, area: true, permisos: true, permisosFinanzas: true },
    });
    return res.json({ ids: usuarios.filter((u) => F.puedeVer(u, 'cotizaciones')).map((u) => u.id) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.conPermiso]', error);
    return res.status(500).json({ error: 'Error al revisar quién ve las cotizaciones' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/cotizaciones  (multipart: archivo + datos + monto + nota
// y, con el permiso "acceso", quien la ve en JSON). Crea la cotizacion con su
// version 1 (la original).
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  const { ext, error: errorArchivo } = leerArchivo(req.file);
  const { data, errores } = await normalizar(req.body);
  const version = normalizarVersion(req.body, { esOriginal: true });
  const acceso = await leerAcceso(accesoDeFormulario(req.body.acceso), req.usuario);
  if (acceso.prohibido) return F.sinPermiso(res);
  errores.push(...version.errores, ...acceso.errores);
  if (errorArchivo) errores.unshift(errorArchivo);
  if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la cotización', detalles: errores });

  let nombreInterno = null;
  try {
    nombreInterno = await almacen.guardar(req.file.buffer, ext);
    const cotizacion = await prisma.$transaction(async (tx) => {
      const nueva = await tx.cotizacion.create({ data: { ...data, ...datosAcceso(acceso.acceso), folio: `TMP-${crypto.randomUUID()}`, creadoPorId: req.usuario.id } });
      await tx.versionCotizacion.create({
        data: { cotizacionId: nueva.id, numero: 1, monto: version.monto, nota: version.nota, subidoPorId: req.usuario.id, ...datosArchivo(req.file, ext, nombreInterno) },
      });
      return tx.cotizacion.update({ where: { id: nueva.id }, data: { folio: F.folio('COT', nueva.id, data.fecha) }, include: incluirDetalle(req.usuario) });
    });
    const quienes = acceso.acceso?.restringido ? `. La ven ${await describirAcceso(acceso.acceso)}` : '';
    F.registrarFinanzas(req.usuario, 'cotizacion', cotizacion.id, 'CREAR', `Registró la cotización ${cotizacion.folio} "${cotizacion.titulo}" (${cotizacion.tipo === 'RECIBIDA' ? 'de' : 'para'} ${cotizacion.contraparteNombre}) con el archivo "${cotizacion.versiones[0].nombreOriginal}"${version.monto ? ` por ${version.monto} ${cotizacion.moneda}` : ''}${quienes}`);
    return res.status(201).json({ mensaje: `Cotización ${cotizacion.folio} registrada`, cotizacion: serializarDetalle(cotizacion) });
  } catch (error) {
    if (nombreInterno) await almacen.borrar(nombreInterno).catch(() => {});
    console.error('[finanzas.cotizaciones.crear]', error);
    return res.status(500).json({ error: 'Error al registrar la cotización' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/cotizaciones/:id/versiones  (multipart: archivo + monto + nota)
// ---------------------------------------------------------------------------
const nuevaVersion = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { ext, error: errorArchivo } = leerArchivo(req.file);
  const version = normalizarVersion(req.body, { esOriginal: false });
  const errores = [...(errorArchivo ? [errorArchivo] : []), ...version.errores];
  if (errores.length) return res.status(400).json({ error: 'Revisa la nueva versión', detalles: errores });

  let nombreInterno = null;
  try {
    const actual = await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), select: { id: true, folio: true, moneda: true } });
    if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
    const sha256 = documentos.huella(req.file.buffer);
    const repetida = await prisma.versionCotizacion.findFirst({ where: { cotizacionId: id, sha256 }, select: { numero: true } });
    if (repetida) return res.status(409).json({ error: `Ese archivo ya está cargado como versión ${repetida.numero}` });

    nombreInterno = await almacen.guardar(req.file.buffer, ext);
    // Dos versiones a la vez: tocar primero la cotizacion bloquea su fila, asi
    // que la segunda espera y lee el numero ya ocupado. Si aun asi chocan
    // (llave unica cotizacion+numero o conflicto de la base), se reintenta.
    const crearVersion = () => prisma.$transaction(async (tx) => {
      await tx.cotizacion.update({ where: { id }, data: { actualizadoEn: new Date() } });
      const ultima = await tx.versionCotizacion.aggregate({ where: { cotizacionId: id }, _max: { numero: true } });
      return tx.versionCotizacion.create({
        data: {
          cotizacionId: id, numero: (ultima._max.numero || 0) + 1, monto: version.monto, nota: version.nota, subidoPorId: req.usuario.id, ...datosArchivo(req.file, ext, nombreInterno),
        },
        select: selectVersion,
      });
    });
    let creada;
    for (let intento = 1; !creada; intento += 1) {
      try {
        creada = await crearVersion();
      } catch (error) {
        if (intento >= 3 || !['P2002', 'P2034'].includes(error?.code)) throw error;
        await new Promise((r) => { setTimeout(r, 50 * intento); });
      }
    }
    F.registrarFinanzas(req.usuario, 'cotizacion', id, 'VERSION', `Subió la versión ${creada.numero} de ${actual.folio} ("${creada.nombreOriginal}")${version.monto ? ` por ${version.monto} ${actual.moneda}` : ''}: ${version.nota}`);
    return res.status(201).json({ mensaje: `Versión ${creada.numero} cargada`, version: { ...creada, monto: montoONull(creada.monto) } });
  } catch (error) {
    if (nombreInterno) await almacen.borrar(nombreInterno).catch(() => {});
    console.error('[finanzas.cotizaciones.nuevaVersion]', error);
    return res.status(500).json({ error: 'Error al guardar la nueva versión' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/finanzas/cotizaciones/:id  (permiso "editar"; no toca archivos)
// Como todo lo demas, solo sobre una cotizacion que la persona ve. Con el
// permiso "acceso" puede traer tambien quien la ve ({ restringido, reglas }),
// como el editor de la base de conocimiento.
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.cotizacion.findFirst({ where: visible(id, req.usuario) });
    if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
    const { data, errores } = await normalizar(req.body, { parcial: true });
    const acceso = await leerAcceso(req.body?.acceso, req.usuario);
    if (acceso.prohibido) return F.sinPermiso(res);
    errores.push(...acceso.errores);
    const final = { ...actual, ...data };
    if (!final.empresaId && !final.contraparteNombre) errores.push('Indica de qué proveedor es o a qué cliente se envió');
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la cotización', detalles: errores });
    if (Object.keys(data).length === 0 && !acceso.acceso) return res.status(400).json({ error: 'No hay cambios que guardar' });
    const cotizacion = await prisma.cotizacion.update({
      where: { id },
      data: { ...data, ...datosAcceso(acceso.acceso, { reemplazar: true }) },
      include: incluirDetalle(req.usuario),
    });
    if (Object.keys(data).length) F.registrarFinanzas(req.usuario, 'cotizacion', id, 'EDITAR', `Corrigió los datos de ${cotizacion.folio} (${Object.keys(data).join(', ')})`);
    if (acceso.acceso) F.registrarFinanzas(req.usuario, 'cotizacion', id, 'ACCESO', `Cambió quién ve ${cotizacion.folio}: ${await describirAcceso(acceso.acceso)}`);
    // Quien se quita a si mismo de la lista deja de verla.
    const sigueViendo = Boolean(await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), select: { id: true } }));
    return res.json({ mensaje: 'Cotización actualizada', sinAcceso: !sigueViendo, ...(sigueViendo ? { cotizacion: serializarDetalle(cotizacion) } : {}) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar la cotización' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/cotizaciones/:id/estado  { estado }  (permiso "aprobar")
// ---------------------------------------------------------------------------
const cambiarEstado = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const estado = String(req.body?.estado || '').toUpperCase();
  if (!F.ESTADOS_COTIZACION.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  try {
    const actual = await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), select: { folio: true, estado: true } });
    if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (actual.estado === estado) return res.status(409).json({ error: 'La cotización ya tiene ese estado' });
    const cotizacion = await prisma.cotizacion.update({ where: { id }, data: { estado }, include: incluirDetalle(req.usuario) });
    const nombres = { PENDIENTE: 'pendiente', APROBADA: 'aprobada', RECHAZADA: 'rechazada' };
    F.registrarFinanzas(req.usuario, 'cotizacion', id, 'ESTADO', `Marcó ${actual.folio} como ${nombres[estado]} (antes ${nombres[actual.estado]})`);
    return res.json({ mensaje: `Cotización ${nombres[estado]}`, cotizacion: serializarDetalle(cotizacion) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.cambiarEstado]', error);
    return res.status(500).json({ error: 'Error al cambiar el estado' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/finanzas/cotizaciones/:id/acceso  (permiso "acceso"; { restringido, reglas })
// ---------------------------------------------------------------------------
const cambiarAcceso = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), select: { folio: true } });
    if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
    const acceso = await leerAcceso(req.body || {}, req.usuario);
    if (acceso.prohibido) return F.sinPermiso(res);
    if (acceso.errores.length) return res.status(400).json({ error: 'Revisa el acceso', detalles: acceso.errores });
    const cotizacion = await prisma.cotizacion.update({
      where: { id },
      data: datosAcceso(acceso.acceso, { reemplazar: true }),
      include: incluirDetalle(req.usuario),
    });
    F.registrarFinanzas(req.usuario, 'cotizacion', id, 'ACCESO', `Cambió quién ve ${actual.folio}: ${await describirAcceso(acceso.acceso)}`);
    // Quien se quita a si mismo de la lista deja de verla.
    const sigueViendo = Boolean(await prisma.cotizacion.findFirst({ where: visible(id, req.usuario), select: { id: true } }));
    return res.json({ mensaje: 'Acceso actualizado', sinAcceso: !sigueViendo, ...(sigueViendo ? { cotizacion: serializarDetalle(cotizacion) } : {}) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.cambiarAcceso]', error);
    return res.status(500).json({ error: 'Error al cambiar el acceso' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/finanzas/cotizaciones/:id  (permiso "eliminar"; va a la papelera del CRM con sus archivos)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.cotizacion.findFirst({
      where: visible(id, req.usuario),
      include: { versiones: { orderBy: { numero: 'asc' } }, accesos: true, empresa: { select: { nombre: true } } },
    });
    if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
    // A la papelera del CRM (services/papelera.service.js), con quien la veia:
    // las versiones no se borran.
    await papelera.conPapelera({
      tipo: 'cotizacion', modulo: 'cotizaciones', entidadId: id, nombre: [actual.folio, actual.titulo].filter(Boolean).join(' · '),
      contexto: actual.empresa?.nombre || actual.contraparteNombre || null, datos: actual,
      archivos: actual.versiones.map((v) => ({ ...papelera.archivoDeAlmacen('cotizaciones', v), nombre: `v${v.numero} · ${v.nombreOriginal}` })),
    }, () => prisma.cotizacion.delete({ where: { id } }));
    F.registrarFinanzas(req.usuario, 'cotizacion', id, 'ELIMINAR', `Eliminó la cotización ${actual.folio} "${actual.titulo}" con sus ${actual.versiones.length} versiones`);
    return res.json({ mensaje: `Cotización ${actual.folio} eliminada` });
  } catch (error) {
    console.error('[finanzas.cotizaciones.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar la cotización' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/cotizaciones/versiones/:id/archivo  (?descargar=1)
// ---------------------------------------------------------------------------
const verArchivo = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Solo de una cotizacion que la persona ve.
    const visibles = F.accesoCotizaciones(req.usuario);
    const version = await prisma.versionCotizacion.findFirst({
      where: combinarWhere({ id }, visibles ? { cotizacion: visibles } : null),
      select: { archivo: true, mime: true, nombreOriginal: true },
    });
    if (!version) return res.status(404).json({ error: 'Archivo no encontrado' });
    let contenido;
    try {
      contenido = await almacen.leer(version.archivo);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(410).json({ error: 'El archivo ya no está en el servidor' });
      throw error;
    }
    return documentos.enviar(res, { contenido, mime: version.mime, nombreOriginal: version.nombreOriginal, descargar: Boolean(req.query.descargar) });
  } catch (error) {
    console.error('[finanzas.cotizaciones.verArchivo]', error);
    return res.status(500).json({ error: 'Error al leer el archivo' });
  }
};

module.exports = {
  // Para "Mandar a finanzas" (finanzasDesdeAdjunto.controller.js).
  normalizar,
  normalizarVersion,
  leerAcceso,
  datosAcceso,
  describirAcceso,
  visible,
  incluirDetalle,
  serializarDetalle,
  selectVersion,
  listar, obtener, compartidas, conPermiso, crear, nuevaVersion, editar, cambiarEstado, cambiarAcceso, eliminar, verArchivo,
};
