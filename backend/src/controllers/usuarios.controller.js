const prisma = require('../lib/prisma');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const bcrypt = require('bcryptjs');
const { sortTareas } = require('../utils/sort.utils');
const { esAdminGlobal, veTodosLosUsuarios, gestionaUsuariosDe } = require('../utils/permissions.utils');
const {
  alcanceDe, ajustesDe, heredados, permisosEfectivos, limpiarMapa, catalogoPublico,
} = require('../utils/permisosArea.utils');
const { configEnCache } = require('../services/configuracion.service');
const { rangoDiaMexico, rangoSemanaMexico } = require('../utils/fechas.utils');
const { validarPasswordNueva, esAreaValida, esRolValido, esEmailValido } = require('../utils/security.utils');
const { subirArchivo, borrarBlobs, esBlobVercel, esLocal } = require('../utils/blob.utils');
const { invalidarCacheUsuario } = require('../middlewares/auth.middleware');
const { Prisma } = require('@prisma/client');
const { generarInvitacion } = require('./auth.controller');
const {
  enviarInvitacion,
  enviarCuentaAprobada,
  enviarAvisoCorreoCambiado,
  enviarAvisoPasswordCambiada,
  enviarAvisoPasswordCambiadaPorAdmin,
} = require('../services/email.service');
const { revocarTodas, datosCliente } = require('../services/sesiones.service');

const contextoCorreo = (req) => ({ ...datosCliente(req), fecha: new Date() });
const { TIPOS, registrarEvento } = require('../services/seguridad.service');

// La cuenta de configuracion de la instalacion no es parte del equipo: no
// sale en listas ni se puede editar, activar o desactivar desde Usuarios.
// Solo el equipo: ni la cuenta de configuración ni las del portal de clientes.
const SIN_CONFIGURADOR = { rol: { in: ['ADMIN', 'MIEMBRO'] } };

// Cortes de "hoy" y "esta semana" en hora de Mexico (lunes a domingo, igual
// que el Inicio: `rangoSemanaMexico`). El servidor corre en UTC:
// `setHours(23,59,59)` marcaba las 18:00 de Mexico como fin del dia.
const finDeSemanaMexico = () => rangoSemanaMexico().fin;

// Regla unica de "tarea de una persona": cuenta para quien figura como
// responsable (asignado principal o co-asignado), nunca por ser el creador.
// Es la misma regla que usa stats.controller; antes Miembros e Inicio daban
// totales distintos para la misma persona.
const esResponsable = (tarea, usuarioId) => (
  tarea.asignadoId === usuarioId
  || (tarea.asignados || []).some((a) => a.id === usuarioId)
);
const whereResponsable = (usuarioIds) => ({
  OR: [
    { asignadoId: { in: usuarioIds } },
    { asignados: { some: { id: { in: usuarioIds } } } },
  ],
});

const tareaResumenSelect = {
  id: true,
  titulo: true,
  numeroActividad: true,
  estado: true,
  prioridad: true,
  creadoEn: true,
  completadoEn: true,
  venceEn: true,
  fechaInicio: true,
  asignadoId: true,
  asignados: { select: { id: true } },
  creadorId: true,
  proyecto: {
    select: { id: true, nombre: true }
  }
};

const resumenTarea = (tarea) => ({
  id: tarea.id,
  titulo: tarea.titulo,
  numeroActividad: tarea.numeroActividad,
  estado: tarea.estado,
  prioridad: tarea.prioridad,
  creadoEn: tarea.creadoEn,
  completadoEn: tarea.completadoEn,
  venceEn: tarea.venceEn,
  fechaInicio: tarea.fechaInicio,
  proyecto: tarea.proyecto
});

const resumenPorProyecto = (...grupos) => {
  const proyectos = new Map();

  grupos.flat().forEach(tarea => {
    const id = tarea.proyecto?.id || 'sin-proyecto';
    const nombre = tarea.proyecto?.nombre || 'Sin proyecto';
    if (!proyectos.has(id)) {
      proyectos.set(id, { id, nombre, total: 0, hechas: 0, enProgreso: 0, pendientes: 0 });
    }
    const proyecto = proyectos.get(id);
    proyecto.total += 1;
    if (tarea.estado === 'HECHO') proyecto.hechas += 1;
    if (tarea.estado === 'EN_PROGRESO') proyecto.enProgreso += 1;
    if (tarea.estado === 'PENDIENTE') proyecto.pendientes += 1;
  });

  return [...proyectos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
};

const proyectoResumenSelect = {
  select: {
    id: true,
    nombre: true,
    estado: true,
    area: true,
    fechaInicio: true,
    fechaFin: true,
  },
  orderBy: { nombre: 'asc' }
};

// Las columnas telefono/puesto/biografia/foto_perfil_url ya estan en el
// schema y en la migracion 20260530170000, asi que se leen y escriben con
// Prisma normal (antes habia un fallback con $queryRaw/$executeRaw).
const perfilUsuarioSelect = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  puesto: true,
  biografia: true,
  fotoPerfilUrl: true,
  area: true,
  rol: true,
  estado: true,
  creadoEn: true,
  googleCalendarEmail: true,
  proyectosMiembro: proyectoResumenSelect,
  proyectosCreados: proyectoResumenSelect,
};

const obtenerPerfilUsuario = (usuarioId) => prisma.usuario.findUnique({
  where: { id: usuarioId },
  select: perfilUsuarioSelect,
});

const normalizarPerfil = (usuario, extra = {}) => ({
  ...usuario,
  resumen: {
    proyectosActivos: usuario.proyectosMiembro.filter((proyecto) => proyecto.estado === 'ACTIVO').length,
    proyectosCreados: usuario.proyectosCreados.length,
    ...extra,
  },
});

const contadoresPerfil = (usuarioId) => Promise.all([
  prisma.tarea.count({ where: { asignadoId: usuarioId } }),
  prisma.tarea.count({ where: { creadorId: usuarioId } }),
  prisma.notificacion.count({ where: { usuarioId, leida: false } }),
]);

const obtenerActividadUsuario = async (usuarioId) => {
  // Esta función se mantiene para compatibilidad con el endpoint individual /actividad
  const { inicio: hoyInicio, fin: hoyFin } = rangoDiaMexico();
  const semanaFin = finDeSemanaMexico();
  const tareasDelUsuario = whereResponsable([usuarioId]);

  const [hechas, enProgreso, faltanHoy, faltanSemana] = await Promise.all([
    // "Hechas hoy": por fecha de cierre (`completadoEn`) dentro del dia
    // mexicano. Antes devolvia todas las HECHO de la historia.
    prisma.tarea.findMany({
      where: { ...tareasDelUsuario, estado: 'HECHO', completadoEn: { gte: hoyInicio, lte: hoyFin } },
      select: tareaResumenSelect
    }),
    prisma.tarea.findMany({
      where: { ...tareasDelUsuario, estado: 'EN_PROGRESO' },
      select: tareaResumenSelect
    }),
    prisma.tarea.findMany({
      where: { ...tareasDelUsuario, estado: 'PENDIENTE' },
      select: tareaResumenSelect
    }),
    prisma.tarea.findMany({
      where: {
        ...tareasDelUsuario,
        estado: { not: 'HECHO' },
        venceEn: { gt: hoyFin, lte: semanaFin }
      },
      select: tareaResumenSelect
    })
  ]);

  const hechasResumen = sortTareas(hechas).map(resumenTarea);
  const enProgresoResumen = sortTareas(enProgreso).map(resumenTarea);
  const faltanResumen = sortTareas(faltanHoy).map(resumenTarea);
  const faltanSemanaResumen = sortTareas(faltanSemana).map(resumenTarea);

  return {
    hechasHoy: hechasResumen,
    enProgreso: enProgresoResumen,
    faltanHoy: faltanResumen,
    faltanSemana: faltanSemanaResumen,
    porProyecto: resumenPorProyecto(hechasResumen, enProgresoResumen, faltanResumen),
    totales: {
      hechasHoy: hechas.length,
      enProgreso: enProgreso.length,
      faltanHoy: faltanHoy.length,
      faltanSemana: faltanSemana.length
    }
  };
};

// Cache simple en memoria para acelerar la respuesta de la lista de usuarios.
// Solo guarda (y sirve) la lista completa del admin global: un admin de area
// la llenaba con su lista parcial y se le servia al global.
let cacheUsuarios = null;
let ultimaActualizacion = 0;
const CACHE_TTL = 30000; // 30 segundos

const limpiarCacheUsuarios = () => {
  cacheUsuarios = null;
  ultimaActualizacion = 0;
};

// Foto de perfil: se guarda en el disco del servidor (carpeta perfiles).
const guardarFotoPerfil = async (file) => {
  if (!file) return undefined;
  return subirArchivo(file, 'perfiles');
};

// "usuarios.ver": ninguno = solo el directorio basico (nombre, area, rol);
// area = gestiona a los de su area; todos = a cualquiera.
const veGestion = (usuario) => esAdminGlobal(usuario) || alcanceDe(usuario, 'usuarios.ver') !== 'ninguno';
const veTodos = veTodosLosUsuarios;
const alcanzaArea = gestionaUsuariosDe;

const obtenerFiltroUsuariosGestion = (usuario) => (veTodos(usuario) ? {} : { area: usuario.area });

// Devuelve todos los usuarios con su actividad pre-calculada de forma eficiente
const listar = async (req, res) => {
  try {
    const ahoraMs = Date.now();
    const filtroGestion = obtenerFiltroUsuariosGestion(req.usuario);
    const solicitanteGlobal = veTodos(req.usuario);
    const gestiona = veGestion(req.usuario);

    // Filtros opcionales (?q= &area= &rol= &estado=) y paginacion.
    // Sin parametros la respuesta sale completa, como antes.
    const paginacion = parsearPaginacion(req.query, { limitePorDefecto: 10 });
    const busqueda = construirBusqueda(req.query.q, ['nombre', 'email']);
    const filtrosExtra = combinarWhere(
      busqueda,
      req.query.area ? { area: String(req.query.area).toUpperCase() } : null,
      req.query.rol ? { rol: String(req.query.rol).toUpperCase() } : null,
      req.query.estado ? { estado: String(req.query.estado).toLowerCase() } : null,
    );
    const hayFiltros = Boolean(filtrosExtra);
    const responder = (lista, extra = {}) => {
      const { items, meta } = paginar(lista, paginacion);
      return res.json({ usuarios: items, ...extra, ...(meta && { meta }) });
    };

    // Si hay datos en caché y no han expirado, devolverlos de inmediato.
    // La cache guarda la lista completa (quien ve a todos), asi que solo sirve
    // cuando no hay filtros; paginar sobre ella si es correcto porque es el
    // mismo conjunto.
    if (cacheUsuarios && !hayFiltros && solicitanteGlobal && (ahoraMs - ultimaActualizacion < CACHE_TTL)) {
      return responder(cacheUsuarios, { cached: true });
    }

    const usuarios = await prisma.usuario.findMany({
      where: combinarWhere(gestiona ? filtroGestion : undefined, filtrosExtra, SIN_CONFIGURADOR),
      orderBy: { nombre: 'asc' },
      select: {
        id:     true,
        nombre: true,
        email:  true,
        fotoPerfilUrl: true,
        area:   true,
        rol:    true,
        creadoEn: true,
        estado: true,
      },
    });

    if (!gestiona) return responder(usuarios);

    // OPTIMIZACIÓN: Obtener solo tareas relevantes (activas o terminadas hoy) en una sola consulta.
    // "Hoy" se corta en hora de Mexico y por fecha de cierre (`completadoEn`).
    const { inicio: hoyInicio, fin: hoyFin } = rangoDiaMexico();
    const semanaFin = finDeSemanaMexico();

    const todasTareas = await prisma.tarea.findMany({
      where: {
        AND: [
          whereResponsable(usuarios.map(u => u.id)),
          {
            OR: [
              { estado: { in: ['PENDIENTE', 'EN_PROGRESO'] } },
              { AND: [{ estado: 'HECHO' }, { completadoEn: { gte: hoyInicio, lte: hoyFin } }] }
            ]
          }
        ]
      },
      select: tareaResumenSelect,
    });

    // Procesar en memoria para cada usuario
    const usuariosConActividad = usuarios.map(usuario => {
      const id = usuario.id;

      // Filtrar tareas del usuario
      const hechasHoy = todasTareas.filter(t => esResponsable(t, id) && t.estado === 'HECHO');
      const enProgreso = todasTareas.filter(t => esResponsable(t, id) && t.estado === 'EN_PROGRESO');
      const faltanHoy = todasTareas.filter(t => esResponsable(t, id) && t.estado === 'PENDIENTE');
      const faltanSemana = todasTareas.filter(t =>
        esResponsable(t, id) &&
        t.estado !== 'HECHO' &&
        t.venceEn && t.venceEn > hoyFin && t.venceEn <= semanaFin
      );

      const hR = sortTareas(hechasHoy).map(resumenTarea);
      const eR = sortTareas(enProgreso).map(resumenTarea);
      const fR = sortTareas(faltanHoy).map(resumenTarea);

      return {
        ...usuario,
        actividad: {
          hechasHoy: hR,
          enProgreso: eR,
          faltanHoy: fR,
          faltanSemana: sortTareas(faltanSemana).map(resumenTarea),
          porProyecto: resumenPorProyecto(hR, eR, fR),
          totales: {
            hechasHoy: hechasHoy.length,
            enProgreso: enProgreso.length,
            faltanHoy: faltanHoy.length,
            faltanSemana: faltanSemana.length
          }
        }
      };
    });

    // Solo se cachea la lista completa (quien ve a todos): guardar un
    // resultado filtrado o parcial (solo su area) haria que la siguiente
    // peticion sin filtros recibiera datos incompletos.
    if (!hayFiltros && solicitanteGlobal) {
      cacheUsuarios = usuariosConActividad;
      ultimaActualizacion = Date.now();
    }

    return responder(usuariosConActividad);
  } catch (error) {
    console.error('[usuarios.listar]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const listarParaProyectos = async (_req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { estado: 'activo', ...SIN_CONFIGURADOR },
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        email: true,
        fotoPerfilUrl: true,
        area: true,
        rol: true,
        estado: true
      }
    });

    return res.json({ usuarios });
  } catch (error) {
    console.error('[usuarios.listarParaProyectos]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const obtenerPerfil = async (req, res) => {
  try {
    const [usuario, [tareasAsignadas, tareasCreadas, notificacionesPendientes]] = await Promise.all([
      obtenerPerfilUsuario(req.usuario.id),
      contadoresPerfil(req.usuario.id),
    ]);

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.json({
      perfil: normalizarPerfil(usuario, {
        tareasAsignadas,
        tareasCreadas,
        notificacionesPendientes,
      }),
    });
  } catch (error) {
    console.error('[usuarios.obtenerPerfil]', error);
    return res.status(500).json({ error: 'Error al obtener el perfil' });
  }
};

const actualizarPerfil = async (req, res) => {
  // Llega como multipart (foto opcional), asi que todo son strings.
  const { nombre, email, telefono, puesto, biografia, removeFoto, passwordActual } = req.body;

  try {
    const emailNormalizado = typeof email === 'string' ? email.toLowerCase().trim() : '';
    if (!nombre || !String(nombre).trim() || !emailNormalizado) {
      return res.status(400).json({ error: 'Nombre y correo son obligatorios' });
    }
    if (!esEmailValido(emailNormalizado)) {
      return res.status(400).json({ error: 'El correo no tiene un formato válido' });
    }

    const actual = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { id: true, email: true, password: true, fotoPerfilUrl: true },
    });
    if (!actual) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Cambiar el correo cambia el identificador de acceso: se exige la
    // contraseña actual para que una sesion abierta no baste para secuestrar
    // la cuenta.
    const cambiaEmail = emailNormalizado !== actual.email.toLowerCase();
    if (cambiaEmail) {
      if (!passwordActual || typeof passwordActual !== 'string') {
        return res.status(400).json({ error: 'Para cambiar el correo debes indicar tu contraseña actual' });
      }
      const coincide = await bcrypt.compare(passwordActual, actual.password);
      if (!coincide) {
        return res.status(403).json({ error: 'La contraseña actual no es correcta' });
      }

      const emailExistente = await prisma.usuario.findFirst({
        where: { email: emailNormalizado, id: { not: req.usuario.id } },
        select: { id: true },
      });
      if (emailExistente) {
        return res.status(409).json({ error: 'Ese correo ya está en uso' });
      }
    }

    const data = {
      nombre: String(nombre).trim(),
      email: emailNormalizado,
    };
    if (telefono !== undefined) data.telefono = String(telefono).trim() || null;
    if (puesto !== undefined) data.puesto = String(puesto).trim() || null;
    if (biografia !== undefined) data.biografia = String(biografia).trim() || null;

    let fotoAnterior = null;
    if (req.file) {
      data.fotoPerfilUrl = await guardarFotoPerfil(req.file);
      fotoAnterior = actual.fotoPerfilUrl;
    } else if (removeFoto === 'true' || removeFoto === true) {
      data.fotoPerfilUrl = null;
      fotoAnterior = actual.fotoPerfilUrl;
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data,
      select: perfilUsuarioSelect,
    });

    // La foto anterior se borra para no dejar huerfanos (disco o Blob antiguo).
    if (fotoAnterior && (esLocal(fotoAnterior) || esBlobVercel(fotoAnterior)) && fotoAnterior !== usuario.fotoPerfilUrl) {
      await borrarBlobs([fotoAnterior]);
    }

    const [tareasAsignadas, tareasCreadas, notificacionesPendientes] = await contadoresPerfil(req.usuario.id);

    limpiarCacheUsuarios();
    if (cambiaEmail) {
      invalidarCacheUsuario(req.usuario.id);
      await registrarEvento(req, {
        usuarioId: req.usuario.id,
        email: emailNormalizado,
        tipo: TIPOS.EMAIL_CAMBIADO,
        detalle: `${actual.email} -> ${emailNormalizado}`,
      });
      enviarAvisoCorreoCambiado({
        emailAnterior: actual.email,
        emailNuevo: emailNormalizado,
        nombre: usuario.nombre,
        contexto: contextoCorreo(req),
      });
    }

    return res.json({
      mensaje: 'Perfil actualizado',
      perfil: normalizarPerfil(usuario, {
        tareasAsignadas,
        tareasCreadas,
        notificacionesPendientes,
      }),
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Ese correo ya está en uso' });
    }
    console.error('[usuarios.actualizarPerfil]', error);
    return res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
};

// Crear nuevo usuario ("usuarios.invitar").
// Genera una invitacion real (misma logica que POST /auth/invitar) y manda
// el enlace /invitacion/:token: antes creaba el usuario en estado
// `pendiente` con un enlace que apuntaba a una invitacion inexistente.
const crear = async (req, res) => {
  const { nombre, email, area, rol } = req.body;

  if (!nombre || !String(nombre).trim() || !email) {
    return res.status(400).json({ error: 'Nombre y correo son requeridos' });
  }

  const emailNormalizado = String(email).toLowerCase().trim();
  if (!esEmailValido(emailNormalizado)) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  }

  const areaFinal = String(area || 'DESARROLLO').toUpperCase();
  const rolFinal = String(rol || 'MIEMBRO').toUpperCase();
  if (!esAreaValida(areaFinal)) {
    return res.status(400).json({ error: 'Área no válida' });
  }
  if (!esRolValido(rolFinal)) {
    return res.status(400).json({ error: 'Rol no válido' });
  }

  try {
    if (!alcanzaArea(req.usuario, areaFinal)) {
      return res.status(403).json({ error: 'Solo puedes crear usuarios de tu propia área' });
    }
    if (rolFinal === 'ADMIN' && !esAdminGlobal(req.usuario)) {
      return res.status(403).json({ error: 'Solo el administrador global puede asignar el rol de administrador' });
    }

    const existe = await prisma.usuario.findUnique({ where: { email: emailNormalizado }, select: { id: true } });
    if (existe) return res.status(409).json({ error: 'El correo ya está registrado' });

    const { token } = await generarInvitacion({
      nombre,
      email: emailNormalizado,
      area: areaFinal,
      rol: rolFinal,
      creadoPor: req.usuario.id,
    });

    let advertencia = null;
    try {
      await enviarInvitacion({ nombre: String(nombre).trim(), email: emailNormalizado, token });
    } catch (errorCorreo) {
      console.error('[usuarios.crear] No se pudo enviar el correo:', errorCorreo?.message || errorCorreo);
      advertencia = 'La invitación se guardó pero no se pudo enviar el correo. Puedes reenviarla desde la lista de invitaciones.';
    }

    limpiarCacheUsuarios();
    return res.status(201).json({
      mensaje: advertencia ? `Invitación guardada para ${emailNormalizado}` : `Invitación enviada a ${emailNormalizado}`,
      invitacion: { nombre: String(nombre).trim(), email: emailNormalizado, area: areaFinal, rol: rolFinal },
      ...(advertencia && { advertencia }),
    });
  } catch (error) {
    console.error('[usuarios.crear]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Editar usuario ("usuarios.editar")
const editar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre, email, password, area, rol } = req.body;

  try {
    const objetivo = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, area: true, rol: true, email: true, nombre: true }
    });

    if (!objetivo || objetivo.rol === 'CONFIGURADOR' || objetivo.rol === 'CLIENTE') {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const rolNormalizado = rol !== undefined && rol !== null && rol !== '' ? String(rol).toUpperCase() : undefined;
    const areaNormalizada = area !== undefined && area !== null && area !== '' ? String(area).toUpperCase() : undefined;
    const cambiaPassword = typeof password === 'string' && password.trim() !== '';

    if (rolNormalizado !== undefined && !esRolValido(rolNormalizado)) {
      return res.status(400).json({ error: 'Rol no válido' });
    }
    if (areaNormalizada !== undefined && !esAreaValida(areaNormalizada)) {
      return res.status(400).json({ error: 'Área no válida' });
    }

    // Fuera del administrador general, se gestiona a los miembros que alcanza
    // "usuarios.ver": sin tocar a administradores, ni ascender a nadie, ni
    // cambiar contraseñas.
    if (!esAdminGlobal(req.usuario)) {
      if (!alcanzaArea(req.usuario, objetivo.area)) {
        return res.status(403).json({ error: 'Solo puedes editar usuarios de tu propia área' });
      }
      if (objetivo.rol === 'ADMIN') {
        return res.status(403).json({ error: 'Solo el administrador global puede editar a otros administradores' });
      }
      if (rolNormalizado === 'ADMIN') {
        return res.status(403).json({ error: 'Solo el administrador global puede asignar el rol de administrador' });
      }
      if (cambiaPassword) {
        return res.status(403).json({ error: 'Solo el administrador global puede cambiar contraseñas' });
      }
      if (areaNormalizada !== undefined && !alcanzaArea(req.usuario, areaNormalizada)) {
        return res.status(403).json({ error: 'No puedes mover usuarios a otra área' });
      }
    }

    if (id === req.usuario.id && rolNormalizado !== undefined && rolNormalizado !== req.usuario.rol) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }

    const data = {};

    if (nombre !== undefined) {
      const nombreLimpio = String(nombre).trim();
      if (!nombreLimpio) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      data.nombre = nombreLimpio;
    }

    if (email !== undefined) {
      const emailNormalizado = String(email).toLowerCase().trim();
      if (!esEmailValido(emailNormalizado)) {
        return res.status(400).json({ error: 'El correo no tiene un formato válido' });
      }
      if (emailNormalizado !== objetivo.email.toLowerCase()) {
        const duplicado = await prisma.usuario.findFirst({
          where: { email: emailNormalizado, id: { not: id } },
          select: { id: true },
        });
        if (duplicado) return res.status(409).json({ error: 'Ese correo ya está en uso' });
      }
      data.email = emailNormalizado;
    }

    if (areaNormalizada !== undefined) data.area = areaNormalizada;
    if (rolNormalizado !== undefined) data.rol = rolNormalizado;

    if (cambiaPassword) {
      const validacion = await validarPasswordNueva(password, { email: objetivo.email });
      if (!validacion.valido) {
        return res.status(400).json({ error: 'Contraseña no segura', detalles: validacion.errores });
      }
      data.password = await bcrypt.hash(password, 12);
      data.passwordCambiadoEn = new Date();
      data.intentosFallidos = 0;
      data.bloqueadoHasta = null;
    }

    const usuario = await prisma.usuario.update({
      where: { id },
      data,
      select: { id: true, nombre: true, email: true, area: true, rol: true }
    });

    // Si un admin le cambia la contraseña a alguien, sus sesiones abiertas
    // se cierran: la contraseña vieja ya no deberia dar acceso a nada.
    if (cambiaPassword) await revocarTodas(id);

    // Avisos por correo y bitácora: la persona se entera de que un admin
    // cambió su correo de acceso o su contraseña. Si el admin se edita a sí
    // mismo, el texto no dice "un administrador".
    const porAdmin = id !== req.usuario.id;
    const cambioEmail = usuario.email !== objetivo.email.toLowerCase();
    if (cambioEmail) {
      await registrarEvento(req, {
        usuarioId: id,
        email: usuario.email,
        tipo: TIPOS.EMAIL_CAMBIADO,
        detalle: `${objetivo.email} -> ${usuario.email}${porAdmin ? ` (por ${req.usuario.email})` : ''}`,
      });
      enviarAvisoCorreoCambiado({
        emailAnterior: objetivo.email,
        emailNuevo: usuario.email,
        nombre: usuario.nombre,
        porAdmin,
        contexto: contextoCorreo(req),
      });
    }
    if (cambiaPassword) {
      await registrarEvento(req, {
        usuarioId: id,
        email: usuario.email,
        tipo: TIPOS.PASSWORD_CAMBIADA,
        detalle: porAdmin ? `Por ${req.usuario.email}` : null,
      });
      const avisar = porAdmin ? enviarAvisoPasswordCambiadaPorAdmin : enviarAvisoPasswordCambiada;
      avisar({ email: usuario.email, nombre: usuario.nombre, contexto: contextoCorreo(req) });
    }

    // Limpiar cachés: la de la lista y la del middleware de autenticacion,
    // para que un cambio de rol/area aplique en la siguiente peticion.
    limpiarCacheUsuarios();
    invalidarCacheUsuario(id);
    return res.json({ mensaje: 'Usuario actualizado', usuario });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Ese correo ya está en uso' });
    }
    console.error('[usuarios.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar usuario' });
  }
};

// DELETE /usuarios/:id — ya no borra (decision del usuario): desactiva la
// cuenta. Sus adjuntos, comentarios, historial y eventos se conservan tal
// cual; el middleware de autenticacion rechaza a los usuarios inactivos.
const eliminar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    if (id === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }

    const objetivo = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, area: true, estado: true, rol: true }
    });
    if (!objetivo || objetivo.rol === 'CONFIGURADOR' || objetivo.rol === 'CLIENTE') {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!alcanzaArea(req.usuario, objetivo.area)) {
      return res.status(403).json({ error: 'Solo puedes desactivar usuarios de tu propia área' });
    }
    if (objetivo.rol === 'ADMIN' && !esAdminGlobal(req.usuario)) {
      return res.status(403).json({ error: 'Solo el administrador global puede desactivar a otros administradores' });
    }

    if (objetivo.estado !== 'inactivo') {
      await prisma.usuario.update({ where: { id }, data: { estado: 'inactivo' } });
    }
    await revocarTodas(id);

    limpiarCacheUsuarios();
    invalidarCacheUsuario(id);
    return res.json({ ok: true, desactivado: true });
  } catch (error) {
    console.error('[usuarios.eliminar]', error);
    return res.status(500).json({ error: 'Error al desactivar usuario' });
  }
};

// Cambiar estado de usuario (solo ADMIN)
const toggleEstado = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { estado } = req.body; // 'activo' o 'inactivo'

  if (!['activo', 'inactivo'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const objetivo = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, area: true, estado: true, email: true, nombre: true, rol: true }
    });

    if (!objetivo || objetivo.rol === 'CONFIGURADOR' || objetivo.rol === 'CLIENTE') {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!alcanzaArea(req.usuario, objetivo.area)) {
      return res.status(403).json({ error: 'Solo puedes cambiar el estado de usuarios de tu propia área' });
    }
    if (objetivo.rol === 'ADMIN' && !esAdminGlobal(req.usuario)) {
      return res.status(403).json({ error: 'Solo el administrador global puede cambiar el estado de otros administradores' });
    }

    if (id === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }

    const usuario = await prisma.usuario.update({
      where: { id },
      // Activar a alguien que se registro solo implica aprobar su cuenta; si
      // aun no habia verificado el correo, el admin lo da por bueno.
      data: { estado, ...(estado === 'activo' ? { verificado: true, verificationToken: null } : {}) },
      select: { id: true, nombre: true, estado: true }
    });

    if (estado === 'inactivo') await revocarTodas(id);
    const eraRegistroPendiente = ['pendiente', 'pendiente_verificacion'].includes(objetivo.estado);
    if (estado === 'activo' && eraRegistroPendiente) {
      enviarCuentaAprobada({ email: objetivo.email, nombre: objetivo.nombre });
    }

    limpiarCacheUsuarios();
    invalidarCacheUsuario(id);
    return res.json({ mensaje: `Usuario marcado como ${estado}`, usuario });
  } catch (error) {
    console.error('[usuarios.toggleEstado]', error);
    return res.status(500).json({ error: 'Error al cambiar estado del usuario' });
  }
};

const actividad = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, area: true }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!veGestion(req.usuario) || !alcanzaArea(req.usuario, usuario.area)) {
      return res.status(403).json({ error: 'Solo puedes consultar actividad de usuarios de tu propia área' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ actividad: await obtenerActividadUsuario(id) });
  } catch (error) {
    console.error('[usuarios.actividad]', error);
    return res.status(500).json({ error: 'Error al obtener actividad del usuario' });
  }
};

// ── Ajustes de permisos por persona (solo el administrador general) ──
// La persona hereda la tabla de su area y rol (Configuracion → Permisos); aqui
// se guardan solo sus excepciones, en usuarios.permisos.

const SELECT_PERMISOS = { id: true, nombre: true, area: true, rol: true, estado: true, permisos: true, permisosFinanzas: true };

const cargarObjetivoPermisos = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: 'ID inválido' }); return null; }
  if (!esAdminGlobal(req.usuario)) {
    res.status(403).json({ error: 'Solo el administrador general asigna permisos por persona' });
    return null;
  }
  const objetivo = await prisma.usuario.findUnique({ where: { id }, select: SELECT_PERMISOS });
  if (!objetivo || !['ADMIN', 'MIEMBRO'].includes(objetivo.rol)) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return null;
  }
  return objetivo;
};

const respuestaPermisos = (objetivo) => {
  const config = configEnCache();
  const { permisos: _p, permisosFinanzas: _pf, ...usuario } = objetivo;
  return {
    usuario,
    adminGeneral: esAdminGlobal(objetivo),
    catalogo: catalogoPublico(),
    heredados: heredados(objetivo, config),
    ajustes: ajustesDe(objetivo),
    efectivos: permisosEfectivos(objetivo, config),
  };
};

// GET /usuarios/:id/permisos
const obtenerPermisos = async (req, res) => {
  try {
    const objetivo = await cargarObjetivoPermisos(req, res);
    if (!objetivo) return undefined;
    res.set('Cache-Control', 'no-store');
    return res.json(respuestaPermisos(objetivo));
  } catch (error) {
    console.error('[usuarios.obtenerPermisos]', error);
    return res.status(500).json({ error: 'Error al obtener los permisos' });
  }
};

// PUT /usuarios/:id/permisos { ajustes: { clave: valor } }. {} = como su area.
// Al guardar, los permisos de finanzas anteriores quedan reemplazados.
const guardarPermisos = async (req, res) => {
  try {
    const objetivo = await cargarObjetivoPermisos(req, res);
    if (!objetivo) return undefined;
    if (esAdminGlobal(objetivo)) {
      return res.status(400).json({ error: 'El administrador general siempre tiene todos los permisos' });
    }
    const ajustes = limpiarMapa(req.body?.ajustes);
    const actualizado = await prisma.usuario.update({
      where: { id: objetivo.id },
      data: { permisos: ajustes, permisosFinanzas: Prisma.DbNull },
      select: SELECT_PERMISOS,
    });
    limpiarCacheUsuarios();
    invalidarCacheUsuario(objetivo.id);
    return res.json(respuestaPermisos(actualizado));
  } catch (error) {
    console.error('[usuarios.guardarPermisos]', error);
    return res.status(500).json({ error: 'Error al guardar los permisos' });
  }
};

module.exports = {
  listar, listarParaProyectos, obtenerPerfil, actualizarPerfil, crear, editar, eliminar, toggleEstado, actividad,
  obtenerPermisos, guardarPermisos,
};
