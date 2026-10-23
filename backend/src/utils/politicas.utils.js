// Reglas de acceso que dependen de la configuración de la instalación.
const { configEnCache } = require('../services/configuracion.service');

const reglasAcceso = () => configEnCache().seguridad;

// Cuentas que siempre necesitan verificación en dos pasos, diga lo que diga
// el panel: son las que pueden tomar otras cuentas o cambiar permisos.
// Decisión del usuario (2026-10-23). El panel solo puede pedirla a todos.
const ROLES_2FA_OBLIGATORIO = ['ADMIN', 'CONFIGURADOR'];

/** ¿La política exige verificación en dos pasos a esta persona? */
const exige2FA = (usuario) => {
  if (ROLES_2FA_OBLIGATORIO.includes(usuario?.rol)) return true;
  return reglasAcceso().dosFactores === 'todos';
};

/** Le falta activarla: hasta que lo haga solo puede usar /api/auth. */
const debeActivar2FA = (usuario) => exige2FA(usuario) && !usuario?.dosFactoresActivo;

module.exports = { reglasAcceso, exige2FA, debeActivar2FA };
