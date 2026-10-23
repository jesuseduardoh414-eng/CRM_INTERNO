/**
 * Sesiones con access token corto + refresh token rotatorio.
 *
 * - Access token: JWT HS256 de 15 minutos con `sub` (usuario) y `sid` (sesion).
 *   El middleware comprueba ademas que la sesion siga viva, asi que cerrar una
 *   sesion la corta en segundos aunque su JWT aun no haya caducado.
 * - Refresh token: 32 bytes aleatorios. En la base solo se guarda su SHA-256.
 *   Cada uso lo rota (el anterior deja de valer). Si alguien presenta uno ya
 *   rotado fuera del margen de concurrencia, es que se copio: la sesion se
 *   revoca entera y queda registrado.
 * - Duracion: 12 h fijas si no se marco "Mantener sesion iniciada"; si se
 *   marco, 30 dias que se renuevan con el uso, con un tope absoluto de 90.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { sha256 } = require('../utils/cifrado.utils');

const ACCESS_TTL_S = 15 * 60;
// Duraciones desde la configuración (seguridad.sesionHoras / recordarDias).
const reglas = () => {
  // eslint-disable-next-line global-require
  const { configEnCache } = require('./configuracion.service');
  return configEnCache().seguridad;
};
const sesionCortaMs = () => reglas().sesionHoras * 60 * 60 * 1000;
const sesionLargaMs = () => reglas().recordarDias * 24 * 60 * 60 * 1000;
const SESION_TOPE_MS = 90 * 24 * 60 * 60 * 1000;
// Dos pestañas pueden pedir refresh con el mismo token casi a la vez; la que
// llega segunda no es un robo. Dentro de este margen se le pide reintentar.
const MARGEN_CONCURRENCIA_MS = 20 * 1000;

const EMISOR = 'omnis-crm';
const AUDIENCIA = 'omnis-crm-api';

class ErrorSesion extends Error {
  constructor(mensaje, codigo, status = 401) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

const datosCliente = (req) => ({
  ip: String(req.ip || '').slice(0, 64) || null,
  userAgent: String(req.headers?.['user-agent'] || '').slice(0, 512) || null,
});

const firmarAccess = (usuarioId, sesionId) => jwt.sign(
  { sid: sesionId, typ: 'access' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: ACCESS_TTL_S, issuer: EMISOR, audience: AUDIENCIA, subject: String(usuarioId) },
);

const verificarAccess = (token) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: EMISOR,
    audience: AUDIENCIA,
  });
  if (payload.typ !== 'access' || !payload.sid) throw new Error('Token sin sesión');
  return { usuarioId: Number(payload.sub), sesionId: String(payload.sid) };
};

const nuevoRefresh = () => crypto.randomBytes(32).toString('base64url');

// El refresh token viaja en una cookie httpOnly: el JavaScript de la pagina
// no puede leerlo, asi que un script inyectado no se lleva una sesion de
// semanas (solo el access token de 15 min). Solo se manda a /api/auth y nunca
// desde otro sitio (SameSite=Strict). En produccion el frontend y la API
// comparten dominio; en desarrollo (5173 -> 3000) son el mismo "sitio".
const COOKIE_REFRESH = 'crm_refresh';
const RUTA_COOKIE = '/api/auth';

const opcionesCookie = (req) => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: Boolean(req.secure) || /^https:/i.test(process.env.FRONTEND_URL || ''),
  path: RUTA_COOKIE,
});

const ponerCookieRefresh = (req, res, refreshToken, expiraEn) => {
  res.cookie(COOKIE_REFRESH, refreshToken, { ...opcionesCookie(req), expires: new Date(expiraEn) });
};

const borrarCookieRefresh = (req, res) => res.clearCookie(COOKIE_REFRESH, opcionesCookie(req));

const leerCookie = (req, buscada) => {
  for (const cookie of String(req.headers?.cookie || '').split(';')) {
    const [nombre, ...resto] = cookie.trim().split('=');
    if (nombre === buscada && resto.length) {
      try {
        return decodeURIComponent(resto.join('='));
      } catch (_e) {
        return null;
      }
    }
  }
  return null;
};

/**
 * Refresh token de la peticion: el de la cookie y, si no hay, el del cuerpo
 * (pestañas abiertas antes de pasar a cookie, que lo guardaban en el navegador).
 */
const refreshDePeticion = (req) => leerCookie(req, COOKIE_REFRESH)
  ?? (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null);

// Adjuntos y fotos se abren con <img>, <iframe> y enlaces, que no pueden mandar
// el token: llevan esta otra cookie httpOnly, solo para /api/archivos. Dura lo
// que la sesion, y en cada archivo el servidor comprueba que la sesion siga
// abierta y que la persona pueda ver ese archivo.
const COOKIE_ARCHIVOS = 'crm_archivos';
const RUTA_ARCHIVOS = '/api/archivos';
const AUDIENCIA_ARCHIVOS = 'omnis-crm-archivos';

const ponerCookieArchivos = (req, res, { usuarioId, sesionId, expiraEn }) => {
  if (!usuarioId || !sesionId || !expiraEn) return;
  const segundos = Math.max(Math.floor((new Date(expiraEn).getTime() - Date.now()) / 1000), 60);
  const valor = jwt.sign(
    { sid: sesionId, typ: 'archivos' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: segundos, issuer: EMISOR, audience: AUDIENCIA_ARCHIVOS, subject: String(usuarioId) },
  );
  res.cookie(COOKIE_ARCHIVOS, valor, { ...opcionesCookie(req), path: RUTA_ARCHIVOS, expires: new Date(expiraEn) });
};

const borrarCookieArchivos = (req, res) => res.clearCookie(COOKIE_ARCHIVOS, { ...opcionesCookie(req), path: RUTA_ARCHIVOS });

/**
 * `{ usuarioId, sesionId }` de la cookie de archivos o, si no hay, del access
 * token de Authorization (descargas con fetch). null si no hay o no vale.
 */
const sesionDeArchivos = (req) => {
  const cookie = leerCookie(req, COOKIE_ARCHIVOS);
  if (cookie) {
    try {
      const payload = jwt.verify(cookie, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: EMISOR, audience: AUDIENCIA_ARCHIVOS });
      if (payload.typ === 'archivos' && payload.sid) return { usuarioId: Number(payload.sub), sesionId: String(payload.sid) };
    } catch (_e) { /* se prueba con el token */ }
  }
  const [esquema, token] = String(req.headers?.authorization || '').split(' ');
  if (token && /^Bearer$/i.test(esquema)) {
    try {
      return verificarAccess(token);
    } catch (_e) { /* sin sesion */ }
  }
  return null;
};

/** Respuesta comun de login/refresh para el frontend. */
const paqueteTokens = ({ accessToken, refreshToken, sesion }) => ({
  token: accessToken,
  refreshToken,
  expiraEn: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
  sesionExpiraEn: sesion.expiraEn.toISOString(),
});

const crearSesion = async (usuarioId, req, { recordar = false } = {}) => {
  const refreshToken = nuevoRefresh();
  const { ip, userAgent } = datosCliente(req);
  // "Mantener sesion" solo si la instalacion lo permite (recordarDias > 0).
  const larga = Boolean(recordar) && reglas().recordarDias > 0;
  const sesion = await prisma.sesion.create({
    data: {
      usuarioId,
      refreshHash: sha256(refreshToken),
      recordar: larga,
      ip,
      userAgent,
      expiraEn: new Date(Date.now() + (larga ? sesionLargaMs() : sesionCortaMs())),
    },
  });

  // Limpieza perezosa: sesiones de esta persona caducadas o revocadas hace
  // mas de una semana ya no aportan nada.
  const haceUnaSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  prisma.sesion.deleteMany({
    where: {
      usuarioId,
      OR: [{ expiraEn: { lt: haceUnaSemana } }, { revocadaEn: { lt: haceUnaSemana } }],
    },
  }).catch(() => {});

  return paqueteTokens({ accessToken: firmarAccess(usuarioId, sesion.id), refreshToken, sesion });
};

const usuarioActivo = (usuario) => usuario && (!usuario.estado || usuario.estado === 'activo');

/**
 * Canjea un refresh token por un par nuevo. Lanza ErrorSesion con:
 *  - REFRESH_CONCURRENTE (409): otra pestaña acaba de rotarlo; reintentar.
 *  - SESION_REVOCADA / SESION_INVALIDA / SESION_EXPIRADA (401).
 * Devuelve `{ tokens, sesion, reutilizado }`; si `reutilizado` es true quien
 * llama debe registrar el incidente (la sesion ya quedo revocada).
 */
const rotarSesion = async (refreshToken, req) => {
  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.length > 200) {
    throw new ErrorSesion('Sesión inválida', 'SESION_INVALIDA');
  }
  const hash = sha256(refreshToken);
  const ahora = new Date();

  const sesion = await prisma.sesion.findUnique({
    where: { refreshHash: hash },
    include: { usuario: { select: { id: true, estado: true, rol: true } } },
  });

  if (!sesion) {
    const rotada = await prisma.sesion.findFirst({ where: { refreshHashAnterior: hash } });
    if (rotada && !rotada.revocadaEn) {
      if (rotada.rotadoEn && ahora - rotada.rotadoEn < MARGEN_CONCURRENCIA_MS) {
        throw new ErrorSesion('La sesión se está renovando, reintenta', 'REFRESH_CONCURRENTE', 409);
      }
      await prisma.sesion.update({ where: { id: rotada.id }, data: { revocadaEn: ahora } });
      const error = new ErrorSesion('La sesión fue revocada por seguridad', 'SESION_REVOCADA');
      error.reutilizado = { usuarioId: rotada.usuarioId, sesionId: rotada.id };
      throw error;
    }
    throw new ErrorSesion('Sesión inválida', 'SESION_INVALIDA');
  }

  if (sesion.revocadaEn) throw new ErrorSesion('La sesión fue cerrada', 'SESION_REVOCADA');
  if (sesion.expiraEn <= ahora) throw new ErrorSesion('La sesión expiró', 'SESION_EXPIRADA');
  if (!usuarioActivo(sesion.usuario)) {
    await prisma.sesion.update({ where: { id: sesion.id }, data: { revocadaEn: ahora } });
    throw new ErrorSesion('Tu cuenta no está activa', 'CUENTA_INACTIVA');
  }
  // Portal de clientes retirado: una sesion de cliente ya no se renueva.
  // eslint-disable-next-line global-require
  if (sesion.usuario.rol === 'CLIENTE' && require('./configuracion.service').configEnCache().modulos?.portalClientes === false) {
    await prisma.sesion.update({ where: { id: sesion.id }, data: { revocadaEn: ahora } });
    throw new ErrorSesion('El portal de clientes ya no está disponible', 'SESION_REVOCADA');
  }

  const siguiente = nuevoRefresh();
  const { ip, userAgent } = datosCliente(req);
  const expiraEn = sesion.recordar
    ? new Date(Math.min(ahora.getTime() + Math.max(sesionLargaMs(), sesionCortaMs()), sesion.creadoEn.getTime() + SESION_TOPE_MS))
    : sesion.expiraEn;

  // updateMany con el hash viejo en el filtro: si dos peticiones rotan a la
  // vez, solo una gana.
  const { count } = await prisma.sesion.updateMany({
    where: { id: sesion.id, refreshHash: hash, revocadaEn: null },
    data: {
      refreshHash: sha256(siguiente),
      refreshHashAnterior: hash,
      rotadoEn: ahora,
      ultimoUso: ahora,
      expiraEn,
      ip,
      userAgent,
    },
  });
  if (count === 0) throw new ErrorSesion('La sesión se está renovando, reintenta', 'REFRESH_CONCURRENTE', 409);

  return paqueteTokens({
    accessToken: firmarAccess(sesion.usuarioId, sesion.id),
    refreshToken: siguiente,
    sesion: { expiraEn },
  });
};

const revocarPorRefresh = async (refreshToken) => {
  if (!refreshToken || typeof refreshToken !== 'string') return null;
  // Tambien con el anterior: si otra pestaña acaba de rotarlo, salir con el
  // viejo no debe dejar la sesion abierta.
  const hash = sha256(refreshToken);
  const sesion = await prisma.sesion.findFirst({ where: { OR: [{ refreshHash: hash }, { refreshHashAnterior: hash }] }, select: { id: true } });
  if (!sesion) return null;
  await prisma.sesion.update({ where: { id: sesion.id }, data: { revocadaEn: new Date() } });
  return sesion.id;
};

const revocarSesion = (sesionId, usuarioId) => prisma.sesion.updateMany({
  where: { id: sesionId, usuarioId, revocadaEn: null },
  data: { revocadaEn: new Date() },
});

/** Cierra todas las sesiones de alguien (menos `exceptoId`, si se pasa). */
const revocarTodas = (usuarioId, exceptoId = null) => prisma.sesion.updateMany({
  where: { usuarioId, revocadaEn: null, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
  data: { revocadaEn: new Date() },
});

const listarActivas = (usuarioId) => prisma.sesion.findMany({
  where: { usuarioId, revocadaEn: null, expiraEn: { gt: new Date() } },
  orderBy: { ultimoUso: 'desc' },
  select: { id: true, ip: true, userAgent: true, creadoEn: true, ultimoUso: true, expiraEn: true, recordar: true },
});

/** ¿Ya hubo alguna sesion desde este navegador? Para el aviso de nuevo dispositivo. */
const esDispositivoConocido = async (usuarioId, req) => {
  const { userAgent } = datosCliente(req);
  const [previa, total] = await Promise.all([
    prisma.sesion.findFirst({ where: { usuarioId, userAgent }, select: { id: true } }),
    prisma.sesion.count({ where: { usuarioId } }),
  ]);
  // La primera sesion de la historia no se avisa: no hay nada con que comparar.
  return Boolean(previa) || total === 0;
};

module.exports = {
  ACCESS_TTL_S,
  ErrorSesion,
  datosCliente,
  ponerCookieRefresh,
  borrarCookieRefresh,
  refreshDePeticion,
  ponerCookieArchivos,
  borrarCookieArchivos,
  sesionDeArchivos,
  verificarAccess,
  crearSesion,
  rotarSesion,
  revocarPorRefresh,
  revocarSesion,
  revocarTodas,
  listarActivas,
  esDispositivoConocido,
};
