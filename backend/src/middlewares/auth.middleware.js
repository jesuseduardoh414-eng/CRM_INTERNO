// Middleware de autenticación JWT
// Valida el token en el header Authorization antes de dar acceso a rutas protegidas.
//
// El access token dura 15 minutos y lleva el id de su sesion (`sid`). Ademas
// de la firma se comprueba, contra la base, que:
//  - la sesion siga abierta (no cerrada desde el perfil, ni por cambio de
//    contraseña, ni por deteccion de robo del refresh token), y
//  - el usuario siga existiendo y activo; se usan su rol y area reales.
// Para no pegarle a la base en cada peticion hay una cache en memoria de 30 s
// por usuario y por sesion. Las invalidaciones locales aplican al instante;
// en otras instancias, en <= 30 s.
//
// Codigos de error (campo `codigo`) que usa el frontend:
//  - TOKEN_EXPIRADO: pedir un access token nuevo con el refresh token.
//  - SESION_REVOCADA / TOKEN_INVALIDO / CUENTA_INACTIVA: volver al login.
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { verificarAccess } = require('../services/sesiones.service');
const { debeActivar2FA } = require('../utils/politicas.utils');

const CACHE_MS = 30 * 1000;
const CACHE_MAX = 2000;
const cacheUsuarios = new Map(); // id -> { usuario, expira }
const cacheSesiones = new Map(); // sid -> { sesion, expira }

const selectUsuarioAuth = { id: true, rol: true, area: true, estado: true, nombre: true, email: true, dosFactoresActivo: true, empresaId: true, permisosFinanzas: true, permisos: true };

const guardarEnCache = (mapa, clave, valor) => {
  if (mapa.size >= CACHE_MAX) mapa.clear();
  mapa.set(clave, { valor, expira: Date.now() + CACHE_MS });
};

const leerCache = (mapa, clave) => {
  const entrada = mapa.get(clave);
  return entrada && entrada.expira > Date.now() ? entrada : null;
};

// Borra de la cache a un usuario (o a todos si no se pasa id), junto con sus
// sesiones. Se llama al editar, desactivar o cambiar el rol de alguien y al
// cerrar sesiones para que el cambio aplique de inmediato en esta instancia.
const invalidarCacheUsuario = (id) => {
  if (id === undefined || id === null) {
    cacheUsuarios.clear();
    cacheSesiones.clear();
    return;
  }
  const numero = Number(id);
  cacheUsuarios.delete(numero);
  for (const [sid, entrada] of cacheSesiones) {
    if (entrada.valor?.usuarioId === numero) cacheSesiones.delete(sid);
  }
};

const cargarUsuario = async (id) => {
  const enCache = leerCache(cacheUsuarios, id);
  if (enCache) return enCache.valor;
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: selectUsuarioAuth });
  guardarEnCache(cacheUsuarios, id, usuario);
  return usuario;
};

const cargarSesion = async (sid) => {
  const enCache = leerCache(cacheSesiones, sid);
  if (enCache) return enCache.valor;
  const sesion = await prisma.sesion.findUnique({
    where: { id: sid },
    select: { id: true, usuarioId: true, revocadaEn: true, expiraEn: true },
  });
  guardarEnCache(cacheSesiones, sid, sesion);
  return sesion;
};

// Require diferido: el servicio de configuracion tambien carga Prisma.
// eslint-disable-next-line global-require
const portalActivo = () => require('../services/configuracion.service').configEnCache().modulos?.portalClientes !== false;

const RUTAS_CONFIGURADOR = ['/api/auth', '/api/configuracion'];
// Lo único que puede usar una cuenta del portal de clientes.
const RUTAS_CLIENTE = ['/api/auth', '/api/portal', '/api/notificaciones'];

const rechazar = (res, codigo, error) => res.status(401).json({ error, codigo });

// Lo que se deja en `req.usuario`: rol y area de la base, no los del token.
const perfilDeSesion = (usuario) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  email: usuario.email,
  area: usuario.area,
  rol: usuario.rol,
  estado: usuario.estado,
  empresaId: usuario.empresaId ?? null,
  // Ajustes de permisos de la persona sobre los de su area
  // (utils/permisosArea.utils.js); los de finanzas anteriores cuentan
  // mientras no tenga ajustes nuevos.
  permisos: usuario.permisos ?? null,
  permisosFinanzas: usuario.permisosFinanzas ?? null,
});

/**
 * Comprueba que la sesion siga abierta y la cuenta activa. Devuelve
 * `{ usuario, sesion, debeActivar2FA }` o `{ codigo, error }`. La usan este
 * middleware y la ruta de archivos (que llega con cookie en vez de token).
 */
const usuarioDeSesion = async ({ usuarioId, sesionId }) => {
  if (!Number.isInteger(usuarioId) || !sesionId) return { codigo: 'TOKEN_INVALIDO', error: 'Token inválido' };
  const [sesion, usuario] = await Promise.all([cargarSesion(sesionId), cargarUsuario(usuarioId)]);

  if (!sesion || sesion.usuarioId !== usuarioId || sesion.revocadaEn || sesion.expiraEn <= new Date()) {
    return { codigo: 'SESION_REVOCADA', error: 'Tu sesión fue cerrada. Vuelve a iniciar sesión.' };
  }
  // `estado` puede venir nulo en usuarios antiguos (la columna se agrego
  // despues) y esos siguen siendo validos.
  if (!usuario || (usuario.estado && usuario.estado !== 'activo')) {
    return { codigo: 'CUENTA_INACTIVA', error: 'Tu cuenta no está activa o ya no existe' };
  }
  // Portal de clientes retirado: las sesiones de cliente que quedaron
  // abiertas se cortan (el frontend cierra la sesion con el 401).
  if (usuario.rol === 'CLIENTE' && !portalActivo()) {
    return { codigo: 'SESION_REVOCADA', error: 'El portal de clientes ya no está disponible.' };
  }
  return { usuario: perfilDeSesion(usuario), sesion, debeActivar2FA: debeActivar2FA(usuario) };
};

const verificarToken = async (req, res, next) => {
  // El token viene unicamente en el header: "Authorization: Bearer <token>".
  // No se acepta por `?token=`: quedaria en logs y en el historial.
  const authHeader = req.headers['authorization'] || '';
  const [esquema, token] = authHeader.split(' ');

  if (!token || !/^Bearer$/i.test(esquema)) {
    return rechazar(res, 'TOKEN_AUSENTE', 'Acceso denegado: token no encontrado');
  }

  let datos;
  try {
    datos = verificarAccess(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return rechazar(res, 'TOKEN_EXPIRADO', 'Token expirado');
    }
    return rechazar(res, 'TOKEN_INVALIDO', 'Token inválido');
  }

  try {
    const resultado = await usuarioDeSesion(datos);
    if (resultado.codigo) return rechazar(res, resultado.codigo, resultado.error);
    const { usuario, sesion } = resultado;

    // La cuenta CONFIGURADOR solo puede usar su propia cuenta (/api/auth) y el
    // panel de configuracion: nada de proyectos, tareas, usuarios ni contratos.
    if (usuario.rol === 'CONFIGURADOR' && !RUTAS_CONFIGURADOR.includes(req.baseUrl)) {
      return res.status(403).json({ error: 'Esta cuenta solo tiene acceso al panel de configuración', codigo: 'SOLO_CONFIGURACION' });
    }

    // La cuenta CLIENTE solo ve su portal (proyectos, contratos, documentos y
    // reuniones de su empresa), sus avisos y su propia cuenta.
    if (usuario.rol === 'CLIENTE' && !RUTAS_CLIENTE.includes(req.baseUrl)) {
      return res.status(403).json({ error: 'Esta cuenta solo tiene acceso al portal de clientes', codigo: 'SOLO_PORTAL' });
    }

    // La política exige verificación en dos pasos y aún no la activó: solo
    // puede usar su cuenta (/api/auth) para configurarla.
    if (resultado.debeActivar2FA && req.baseUrl !== '/api/auth') {
      return res.status(403).json({ error: 'Debes activar la verificación en dos pasos para continuar', codigo: 'REQUIERE_2FA' });
    }

    req.usuario = usuario;
    req.sesionId = sesion.id;
    req.sesionExpiraEn = sesion.expiraEn;
    return next();
  } catch (error) {
    console.error('[verificarToken]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { verificarToken, invalidarCacheUsuario, usuarioDeSesion };
