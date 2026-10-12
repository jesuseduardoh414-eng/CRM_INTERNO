// Acceso al modulo de finanzas. Los permisos son por usuario y por recurso
// (utils/finanzas.utils.js); el administrador global siempre pasa.
const { tieneAccesoFinanzas, puedeVer, puedeEditar, sinPermiso, leerId } = require('../utils/finanzas.utils');

/** 403 si la cuenta no tiene ningun permiso de finanzas. */
const requiereAccesoFinanzas = (req, res, next) => (tieneAccesoFinanzas(req.usuario) ? next() : sinPermiso(res));

/**
 * 403 si no alcanza el nivel pedido sobre el recurso ('ventas', 'tesoreria',
 * 'informe'). Las categorias de gastos se comprueban en el controlador,
 * porque dependen del registro.
 */
const requiereNivel = (recurso, nivel = 'ver') => (req, res, next) => {
  const ok = nivel === 'editar' ? puedeEditar(req.usuario, recurso) : puedeVer(req.usuario, recurso);
  return ok ? next() : sinPermiso(res);
};

/** Pasa si tiene el nivel pedido en cualquiera de los recursos. */
const requiereAlguno = (recursos, nivel = 'ver') => (req, res, next) => {
  const comprobar = nivel === 'editar' ? puedeEditar : puedeVer;
  return recursos.some((r) => comprobar(req.usuario, r)) ? next() : sinPermiso(res);
};

/**
 * Antes de leer el archivo subido (multer lo carga entero en memoria): el
 * gasto existe y la persona puede editar su categoria. Sin esto, cualquiera
 * con algun acceso a finanzas podia mandar archivos grandes a cualquier id.
 */
const requiereEditarGasto = async (req, res, next) => {
  try {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    // eslint-disable-next-line global-require
    const gasto = await require('../lib/prisma').gasto.findUnique({ where: { id }, select: { categoria: true } });
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
    return puedeEditar(req.usuario, `gastos.${gasto.categoria}`) ? next() : sinPermiso(res);
  } catch (error) {
    return next(error);
  }
};

module.exports = { requiereAccesoFinanzas, requiereNivel, requiereAlguno, requiereEditarGasto };
