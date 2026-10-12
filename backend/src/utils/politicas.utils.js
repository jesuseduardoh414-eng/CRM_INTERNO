// Reglas de acceso que dependen de la configuración de la instalación.
const { configEnCache } = require('../services/configuracion.service');

const reglasAcceso = () => configEnCache().seguridad;

/** ¿La política exige verificación en dos pasos a esta persona? */
const exige2FA = (usuario) => {
  const politica = reglasAcceso().dosFactores;
  if (politica === 'todos') return true;
  if (politica === 'admins') return ['ADMIN', 'CONFIGURADOR'].includes(usuario?.rol);
  return false;
};

/** Le falta activarla: hasta que lo haga solo puede usar /api/auth. */
const debeActivar2FA = (usuario) => exige2FA(usuario) && !usuario?.dosFactoresActivo;

module.exports = { reglasAcceso, exige2FA, debeActivar2FA };
