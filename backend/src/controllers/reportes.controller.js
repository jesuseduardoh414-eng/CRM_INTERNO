// Reportes para administradores (/api/reportes). Cada reporte se pide en JSON
// para verlo en pantalla o con ?formato=excel para descargarlo. Un admin de
// área solo ve a su gente y sus proyectos; el general ve todo.
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { esAdminGlobal, buildFiltroAreaProyecto } = require('../utils/permissions.utils');

// Alcance de los reportes: el administrador general ve todo; el resto, su area.
const scopeReporte = (usuario) => (esAdminGlobal(usuario) ? {} : buildFiltroAreaProyecto(usuario.area));
const { ESTADOS_PROYECTO_OCULTOS } = require('../utils/estados.utils');
const { rangoDiaMexico, claveDiaMexico } = require('../utils/fechas.utils');
const { configEnCache } = require('../services/configuracion.service');

const DIA_MS = 24 * 60 * 60 * 1000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;
const ESTADOS_CONTRATO_VIGENTES = ['VIGENTE', 'EN_REVISION'];

const nombreArea = (clave) => configEnCache().reglas.areas.find((a) => a.clave === clave)?.nombre
  || (clave ? clave.charAt(0) + clave.slice(1).toLowerCase() : '');

/** Rango ?desde=&hasta= (YYYY-MM-DD). Por defecto, los últimos 30 días. */
const leerRango = (query) => {
  const hoy = claveDiaMexico();
  const hasta = REGEX_FECHA.test(query.hasta || '') ? query.hasta : hoy;
  const desdeDefecto = claveDiaMexico(new Date(rangoDiaMexico(hasta).inicio.getTime() - 29 * DIA_MS));
  const desde = REGEX_FECHA.test(query.desde || '') ? query.desde : desdeDefecto;
  const inicio = rangoDiaMexico(desde).inicio;
  const fin = rangoDiaMexico(hasta).fin;
  if (fin < inicio) return { error: 'La fecha inicial es posterior a la final' };
  if ((fin - inicio) / DIA_MS > MAX_DIAS) return { error: `El rango no puede pasar de ${MAX_DIAS} días` };
  return { desde, hasta, inicio, fin };
};

const enviarExcel = (res, nombre, hojas) => {
  const wb = XLSX.utils.book_new();
  hojas.forEach(({ titulo, filas, anchos }) => {
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    if (anchos) hoja['!cols'] = anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, hoja, titulo.slice(0, 31));
  });
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(buffer);
};

const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : null);

// ---------------------------------------------------------------------------
// GET /api/reportes/personas?desde=&hasta=&formato=excel
// Por persona: tareas cerradas en el rango (a tiempo / tarde) y su carga actual.
// ---------------------------------------------------------------------------
const personas = async (req, res) => {
  const rango = leerRango(req.query);
  if (rango.error) return res.status(400).json({ error: rango.error });
  try {
    const scope = scopeReporte(req.usuario);
    const miembros = await prisma.usuario.findMany({
      where: { rol: { in: ['MIEMBRO', 'ADMIN'] }, OR: [{ estado: 'activo' }, { estado: null }], ...(esAdminGlobal(req.usuario) ? {} : { area: req.usuario.area }) },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, area: true, rol: true, fotoPerfilUrl: true },
    });
    const ids = miembros.map((m) => m.id);
    const tareas = ids.length ? await prisma.tarea.findMany({
      where: {
        OR: [{ asignadoId: { in: ids } }, { asignados: { some: { id: { in: ids } } } }],
        ...(scope && Object.keys(scope).length ? { proyecto: scope } : {}),
        // Lo cerrado en el rango y todo lo que sigue abierto
        AND: [{ OR: [{ estado: { not: 'HECHO' } }, { completadoEn: { gte: rango.inicio, lte: rango.fin } }] }],
      },
      select: { estado: true, completadoEn: true, venceEn: true, asignadoId: true, asignados: { select: { id: true } } },
    }) : [];

    const ahora = new Date();
    const filas = miembros.map((m) => {
      const suyas = tareas.filter((t) => t.asignadoId === m.id || t.asignados.some((a) => a.id === m.id));
      const hechas = suyas.filter((t) => t.estado === 'HECHO');
      // A tiempo: sin fecha límite o cerrada antes de que terminara ese día.
      const aTiempo = hechas.filter((t) => !t.venceEn || t.completadoEn <= new Date(rangoDiaMexico(claveDiaMexico(t.venceEn)).fin)).length;
      const abiertas = suyas.filter((t) => t.estado !== 'HECHO');
      return {
        id: m.id,
        nombre: m.nombre,
        area: m.area,
        rol: m.rol,
        fotoPerfilUrl: m.fotoPerfilUrl,
        hechas: hechas.length,
        aTiempo,
        tarde: hechas.length - aTiempo,
        cumplimiento: pct(aTiempo, hechas.length),
        enCurso: abiertas.filter((t) => t.estado === 'EN_PROGRESO').length,
        pendientes: abiertas.filter((t) => t.estado === 'PENDIENTE').length,
        vencidas: abiertas.filter((t) => t.venceEn && t.venceEn < ahora).length,
      };
    }).sort((a, b) => b.hechas - a.hechas || a.nombre.localeCompare(b.nombre));

    const totales = filas.reduce((acc, f) => {
      ['hechas', 'aTiempo', 'tarde', 'enCurso', 'pendientes', 'vencidas'].forEach((k) => { acc[k] += f[k]; });
      return acc;
    }, { hechas: 0, aTiempo: 0, tarde: 0, enCurso: 0, pendientes: 0, vencidas: 0 });
    totales.cumplimiento = pct(totales.aTiempo, totales.hechas);

    if (req.query.formato === 'excel') {
      return enviarExcel(res, `reporte_personas_${rango.desde}_a_${rango.hasta}`, [{
        titulo: 'Por persona',
        anchos: [30, 18, 10, 10, 10, 14, 10, 12, 10],
        filas: [
          [`Reporte por persona · ${rango.desde} a ${rango.hasta}`],
          [],
          ['Persona', 'Área', 'Hechas', 'A tiempo', 'Tarde', '% a tiempo', 'En curso', 'Pendientes', 'Vencidas'],
          ...filas.map((f) => [f.nombre, nombreArea(f.area), f.hechas, f.aTiempo, f.tarde, f.cumplimiento ?? '', f.enCurso, f.pendientes, f.vencidas]),
          [],
          ['Total', '', totales.hechas, totales.aTiempo, totales.tarde, totales.cumplimiento ?? '', totales.enCurso, totales.pendientes, totales.vencidas],
        ],
      }]);
    }
    return res.json({ desde: rango.desde, hasta: rango.hasta, personas: filas, totales });
  } catch (error) {
    console.error('[reportes.personas]', error);
    return res.status(500).json({ error: 'No se pudo generar el reporte' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/reportes/clientes?formato=excel
// Por cliente: sus proyectos (avance), tareas y contratos vigentes.
// ---------------------------------------------------------------------------
const clientes = async (req, res) => {
  try {
    const scope = scopeReporte(req.usuario);
    const empresas = await prisma.empresa.findMany({
      where: { tipo: { in: ['CLIENTE', 'AMBOS'] } },
      orderBy: { nombre: 'asc' },
      select: {
        id: true, nombre: true, nombreComercial: true, estado: true,
        proyectos: {
          where: scope && Object.keys(scope).length ? scope : undefined,
          select: { id: true, nombre: true, estado: true, tareas: { select: { estado: true, venceEn: true } } },
        },
        contratos: { select: { estado: true, monto: true, moneda: true, fechaFin: true } },
      },
    });
    const ahora = new Date();
    const filas = empresas.map((e) => {
      const activos = e.proyectos.filter((p) => !ESTADOS_PROYECTO_OCULTOS.includes(p.estado));
      const tareas = e.proyectos.flatMap((p) => p.tareas);
      const hechas = tareas.filter((t) => t.estado === 'HECHO').length;
      const vigentes = e.contratos.filter((c) => ESTADOS_CONTRATO_VIGENTES.includes(c.estado));
      const montos = vigentes.reduce((acc, c) => {
        if (c.monto !== null) acc[c.moneda] = (acc[c.moneda] || 0) + Number(c.monto);
        return acc;
      }, {});
      return {
        id: e.id,
        nombre: e.nombreComercial || e.nombre,
        razonSocial: e.nombre,
        estado: e.estado,
        proyectos: e.proyectos.length,
        proyectosActivos: activos.length,
        tareas: tareas.length,
        tareasHechas: hechas,
        tareasVencidas: tareas.filter((t) => t.estado !== 'HECHO' && t.venceEn && t.venceEn < ahora).length,
        avance: pct(hechas, tareas.length),
        contratosVigentes: vigentes.length,
        montosVigentes: montos,
      };
    }).sort((a, b) => b.proyectosActivos - a.proyectosActivos || b.contratosVigentes - a.contratosVigentes || a.nombre.localeCompare(b.nombre));

    if (req.query.formato === 'excel') {
      const monedas = [...new Set(filas.flatMap((f) => Object.keys(f.montosVigentes)))].sort();
      return enviarExcel(res, `reporte_clientes_${claveDiaMexico()}`, [{
        titulo: 'Por cliente',
        anchos: [32, 32, 10, 10, 12, 10, 10, 10, 12, ...monedas.map(() => 16)],
        filas: [
          [`Reporte por cliente · ${claveDiaMexico()}`],
          [],
          ['Cliente', 'Razón social', 'Estado', 'Proyectos', 'Activos', 'Tareas', 'Hechas', 'Vencidas', '% avance', 'Contratos vigentes', ...monedas.map((m) => `Monto vigente ${m}`)],
          ...filas.map((f) => [f.nombre, f.razonSocial, f.estado, f.proyectos, f.proyectosActivos, f.tareas, f.tareasHechas, f.tareasVencidas, f.avance ?? '', f.contratosVigentes, ...monedas.map((m) => f.montosVigentes[m] ?? '')]),
        ],
      }]);
    }
    return res.json({ clientes: filas });
  } catch (error) {
    console.error('[reportes.clientes]', error);
    return res.status(500).json({ error: 'No se pudo generar el reporte' });
  }
};

module.exports = { personas, clientes };
