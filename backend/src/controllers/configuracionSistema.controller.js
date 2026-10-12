// Panel de configuración (solo CONFIGURADOR): administradores de la empresa,
// correo de prueba y estado del sistema.
//
// Administradores: el configurador NO gestiona miembros ni ve datos de la
// empresa (decisión del usuario). Solo da de alta a los administradores y
// les restablece el acceso cuando hace falta.
const crypto = require('crypto');
const fs = require('fs/promises');
const prisma = require('../lib/prisma');
const { generarInvitacion } = require('./auth.controller');
const { esAreaValida, esEmailValido, escapeHtml } = require('../utils/security.utils');
const { sha256 } = require('../utils/cifrado.utils');
const { revocarTodas } = require('../services/sesiones.service');
const { invalidarCacheUsuario } = require('../middlewares/auth.middleware');
const { registrarEvento } = require('../services/seguridad.service');
const { configEnCache } = require('../services/configuracion.service');
const { zonaHoraria } = require('../utils/fechas.utils');
const archivosContratos = require('../services/contratosArchivos.service');
const correo = require('../services/email.service');
const almacenamiento = require('../services/almacenamiento.service');

const urlFrontend = (req) => String(process.env.FRONTEND_URL || req.headers.origin || '').replace(/\/+$/, '');
const leerId = (valor) => { const n = Number.parseInt(valor, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const ACTIVO = { OR: [{ estado: 'activo' }, { estado: null }] };

const selectAdmin = {
  id: true, nombre: true, email: true, area: true, estado: true, dosFactoresActivo: true,
  ultimoLoginEn: true, bloqueadoHasta: true, creadoEn: true,
};

// GET /api/configuracion/administradores
const listarAdministradores = async (_req, res) => {
  try {
    const [admins, invitaciones, sesiones] = await Promise.all([
      prisma.usuario.findMany({ where: { rol: 'ADMIN' }, select: selectAdmin, orderBy: { nombre: 'asc' } }),
      prisma.invitacion.findMany({
        where: { rol: 'admin', estado: { not: 'aceptada' } },
        select: { id: true, nombre: true, email: true, area: true, estado: true, expiraEn: true, creadoEn: true },
        orderBy: { creadoEn: 'desc' },
      }),
      prisma.sesion.groupBy({
        by: ['usuarioId'],
        where: { revocadaEn: null, expiraEn: { gt: new Date() }, usuario: { rol: 'ADMIN' } },
        _count: { _all: true },
      }),
    ]);
    const porUsuario = Object.fromEntries(sesiones.map((s) => [s.usuarioId, s._count._all]));
    const ahora = new Date();
    return res.json({
      administradores: admins.map((a) => ({
        ...a,
        bloqueado: Boolean(a.bloqueadoHasta && a.bloqueadoHasta > ahora),
        sesionesActivas: porUsuario[a.id] || 0,
      })),
      invitaciones: invitaciones.map((i) => ({ ...i, vencida: i.expiraEn < ahora })),
    });
  } catch (error) {
    console.error('[configuracion.listarAdministradores]', error);
    return res.status(500).json({ error: 'No se pudo cargar la lista de administradores' });
  }
};

// POST /api/configuracion/administradores  { nombre, email, area }
const invitarAdministrador = async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const area = String(req.body?.area || 'ADMINISTRACION').toUpperCase();
  if (nombre.length < 3) return res.status(400).json({ error: 'Escribe el nombre completo' });
  if (!esEmailValido(email)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  if (!esAreaValida(area)) return res.status(400).json({ error: 'Área no válida' });

  try {
    if (await prisma.usuario.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
    }
    const { token } = await generarInvitacion({ nombre, email, area, rol: 'admin', creadoPor: req.usuario.id });
    const enlace = `${urlFrontend(req)}/invitacion/${token}`;
    let correoEnviado = true;
    try {
      await correo.enviarInvitacion({ nombre, email, token });
    } catch (errorCorreo) {
      correoEnviado = false;
      console.error('[configuracion.invitarAdministrador] correo:', errorCorreo?.message);
    }
    return res.status(201).json({
      mensaje: correoEnviado ? `Invitación enviada a ${email}` : 'Invitación creada, pero no se pudo enviar el correo: comparte el enlace',
      enlace,
      correoEnviado,
    });
  } catch (error) {
    console.error('[configuracion.invitarAdministrador]', error);
    return res.status(500).json({ error: 'No se pudo crear la invitación' });
  }
};

// POST /api/configuracion/administradores/invitaciones/:id/reenviar
const reenviarInvitacionAdmin = async (req, res) => {
  try {
    const invitacion = await prisma.invitacion.findUnique({ where: { id: String(req.params.id) } });
    if (!invitacion || invitacion.rol !== 'admin' || invitacion.estado === 'aceptada') {
      return res.status(404).json({ error: 'Invitación no encontrada' });
    }
    const { token } = await generarInvitacion({
      nombre: invitacion.nombre, email: invitacion.email, area: invitacion.area, rol: 'admin', creadoPor: req.usuario.id,
    });
    let correoEnviado = true;
    try {
      await correo.enviarInvitacion({ nombre: invitacion.nombre, email: invitacion.email, token });
    } catch (_e) {
      correoEnviado = false;
    }
    return res.json({ mensaje: 'Invitación renovada', enlace: `${urlFrontend(req)}/invitacion/${token}`, correoEnviado });
  } catch (error) {
    console.error('[configuracion.reenviarInvitacionAdmin]', error);
    return res.status(500).json({ error: 'No se pudo reenviar la invitación' });
  }
};

// DELETE /api/configuracion/administradores/invitaciones/:id
const eliminarInvitacionAdmin = async (req, res) => {
  try {
    const { count } = await prisma.invitacion.deleteMany({ where: { id: String(req.params.id), rol: 'admin', estado: { not: 'aceptada' } } });
    if (count === 0) return res.status(404).json({ error: 'Invitación no encontrada' });
    return res.json({ mensaje: 'Invitación eliminada' });
  } catch (error) {
    console.error('[configuracion.eliminarInvitacionAdmin]', error);
    return res.status(500).json({ error: 'No se pudo eliminar la invitación' });
  }
};

const ACCIONES = ['restablecer', 'desbloquear', 'quitar2fa', 'cerrarSesiones', 'desactivar', 'activar'];

// POST /api/configuracion/administradores/:id/acciones  { accion }
const accionAdministrador = async (req, res) => {
  const id = leerId(req.params.id);
  const accion = String(req.body?.accion || '');
  if (!id || !ACCIONES.includes(accion)) return res.status(400).json({ error: 'Acción no válida' });

  try {
    const admin = await prisma.usuario.findUnique({ where: { id }, select: { ...selectAdmin, rol: true } });
    if (!admin || admin.rol !== 'ADMIN') return res.status(404).json({ error: 'Administrador no encontrado' });

    let respuesta = { mensaje: 'Hecho' };
    if (accion === 'restablecer') {
      // Enlace de un solo uso de 30 min; el configurador puede copiarlo si
      // el correo no está configurado.
      const token = crypto.randomBytes(32).toString('base64url');
      await prisma.usuario.update({
        where: { id },
        data: { resetToken: sha256(token), resetTokenExpires: new Date(Date.now() + 30 * 60 * 1000) },
      });
      const enlace = `${urlFrontend(req)}/reset-password/${token}`;
      let correoEnviado = true;
      try { await correo.sendResetEmail(admin.email, token); } catch (_e) { correoEnviado = false; }
      respuesta = { mensaje: correoEnviado ? `Enlace enviado a ${admin.email}` : 'No se pudo enviar el correo: comparte el enlace', enlace, correoEnviado };
    } else if (accion === 'desbloquear') {
      await prisma.usuario.update({ where: { id }, data: { intentosFallidos: 0, bloqueadoHasta: null } });
      respuesta = { mensaje: 'Cuenta desbloqueada' };
    } else if (accion === 'quitar2fa') {
      await prisma.usuario.update({
        where: { id },
        data: { dosFactoresActivo: false, dosFactoresSecreto: null, dosFactoresPendiente: null, dosFactoresUltimoPaso: null, codigosRespaldo: null },
      });
      await revocarTodas(id);
      correo.enviarAvisoDosFactores({ email: admin.email, nombre: admin.nombre, activado: false, contexto: { fecha: new Date() } });
      respuesta = { mensaje: 'Verificación en dos pasos quitada; deberá configurarla de nuevo' };
    } else if (accion === 'cerrarSesiones') {
      const { count } = await revocarTodas(id);
      respuesta = { mensaje: `Se cerraron ${count} sesión(es)` };
    } else if (accion === 'desactivar') {
      const otrosActivos = await prisma.usuario.count({ where: { rol: 'ADMIN', id: { not: id }, ...ACTIVO } });
      if (otrosActivos === 0) {
        return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' });
      }
      await prisma.usuario.update({ where: { id }, data: { estado: 'inactivo' } });
      await revocarTodas(id);
      respuesta = { mensaje: 'Administrador desactivado' };
    } else if (accion === 'activar') {
      await prisma.usuario.update({ where: { id }, data: { estado: 'activo' } });
      respuesta = { mensaje: 'Administrador activado' };
    }

    invalidarCacheUsuario(id);
    await registrarEvento(req, { usuarioId: id, email: admin.email, tipo: 'accion_configurador', detalle: accion });
    return res.json(respuesta);
  } catch (error) {
    console.error('[configuracion.accionAdministrador]', error);
    return res.status(500).json({ error: 'No se pudo completar la acción' });
  }
};

// GET /api/configuracion/correo/plantillas  -> correos del sistema, textos de fabrica y variables
const plantillasCorreo = (_req, res) => res.json({ plantillas: correo.catalogoPlantillas() });

// POST /api/configuracion/correo/vista-previa  { plantilla, borrador: { marca, colores, disenoCorreo, textosCorreo } }
// Arma el correo con el borrador del panel (sin guardarlo) y datos de ejemplo.
const vistaPreviaCorreo = async (req, res) => {
  const { plantilla, borrador = {} } = req.body || {};
  if (typeof plantilla !== 'string') return res.status(400).json({ error: 'Falta la plantilla' });
  const { marca, colores, disenoCorreo, textosCorreo } = borrador && typeof borrador === 'object' ? borrador : {};
  try {
    return res.json(await correo.vistaPrevia(plantilla, { marca, colores, disenoCorreo, textosCorreo }));
  } catch (error) {
    if (/desconocida/.test(error?.message)) return res.status(404).json({ error: error.message });
    console.error('[configuracion.vistaPreviaCorreo]', error);
    return res.status(500).json({ error: 'No se pudo armar la vista previa' });
  }
};

// POST /api/configuracion/correo/prueba  { email?, plantilla? }
// Sin plantilla manda el correo de prueba; con plantilla, esa plantilla con
// datos de ejemplo (usa lo guardado, no el borrador).
const correoPrueba = async (req, res) => {
  const destino = String(req.body?.email || req.usuario.email).toLowerCase().trim();
  if (!esEmailValido(destino)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  const plantilla = typeof req.body?.plantilla === 'string' ? req.body.plantilla : null;
  try {
    const resultado = plantilla && plantilla !== 'prueba'
      ? await correo.enviarEjemplo(destino, plantilla)
      : await correo.enviarCorreoPrueba(destino);
    return res.json({
      mensaje: resultado?.simulado ? 'Modo desarrollo: el correo se mostró en la consola del servidor' : `Correo de prueba enviado a ${destino}`,
      simulado: Boolean(resultado?.simulado),
    });
  } catch (error) {
    console.error('[configuracion.correoPrueba]', error);
    // El detalle del proveedor ayuda a diagnosticar (clave o remitente mal); va
    // solo a la cuenta de configuración.
    return res.status(502).json({ error: `No se pudo enviar: ${escapeHtml(String(error?.message || 'error desconocido')).slice(0, 300)}` });
  }
};

// POST /api/configuracion/correo/verificar  { host, puerto, seguridad, usuario, password? }
// Prueba conexion e inicio de sesion con los datos del formulario, aunque aun
// no esten guardados. Sin password usa la guardada.
const verificarCorreo = async (req, res) => {
  const { validar } = require('../utils/configuracion.utils');
  const datos = validar({ correo: { ...req.body, passwordCifrada: undefined } }, { correo: { host: null } }).correo;
  if (!datos.host) return res.status(400).json({ error: 'Escribe un servidor SMTP válido (por ejemplo mail.tuempresa.com)' });
  try {
    await correo.verificarSmtp({ ...datos, password: typeof req.body?.password === 'string' ? req.body.password : '' });
    // Sin usuario solo se comprueba que el servidor responde (no hubo inicio de sesion).
    const sinLogin = datos.usuario ? '' : ' (sin iniciar sesión: falta el usuario)';
    return res.json({ ok: true, mensaje: `Conexión correcta con ${datos.host}:${datos.puerto}${sinLogin}` });
  } catch (error) {
    const codigo = error?.code || '';
    const explicacion = {
      EAUTH: 'El servidor rechazó el usuario o la contraseña.',
      ECONNECTION: 'No se pudo conectar: revisa el servidor y el puerto.',
      ETIMEDOUT: 'El servidor no respondió a tiempo: revisa el puerto o el firewall.',
      ESOCKET: 'Falló la conexión segura: prueba otro tipo de seguridad (SSL en 465, STARTTLS en 587).',
      EDNS: 'No existe ese servidor: revisa el nombre.',
    }[codigo] || 'No se pudo verificar el servidor de correo.';
    return res.status(502).json({ error: explicacion, detalle: escapeHtml(String(error?.message || '')).slice(0, 200) });
  }
};

// GET /api/configuracion/estado
const estadoSistema = async (_req, res) => {
  const resultado = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    resultado.baseDatos = { ok: true };
  } catch (_e) {
    resultado.baseDatos = { ok: false };
  }

  const { modo, remitente, servidor } = correo.resumenCorreo();
  resultado.correo = {
    ok: (modo === 'smtp' || modo === 'smtp_env') && Boolean(remitente),
    modo,
    remitente,
    servidor,
  };

  let contratosEscribible = false;
  try {
    await fs.mkdir(archivosContratos.directorio(), { recursive: true });
    await fs.access(archivosContratos.directorio(), fs.constants?.W_OK ?? 2);
    contratosEscribible = true;
  } catch (_e) { /* sin permiso */ }
  resultado.almacenamiento = {
    adjuntos: { ...(await almacenamiento.estado()), proveedor: 'disco' },
    contratos: { ok: contratosEscribible, ruta: archivosContratos.directorio() },
    marca: { ok: true, proveedor: 'Base de datos' },
  };

  const zona = zonaHoraria();
  resultado.servidor = {
    entorno: process.env.NODE_ENV || 'development',
    node: process.version,
    zonaHoraria: zona,
    horaLocal: new Intl.DateTimeFormat('es-MX', { timeZone: zona, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
  };

  try {
    const [activos, con2fa] = await Promise.all([
      prisma.usuario.count({ where: { rol: 'ADMIN', ...ACTIVO } }),
      prisma.usuario.count({ where: { rol: 'ADMIN', dosFactoresActivo: true, ...ACTIVO } }),
    ]);
    resultado.administradores = { activos, con2fa, politica2fa: configEnCache().seguridad.dosFactores };
  } catch (_e) {
    resultado.administradores = null;
  }
  return res.json(resultado);
};

module.exports = {
  verificarCorreo,
  plantillasCorreo,
  vistaPreviaCorreo,
  listarAdministradores,
  invitarAdministrador,
  reenviarInvitacionAdmin,
  eliminarInvitacionAdmin,
  accionAdministrador,
  correoPrueba,
  estadoSistema,
};
