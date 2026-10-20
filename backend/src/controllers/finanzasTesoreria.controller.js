// Finanzas / Tesoreria: la bolsa de ingresos (pagos registrados en la moneda
// base) y el presupuesto mensual de cada categoria de gastos, que sale de esa
// bolsa. Las cuentas y reglas estan en services/presupuestos.service.js.
// Permiso `tesoreria` (ver / editar), comprobado en la ruta.
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const P = require('../services/presupuestos.service');
const F = require('../utils/finanzas.utils');

const nombreMes = (anio, mes) => `${F.MESES[mes - 1].toLowerCase()} de ${anio}`;

// ---------------------------------------------------------------------------
// GET /api/finanzas/tesoreria?anio=&mes=
// Saldos de la bolsa, presupuesto del mes elegido (por defecto el actual), el
// del mes anterior (para copiarlo) y el resumen mes a mes de ese año.
// ---------------------------------------------------------------------------
const resumen = async (req, res) => {
  try {
    const actual = P.mesActual();
    const anio = F.leerAnio(req.query.anio, actual.anio);
    const mes = F.leerMes(req.query.mes) || (anio === actual.anio ? actual.mes : 1);
    const [movimientos, otrasMonedas] = await Promise.all([
      P.cargarMovimientos(),
      Promise.all([
        prisma.pago.count({ where: { estado: 'REGISTRADO', moneda: { not: F.MONEDA_BASE } } }),
        prisma.gasto.count({ where: { estado: { not: 'ANULADO' }, moneda: { not: F.MONEDA_BASE } } }),
      ]).then(([pagos, gastos]) => pagos + gastos),
    ]);
    const calculo = P.calcular(movimientos, actual);
    const anterior = P.mesAnterior(anio, mes);
    const delAnterior = P.detalleMes(calculo, anterior.anio, anterior.mes);

    return res.json({
      anio,
      mes,
      mesActual: actual,
      moneda: F.MONEDA_BASE,
      ingresos: calculo.ingresos,
      gastado: calculo.gastado,
      comprometido: calculo.comprometido,
      apartado: calculo.apartado,
      sinAsignar: calculo.sinAsignar,
      presupuesto: P.detalleMes(calculo, anio, mes),
      anterior: { anio: anterior.anio, mes: anterior.mes, montos: Object.fromEntries(delAnterior.categorias.map((c) => [c.categoria, c.presupuesto])) },
      porMes: P.resumenMeses(calculo, movimientos, anio),
      otrasMonedas,
    });
  } catch (error) {
    console.error('[finanzas.tesoreria.resumen]', error);
    return res.status(500).json({ error: 'Error al calcular la tesorería' });
  }
};

// Comprobar la bolsa y grabar tiene que ser un solo paso: dos cambios
// simultaneos leian el mismo "sin asignar", pasaban los dos y la bolsa quedaba
// en negativo. En este proceso van de uno en uno (cola); entre varias
// instancias (serverless) la transaccion serializable hace fallar a uno, que
// recibe 409 para reintentar.
let cola = Promise.resolve();
const enCola = (fn) => {
  const resultado = cola.then(fn, fn);
  cola = resultado.catch(() => {});
  return resultado;
};

class SinFondos extends Error {
  constructor(sinAsignar, faltan) {
    super('SIN_FONDOS');
    this.sinAsignar = sinAsignar;
    this.faltan = faltan;
  }
}

const esConflicto = (error) => error?.code === 'P2034' || /deadlock|could not serialize|write conflict/i.test(String(error?.message || ''));

const normalizarPresupuestos = (body = {}) => {
  const errores = [];
  const anio = F.leerAnio(body.anio, null);
  const mes = F.leerMes(body.mes);
  if (!anio) errores.push('El año no es válido');
  if (!mes) errores.push('El mes no es válido (1 a 12)');
  const lista = Array.isArray(body.presupuestos) ? body.presupuestos : [];
  if (lista.length === 0) errores.push('No hay presupuestos que guardar');
  const nuevos = {};
  lista.slice(0, F.CATEGORIAS_GASTO.length + 1).forEach((p) => {
    const categoria = String(p?.categoria || '').toUpperCase();
    if (!F.CATEGORIAS_GASTO.includes(categoria)) { errores.push('Categoría de gasto no válida'); return; }
    if (categoria in nuevos) { errores.push(`La categoría ${F.NOMBRES_CATEGORIA[categoria]} viene repetida`); return; }
    // 0 (o vacio) quita el presupuesto de ese mes.
    const monto = p?.monto === '' || p?.monto === null ? 0 : F.leerMonto(p?.monto, { permitirCero: true });
    if (monto === false) errores.push(`El presupuesto de ${F.NOMBRES_CATEGORIA[categoria]} debe ser un número de cero en adelante`);
    else nuevos[categoria] = monto;
  });
  return { anio, mes, nuevos, errores };
};

// ---------------------------------------------------------------------------
// PUT /api/finanzas/tesoreria/presupuestos
//   { anio, mes, presupuestos: [{ categoria, monto }] }   (monto 0 = quitarlo)
// Solo cambia las categorias que vienen. En un mes abierto no se puede apartar
// mas de lo que hay sin asignar; en uno cerrado el presupuesto ya no aparta
// nada (queda solo para el informe).
// ---------------------------------------------------------------------------
const guardarPresupuestos = async (req, res) => {
  const { anio, mes, nuevos, errores } = normalizarPresupuestos(req.body);
  if (errores.length) return res.status(400).json({ error: 'Revisa los presupuestos', detalles: errores });
  try {
    const cambios = await enCola(() => prisma.$transaction(async (tx) => {
      const calculo = P.calcular(await P.cargarMovimientos(tx));
      const delta = P.deltaReservado(calculo, anio, mes, nuevos);
      const sinAsignar = F.centavos(calculo.sinAsignar);
      if (delta > 0 && delta > sinAsignar) throw new SinFondos(calculo.sinAsignar, (delta - Math.max(0, sinAsignar)) / 100);

      const antes = P.detalleMes(calculo, anio, mes).categorias;
      const hechos = [];
      for (const [categoria, monto] of Object.entries(nuevos)) {
        const previo = antes.find((c) => c.categoria === categoria);
        if (F.centavos(previo.presupuesto) === F.centavos(monto)) continue;
        if (monto === 0) {
          if (previo.id) await tx.presupuestoCategoria.delete({ where: { id: previo.id } });
          hechos.push({ categoria, id: previo.id, antes: previo.presupuesto, ahora: 0 });
        } else {
          const fila = await tx.presupuestoCategoria.upsert({
            where: { categoria_anio_mes: { categoria, anio, mes } },
            create: { categoria, anio, mes, monto, fijadoPorId: req.usuario.id },
            update: { monto, fijadoPorId: req.usuario.id },
          });
          hechos.push({ categoria, id: fila.id, antes: previo.presupuesto, ahora: monto });
        }
      }
      return hechos;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }));

    cambios.forEach((c) => {
      const texto = c.ahora === 0
        ? `Quitó el presupuesto de ${F.NOMBRES_CATEGORIA[c.categoria]} en ${nombreMes(anio, mes)} (era ${c.antes} ${F.MONEDA_BASE})`
        : `Fijó el presupuesto de ${F.NOMBRES_CATEGORIA[c.categoria]} en ${nombreMes(anio, mes)}: ${c.ahora} ${F.MONEDA_BASE}${c.antes ? ` (antes ${c.antes})` : ''}`;
      F.registrarFinanzas(req.usuario, 'presupuesto', c.id, c.ahora === 0 ? 'ELIMINAR' : 'FIJAR', texto);
    });

    const calculo = P.calcular(await P.cargarMovimientos());
    return res.json({
      mensaje: cambios.length ? `Presupuesto de ${nombreMes(anio, mes)} guardado` : 'No había cambios',
      cambios: cambios.length,
      sinAsignar: calculo.sinAsignar,
      presupuesto: P.detalleMes(calculo, anio, mes),
    });
  } catch (error) {
    if (error instanceof SinFondos) {
      return res.status(409).json({
        error: `No alcanza la bolsa: hay ${error.sinAsignar.toFixed(2)} ${F.MONEDA_BASE} sin asignar y faltan ${error.faltan.toFixed(2)}. Baja algún presupuesto o registra más ingresos en Ventas.`,
        codigo: 'SIN_FONDOS',
        sinAsignar: error.sinAsignar,
        faltan: error.faltan,
      });
    }
    if (esConflicto(error)) {
      return res.status(409).json({ error: 'Otro cambio de presupuesto se guardó al mismo tiempo. Vuelve a intentarlo.', codigo: 'CONFLICTO' });
    }
    console.error('[finanzas.tesoreria.guardarPresupuestos]', error);
    return res.status(500).json({ error: 'Error al guardar los presupuestos' });
  }
};

module.exports = { resumen, guardarPresupuestos };
