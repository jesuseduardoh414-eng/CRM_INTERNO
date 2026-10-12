// Rutas de autenticación (/api/auth)
//
// Públicas
//   GET  /config                     modo de registro, dominios y politica de contraseña
//   POST /register                   alta (segun REGISTRO_MODO) -> envia codigo
//   POST /verificar-email            confirma el codigo de 6 digitos
//   POST /reenviar-codigo            codigo nuevo (cada 60 s como minimo)
//   POST /login                      correo + contraseña (+ recordar)
//   POST /2fa/login                  segundo paso del login con 2FA
//   POST /refresh                    rota el refresh token y da access token nuevo
//   POST /logout                     revoca la sesion del refresh token
//   POST /forgot-password            envia enlace de recuperacion
//   GET  /reset-password/:token      ¿sigue valido el enlace?
//   POST /reset-password/:token      fija la contraseña nueva
//   GET  /verify/:token              enlace de verificacion antiguo
//   GET  /invitacion/:token          datos de una invitacion
//   POST /invitacion/:token/aceptar  crea la cuenta invitada
// Con sesion
//   GET  /me, GET /seguridad, POST /cambiar-password
//   GET  /sesiones, DELETE /sesiones (las demas), DELETE /sesiones/:id
//   GET  /eventos
//   POST /2fa/configurar, /2fa/activar, /2fa/desactivar, /2fa/codigos-respaldo
// Admin
//   POST /invitar, POST /invitar/reenviar, GET /invitaciones, DELETE /invitaciones/:id

const express = require('express');
const ctrl = require('../controllers/auth.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloAdmin }      = require('../middlewares/roles.middleware');
const {
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
} = require('../middlewares/rateLimit.middleware');

const router = express.Router();

// Nada de lo que pasa por aqui (tokens, datos de cuenta) debe quedar en
// caches del navegador ni de proxies.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
});

// ---- Públicas ----
router.get('/config', ctrl.config);
router.post('/register', limiteRegistro, ctrl.register);
router.post('/verificar-email', authLimiter, limiteCodigoVerificacion, ctrl.verificarEmail);
router.post('/reenviar-codigo', authLimiter, limiteReenvioCodigo, ctrl.reenviarCodigo);
router.post('/login', loginLimiter, limitePorCorreo, ctrl.login);
router.post('/2fa/login', limiteDosFactores, ctrl.login2fa);
router.post('/refresh', limiteRefresh, ctrl.refresh);
router.post('/logout', authLimiter, ctrl.logout);
router.post('/forgot-password', authLimiter, limiteOlvidePassword, ctrl.forgotPassword);
router.get('/reset-password/:token', authLimiter, ctrl.validarResetToken);
router.post('/reset-password/:token', authLimiter, limitePorCorreo, ctrl.resetPassword);
router.get('/verify/:token', authLimiter, ctrl.verifyAccount);
router.get('/invitacion/:token', authLimiter, ctrl.verificarInvitacion);
router.post('/invitacion/:token/aceptar', authLimiter, ctrl.aceptarInvitacion);

// ---- Con sesión ----
router.get('/me', verificarToken, ctrl.me);
router.get('/seguridad', verificarToken, ctrl.resumenSeguridad);
router.post('/cambiar-password', verificarToken, limiteAccionSensible, ctrl.cambiarPassword);
router.get('/sesiones', verificarToken, ctrl.listarSesiones);
router.delete('/sesiones', verificarToken, ctrl.cerrarOtrasSesiones);
router.delete('/sesiones/:id', verificarToken, ctrl.cerrarSesion);
router.get('/eventos', verificarToken, ctrl.eventosSeguridad);
router.post('/2fa/configurar', verificarToken, limiteAccionSensible, ctrl.configurar2fa);
router.post('/2fa/activar', verificarToken, limiteAccionSensible, ctrl.activar2fa);
router.post('/2fa/desactivar', verificarToken, limiteAccionSensible, ctrl.desactivar2fa);
router.post('/2fa/codigos-respaldo', verificarToken, limiteAccionSensible, ctrl.regenerarCodigosRespaldo);

// ---- Gestión de invitaciones (solo admin) ----
router.post('/invitar', verificarToken, soloAdmin, ctrl.invitar);
router.post('/invitar/reenviar', verificarToken, soloAdmin, ctrl.reenviarInvitacion);
router.get('/invitaciones', verificarToken, soloAdmin, ctrl.listarInvitaciones);
router.delete('/invitaciones/:id', verificarToken, soloAdmin, ctrl.eliminarInvitacion);

module.exports = router;
