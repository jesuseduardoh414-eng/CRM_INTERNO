// Presupuestos mensuales por categoria de gastos y la bolsa de ingresos
// (Tesoreria). Todo se calcula en cada lectura a partir de los movimientos en
// la moneda base: no hay saldos guardados que puedan descuadrarse.
//
// Para cada categoria y mes:
//   usado      = gastado (PAGADO) + comprometido (PENDIENTE) con fecha en ese mes
//   remanente  = presupuesto - usado            (negativo: se paso)
//   reservado  = mes abierto (el actual o uno futuro): max(presupuesto, usado)
//                mes cerrado: usado             (el remanente vuelve a la bolsa)
//   sin asignar (bolsa) = ingresos - lo reservado en todos los meses
//
// Es decir: sin asignar = ingresos - gastos - presupuesto aun no gastado de
// los meses abiertos. Un gasto sin presupuesto tambien sale de la bolsa.
const prisma = require('../lib/prisma');
const { partesDiaMexico } = require('../utils/fechas.utils');
const F = require('../utils/finanzas.utils');

/** { anio, mes (1-12) } de hoy en la zona de la empresa. */
const mesActual = () => {
  const { year, month } = partesDiaMexico();
  return { anio: year, mes: month + 1 };
};

const claveMes = (anio, mes) => anio * 100 + mes;
const esMesCerrado = (anio, mes, actual = mesActual()) => claveMes(anio, mes) < claveMes(actual.anio, actual.mes);
const mesAnterior = (anio, mes) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });

/** Movimientos que entran en los calculos. `db` = prisma o una transaccion. */
const cargarMovimientos = async (db = prisma) => {
  const [pagos, gastos, presupuestos] = await Promise.all([
    db.pago.findMany({ where: { estado: 'REGISTRADO', moneda: F.MONEDA_BASE }, select: { monto: true, fecha: true } }),
    db.gasto.findMany({ where: { estado: { not: 'ANULADO' }, moneda: F.MONEDA_BASE }, select: { categoria: true, monto: true, fecha: true, estado: true } }),
    db.presupuestoCategoria.findMany({ select: { id: true, categoria: true, anio: true, mes: true, monto: true } }),
  ]);
  return { pagos, gastos, presupuestos };
};

// Celdas categoria x mes, en centavos enteros (sin errores de coma flotante).
const clave = (categoria, anio, mes) => `${categoria}|${anio}|${mes}`;

const indexar = ({ gastos, presupuestos }) => {
  const celdas = new Map();
  const celda = (categoria, anio, mes) => {
    const k = clave(categoria, anio, mes);
    if (!celdas.has(k)) celdas.set(k, { categoria, anio, mes, id: null, presupuesto: 0, gastado: 0, comprometido: 0 });
    return celdas.get(k);
  };
  presupuestos.forEach((p) => {
    const c = celda(p.categoria, p.anio, p.mes);
    c.id = p.id;
    c.presupuesto = F.centavos(p.monto);
  });
  gastos.forEach((g) => {
    const c = celda(g.categoria, g.fecha.getUTCFullYear(), g.fecha.getUTCMonth() + 1);
    if (g.estado === 'PAGADO') c.gastado += F.centavos(g.monto);
    else c.comprometido += F.centavos(g.monto);
  });
  return celdas;
};

const reservadoDe = (c, actual) => {
  const usado = c.gastado + c.comprometido;
  return esMesCerrado(c.anio, c.mes, actual) ? usado : Math.max(c.presupuesto, usado);
};

const enPesos = (centavos) => centavos / 100;

/** Saldos globales de la bolsa (en pesos) y las celdas para los detalles. */
const calcular = (movimientos, actual = mesActual()) => {
  const celdas = indexar(movimientos);
  const ingresos = movimientos.pagos.reduce((s, p) => s + F.centavos(p.monto), 0);
  let gastado = 0;
  let comprometido = 0;
  let reservado = 0;
  celdas.forEach((c) => {
    gastado += c.gastado;
    comprometido += c.comprometido;
    reservado += reservadoDe(c, actual);
  });
  return {
    actual,
    celdas,
    ingresos: enPesos(ingresos),
    gastado: enPesos(gastado),
    comprometido: enPesos(comprometido),
    // Presupuesto de los meses abiertos que todavia no se gasta.
    apartado: enPesos(reservado - gastado - comprometido),
    sinAsignar: enPesos(ingresos - reservado),
  };
};

const filaDe = (c) => ({
  categoria: c.categoria,
  id: c.id,
  presupuesto: enPesos(c.presupuesto),
  gastado: enPesos(c.gastado),
  comprometido: enPesos(c.comprometido),
  remanente: enPesos(c.presupuesto - c.gastado - c.comprometido),
});

const sumarFilas = (filas) => {
  const total = (campo) => F.sumar(filas.map((f) => f[campo]));
  return { presupuesto: total('presupuesto'), gastado: total('gastado'), comprometido: total('comprometido'), remanente: total('remanente') };
};

/** Las seis categorias en un mes: presupuesto, gastado, comprometido, remanente. */
const detalleMes = ({ celdas, actual }, anio, mes) => {
  const vacia = (categoria) => ({ categoria, anio, mes, id: null, presupuesto: 0, gastado: 0, comprometido: 0 });
  const categorias = F.CATEGORIAS_GASTO.map((c) => filaDe(celdas.get(clave(c, anio, mes)) || vacia(c)));
  return { anio, mes, cerrado: esMesCerrado(anio, mes, actual), categorias, totales: sumarFilas(categorias) };
};

/** Las seis categorias sumando los doce meses de un año. */
const detalleAnio = (calculo, anio) => {
  const meses = Array.from({ length: 12 }, (_v, i) => detalleMes(calculo, anio, i + 1));
  const categorias = F.CATEGORIAS_GASTO.map((categoria, i) => {
    const filas = meses.map((m) => m.categorias[i]);
    return { categoria, id: null, ...sumarFilas(filas) };
  });
  return { anio, mes: null, categorias, totales: sumarFilas(categorias), meses };
};

/** Doce filas del año: ingresos del mes y los totales de presupuesto y gasto. */
const resumenMeses = (calculo, movimientos, anio) => {
  const { meses } = detalleAnio(calculo, anio);
  return meses.map((m) => ({
    mes: m.mes,
    cerrado: m.cerrado,
    ingresos: F.sumar(movimientos.pagos.filter((p) => p.fecha.getUTCFullYear() === anio && p.fecha.getUTCMonth() + 1 === m.mes).map((p) => p.monto)),
    ...m.totales,
  }));
};

/**
 * Cuanto cambia lo reservado si los presupuestos de `mes` pasan a `nuevos`
 * ({ CATEGORIA: pesos }). Solo cuentan los meses abiertos: en uno cerrado el
 * presupuesto ya no aparta nada. Devuelve centavos.
 */
const deltaReservado = ({ celdas, actual }, anio, mes, nuevos) => Object.entries(nuevos).reduce((delta, [categoria, monto]) => {
  const actualCelda = celdas.get(clave(categoria, anio, mes)) || { anio, mes, presupuesto: 0, gastado: 0, comprometido: 0 };
  const nueva = { ...actualCelda, presupuesto: F.centavos(monto) };
  return delta + reservadoDe(nueva, actual) - reservadoDe(actualCelda, actual);
}, 0);

/**
 * Presupuesto, gastado y remanente de UNA categoria en un mes (para Gastos y
 * su formulario). Consultas acotadas: no carga todos los movimientos.
 */
const resumenCategoriaMes = async (categoria, anio, mes) => {
  const { inicio, fin } = F.rangoMes(anio, mes - 1);
  const [presupuesto, porEstado] = await Promise.all([
    prisma.presupuestoCategoria.findUnique({ where: { categoria_anio_mes: { categoria, anio, mes } }, select: { id: true, monto: true } }),
    prisma.gasto.groupBy({
      by: ['estado'],
      where: { categoria, moneda: F.MONEDA_BASE, estado: { not: 'ANULADO' }, fecha: { gte: inicio, lt: fin } },
      _sum: { monto: true },
    }),
  ]);
  const suma = (estado) => F.centavos(porEstado.find((g) => g.estado === estado)?._sum.monto);
  return {
    ...filaDe({ categoria, id: presupuesto?.id ?? null, presupuesto: F.centavos(presupuesto?.monto), gastado: suma('PAGADO'), comprometido: suma('PENDIENTE') }),
    anio,
    mes,
    cerrado: esMesCerrado(anio, mes),
    tienePresupuesto: Boolean(presupuesto),
    moneda: F.MONEDA_BASE,
  };
};

module.exports = {
  mesActual,
  mesAnterior,
  esMesCerrado,
  cargarMovimientos,
  calcular,
  detalleMes,
  detalleAnio,
  resumenMeses,
  deltaReservado,
  resumenCategoriaMes,
};
