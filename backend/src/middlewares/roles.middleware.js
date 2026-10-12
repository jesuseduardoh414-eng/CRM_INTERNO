// Middleware de roles
// Verifica que el usuario autenticado tenga el rol requerido
const { esAdmin } = require('../utils/permissions.utils');

// Solo permite el paso a usuarios con rol ADMIN
const soloAdmin = (req, res, next) => {
  if (!esAdmin(req.usuario)) {
    return res.status(403).json({
      error: 'Acceso denegado: solo los administradores pueden realizar esta accion',
    });
  }
  next();
};

const soloMiembro = (req, res, next) => {
  if (esAdmin(req.usuario)) {
    return res.status(403).json({
      error: 'Acceso denegado: esta accion es solo para miembros',
    });
  }
  next();
};

// Solo la cuenta de configuracion de la instalacion (rol CONFIGURADOR).
const soloConfigurador = (req, res, next) => {
  if (req.usuario?.rol !== 'CONFIGURADOR') {
    return res.status(403).json({ error: 'Acceso denegado: solo la cuenta de configuración puede hacer esto' });
  }
  next();
};

module.exports = { soloAdmin, soloMiembro, soloConfigurador };
