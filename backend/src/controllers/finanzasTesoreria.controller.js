// Finanzas / Tesoreria: la bolsa de ingresos (pagos registrados en la moneda
// base) y como se reparte en partidas. Una asignacion aparta dinero de la
// bolsa para una partida; los gastos con esa partida lo consumen.
//
//   sin asignar          = ingresos - asignado (de todas las partidas)
//   disponible (partida) = asignado - gastado (PAGADO) - comprometido (PENDIENTE)
//
// Todo se calcula en cada lectura a partir de los movimientos (no hay saldos
// guardados que puedan descuadrarse). Permiso `tesoreria` (ver / editar),
// comprobado en la ruta.
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { partesDiaMexico } = require('../utils/fechas.utils');
const { parsearPaginacion, paginar, combinarWhere } = require('../utils/paginacion.utils');
const F = require('../utils/finanzas.utils');

const incluirAsignacion = {
  partida: { select: F.selectPartidaCorta },
  creadoPor: { select: F.selectUsuarioCorto },
};

const serializarAsignacion = (a) => ({ ...a, monto: F.aNumero(a.monto), fecha: F.fechaATexto(a.fecha) });

/** Movimientos completos (todos los años) para calcular saldos. `db` = prisma o una transaccion. */
const cargarMovimientos = (db = prisma) => Promise.all([
  db.pago.findMany({ where: { estado: 'REGISTRADO' }, select: { monto: true, moneda: true, fecha: true } }),
  db.asignacionPartida.findMany({ select: { id: true, partidaId: true, monto: true, fecha: true } }),
  db.gasto.findMany({ where: { estado: { not: 'ANULADO' } }, select: { partidaId: true, monto: true, moneda: true, fecha: true, estado: true } }),
  // _count.gastos incluye los anulados: con cualquiera, la partida se archiva en vez de borrarse.
  db.partida.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], include: { _count: { select: { gastos: true } } } }),
]);

const calcularSaldos = ([pagos, asignaciones, gastos, partidas]) => {
  const ingresos = F.sumar(pagos.filter((p) => p.moneda === F.MONEDA_BASE).map((p) => p.monto));
  const asignado = F.sumar(asignaciones.map((a) => a.monto));
  const gastosBase = gastos.filter((g) => g.moneda === F.MONEDA_BASE);
  const porPartida = partidas.map((p) => {
    const asignadoP = F.sumar(asignaciones.filter((a) => a.partidaId === p.id).map((a) => a.monto));
    const gastado = F.sumar(gastosBase.filter((g) => g.partidaId === p.id && g.estado === 'PAGADO').map((g) => g.monto));
    const comprometido = F.sumar(gastosBase.filter((g) => g.partidaId === p.id && g.estado === 'PENDIENTE').map((g) => g.monto));
    const { _count, ...partida } = p;
    return {
      ...partida,
      totalGastos: _count?.gastos ?? 0,
      asignado: asignadoP,
      gastado,
      comprometido,
      disponible: Math.round((asignadoP - gastado - comprometido) * 100) / 100,
      totalAsignaciones: asignaciones.filter((a) => a.partidaId === p.id).length,
    };
  });
  return {
    ingresos,
    asignado,
    sinAsignar: Math.round((ingresos - asignado) * 100) / 100,
    partidas: porPartida,
    sinPartida: {
      gastado: F.sumar(gastosBase.filter((g) => !g.partidaId && g.estado === 'PAGADO').map((g) => g.monto)),
      comprometido: F.sumar(gastosBase.filter((g) => !g.partidaId && g.estado === 'PENDIENTE').map((g) => g.monto)),
    },
    otrasMonedas: pagos.filter((p) => p.moneda !== F.MONEDA_BASE).length + gastos.filter((g) => g.moneda !== F.MONEDA_BASE).length,
  };
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/tesoreria?anio=  -> saldos globales, por partida y por mes
// ---------------------------------------------------------------------------
const resumen = async (req, res) => {
  try {
    const anio = F.leerAnio(req.query.anio, partesDiaMexico().year);
    const movimientos = await cargarMovimientos();
    const [pagos, asignaciones, gastos] = movimientos;
    const saldos = calcularSaldos(movimientos);

    const delAnio = (lista) => lista.filter((x) => x.fecha.getUTCFullYear() === anio);
    const porMes = Array.from({ length: 12 }, (_v, mes) => {
      const enMes = (lista) => lista.filter((x) => x.fecha.getUTCMonth() === mes);
      return {
        mes: mes + 1,
        ingresos: F.sumar(enMes(delAnio(pagos.filter((p) => p.moneda === F.MONEDA_BASE))).map((p) => p.monto)),
        asignado: F.sumar(enMes(delAnio(asignaciones)).map((a) => a.monto)),
        // Solo lo pagado, como el "gastado" de cada partida (lo pendiente es comprometido).
        gastado: F.sumar(enMes(delAnio(gastos.filter((g) => g.moneda === F.MONEDA_BASE && g.estado === 'PAGADO'))).map((g) => g.monto)),
      };
    });

    const ultimas = await prisma.asignacionPartida.findMany({ include: incluirAsignacion, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 8 });

    return res.json({
      anio,
      moneda: F.MONEDA_BASE,
      ...saldos,
      porMes,
      ultimasAsignaciones: ultimas.map(serializarAsignacion),
    });
  } catch (error) {
    console.error('[finanzas.tesoreria.resumen]', error);
    return res.status(500).json({ error: 'Error al calcular la tesorería' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/tesoreria/asignaciones?partidaId=&anio=&page=&limit=
// ---------------------------------------------------------------------------
const listarAsignaciones = async (req, res) => {
  try {
    const partidaId = F.leerId(req.query.partidaId);
    const anio = F.leerAnio(req.query.anio, null);
    const where = combinarWhere(
      partidaId ? { partidaId } : null,
      anio ? { fecha: { gte: F.rangoAnio(anio).inicio, lt: F.rangoAnio(anio).fin } } : null,
    );
    const asignaciones = await prisma.asignacionPartida.findMany({ where, include: incluirAsignacion, orderBy: [{ fecha: 'desc' }, { id: 'desc' }] });
    const lista = asignaciones.map(serializarAsignacion);
    const { items, meta } = paginar(lista, parsearPaginacion(req.query, { limitePorDefecto: 25 }));
    const resumenFiltro = { total: F.sumar(lista.map((a) => a.monto)), cantidad: lista.length };
    return res.json(meta ? { asignaciones: items, meta, resumenFiltro } : { asignaciones: items, resumenFiltro });
  } catch (error) {
    console.error('[finanzas.tesoreria.listarAsignaciones]', error);
    return res.status(500).json({ error: 'Error al listar las asignaciones' });
  }
};

// `partidaActual`: al editar, la partida que ya tenia; esa se acepta aunque
// este archivada (corregir el monto o la nota de una asignacion vieja).
const normalizarAsignacion = async (body = {}, { parcial = false, partidaActual = null } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('partidaId')) {
    const partidaId = F.leerId(body.partidaId);
    if (!partidaId) errores.push('Elige una partida');
    else {
      const partida = await prisma.partida.findUnique({ where: { id: partidaId }, select: { id: true, activa: true, nombre: true } });
      if (!partida) errores.push('La partida no existe');
      else if (!partida.activa && partidaId !== partidaActual) errores.push(`La partida "${partida.nombre}" está archivada`);
      else data.partidaId = partidaId;
    }
  }
  if (!parcial || viene('monto')) {
    const monto = F.leerMonto(body.monto);
    if (monto === false) errores.push('El monto debe ser un número mayor que cero');
    else data.monto = monto;
  }
  if (!parcial || viene('fecha')) {
    const fecha = F.leerFecha(body.fecha);
    if (fecha === false) errores.push('La fecha no es válida (AAAA-MM-DD)');
    else data.fecha = fecha || F.hoyFecha();
  }
  if (viene('nota')) data.nota = F.textoOpcional(body.nota, 255);
  return { data, errores };
};

// Comprobar el saldo y grabar la asignacion tiene que ser un solo paso: dos
// altas simultaneas leian el mismo "sin asignar", pasaban las dos y la bolsa
// quedaba en negativo. En este proceso se hacen de una en una (cola); entre
// varias instancias (serverless) la transaccion serializable hace fallar a
// una de las dos, que recibe 409 para reintentar.
let colaAsignaciones = Promise.resolve();
const enCola = (fn) => {
  const resultado = colaAsignaciones.then(fn, fn);
  colaAsignaciones = resultado.catch(() => {});
  return resultado;
};

class SinFondos extends Error {
  constructor(sinAsignar) {
    super('SIN_FONDOS');
    this.sinAsignar = sinAsignar;
  }
}

/**
 * Corre `escribir(tx)` solo si `monto` cabe en lo que hay sin asignar (al
 * editar, la propia asignacion vuelve a estar disponible). Sin `monto` no
 * comprueba nada. Lanza SinFondos si no cabe.
 */
const conSaldo = (asignacionId, monto, escribir) => enCola(() => prisma.$transaction(async (tx) => {
  if (monto !== undefined) {
    const movimientos = await cargarMovimientos(tx);
    const propia = asignacionId ? movimientos[1].find((a) => a.id === asignacionId) : null;
    const sinAsignar = Math.round((calcularSaldos(movimientos).sinAsignar + (propia ? F.aNumero(propia.monto) : 0)) * 100) / 100;
    if (monto > sinAsignar) throw new SinFondos(sinAsignar);
  }
  return escribir(tx);
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }));

const esConflicto = (error) => error?.code === 'P2034' || /deadlock|could not serialize|write conflict/i.test(String(error?.message || ''));

/** Respuesta para SinFondos o un choque entre transacciones; null si es otro error. */
const responderSaldo = (res, error) => {
  if (error instanceof SinFondos) {
    return res.status(409).json({ error: `Solo hay ${error.sinAsignar.toFixed(2)} ${F.MONEDA_BASE} sin asignar en la bolsa de ingresos`, codigo: 'SIN_FONDOS', sinAsignar: error.sinAsignar });
  }
  if (esConflicto(error)) {
    return res.status(409).json({ error: 'Otra asignación se registró al mismo tiempo. Vuelve a intentarlo.', codigo: 'CONFLICTO' });
  }
  return null;
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/tesoreria/asignaciones  { partidaId, monto, fecha, nota }
// No se puede apartar mas de lo que hay sin asignar.
// ---------------------------------------------------------------------------
const crearAsignacion = async (req, res) => {
  try {
    const { data, errores } = await normalizarAsignacion(req.body);
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la asignación', detalles: errores });
    const asignacion = await conSaldo(null, data.monto, (tx) => tx.asignacionPartida.create({ data: { ...data, creadoPorId: req.usuario.id }, include: incluirAsignacion }));
    F.registrarFinanzas(req.usuario, 'asignacion', asignacion.id, 'CREAR', `Asignó ${F.aNumero(asignacion.monto)} ${F.MONEDA_BASE} a la partida "${asignacion.partida.nombre}"`);
    return res.status(201).json({ mensaje: `Asignados ${F.aNumero(asignacion.monto)} ${F.MONEDA_BASE} a ${asignacion.partida.nombre}`, asignacion: serializarAsignacion(asignacion) });
  } catch (error) {
    if (responderSaldo(res, error)) return undefined;
    console.error('[finanzas.tesoreria.crearAsignacion]', error);
    return res.status(500).json({ error: 'Error al crear la asignación' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/finanzas/tesoreria/asignaciones/:id
// ---------------------------------------------------------------------------
const editarAsignacion = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.asignacionPartida.findUnique({ where: { id }, include: incluirAsignacion });
    if (!actual) return res.status(404).json({ error: 'Asignación no encontrada' });
    const { data, errores } = await normalizarAsignacion(req.body, { parcial: true, partidaActual: actual.partidaId });
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la asignación', detalles: errores });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar' });
    const asignacion = await conSaldo(id, data.monto, (tx) => tx.asignacionPartida.update({ where: { id }, data, include: incluirAsignacion }));
    F.registrarFinanzas(req.usuario, 'asignacion', id, 'EDITAR', `Editó la asignación de "${actual.partida.nombre}" (${Object.keys(data).join(', ')})`);
    return res.json({ mensaje: 'Asignación actualizada', asignacion: serializarAsignacion(asignacion) });
  } catch (error) {
    if (responderSaldo(res, error)) return undefined;
    console.error('[finanzas.tesoreria.editarAsignacion]', error);
    return res.status(500).json({ error: 'Error al actualizar la asignación' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/finanzas/tesoreria/asignaciones/:id
// ---------------------------------------------------------------------------
const eliminarAsignacion = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.asignacionPartida.findUnique({ where: { id }, include: incluirAsignacion });
    if (!actual) return res.status(404).json({ error: 'Asignación no encontrada' });
    await prisma.asignacionPartida.delete({ where: { id } });
    F.registrarFinanzas(req.usuario, 'asignacion', id, 'ELIMINAR', `Quitó la asignación de ${F.aNumero(actual.monto)} ${F.MONEDA_BASE} a "${actual.partida.nombre}"`);
    return res.json({ mensaje: 'Asignación eliminada' });
  } catch (error) {
    console.error('[finanzas.tesoreria.eliminarAsignacion]', error);
    return res.status(500).json({ error: 'Error al eliminar la asignación' });
  }
};

module.exports = { resumen, listarAsignaciones, crearAsignacion, editarAsignacion, eliminarAsignacion, calcularSaldos, cargarMovimientos };
