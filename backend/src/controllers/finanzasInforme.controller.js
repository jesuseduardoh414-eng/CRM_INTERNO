// Finanzas / Informe de gastos: tabla de meses por partidas (las columnas son
// las partidas creadas en Tesoreria) o por categorias. Cuenta los gastos no
// anulados en la moneda base, agrupados por su fecha contable. Permiso
// `informe` (ver), comprobado en la ruta; el informe muestra todas las
// categorias, con independencia de los permisos por categoria.
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { partesDiaMexico } = require('../utils/fechas.utils');
const F = require('../utils/finanzas.utils');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const NOMBRES_CATEGORIA = {
  PRESUPUESTO_GENERAL: 'Presupuesto de gastos – General',
  PRESUPUESTO_OFICINA: 'Presupuesto de gastos – Oficina',
  NOMINA: 'Nómina',
  FIJOS: 'Gastos fijos',
  VARIABLES: 'Gastos variables',
  OTROS: 'Otros',
};

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
  const filas = MESES.map((nombre, mes) => ({ mes: mes + 1, nombre, valores: vacio(), total: 0 }));
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

// ---------------------------------------------------------------------------
// GET /api/finanzas/informe?anio=&vista=partidas|categorias&formato=excel
// ---------------------------------------------------------------------------
const informe = async (req, res) => {
  try {
    const anio = F.leerAnio(req.query.anio, partesDiaMexico().year);
    const vista = req.query.vista === 'categorias' ? 'categorias' : 'partidas';
    const { inicio, fin } = F.rangoAnio(anio);

    const [gastos, partidas, asignaciones, excluidos] = await Promise.all([
      prisma.gasto.findMany({
        where: { estado: { not: 'ANULADO' }, moneda: F.MONEDA_BASE, fecha: { gte: inicio, lt: fin } },
        select: { monto: true, fecha: true, partidaId: true, categoria: true, estado: true },
      }),
      prisma.partida.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
      prisma.asignacionPartida.findMany({ where: { fecha: { gte: inicio, lt: fin } }, select: { partidaId: true, monto: true } }),
      prisma.gasto.count({ where: { estado: { not: 'ANULADO' }, moneda: { not: F.MONEDA_BASE }, fecha: { gte: inicio, lt: fin } } }),
    ]);

    let columnas;
    let claveDe;
    let asignado = null;
    if (vista === 'partidas') {
      // Partidas activas, mas las archivadas que tengan gastos ese año, mas "Sin partida".
      const conDatos = new Set(gastos.map((g) => g.partidaId).filter(Boolean));
      columnas = partidas
        .filter((p) => p.activa || conDatos.has(p.id))
        .map((p) => ({ clave: `p${p.id}`, partidaId: p.id, nombre: p.nombre, color: p.color, activa: p.activa }));
      columnas.push({ clave: 'sin', partidaId: null, nombre: 'Sin partida', color: null, activa: true });
      claveDe = (g) => (g.partidaId ? `p${g.partidaId}` : 'sin');
      asignado = Object.fromEntries(columnas.map((c) => [c.clave, c.partidaId ? F.sumar(asignaciones.filter((a) => a.partidaId === c.partidaId).map((a) => a.monto)) : 0]));
    } else {
      columnas = F.CATEGORIAS_GASTO.map((c) => ({ clave: c, nombre: NOMBRES_CATEGORIA[c], color: null, activa: true }));
      claveDe = (g) => g.categoria;
    }

    const { filas, totales } = armarMatriz(gastos, columnas, claveDe);
    const pendientes = F.sumar(gastos.filter((g) => g.estado === 'PENDIENTE').map((g) => g.monto));

    if (req.query.formato === 'excel') {
      const cabecera = ['Mes', ...columnas.map((c) => c.nombre), 'Total'];
      const cuerpo = filas.map((f) => [f.nombre, ...columnas.map((c) => f.valores[c.clave]), f.total]);
      const hoja = [
        [`Informe de gastos ${anio} por ${vista === 'partidas' ? 'partida' : 'categoría'} (${F.MONEDA_BASE})`],
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
      excluidos: { otrasMonedas: excluidos },
    });
  } catch (error) {
    console.error('[finanzas.informe]', error);
    return res.status(500).json({ error: 'Error al generar el informe de gastos' });
  }
};

module.exports = { informe, NOMBRES_CATEGORIA };
