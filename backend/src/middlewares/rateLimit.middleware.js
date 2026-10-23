const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// LIMITACION CONOCIDA: los contadores viven en memoria del proceso. En Vercel
// cada instancia (y cada arranque en frio) tiene su propio contador, asi que
// el limite real es "por instancia", no global, y se reinicia al reciclarse
// la funcion. Sigue frenando la fuerza bruta mas burda; para un limite
// estricto habria que usar un store compartido (Redis/Upstash).

const VENTANA_MS = 15 * 60 * 1000; // 15 minutos
const cabeceras = { standardHeaders: true, legacyHeaders: false };

// Clave "ip + correo": frena a quien prueba muchas contraseñas contra una
// misma cuenta aunque cambie poco de IP, y a la vez no castiga a toda una
// oficina que comparte IP si solo una cuenta esta siendo atacada.
// En reset-password no viene correo en el cuerpo, asi que se usa el token.
// `ipKeyGenerator` recibe la IP como cadena (normaliza IPv6 a /56), no `req`.
const claveIpCorreo = (req) => {
  const identificador = String(req.body?.email || req.params?.token || '').toLowerCase().trim();
  return `${ipKeyGenerator(req.ip || '')}|${identificador}`;
};

// Limitador general para rutas de autenticacion (register, etc.)
const authLimiter = rateLimit({
  windowMs: VENTANA_MS,
  limit:50,
  message: {
    error: 'Demasiados intentos desde esta IP, por favor intenta de nuevo en 15 minutos'
  },
  ...cabeceras,
});

// Login: 10 intentos por IP cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: VENTANA_MS,
  limit:10,
  message: {
    error: 'Demasiados intentos de inicio de sesión, por favor intenta de nuevo en 15 minutos'
  },
  ...cabeceras,
});

// Limite por (ip + correo) para login, forgot y reset. Solo cuentan los
// intentos fallidos, para que un usuario legitimo no se bloquee a si mismo.
const limitePorCorreo = rateLimit({
  windowMs: VENTANA_MS,
  limit:5,
  keyGenerator: claveIpCorreo,
  skipSuccessfulRequests: true,
  message: {
    error: 'Demasiados intentos para esta cuenta, por favor intenta de nuevo en 15 minutos'
  },
  ...cabeceras,
});

// Olvide mi contraseña: la respuesta es siempre 200 (neutra, para no revelar
// si el correo existe), asi que aqui NO se pueden saltar las peticiones
// exitosas: se cuentan todas. 3 correos por (ip + correo) cada 15 minutos.
const limiteOlvidePassword = rateLimit({
  windowMs: VENTANA_MS,
  limit: 3,
  keyGenerator: claveIpCorreo,
  message: {
    error: 'Ya se enviaron varios correos de recuperación a esta cuenta, intenta de nuevo en 15 minutos'
  },
  ...cabeceras,
});

// Registro: 5 cuentas nuevas por IP cada hora.
const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: { error: 'Demasiados registros desde esta red. Intenta de nuevo en una hora.' },
  ...cabeceras,
});

// Codigo de verificacion de correo: ademas del tope de 5 intentos por codigo
// que se guarda en la base, 10 intentos por (ip + correo) cada 15 minutos.
const limiteCodigoVerificacion = rateLimit({
  windowMs: VENTANA_MS,
  limit: 10,
  keyGenerator: claveIpCorreo,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos con el código. Espera 15 minutos.' },
  ...cabeceras,
});

// Reenvio de codigo: se cuentan todas (la respuesta siempre es 200).
const limiteReenvioCodigo = rateLimit({
  windowMs: VENTANA_MS,
  limit: 4,
  keyGenerator: claveIpCorreo,
  message: { error: 'Ya te enviamos varios códigos. Espera 15 minutos antes de pedir otro.' },
  ...cabeceras,
});

// Segundo factor en el login: 10 intentos fallidos por IP cada 15 minutos
// (el bloqueo por cuenta de la base se suma a esto).
const limiteDosFactores = rateLimit({
  windowMs: VENTANA_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados códigos incorrectos. Espera 15 minutos.' },
  ...cabeceras,
});

// Renovacion de sesion: holgado (varias pestañas), pero con techo.
const limiteRefresh = rateLimit({
  windowMs: VENTANA_MS,
  limit: 150,
  message: { error: 'Demasiadas renovaciones de sesión. Espera unos minutos.' },
  ...cabeceras,
});

// Acciones sensibles con sesion iniciada (cambiar contraseña, 2FA): por
// usuario, no por IP.
const limiteAccionSensible = rateLimit({
  windowMs: VENTANA_MS,
  limit: 10,
  keyGenerator: (req) => `usuario:${req.usuario?.id ?? ipKeyGenerator(req.ip || '')}`,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  ...cabeceras,
});

// Techo general de toda la API: frena inundaciones y que una sesion robada
// descargue la base a base de peticiones. Por persona si trae sesion valida
// (token o cookie de archivos), por IP si no. Holgado a proposito: una
// oficina entera puede salir por la misma IP. El de salud no cuenta.
const claveSesion = (req) => {
  // eslint-disable-next-line global-require
  const datos = require('../services/sesiones.service').sesionDeArchivos(req);
  return datos && Number.isInteger(datos.usuarioId) ? `usuario:${datos.usuarioId}` : null;
};
const limiteGeneral = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: (req) => (claveSesion(req) ? 2000 : 1000),
  keyGenerator: (req) => claveSesion(req) || `ip:${ipKeyGenerator(req.ip || '')}`,
  skip: (req) => req.path === '/health',
  message: { error: 'Demasiadas peticiones seguidas. Espera unos minutos y vuelve a intentarlo.' },
  ...cabeceras,
});

module.exports = {
  limiteGeneral,
  authLimiter,
  loginLimiter,
  limitePorCorreo,
  limiteOlvidePassword,
  limiteRegistro,
  limiteCodigoVerificacion,
  limiteReenvioCodigo,
  limiteDosFactores,
  limiteRefresh,
  limiteAccionSensible,
};
