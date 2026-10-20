// Middleware de roles
// Verifica que el usuario autenticado tenga el rol requerido
const { esAdmin } = require('../utils/permissions.utils');
const { puede, sinPermiso } = require('../utils/permisosArea.utils');

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

/**
 * 403 SIN_PERMISO si la persona no tiene la casilla (tabla de su area y sus
 * ajustes, utils/permisosArea.utils.js). En las de alcance basta con que no
 * sea "ninguno"; el controlador mira hasta donde llega.
 */
const requiere = (clave) => (req, res, next) => (puede(req.usuario, clave) ? next() : sinPermiso(res));

/** Pasa con cualquiera de las casillas. */
const requiereAlguno = (claves) => (req, res, next) => (claves.some((c) => puede(req.usuario, c)) ? next() : sinPermiso(res));

module.exports = { soloAdmin, soloMiembro, soloConfigurador, requiere, requiereAlguno };
