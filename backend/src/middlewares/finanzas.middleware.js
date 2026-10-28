// Acceso al modulo de finanzas. Los permisos son las casillas finanzas.* de la
// tabla por area y de los ajustes de cada persona (utils/finanzas.utils.js);
// el administrador general siempre pasa.
const {
  tieneAccesoFinanzas, puedeFin, puedeGasto, sinPermiso, leerId, accesoCotizaciones,
} = require('../utils/finanzas.utils');

/** 403 si la cuenta no tiene ningun permiso de finanzas. */
const requiereAccesoFinanzas = (req, res, next) => (tieneAccesoFinanzas(req.usuario) ? next() : sinPermiso(res));

/**
 * Cotizaciones: pasa quien tiene finanzas.cotizaciones.ver y tambien quien,
 * sin ese permiso, ve alguna (se la compartieron o la registro). Lo que ve
 * cada uno lo filtra el controlador.
 */
const requiereVerCotizaciones = async (req, res, next) => {
  try {
    if (puedeFin(req.usuario, 'cotizaciones', 'ver')) return next();
    // eslint-disable-next-line global-require
    const alguna = await require('../lib/prisma').cotizacion.findFirst({ where: accesoCotizaciones(req.usuario), select: { id: true } });
    return alguna ? next() : sinPermiso(res);
  } catch (error) {
    return next(error);
  }
};

/**
 * 403 si no puede la accion sobre el recurso ('ventas', 'tesoreria',
 * 'informe', 'cotizaciones'). Las categorias de gastos se comprueban en el
 * controlador, porque dependen del registro.
 */
const requiereFin = (recurso, accion = 'ver') => (req, res, next) => (
  puedeFin(req.usuario, recurso, accion) ? next() : sinPermiso(res)
);

/** Pasa si puede cualquiera de los pares [recurso, accion]. */
const requiereAlgunaFin = (pares) => (req, res, next) => (
  pares.some(([recurso, accion]) => puedeFin(req.usuario, recurso, accion)) ? next() : sinPermiso(res)
);

/**
 * Antes de leer el archivo subido (multer lo carga entero en memoria): el
 * gasto existe y la persona puede crear o editar en su categoria. Sin esto,
 * cualquiera con algun acceso a finanzas podia mandar archivos grandes a
 * cualquier id.
 */
const requiereComprobanteGasto = async (req, res, next) => {
  try {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    // eslint-disable-next-line global-require
    const gasto = await require('../lib/prisma').gasto.findUnique({ where: { id }, select: { categoria: true } });
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
    const ok = puedeGasto(req.usuario, gasto.categoria, 'crear') || puedeGasto(req.usuario, gasto.categoria, 'editar');
    return ok ? next() : sinPermiso(res);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  requiereAccesoFinanzas, requiereVerCotizaciones, requiereFin, requiereAlgunaFin, requiereComprobanteGasto,
};
