// Modulos y permisos configurables desde el panel (configuracion.modulos y
// configuracion.permisos). Se comprueban en el servidor: ocultar un boton en
// el frontend no basta.
const { moduloActivo, configEnCache } = require('../services/configuracion.service');
const { esAdmin } = require('../utils/permissions.utils');

/** 404 MODULO_DESACTIVADO si el configurador apago el modulo. */
const requiereModulo = (modulo) => async (_req, res, next) => {
  try {
    if (await moduloActivo(modulo)) return next();
    return res.status(404).json({ error: 'Este módulo está desactivado en esta instalación', codigo: 'MODULO_DESACTIVADO' });
  } catch (error) {
    return next(error);
  }
};

/** Los administradores siempre pueden; un miembro, solo si el permiso esta activo. */
const tienePermiso = (usuario, clave) => esAdmin(usuario) || configEnCache().permisos?.[clave] === true;

/** 403 SIN_PERMISO si un miembro no tiene ese permiso. */
const requierePermiso = (clave) => (req, res, next) => {
  if (tienePermiso(req.usuario, clave)) return next();
  return res.status(403).json({ error: 'Tu cuenta no tiene permiso para hacer esto. Pídeselo a un administrador.', codigo: 'SIN_PERMISO' });
};

module.exports = { requiereModulo, requierePermiso, tienePermiso };
