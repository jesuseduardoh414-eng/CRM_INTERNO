// Finanzas / Informe de gastos. Tres vistas:
//   presupuesto  (por defecto) categorias con presupuesto, gastado, pendiente
//                y remanente de un mes o del año completo
//   categorias   tabla de meses por categorias (lo gastado)
//   partidas     tabla de meses por las partidas anteriores al 2026-10-14
//                (historial; solo si hay partidas)
// Cuenta los gastos no anulados en la moneda base, agrupados por su fecha
// contable. Permiso `informe` (ver), comprobado en la ruta; el informe muestra
// todas las categorias, con independencia de los permisos por categoria.
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const P = require('../services/presupuestos.service');
const F = require('../utils/finanzas.utils');

const VISTAS = ['presupuesto', 'categorias', 'partidas'];

const enviarExcel = (res, nombre, hojas) => {
  const libro = XLSX.utils.book_new();
  hojas.forEach(({ titulo, filas, anchos }) => {
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    if (anchos) hoja['!cols'] = anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, hoja, titulo.slice(0, 31));
  });
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nombre}.xlsx"`,
    'Cache-Control': 'private, no-store',
  });
  return res.send(buffer);
};

/**
 * Arma la matriz meses x columnas. `columnas` lleva { clave, nombre, color }
 * y `claveDe(gasto)` dice en que columna cae cada gasto.
 */
const armarMatriz = (gastos, columnas, claveDe) => {
  const vacio = () => Object.fromEntries(columnas.map((c) => [c.clave, 0]));
  const filas = F.MESES.map((nombre, mes) => ({ mes: mes + 1, nombre, valores: vacio(), total: 0 }));
  const totales = { ...vacio(), total: 0 };
  gastos.forEach((g) => {
    const fila = filas[g.fecha.getUTCMonth()];
    const clave = claveDe(g);
    if (!(clave in fila.valores)) return;
    fila.valores[clave] = F.sumar([fila.valores[clave], g.monto]);
    fila.total = F.sumar([fila.total, g.monto]);
    totales[clave] = F.sumar([totales[clave], g.monto]);
    totales.total = F.sumar([totales.total, g.monto]);
  });
  return { filas, totales };
};

const usado = (f) => F.sumar([f.gastado, f.comprometido]);
const porcentaje = (f) => (f.presupuesto > 0 ? Math.round((usado(f) / f.presupuesto) * 1000) / 10 : null);

// ---------------------------------------------------------------------------
// Vista presupuesto: ?mes=1..12 para un mes; sin mes, el año completo.
// ---------------------------------------------------------------------------
const informePresupuesto = async (req, res, anio, hayPartidas, excluidos) => {
  const mes = F.leerMes(req.query.mes);
  const calculo = P.calcular(await P.cargarMovimientos());
  const anual = P.detalleAnio(calculo, anio);
  const periodo = mes ? P.detalleMes(calculo, anio, mes) : anual;
  const filas = periodo.categorias.map((f) => ({ ...f, porcentaje: porcentaje(f) }));

  if (req.query.formato === 'excel') {
    const nombrePeriodo = mes ? `${F.MESES[mes - 1]} ${anio}` : `${anio} (año completo)`;
    // El % va como fraccion para que Excel lo pueda formatear como porcentaje.
    const fila = (nombre, f) => [nombre, f.presupuesto, f.gastado, f.comprometido, f.remanente, f.presupuesto > 0 ? usado(f) / f.presupuesto : ''];
    const resumen = [
      [`Presupuesto contra gastado: ${nombrePeriodo} (${F.MONEDA_BASE})`],
      [],
      ['Categoría', 'Presupuesto', 'Gastado', 'Pendiente de pago', 'Remanente', '% usado'],
      ...filas.map((f) => fila(F.NOMBRES_CATEGORIA[f.categoria], f)),
      fila('Total', periodo.totales),
    ];
    const detalle = [
      ['Mes', 'Categoría', 'Presupuesto', 'Gastado', 'Pendiente de pago', 'Remanente'],
      ...anual.meses.flatMap((m) => m.categorias.map((f) => [F.MESES[m.mes - 1], F.NOMBRES_CATEGORIA[f.categoria], f.presupuesto, f.gastado, f.comprometido, f.remanente])),
    ];
    return enviarExcel(res, `informe-presupuesto-${anio}${mes ? `-${String(mes).padStart(2, '0')}` : ''}`, [
      { titulo: mes ? `${F.MESES[mes - 1]} ${anio}` : `Año ${anio}`, filas: resumen, anchos: [34, 16, 16, 18, 16, 10] },
      { titulo: `Mes a mes ${anio}`, filas: detalle, anchos: [14, 34, 16, 16, 18, 16] },
    ]);
  }

  return res.json({
    anio,
    vista: 'presupuesto',
    mes: mes || null,
    cerrado: mes ? periodo.cerrado : null,
    moneda: F.MONEDA_BASE,
    filas,
    totales: { ...periodo.totales, porcentaje: porcentaje(periodo.totales) },
    porMes: anual.meses.map((m) => ({ mes: m.mes, cerrado: m.cerrado, ...m.totales })),
    hayPartidas,
    excluidos,
  });
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/informe?anio=&vista=presupuesto|categorias|partidas&mes=&formato=excel
// ---------------------------------------------------------------------------
const informe = async (req, res) => {
  try {
    const anio = F.leerAnio(req.query.anio, P.mesActual().anio);
    const pedida = VISTAS.includes(req.query.vista) ? req.query.vista : 'presupuesto';
    const { inicio, fin } = F.rangoAnio(anio);

    const [totalPartidas, otrasMonedas] = await Promise.all([
      prisma.partida.count(),
      prisma.gasto.count({ where: { estado: { not: 'ANULADO' }, moneda: { not: F.MONEDA_BASE }, fecha: { gte: inicio, lt: fin } } }),
    ]);
    const hayPartidas = totalPartidas > 0;
    const excluidos = { otrasMonedas };
    const vista = pedida === 'partidas' && !hayPartidas ? 'presupuesto' : pedida;
    if (vista === 'presupuesto') return await informePresupuesto(req, res, anio, hayPartidas, excluidos);

    const [gastos, partidas, asignaciones] = await Promise.all([
      prisma.gasto.findMany({
        where: { estado: { not: 'ANULADO' }, moneda: F.MONEDA_BASE, fecha: { gte: inicio, lt: fin } },
        select: { monto: true, fecha: true, partidaId: true, categoria: true, estado: true },
      }),
      vista === 'partidas' ? prisma.partida.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }) : [],
      vista === 'partidas' ? prisma.asignacionPartida.findMany({ where: { fecha: { gte: inicio, lt: fin } }, select: { partidaId: true, monto: true } }) : [],
    ]);

    let columnas;
    let claveDe;
    let asignado = null;
    if (vista === 'partidas') {
      // Todas las partidas (ya archivadas) mas "Sin partida".
      columnas = partidas.map((p) => ({ clave: `p${p.id}`, partidaId: p.id, nombre: p.nombre, color: p.color, activa: p.activa }));
      columnas.push({ clave: 'sin', partidaId: null, nombre: 'Sin partida', color: null, activa: true });
      claveDe = (g) => (g.partidaId ? `p${g.partidaId}` : 'sin');
      asignado = Object.fromEntries(columnas.map((c) => [c.clave, c.partidaId ? F.sumar(asignaciones.filter((a) => a.partidaId === c.partidaId).map((a) => a.monto)) : 0]));
    } else {
      columnas = F.CATEGORIAS_GASTO.map((c) => ({ clave: c, nombre: F.NOMBRES_CATEGORIA[c], color: null, activa: true }));
      claveDe = (g) => g.categoria;
    }

    const { filas, totales } = armarMatriz(gastos, columnas, claveDe);
    const pendientes = F.sumar(gastos.filter((g) => g.estado === 'PENDIENTE').map((g) => g.monto));

    if (req.query.formato === 'excel') {
      const cabecera = ['Mes', ...columnas.map((c) => c.nombre), 'Total'];
      const cuerpo = filas.map((f) => [f.nombre, ...columnas.map((c) => f.valores[c.clave]), f.total]);
      const hoja = [
        [`Informe de gastos ${anio} por ${vista === 'partidas' ? 'partida (anteriores)' : 'categoría'} (${F.MONEDA_BASE})`],
        [],
        cabecera,
        ...cuerpo,
        ['Total', ...columnas.map((c) => totales[c.clave]), totales.total],
      ];
      if (asignado) hoja.push(['Asignado en el año', ...columnas.map((c) => asignado[c.clave]), F.sumar(Object.values(asignado))]);
      return enviarExcel(res, `informe-gastos-${anio}-${vista}`, [{ titulo: `Gastos ${anio}`, filas: hoja, anchos: [16, ...columnas.map(() => 18), 16] }]);
    }

    return res.json({
      anio,
      vista,
      moneda: F.MONEDA_BASE,
      columnas,
      filas,
      totales,
      asignado,
      pendientes,
      hayPartidas,
      excluidos,
    });
  } catch (error) {
    console.error('[finanzas.informe]', error);
    return res.status(500).json({ error: 'Error al generar el informe de gastos' });
  }
};

module.exports = { informe };
