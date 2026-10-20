// Modulos que el configurador puede apagar (configuracion.modulos). Se
// comprueban en el servidor: ocultar un boton en el frontend no basta. Los
// permisos de cada persona van aparte: middlewares/roles.middleware.js (requiere).
const { moduloActivo } = require('../services/configuracion.service');

/** 404 MODULO_DESACTIVADO si el configurador apago el modulo. */
const requiereModulo = (modulo) => async (_req, res, next) => {
  try {
    if (await moduloActivo(modulo)) return next();
    return res.status(404).json({ error: 'Este módulo está desactivado en esta instalación', codigo: 'MODULO_DESACTIVADO' });
  } catch (error) {
    return next(error);
  }
};

module.exports = { requiereModulo };
