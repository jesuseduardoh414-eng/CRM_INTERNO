/**
 * Servicio de envio de correos (Nodemailer / SMTP).
 *
 * Orden de preferencia:
 *  1. SMTP configurado en el panel (configuracion.correo): el correo del
 *     hosting/cPanel, Gmail, Outlook, Zoho... La contraseña va cifrada.
 *  2. SMTP por variables de entorno (EMAIL_HOST, EMAIL_PORT...).
 *  3. En desarrollo, sin nada configurado: se imprime en consola.
 *
 * Es el unico punto de salida de correo del sistema (cuenta, seguridad e
 * invitaciones). `correo.js` solo reexporta de aqui.
 *
 * Variables de entorno (solo si el panel no tiene SMTP capturado):
 *  - EMAIL_HOST     servidor SMTP (p. ej. mail.tudominio.com, smtp.gmail.com)
 *  - EMAIL_PORT     465 (SSL) o 587 (STARTTLS). Por defecto 587
 *  - EMAIL_SECURE   'ssl' | 'starttls' | 'ninguna'. Por defecto: ssl si el
 *                   puerto es 465, starttls en otro caso
 *  - EMAIL_USER     usuario SMTP
 *  - EMAIL_PASS     contraseña SMTP (en Gmail, una contraseña de aplicacion)
 *  - EMAIL_FROM     remitente: "Nombre <correo@dominio>" o solo el correo.
 *                   Si falta, se usa EMAIL_USER
 *  - FRONTEND_URL   base de los enlaces que llevan los correos
 */
const fs = require('fs/promises');
const path = require('path');
const nodemailer = require('nodemailer');
const { escapeHtml } = require('../utils/security.utils');
const { descifrar } = require('../utils/cifrado.utils');
const prisma = require('../lib/prisma');
const { configEnCache, obtener: obtenerConfiguracion } = require('./configuracion.service');
const { zonaHoraria } = require('../utils/fechas.utils');
const { validar } = require('../utils/configuracion.utils');
const { renderizar } = require('../utils/renderCorreo');
const { PLANTILLAS_POR_ID, ejemplosDe, catalogo } = require('../utils/plantillasCorreo');

const extractEmail = (value) => {
  const raw = (value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
};

const urlFrontend = () => String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');

const sistema = () => configEnCache().marca.nombreSistema;

// ---------------------------------------------------------------------------
// SMTP (panel de configuracion)
// ---------------------------------------------------------------------------

const smtpConfigurado = () => {
  const c = configEnCache().correo;
  return c?.host ? c : null;
};

// SMTP de respaldo leido del .env, con la misma forma que el del panel.
const smtpDeEntorno = () => {
  const host = process.env.EMAIL_HOST?.trim();
  if (!host) return null;
  const puerto = parseInt(process.env.EMAIL_PORT, 10) || 587;
  const seguridadEnv = String(process.env.EMAIL_SECURE || '').trim().toLowerCase();
  const seguridad = ['ssl', 'starttls', 'ninguna'].includes(seguridadEnv)
    ? seguridadEnv
    : (seguridadEnv === 'true' || puerto === 465 ? 'ssl' : 'starttls');
  const from = process.env.EMAIL_FROM?.trim() || '';
  const nombreFrom = (from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;
  return {
    host,
    puerto,
    seguridad,
    usuario: process.env.EMAIL_USER?.trim() || '',
    password: process.env.EMAIL_PASS || '',
    remitenteEmail: extractEmail(from) || null,
    remitenteNombre: nombreFrom,
  };
};

/** 'smtp' (panel) | 'smtp_env' (.env) | 'consola' | 'sin_configurar' */
const proveedorCorreo = () => {
  if (smtpConfigurado()) return 'smtp';
  if (smtpDeEntorno()) return 'smtp_env';
  return process.env.NODE_ENV === 'production' ? 'sin_configurar' : 'consola';
};

/** Modo, remitente efectivo y servidor, para el estado del sistema en el panel. */
const resumenCorreo = () => {
  const modo = proveedorCorreo();
  const c = modo === 'smtp' ? smtpConfigurado() : modo === 'smtp_env' ? smtpDeEntorno() : null;
  if (!c) return { modo, remitente: null, servidor: null };
  return {
    modo,
    remitente: c.remitenteEmail || (/@/.test(c.usuario || '') ? c.usuario : null),
    servidor: `${c.host}:${c.puerto}`,
  };
};

const crearTransporte = ({ host, puerto, seguridad, usuario, password }) => nodemailer.createTransport({
  host,
  port: puerto,
  secure: seguridad === 'ssl',
  requireTLS: seguridad === 'starttls',
  ignoreTLS: seguridad === 'ninguna',
  auth: usuario ? { user: usuario, pass: password || '' } : undefined,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

// Un transporte por configuracion (se rehace si cambia algo en el panel).
let transporteCache = { clave: null, transporte: null };
const transporteActual = (c) => {
  const clave = JSON.stringify([c.host, c.puerto, c.seguridad, c.usuario, c.passwordCifrada, c.password]);
  if (transporteCache.clave !== clave) {
    transporteCache.transporte?.close?.();
    // El del panel guarda la contraseña cifrada; el del .env la trae en claro
    const password = c.passwordCifrada ? descifrar(c.passwordCifrada) : (c.password || '');
    transporteCache = { clave, transporte: crearTransporte({ ...c, password }) };
  }
  return transporteCache.transporte;
};

/**
 * Prueba la conexion y el inicio de sesion con unos datos (los del panel,
 * aunque aun no esten guardados). Sin password usa la guardada.
 */
const verificarSmtp = async (datos) => {
  const guardada = configEnCache().correo?.passwordCifrada;
  const password = datos.password || (guardada ? descifrar(guardada) : '');
  const transporte = crearTransporte({ ...datos, password });
  try {
    await transporte.verify();
  } finally {
    transporte.close();
  }
};

const enviarPorSmtp = async (c, options) => {
  const remitente = c.remitenteEmail || (/@/.test(c.usuario || '') ? c.usuario : null);
  if (!remitente) throw new Error('Falta el correo remitente en la configuración de correo.');
  const info = await transporteActual(c).sendMail({
    from: { name: configEnCache().reglas.remitenteCorreo || c.remitenteNombre || sistema(), address: remitente },
    to: extractEmail(options.to),
    subject: options.subject,
    html: options.html || undefined,
    text: options.text || undefined,
    // Correo automatico (transaccional): evita respuestas automaticas y ayuda
    // a que los filtros lo clasifiquen bien.
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    attachments: options.attachments?.length ? options.attachments : undefined,
  });
  return { messageId: info.messageId };
};

const sendEmailViaAPI = async (options = {}) => {
  const smtp = smtpConfigurado() || smtpDeEntorno();
  if (smtp) return enviarPorSmtp(smtp, options);

  if (process.env.NODE_ENV !== 'production') {
    // Modo desarrollo: se muestra el correo en consola en vez de enviarlo.
    const texto = String(options.html || options.text || '')
      .replace(/<a [^>]*href="([^"]+)"[^>]*>/g, ' [$1] ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    console.log(`\n📧 [correo:dev] Para: ${options.to}\n   Asunto: ${options.subject}\n   ${texto.slice(0, 900)}\n`);
    return { simulado: true };
  }
  throw new Error('El correo no está configurado: captura el servidor SMTP en el panel de configuración o define EMAIL_HOST en el servidor.');
};

// ---------------------------------------------------------------------------
// Plantillas: diseño y textos del panel (Correo y avisos -> Diseño / Textos)
// ---------------------------------------------------------------------------

// Formatos que todos los clientes de correo muestran (Gmail y Outlook no
// muestran SVG; Outlook tampoco WEBP).
const MIMES_LOGO = ['image/png', 'image/jpeg', 'image/gif'];
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
const CID_LOGO = 'logo-correo';
const logosEnMemoria = new Map(); // sha256 -> Buffer

/**
 * Logo de la cabecera: el especifico de correos o, si no hay, el de la marca
 * que corresponde al fondo de la cabecera. null = se usa el nombre en texto.
 */
const resolverLogo = async (config, archivos = {}) => {
  if (config.disenoCorreo.logo === 'texto') return null;
  const deMarca = config.disenoCorreo.cabecera === 'color' ? 'logoOscuro' : 'logoClaro';
  for (const clave of ['logoCorreo', deMarca]) {
    const meta = archivos[clave];
    if (!meta || !MIMES_LOGO.includes(meta.mime)) continue;
    let contenido = logosEnMemoria.get(meta.sha256);
    if (!contenido) {
      const fila = await prisma.configuracionArchivo.findUnique({ where: { clave }, select: { contenido: true } });
      if (!fila) continue;
      contenido = Buffer.from(fila.contenido);
      if (logosEnMemoria.size > 10) logosEnMemoria.clear();
      logosEnMemoria.set(meta.sha256, contenido);
    }
    return { clave, contenido, mime: meta.mime };
  }
  // Igual que en el CRM: el logo de fabrica solo si la instalacion sigue
  // siendo OMNIS y no subio logos propios (si no, mejor el nombre en texto).
  const hayLogosPropios = ['logoClaro', 'logoOscuro', 'logoCorreo'].some((c) => archivos[c]);
  if (!hayLogosPropios && config.marca.nombreCorto === 'OMNIS') {
    const archivo = deMarca === 'logoOscuro' ? 'omnis-horizontal-blanco.png' : 'omnis-horizontal-azul.png';
    let contenido = logosEnMemoria.get(archivo);
    if (!contenido) {
      try {
        contenido = await fs.readFile(path.join(__dirname, '../../assets/correo', archivo));
        logosEnMemoria.set(archivo, contenido);
      } catch (_e) {
        return null;
      }
    }
    return { clave: 'fabrica', contenido, mime: 'image/png' };
  }
  return null;
};

/** Logo que se usaria con este diseño (para que el panel lo explique). */
const logoParaCorreo = async (config, archivos) => {
  const logo = await resolverLogo(config, archivos);
  return logo ? logo.clave : null;
};

/**
 * Arma asunto, HTML y adjuntos de una plantilla. `vista` = para la vista
 * previa del panel: el logo va incrustado como data: en vez de adjunto.
 */
const componer = async (id, vars = {}, extras = {}, { config = null, archivos = null, vista = false } = {}) => {
  let cfg = config;
  let arch = archivos;
  if (!cfg || !arch) {
    try {
      const datos = await obtenerConfiguracion();
      cfg = cfg || datos.config;
      arch = arch || datos.archivos;
    } catch (_e) {
      cfg = cfg || configEnCache();
      arch = arch || {};
    }
  }
  let logo = null;
  try { logo = await resolverLogo(cfg, arch); } catch (_e) { logo = null; }
  const logoSrc = logo ? (vista ? `data:${logo.mime};base64,${logo.contenido.toString('base64')}` : `cid:${CID_LOGO}`) : null;
  const { asunto, html, texto } = renderizar({ config: cfg, id, vars, extras, logoSrc, zonaHoraria: cfg.operacion?.zonaHoraria || zonaHoraria() });
  const attachments = logo && !vista
    ? [{ filename: `logo.${EXTENSION[logo.mime]}`, content: logo.contenido, contentType: logo.mime, cid: CID_LOGO }]
    : [];
  return { asunto, html, texto, attachments };
};

const enviarPlantilla = async (to, id, vars, extras) => {
  const { asunto, html, texto, attachments } = await componer(id, vars, extras);
  return sendEmailViaAPI({ to, subject: asunto, html, text: texto, attachments });
};

/**
 * Envio "best effort" para avisos de seguridad: si falla no debe romper el
 * flujo principal (login, cambio de contraseña...). Solo se registra.
 */
const enviarPlantillaSinBloquear = (to, id, vars, extras) => {
  enviarPlantilla(to, id, vars, extras).catch((error) => {
    console.error(`[correo] No se pudo enviar "${id}" a ${to}:`, error?.message || error);
  });
};

/**
 * Vista previa para el panel: aplica el borrador (sin guardarlo) sobre la
 * configuracion actual y usa datos de ejemplo.
 */
const vistaPrevia = async (id, borrador = {}) => {
  const plantilla = PLANTILLAS_POR_ID[id];
  if (!plantilla) throw new Error('Plantilla de correo desconocida');
  const { config, archivos } = await obtenerConfiguracion();
  const cfg = validar(borrador, config);
  const extras = {
    url: `${urlFrontend() || 'https://crm.tuempresa.com'}/login`,
    codigo: ejemplosDe(plantilla).codigo || '482913',
    contexto: { ip: '187.190.12.34', userAgent: 'Chrome 129 · Windows 11', fecha: new Date() },
  };
  const { asunto, html } = await componer(id, ejemplosDe(plantilla), extras, { config: cfg, archivos, vista: true });
  return { asunto, html, logo: await logoParaCorreo(cfg, archivos) };
};

/** Envia una plantilla con datos de ejemplo y la configuracion guardada. */
const enviarEjemplo = async (destino, id) => {
  const plantilla = PLANTILLAS_POR_ID[id];
  if (!plantilla) throw new Error('Plantilla de correo desconocida');
  const extras = {
    url: `${urlFrontend()}/login`,
    codigo: ejemplosDe(plantilla).codigo || '482913',
    contexto: { ip: '187.190.12.34', userAgent: 'Chrome 129 · Windows 11', fecha: new Date() },
  };
  const { asunto, html, texto, attachments } = await componer(id, ejemplosDe(plantilla), extras);
  return sendEmailViaAPI({ to: destino, subject: `[Prueba] ${asunto}`, html, text: texto, attachments });
};

// ---------------------------------------------------------------------------
// Cuenta
// ---------------------------------------------------------------------------

const sendResetEmail = async (email, token) => {
  await enviarPlantilla(email, 'recuperacion', {}, { url: `${urlFrontend()}/reset-password/${encodeURIComponent(token)}` });
  return true;
};

/** Enlace de verificacion antiguo (/verify/:token). Se mantiene por compatibilidad. */
const sendVerificationEmail = async (email, token) => {
  await enviarPlantilla(email, 'verificarCuenta', {}, { url: `${urlFrontend()}/verify/${encodeURIComponent(token)}` });
  return true;
};

const enviarCodigoVerificacion = async ({ email, nombre, codigo }) => {
  await enviarPlantilla(email, 'codigoVerificacion', { nombre, codigo }, { codigo });
};

/** Alguien intento registrarse con un correo que ya tiene cuenta. */
const enviarAvisoRegistroExistente = ({ email, nombre }) => enviarPlantillaSinBloquear(
  email, 'registroExistente', { nombre }, { url: `${urlFrontend()}/login` },
);

const enviarAvisoRegistroPendiente = ({ emailAdmin, nombre, email, area }) => enviarPlantillaSinBloquear(
  emailAdmin, 'registroPendiente', { nombre, correo: email, area }, { url: `${urlFrontend()}/usuarios` },
);

const enviarCuentaAprobada = ({ email, nombre }) => enviarPlantillaSinBloquear(
  email, 'cuentaAprobada', { nombre }, { url: `${urlFrontend()}/login` },
);

// ---------------------------------------------------------------------------
// Avisos de seguridad
// ---------------------------------------------------------------------------

const enviarAvisoPasswordCambiada = ({ email, nombre, contexto }) => enviarPlantillaSinBloquear(
  email, 'passwordCambiada', { nombre }, { contexto },
);

/** Un administrador cambio la contraseña de la persona desde Usuarios. */
const enviarAvisoPasswordCambiadaPorAdmin = ({ email, nombre, contexto }) => enviarPlantillaSinBloquear(
  email, 'passwordCambiadaAdmin', { nombre }, { contexto, url: `${urlFrontend()}/login` },
);

/**
 * Cambio del correo de acceso: aviso de seguridad al correo anterior (por si
 * no fue la persona) y confirmacion al nuevo, que es con el que entrara.
 */
const enviarAvisoCorreoCambiado = ({ emailAnterior, emailNuevo, nombre, contexto }) => {
  enviarPlantillaSinBloquear(emailAnterior, 'correoCambiadoAnterior', { nombre, correoNuevo: emailNuevo }, { contexto });
  enviarPlantillaSinBloquear(emailNuevo, 'correoCambiadoNuevo', { nombre, correoNuevo: emailNuevo }, { contexto, url: `${urlFrontend()}/login` });
};

const enviarAvisoBloqueo = ({ email, nombre, minutos, contexto }) => enviarPlantillaSinBloquear(
  email, 'bloqueo', { nombre, minutos }, { contexto, url: `${urlFrontend()}/forgot-password` },
);

const enviarAvisoNuevoInicio = ({ email, nombre, contexto }) => enviarPlantillaSinBloquear(
  email, 'nuevoInicio', { nombre }, { contexto, url: `${urlFrontend()}/perfil#seguridad` },
);

const enviarAvisoDosFactores = ({ email, nombre, activado, contexto }) => enviarPlantillaSinBloquear(
  email, activado ? 'dosFactoresActivado' : 'dosFactoresDesactivado', { nombre }, { contexto },
);

const enviarAvisoSesionComprometida = ({ email, nombre, contexto }) => enviarPlantillaSinBloquear(
  email, 'sesionComprometida', { nombre }, { contexto },
);

/**
 * Correo de invitación al CRM. El enlace apunta a /invitacion/:token del
 * frontend y caduca segun la regla del panel.
 */
const enviarInvitacion = async ({ nombre, email, token }) => {
  const info = await enviarPlantilla(
    email,
    'invitacion',
    { nombre, horas: configEnCache().seguridad.invitacionHoras },
    { url: `${urlFrontend()}/invitacion/${encodeURIComponent(token)}` },
  );
  return { success: true, messageId: info?.messageId };
};

/** Invitación al portal de clientes (rol CLIENTE). */
const enviarInvitacionPortal = async ({ nombre, email, token, cliente }) => {
  const info = await enviarPlantilla(
    email,
    'invitacionPortal',
    { nombre, cliente, horas: configEnCache().seguridad.invitacionHoras },
    { url: `${urlFrontend()}/invitacion/${encodeURIComponent(token)}` },
  );
  return { success: true, messageId: info?.messageId };
};

/** Aviso al cliente de que el equipo le escribió en un proyecto. No bloquea. */
const avisarMensajePortal = ({ nombre, email, actor, proyecto, proyectoId, mensaje }) => enviarPlantillaSinBloquear(
  email,
  'mensajePortal',
  { nombre, actor, proyecto, mensaje: mensaje.length > 280 ? `${mensaje.slice(0, 277)}…` : mensaje },
  { url: `${urlFrontend()}/portal/proyectos/${proyectoId}?vista=mensajes` },
);

/** Correo de prueba desde el panel de configuración. */
const enviarCorreoPrueba = (email) => enviarPlantilla(email, 'prueba', {}, {});

module.exports = {
  enviarPlantillaSinBloquear,
  proveedorCorreo,
  resumenCorreo,
  verificarSmtp,
  enviarCorreoPrueba,
  sendEmailViaAPI,
  catalogoPlantillas: catalogo,
  vistaPrevia,
  enviarEjemplo,
  sendResetEmail,
  sendVerificationEmail,
  enviarCodigoVerificacion,
  enviarAvisoRegistroExistente,
  enviarAvisoRegistroPendiente,
  enviarCuentaAprobada,
  enviarAvisoPasswordCambiada,
  enviarAvisoPasswordCambiadaPorAdmin,
  enviarAvisoCorreoCambiado,
  enviarAvisoBloqueo,
  enviarAvisoNuevoInicio,
  enviarAvisoDosFactores,
  enviarAvisoSesionComprometida,
  enviarInvitacion,
  enviarInvitacionPortal,
  avisarMensajePortal,
};
