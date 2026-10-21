// Panel de configuración (solo CONFIGURADOR): administradores de la empresa,
// otras cuentas de configuración, correo de prueba y estado del sistema.
//
// Administradores: el configurador NO gestiona miembros ni ve datos de la
// empresa (decisión del usuario). Solo da de alta a los administradores y
// les restablece el acceso cuando hace falta. Igual con las cuentas de
// configuración: la primera se crea por consola y las demás se invitan aquí.
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
const { AREA_GENERAL } = require('../utils/configuracion.utils');
const { zonaHoraria } = require('../utils/fechas.utils');
const archivosContratos = require('../services/contratosArchivos.service');
const archivosComprobantes = require('../services/comprobantes.service');
const correo = require('../services/email.service');
const almacenamiento = require('../services/almacenamiento.service');
const drive = require('../services/drive.service');

const urlFrontend = (req) => String(process.env.FRONTEND_URL || req.headers.origin || '').replace(/\/+$/, '');
const leerId = (valor) => { const n = Number.parseInt(valor, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const ACTIVO = { OR: [{ estado: 'activo' }, { estado: null }] };

const selectAdmin = {
  id: true, nombre: true, email: true, area: true, estado: true, dosFactoresActivo: true,
  ultimoLoginEn: true, bloqueadoHasta: true, creadoEn: true,
};

// Cuentas que da de alta el configurador. `rol` es el de la cuenta e
// `invitacion` el de su invitación. Las de configuración no son de ningún
// área del equipo: llevan la general, como las de `npm run crear-configurador`.
const ADMINISTRADORES = {
  clave: 'administradores',
  rol: 'ADMIN',
  invitacion: 'admin',
  conArea: true,
  enviar: (datos) => correo.enviarInvitacion(datos),
  textos: {
    errorLista: 'No se pudo cargar la lista de administradores',
    noEncontrado: 'Administrador no encontrado',
    ultimoActivo: 'Debe quedar al menos un administrador activo',
    desactivado: 'Administrador desactivado',
    activado: 'Administrador activado',
  },
};
const CONFIGURADORES = {
  clave: 'configuradores',
  rol: 'CONFIGURADOR',
  invitacion: 'configurador',
  conArea: false,
  enviar: (datos) => correo.enviarInvitacionConfiguracion(datos),
  textos: {
    errorLista: 'No se pudo cargar la lista de cuentas de configuración',
    noEncontrado: 'Cuenta de configuración no encontrada',
    ultimoActivo: 'Debe quedar al menos una cuenta de configuración activa',
    desactivado: 'Cuenta de configuración desactivada',
    activado: 'Cuenta de configuración activada',
  },
};

// GET /api/configuracion/administradores | /configuradores
const listarCuentas = (tipo) => async (req, res) => {
  try {
    const [cuentas, invitaciones, sesiones] = await Promise.all([
      prisma.usuario.findMany({ where: { rol: tipo.rol }, select: selectAdmin, orderBy: { nombre: 'asc' } }),
      prisma.invitacion.findMany({
        where: { rol: tipo.invitacion, estado: { not: 'aceptada' } },
        select: { id: true, nombre: true, email: true, area: true, estado: true, expiraEn: true, creadoEn: true },
        orderBy: { creadoEn: 'desc' },
      }),
      prisma.sesion.groupBy({
        by: ['usuarioId'],
        where: { revocadaEn: null, expiraEn: { gt: new Date() }, usuario: { rol: tipo.rol } },
        _count: { _all: true },
      }),
    ]);
    const porUsuario = Object.fromEntries(sesiones.map((s) => [s.usuarioId, s._count._all]));
    const ahora = new Date();
    return res.json({
      [tipo.clave]: cuentas.map((a) => ({
        ...a,
        bloqueado: Boolean(a.bloqueadoHasta && a.bloqueadoHasta > ahora),
        sesionesActivas: porUsuario[a.id] || 0,
        esTuCuenta: a.id === req.usuario.id,
      })),
      invitaciones: invitaciones.map((i) => ({ ...i, vencida: i.expiraEn < ahora })),
    });
  } catch (error) {
    console.error(`[configuracion.listar ${tipo.clave}]`, error);
    return res.status(500).json({ error: tipo.textos.errorLista });
  }
};

// POST /api/configuracion/administradores  { nombre, email, area }
// POST /api/configuracion/configuradores   { nombre, email }
const invitarCuenta = (tipo) => async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const area = tipo.conArea ? String(req.body?.area || AREA_GENERAL).toUpperCase() : AREA_GENERAL;
  if (nombre.length < 3) return res.status(400).json({ error: 'Escribe el nombre completo' });
  if (!esEmailValido(email)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  if (!esAreaValida(area)) return res.status(400).json({ error: 'Área no válida' });

  try {
    if (await prisma.usuario.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
    }
    const { token } = await generarInvitacion({ nombre, email, area, rol: tipo.invitacion, creadoPor: req.usuario.id });
    const enlace = `${urlFrontend(req)}/invitacion/${token}`;
    let correoEnviado = true;
    try {
      await tipo.enviar({ nombre, email, token });
    } catch (errorCorreo) {
      correoEnviado = false;
      console.error(`[configuracion.invitar ${tipo.clave}] correo:`, errorCorreo?.message);
    }
    return res.status(201).json({
      mensaje: correoEnviado ? `Invitación enviada a ${email}` : 'Invitación creada, pero no se pudo enviar el correo: comparte el enlace',
      enlace,
      correoEnviado,
    });
  } catch (error) {
    console.error(`[configuracion.invitar ${tipo.clave}]`, error);
    return res.status(500).json({ error: 'No se pudo crear la invitación' });
  }
};

// POST /api/configuracion/administradores/invitaciones/:id/reenviar  (o /configuradores/...)
const reenviarInvitacionCuenta = (tipo) => async (req, res) => {
  try {
    const invitacion = await prisma.invitacion.findUnique({ where: { id: String(req.params.id) } });
    if (!invitacion || invitacion.rol !== tipo.invitacion || invitacion.estado === 'aceptada') {
      return res.status(404).json({ error: 'Invitación no encontrada' });
    }
    const { token } = await generarInvitacion({
      nombre: invitacion.nombre, email: invitacion.email, area: invitacion.area, rol: tipo.invitacion, creadoPor: req.usuario.id,
    });
    let correoEnviado = true;
    try {
      await tipo.enviar({ nombre: invitacion.nombre, email: invitacion.email, token });
    } catch (_e) {
      correoEnviado = false;
    }
    return res.json({ mensaje: 'Invitación renovada', enlace: `${urlFrontend(req)}/invitacion/${token}`, correoEnviado });
  } catch (error) {
    console.error(`[configuracion.reenviarInvitacion ${tipo.clave}]`, error);
    return res.status(500).json({ error: 'No se pudo reenviar la invitación' });
  }
};

// DELETE /api/configuracion/administradores/invitaciones/:id  (o /configuradores/...)
const eliminarInvitacionCuenta = (tipo) => async (req, res) => {
  try {
    const { count } = await prisma.invitacion.deleteMany({ where: { id: String(req.params.id), rol: tipo.invitacion, estado: { not: 'aceptada' } } });
    if (count === 0) return res.status(404).json({ error: 'Invitación no encontrada' });
    return res.json({ mensaje: 'Invitación eliminada' });
  } catch (error) {
    console.error(`[configuracion.eliminarInvitacion ${tipo.clave}]`, error);
    return res.status(500).json({ error: 'No se pudo eliminar la invitación' });
  }
};

const ACCIONES = ['restablecer', 'desbloquear', 'quitar2fa', 'cerrarSesiones', 'desactivar', 'activar'];

// POST /api/configuracion/administradores/:id/acciones  { accion }  (o /configuradores/...)
const accionCuenta = (tipo) => async (req, res) => {
  const id = leerId(req.params.id);
  const accion = String(req.body?.accion || '');
  if (!id || !ACCIONES.includes(accion)) return res.status(400).json({ error: 'Acción no válida' });
  // La propia cuenta se gestiona en "Mi cuenta", donde se pide la contraseña.
  if (id === req.usuario.id) return res.status(400).json({ error: 'Tu propia cuenta se gestiona desde Mi cuenta' });

  try {
    const admin = await prisma.usuario.findUnique({ where: { id }, select: { ...selectAdmin, rol: true } });
    if (!admin || admin.rol !== tipo.rol) return res.status(404).json({ error: tipo.textos.noEncontrado });

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
      const otrosActivos = await prisma.usuario.count({ where: { rol: tipo.rol, id: { not: id }, ...ACTIVO } });
      if (otrosActivos === 0) {
        return res.status(409).json({ error: tipo.textos.ultimoActivo });
      }
      await prisma.usuario.update({ where: { id }, data: { estado: 'inactivo' } });
      await revocarTodas(id);
      respuesta = { mensaje: tipo.textos.desactivado };
    } else if (accion === 'activar') {
      await prisma.usuario.update({ where: { id }, data: { estado: 'activo' } });
      respuesta = { mensaje: tipo.textos.activado };
    }

    invalidarCacheUsuario(id);
    await registrarEvento(req, { usuarioId: id, email: admin.email, tipo: 'accion_configurador', detalle: accion });
    return res.json(respuesta);
  } catch (error) {
    console.error(`[configuracion.accion ${tipo.clave}]`, error);
    return res.status(500).json({ error: 'No se pudo completar la acción' });
  }
};

const listarAdministradores = listarCuentas(ADMINISTRADORES);
const invitarAdministrador = invitarCuenta(ADMINISTRADORES);
const reenviarInvitacionAdmin = reenviarInvitacionCuenta(ADMINISTRADORES);
const eliminarInvitacionAdmin = eliminarInvitacionCuenta(ADMINISTRADORES);
const accionAdministrador = accionCuenta(ADMINISTRADORES);

const listarConfiguradores = listarCuentas(CONFIGURADORES);
const invitarConfigurador = invitarCuenta(CONFIGURADORES);
const reenviarInvitacionConfigurador = reenviarInvitacionCuenta(CONFIGURADORES);
const eliminarInvitacionConfigurador = eliminarInvitacionCuenta(CONFIGURADORES);
const accionConfigurador = accionCuenta(CONFIGURADORES);

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
  // Comprobantes de finanzas (COMPROBANTES_DIR): mismo chequeo que contratos.
  let comprobantesEscribible = false;
  try {
    await fs.mkdir(archivosComprobantes.directorio(), { recursive: true });
    await fs.access(archivosComprobantes.directorio(), fs.constants?.W_OK ?? 2);
    comprobantesEscribible = true;
  } catch (_e) { /* sin permiso */ }
  resultado.almacenamiento = {
    adjuntos: { ...(await almacenamiento.estado()), proveedor: 'disco' },
    contratos: { ok: contratosEscribible, ruta: archivosContratos.directorio() },
    comprobantes: { ok: comprobantesEscribible, ruta: archivosComprobantes.directorio() },
    marca: { ok: true, proveedor: 'Base de datos' },
  };
  // Google Drive (sin consultar a Google: solo lo guardado aqui).
  try {
    resultado.drive = await drive.estado({ detalle: false });
  } catch (_e) { /* sin la tabla o sin base: no se muestra */ }

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
  listarConfiguradores,
  invitarConfigurador,
  reenviarInvitacionConfigurador,
  eliminarInvitacionConfigurador,
  accionConfigurador,
  correoPrueba,
  estadoSistema,
};
