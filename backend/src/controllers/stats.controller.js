const XLSX = require('xlsx');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { esPostgres } = require('../lib/baseDatos');
const { sortTareas } = require('../utils/sort.utils');
const { buildScopeProyectoParaAdmin, esAdminDeArea } = require('../utils/permissions.utils');
const { ESTADOS_PROYECTO_OCULTOS } = require('../utils/estados.utils');
const { rangoDiaMexico, rangoSemanaMexico, claveDiaMexico, zonaHoraria } = require('../utils/fechas.utils');
const { configEnCache } = require('../services/configuracion.service');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const tareaResumenSelect = {
  id: true,
  titulo: true,
  numeroActividad: true,
  estado: true,
  prioridad: true,
  creadoEn: true,
  completadoEn: true,
  venceEn: true,
  fechaInicio: true,
  asignadoId: true,
  creadorId: true,
  asignados: { select: { id: true } },
  proyecto: {
    select: { id: true, nombre: true }
  }
};

// Regla unica de conteo: una tarea cuenta para quien figura como responsable
// (`asignadoId` o relacion `asignados`), una sola vez. Nunca por ser el
// creador: antes se sumaba al asignado Y al creador, y el reporte diario la
// listaba dos veces.
const esResponsable = (tarea, usuarioId) => (
  tarea.asignadoId === usuarioId
  || (tarea.asignados || []).some((asignado) => asignado.id === usuarioId)
);

const responsablesDe = (tarea) => new Set(
  [tarea.asignadoId, ...(tarea.asignados || []).map((asignado) => asignado.id)].filter(Boolean)
);

// Filtro Prisma equivalente a `esResponsable` para un conjunto de usuarios
const whereResponsableEn = (ids) => ({
  OR: [
    { asignadoId: { in: ids } },
    { asignados: { some: { id: { in: ids } } } },
  ],
});

const resumenTarea = (tarea) => ({
  id: tarea.id,
  titulo: tarea.titulo,
  numeroActividad: tarea.numeroActividad,
  estado: tarea.estado,
  prioridad: tarea.prioridad,
  creadoEn: tarea.creadoEn,
  completadoEn: tarea.completadoEn,
  venceEn: tarea.venceEn,
  fechaInicio: tarea.fechaInicio,
  proyecto: tarea.proyecto
});

const getFinTareaOcupacion = (tarea) => (
  tarea.venceEn ? tarea.venceEn : (tarea.completadoEn || tarea.fechaInicio || tarea.creadoEn)
);

const resumenOcupacionTarea = (tarea) => ({
  id: `tarea-${tarea.id}`,
  origenId: tarea.id,
  tipo: 'tarea',
  titulo: tarea.titulo,
  estado: tarea.estado,
  prioridad: tarea.prioridad,
  fechaInicio: tarea.fechaInicio || tarea.creadoEn,
  fechaFin: getFinTareaOcupacion(tarea),
  proyecto: tarea.proyecto || null,
});

const resumenOcupacionProyecto = (proyecto, usuarioId) => ({
  id: `proyecto-${proyecto.id}-${usuarioId}`,
  origenId: proyecto.id,
  tipo: 'proyecto',
  titulo: `Proyecto: ${proyecto.nombre}`,
  estado: proyecto.estado,
  prioridad: null,
  fechaInicio: proyecto.fechaInicio || proyecto.creadoEn,
  fechaFin: proyecto.fechaFin || proyecto.fechaInicio || proyecto.creadoEn,
  proyecto: { id: proyecto.id, nombre: proyecto.nombre },
});

const resumenOcupacionEvento = (evento) => ({
  id: `evento-${evento.id}`,
  origenId: evento.id,
  tipo: evento.tipo === 'reunion' ? 'reunion' : 'evento',
  titulo: evento.titulo,
  estado: null,
  prioridad: null,
  fechaInicio: evento.fechaInicio,
  fechaFin: evento.fechaFin || evento.fechaInicio,
  proyecto: evento.proyecto || null,
});

const buildProjectScopeWhere = (scopeProyecto) => (
  scopeProyecto ? { proyecto: scopeProyecto } : {}
);

const getTopUsuariosProductividad = async (usuario) => {
  // Semana actual en hora de Mexico (lunes 00:00) y ventana de 4 semanas
  const { inicio: inicioSemanaActual } = rangoSemanaMexico();
  const semanasAnalizadas = 4;
  const inicioVentana = new Date(inicioSemanaActual.getTime() - ((semanasAnalizadas - 1) * 7 * ONE_DAY_MS));
  const filtroAreaUsuarios = esAdminDeArea(usuario) ? { area: usuario.area } : {};
  const scopeProyecto = buildScopeProyectoParaAdmin(usuario);

  const [miembros, tareasHechas] = await Promise.all([
    prisma.usuario.findMany({
      where: { rol: 'MIEMBRO', ...filtroAreaUsuarios },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, area: true }
    }),
    prisma.tarea.findMany({
      where: {
        estado: 'HECHO',
        completadoEn: { gte: inicioVentana },
        ...(scopeProyecto ? { proyecto: scopeProyecto } : {})
      },
      select: {
        id: true,
        asignadoId: true,
        asignados: { select: { id: true } },
        completadoEn: true
      }
    })
  ]);

  return miembros
    .map((miembro) => {
      const hechas = tareasHechas.filter((tarea) => esResponsable(tarea, miembro.id));
      const hechasSemanaActual = hechas.filter((tarea) => tarea.completadoEn >= inicioSemanaActual).length;
      const promedioSemanal = Number((hechas.length / semanasAnalizadas).toFixed(1));

      return {
        id: miembro.id,
        nombre: miembro.nombre,
        area: miembro.area,
        promedioSemanal,
        hechasSemanaActual,
        totalVentana: hechas.length
      };
    })
    .sort((a, b) =>
      b.promedioSemanal - a.promedioSemanal
      || b.hechasSemanaActual - a.hechasSemanaActual
      || a.nombre.localeCompare(b.nombre))
    .slice(0, 5);
};

/**
 * Actividad por miembro para un dia concreto.
 *
 * `fecha` ('YYYY-MM-DD') permite mirar dias pasados; sin ella se usa hoy.
 * Los limites del dia salen de `rangoDiaMexico`: antes se usaba
 * `setHours(0,0,0,0)`, que en el servidor (UTC) cortaba el dia a las 18:00 hora
 * de Mexico y mandaba al dia siguiente todo lo cerrado por la tarde-noche.
 * El fin de semana sale de `rangoSemanaMexico` por la misma razon.
 */
const getActividadMiembros = async (usuario, fecha = null) => {
  const { inicio: hoyInicio, fin: hoyFin } = rangoDiaMexico(fecha);
  // El dia siguiente al consultado, para la vista de "mañana"
  const { inicio: mananaInicio, fin: mananaFin } = rangoDiaMexico(
    claveDiaMexico(new Date(hoyFin.getTime() + 1)),
  );
  const ahora = hoyFin;
  const { fin: semanaFin } = rangoSemanaMexico(fecha || hoyFin);
  const calendarioInicio = new Date(ahora);
  calendarioInicio.setMonth(calendarioInicio.getMonth() - 6);
  calendarioInicio.setHours(0, 0, 0, 0);
  const calendarioFin = new Date(ahora);
  calendarioFin.setMonth(calendarioFin.getMonth() + 12);
  calendarioFin.setHours(23, 59, 59, 999);
  const filtroAreaUsuarios = esAdminDeArea(usuario) ? { area: usuario.area } : {};
  const scopeProyecto = buildScopeProyectoParaAdmin(usuario);
  const projectScopeWhere = buildProjectScopeWhere(scopeProyecto);

  const miembros = await prisma.usuario.findMany({
    where: { rol: 'MIEMBRO', ...filtroAreaUsuarios },
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, area: true, fotoPerfilUrl: true }
  });

  if (!miembros.length) return [];

  const memberIds = miembros.map((miembro) => miembro.id);

  const [todasLasTareas, proyectosActivos, eventosAgenda] = await Promise.all([
    prisma.tarea.findMany({
      where: {
        ...whereResponsableEn(memberIds),
        ...projectScopeWhere,
      },
      select: tareaResumenSelect,
    }),
    prisma.proyecto.findMany({
      where: {
        estado: { notIn: ESTADOS_PROYECTO_OCULTOS },
        OR: [
          { miembros: { some: { id: { in: memberIds } } } },
          { creadorId: { in: memberIds } },
        ],
        ...(scopeProyecto || {}),
      },
      select: {
        id: true,
        nombre: true,
        estado: true,
        creadoEn: true,
        fechaInicio: true,
        fechaFin: true,
        creadorId: true,
        miembros: { select: { id: true } },
      },
    }),
    prisma.evento.findMany({
      where: {
        AND: [
          {
            OR: [
              { usuarioId: { in: memberIds } },
              { creadoPorId: { in: memberIds } },
              { invitados: { some: { usuarioId: { in: memberIds }, estado: 'aceptado' } } },
            ],
          },
          { fechaInicio: { lte: calendarioFin } },
          {
            OR: [
              { fechaFin: { gte: calendarioInicio } },
              { fechaFin: null, fechaInicio: { gte: calendarioInicio } },
            ],
          },
          // Las filas "Proyecto: X" (dia completo, sin invitados) que antes
          // generaba el alta de proyectos ya no cuentan: la ocupacion del
          // proyecto la aporta `proyectosDelMiembro` y se duplicaba.
          {
            NOT: {
              tipo: 'dia_completo',
              titulo: { startsWith: 'Proyecto:' },
              invitados: { none: {} },
            },
          },
        ],
      },
      select: {
        id: true,
        titulo: true,
        tipo: true,
        fechaInicio: true,
        fechaFin: true,
        usuarioId: true,
        creadoPorId: true,
        invitados: {
          where: { estado: 'aceptado', usuarioId: { in: memberIds } },
          select: { usuarioId: true },
        },
        proyecto: { select: { id: true, nombre: true } },
      },
    }),
  ]);

  // Cada tarea va a cada uno de sus responsables, una sola vez por persona
  const tareasPorMiembro = new Map(memberIds.map((id) => [id, []]));
  todasLasTareas.forEach((tarea) => {
    responsablesDe(tarea).forEach((responsableId) => {
      if (tareasPorMiembro.has(responsableId)) {
        tareasPorMiembro.get(responsableId).push(tarea);
      }
    });
  });

  const proyectosPorMiembro = new Map(memberIds.map((id) => [id, []]));
  proyectosActivos.forEach((proyecto) => {
    const relacionados = new Set([
      proyecto.creadorId,
      ...proyecto.miembros.map((miembro) => miembro.id),
    ]);
    relacionados.forEach((memberId) => {
      if (proyectosPorMiembro.has(memberId)) {
        proyectosPorMiembro.get(memberId).push(proyecto);
      }
    });
  });

  const eventosPorMiembro = new Map(memberIds.map((id) => [id, []]));
  eventosAgenda.forEach((evento) => {
    const relacionados = new Set([
      evento.usuarioId,
      evento.creadoPorId,
      ...evento.invitados.map((invitado) => invitado.usuarioId),
    ]);
    relacionados.forEach((memberId) => {
      if (eventosPorMiembro.has(memberId)) {
        eventosPorMiembro.get(memberId).push(evento);
      }
    });
  });

  return miembros.map((miembro) => {
    const tareasDelMiembro = tareasPorMiembro.get(miembro.id) || [];
    const hechas = tareasDelMiembro.filter((tarea) => tarea.estado === 'HECHO');
    // Cerradas dentro del dia consultado (no "de hoy en adelante")
    const hechasHoy = hechas.filter((tarea) => (
      tarea.completadoEn && tarea.completadoEn >= hoyInicio && tarea.completadoEn <= hoyFin
    ));
    const enProgreso = tareasDelMiembro.filter((tarea) => tarea.estado === 'EN_PROGRESO');
    const faltanHoy = tareasDelMiembro.filter((tarea) => tarea.estado === 'PENDIENTE');
    // Vencen dentro del dia siguiente al consultado
    const faltanManana = tareasDelMiembro.filter((tarea) =>
      tarea.estado !== 'HECHO'
      && tarea.venceEn
      && tarea.venceEn >= mananaInicio
      && tarea.venceEn <= mananaFin
    );
    const faltanSemana = tareasDelMiembro.filter((tarea) =>
      tarea.estado !== 'HECHO'
      && tarea.venceEn
      && tarea.venceEn > hoyFin
      && tarea.venceEn <= semanaFin
    );
    const proyectosDelMiembro = proyectosPorMiembro.get(miembro.id) || [];
    const eventosDelMiembro = eventosPorMiembro.get(miembro.id) || [];

    const ocupacionCalendario = [
      ...proyectosDelMiembro.map((proyecto) => resumenOcupacionProyecto(proyecto, miembro.id)),
      ...tareasDelMiembro.map(resumenOcupacionTarea),
      ...eventosDelMiembro.map(resumenOcupacionEvento),
    ].filter((item) => item.fechaInicio && item.fechaFin);

    return {
      id: miembro.id,
      nombre: miembro.nombre,
      area: miembro.area,
      fotoPerfilUrl: miembro.fotoPerfilUrl,
      hechasHoy: sortTareas(hechasHoy).map(resumenTarea),
      enProgreso: sortTareas(enProgreso).map(resumenTarea),
      faltanHoy: sortTareas(faltanHoy).map(resumenTarea),
      faltanManana: sortTareas(faltanManana).map(resumenTarea),
      faltanSemana: sortTareas(faltanSemana).map(resumenTarea),
      todasConFecha: tareasDelMiembro.map(resumenTarea),
      ocupacionCalendario,
      totales: {
        totalTareas: tareasDelMiembro.length,
        hechasHoy: hechasHoy.length,
        enProgreso: enProgreso.length,
        faltanHoy: faltanHoy.length,
        faltanManana: faltanManana.length,
        faltanSemana: faltanSemana.length,
        totalHechas: hechas.length,
        pendientes: tareasDelMiembro.filter((tarea) => tarea.estado === 'PENDIENTE').length,
        porcentajeCumplimiento: tareasDelMiembro.length > 0
          ? Math.round((hechas.length / tareasDelMiembro.length) * 100)
          : 0,
      },
    };
  });
};

const getMemberStats = async (req, res) => {
  try {
    // Proyectos que el miembro puede ver (misma regla que `puedeVerProyecto`):
    // miembro, creador del proyecto, o participa en alguna tarea.
    const proyectos = await prisma.proyecto.findMany({
      where: {
        OR: [
          { miembros: { some: { id: req.usuario.id } } },
          { creadorId: req.usuario.id },
          { tareas: { some: { asignadoId: req.usuario.id } } },
          { tareas: { some: { asignados: { some: { id: req.usuario.id } } } } },
          { tareas: { some: { creadorId: req.usuario.id } } },
        ],
      },
      orderBy: { creadoEn: 'desc' },
      include: {
        creador: { select: { id: true, nombre: true, area: true } },
        miembros: { select: { id: true, nombre: true, email: true, area: true, rol: true } },
        _count: { select: { tareas: true } },
        tareas: {
          select: { estado: true, asignadoId: true, asignados: { select: { id: true } } },
        },
      },
    });

    const proyectosConProgreso = proyectos.map((proyecto) => {
      const total = proyecto.tareas.length;
      const hechas = proyecto.tareas.filter((tarea) => tarea.estado === 'HECHO').length;
      const tareasMiembro = proyecto.tareas.filter((tarea) => esResponsable(tarea, req.usuario.id));
      const hechasMiembro = tareasMiembro.filter((tarea) => tarea.estado === 'HECHO').length;
      const { tareas, ...resto } = proyecto;

      return {
        ...resto,
        progreso: total > 0 ? Math.round((hechas / total) * 100) : 0,
        progresoGeneral: total > 0 ? Math.round((hechas / total) * 100) : 0,
        progresoMiembro: tareasMiembro.length > 0
          ? Math.round((hechasMiembro / tareasMiembro.length) * 100)
          : 0,
        tareasMiembro: tareasMiembro.length,
      };
    });

    const resumenTareas = proyectos.reduce((acc, proyecto) => {
      proyecto.tareas.forEach((tarea) => {
        acc.total += 1;
        if (tarea.estado === 'HECHO') acc.hechas += 1;
        if (tarea.estado === 'PENDIENTE') acc.pendientes += 1;
        if (tarea.estado === 'EN_PROGRESO') acc.enProgreso += 1;
      });
      return acc;
    }, {
      total: 0,
      hechas: 0,
      pendientes: 0,
      enProgreso: 0,
    });

    // Lista de "mis tareas": las que tiene a su cargo (principal o co-asignado)
    // y las que creo, igual que la visibilidad del listado del proyecto.
    const tareas = await prisma.tarea.findMany({
      where: {
        proyectoId: { in: proyectos.map((proyecto) => proyecto.id) },
        OR: [
          { asignadoId: req.usuario.id },
          { asignados: { some: { id: req.usuario.id } } },
          { creadorId: req.usuario.id },
        ],
      },
      orderBy: { creadoEn: 'asc' },
      include: {
        asignado: { select: { id: true, nombre: true, email: true, area: true } },
        asignados: { select: { id: true, nombre: true, email: true, area: true } },
        creador: { select: { id: true, nombre: true, email: true, area: true } },
        proyecto: { select: { id: true, nombre: true } },
      },
    });

    return res.json({
      proyectos: proyectosConProgreso,
      tareas: sortTareas(tareas),
      resumenTareas,
    });
  } catch (error) {
    console.error('[stats.getMemberStats]', error);
    return res.status(500).json({ error: 'Error al generar estadisticas del miembro' });
  }
};

/**
 * Cuenta las tareas terminadas agrupadas por mes de cierre.
 *
 * Se agrupa en la base (no trayendo las ~1150 filas) y se resta el offset de
 * Mexico antes de truncar: la columna es DATETIME(3) en UTC, asi que una
 * tarea cerrada a las 8 pm del ultimo dia del mes caeria en el mes siguiente
 * si se truncara en UTC.
 *
 * Hay una version por base (lib/baseDatos.js): en MySQL DATE_SUB / DATE_FORMAT
 * y columnas entre acentos graves; en Postgres interval / to_char y columnas
 * entre comillas (son camelCase). `COUNT(*)` llega como BigInt desde los dos
 * drivers, por eso se pasa por `Number` abajo.
 *
 * Las tareas HECHO sin `completadoEn` no se pueden ubicar en ningun mes; se
 * devuelven aparte en vez de repartirlas o inventarles fecha.
 */
const getActividadPorMes = async (scopeProyecto) => {
  const proyectos = await prisma.proyecto.findMany({
    where: scopeProyecto || undefined,
    select: { id: true },
  });
  const ids = proyectos.map((p) => p.id);
  if (ids.length === 0) return { meses: [], sinFecha: 0 };

  const porMes = esPostgres()
    ? prisma.$queryRaw`
      SELECT to_char("completadoEn" - INTERVAL '6 hours', 'YYYY-MM') AS mes,
             COUNT(*) AS total
        FROM tareas
       WHERE estado = 'HECHO'
         AND "completadoEn" IS NOT NULL
         AND "proyectoId" IN (${Prisma.join(ids)})
       GROUP BY mes
       ORDER BY mes
    `
    : prisma.$queryRaw`
      SELECT DATE_FORMAT(DATE_SUB(\`completadoEn\`, INTERVAL 6 HOUR), '%Y-%m') AS mes,
             COUNT(*) AS total
        FROM tareas
       WHERE estado = 'HECHO'
         AND \`completadoEn\` IS NOT NULL
         AND \`proyectoId\` IN (${Prisma.join(ids)})
       GROUP BY mes
       ORDER BY mes
    `;

  const [filas, sinFecha] = await Promise.all([
    porMes,
    prisma.tarea.count({
      where: { estado: 'HECHO', completadoEn: null, proyectoId: { in: ids } },
    }),
  ]);

  return { meses: filas.map((f) => ({ mes: f.mes, total: Number(f.total) })), sinFecha };
};

const getAdminStats = async (req, res) => {
  try {
    const scopeProyecto = buildScopeProyectoParaAdmin(req.usuario);
    const whereProyecto = scopeProyecto || undefined;
    const whereTarea = scopeProyecto ? { proyecto: scopeProyecto } : undefined;

    // Todas las consultas son independientes entre si: se lanzan a la vez en
    // vez de una tras otra (antes eran nueve viajes seguidos a la base).
    const [
      totalProyectos,
      proyectosPorEstado,
      totalTareas,
      tareasPorEstado,
      topUsuarios,
      actividadPorMes,
      actividadReciente,
      proyectosActivos,
      actividadMiembros,
    ] = await Promise.all([
      // 1. Estadísticas de Proyectos
      prisma.proyecto.count({ where: whereProyecto }),
      prisma.proyecto.groupBy({
        by: ['estado'],
        where: whereProyecto,
        _count: true
      }),
      // 2. Estadísticas de Tareas
      prisma.tarea.count({ where: whereTarea }),
      prisma.tarea.groupBy({
        by: ['estado'],
        where: whereTarea,
        _count: true
      }),
      // 3. Top Usuarios (Productividad): usuarios con más tareas completadas
      getTopUsuariosProductividad(req.usuario),
      // 3-bis. Actividades completadas por mes (para la vista mensual del inicio)
      getActividadPorMes(scopeProyecto),
      // 4. Actividad Reciente
      prisma.logActividad.findMany({
        take: 8,
        where: whereTarea,
        orderBy: { creadoEn: 'desc' },
        include: {
          usuario: { select: { nombre: true, area: true } }
        }
      }),
      // 5. Proyectos con más progreso (Top 5 activos)
      prisma.proyecto.findMany({
        where: whereProyecto,
        include: {
          _count: { select: { tareas: true } },
          tareas: {
            select: { id: true, estado: true }
          },
          miembros: {
            select: { id: true }
          },
        }
      }),
      // 6. Actividad del equipo (hoy)
      getActividadMiembros(req.usuario),
    ]);

    const proyectosProgreso = proyectosActivos.map(p => {
      const total = p._count.tareas;
      const completas = p.tareas.filter((tarea) => tarea.estado === 'HECHO').length;
      const pendientes = p.tareas.filter((tarea) => tarea.estado === 'PENDIENTE').length;
      const enProgreso = p.tareas.filter((tarea) => tarea.estado === 'EN_PROGRESO').length;
      return {
        id: p.id,
        nombre: p.nombre,
        estado: p.estado,
        totalTareas: total,
        completas,
        pendientes,
        enProgreso,
        miembros: p.miembros.length,
        // La tabla del inicio muestra estas fechas; antes no se enviaban y la
        // columna salia vacia para todos los proyectos.
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin,
        porcentaje: total > 0 ? Math.round((completas / total) * 100) : 0
      };
    }).sort((a, b) =>
      b.porcentaje - a.porcentaje
      || b.completas - a.completas
      || a.nombre.localeCompare(b.nombre)
    );

    res.json({
      proyectos: {
        total: totalProyectos,
        estados: proyectosPorEstado
      },
      tareas: {
        total: totalTareas,
        estados: tareasPorEstado
      },
      topUsuarios,
      actividadReciente,
      proyectosProgreso,
      actividadMiembros,
      actividadPorMes
    });

  } catch (error) {
    console.error('[stats.getAdminStats]', error);
    res.status(500).json({ error: 'Error al generar estadísticas' });
  }
};

// €€ GET /api/stats/actividad-equipo?fecha=YYYY-MM-DD €€€€€€€€€€€€€€€€€€€€€€€€
// Endpoint aparte para que cambiar de dia no obligue a recalcular todo el
// tablero (que hace bastantes consultas mas).
const getActividadEquipoPorDia = async (req, res) => {
  try {
    const fecha = req.query.fecha || null;

    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Se espera YYYY-MM-DD' });
    }

    const miembros = await getActividadMiembros(req.usuario, fecha);
    return res.json({ fecha: fecha || claveDiaMexico(), miembros });
  } catch (error) {
    console.error('[stats.getActividadEquipoPorDia]', error);
    return res.status(500).json({ error: 'Error al obtener la actividad del equipo' });
  }
};

// GET /api/stats/reporte-dia/excel?fecha=YYYY-MM-DD&proyectoId=N
// Reporte diario en Excel. Se recalcula aqui en vez de recibir el JSON del
// navegador para que el archivo no dependa de lo que el tablero tenga en cache.

const ETIQUETA_AREA = {
  DESARROLLO: 'Desarrollo',
  ADMINISTRACION: 'Administración',
  COMUNICACION: 'Comunicación',
  MARKETING: 'Marketing',
};
// Nombre que el configurador le dio al area; si no, el de fabrica.
const nombreArea = (clave) => configEnCache().reglas.areas.find((a) => a.clave === clave)?.nombre || ETIQUETA_AREA[clave] || clave || '';

const horaMexico = (valor) => (valor
  ? new Date(valor).toLocaleTimeString('es-MX', {
    timeZone: zonaHoraria(), hour: '2-digit', minute: '2-digit',
  })
  : '');

const fechaMexico = (valor) => (valor
  ? new Date(valor).toLocaleDateString('es-MX', {
    timeZone: zonaHoraria(), day: '2-digit', month: '2-digit', year: 'numeric',
  })
  : '');

/**
 * Solo entra quien cerro al menos una tarea ese dia; de esa gente se lleva
 * tambien lo que dejo en curso. `proyectoId` replica el filtro de proyecto del
 * tablero, para que el archivo salga con el mismo recorte que se ve en pantalla.
 */
const construirReporteDia = (miembros, proyectoId = null) => {
  const delProyecto = (tareas) => (
    proyectoId ? (tareas || []).filter((tarea) => tarea.proyecto?.id === proyectoId) : (tareas || [])
  );

  return miembros
    .map((miembro) => ({
      miembro,
      hechas: delProyecto(miembro.hechasHoy),
      enProgreso: delProyecto(miembro.enProgreso),
    }))
    .filter((fila) => fila.hechas.length > 0)
    .sort((a, b) => (
      b.hechas.length - a.hechas.length
      || String(a.miembro.nombre || '').localeCompare(String(b.miembro.nombre || ''), 'es')
    ));
};

const exportarReporteDiaExcel = async (req, res) => {
  try {
    const fecha = req.query.fecha || null;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Se espera YYYY-MM-DD' });
    }

    const proyectoId = req.query.proyectoId ? Number(req.query.proyectoId) : null;
    if (proyectoId !== null && !Number.isInteger(proyectoId)) {
      return res.status(400).json({ error: 'ID de proyecto inválido' });
    }

    const dia = fecha || claveDiaMexico();
    const miembros = await getActividadMiembros(req.usuario, fecha);
    const reporte = construirReporteDia(miembros, proyectoId);

    const resumen = [['Persona', 'Área', 'Terminadas', 'En curso']];
    const detalle = [['Persona', 'Área', 'Situación', 'Tarea', 'Proyecto', 'Hora de cierre', 'Vence']];

    reporte.forEach(({ miembro, hechas, enProgreso }) => {
      const area = nombreArea(miembro.area);
      resumen.push([miembro.nombre, area, hechas.length, enProgreso.length]);

      hechas.forEach((tarea) => detalle.push([
        miembro.nombre, area, 'Terminada',
        tarea.titulo, tarea.proyecto?.nombre || '', horaMexico(tarea.completadoEn), '',
      ]));
      enProgreso.forEach((tarea) => detalle.push([
        miembro.nombre, area, 'En curso',
        tarea.titulo, tarea.proyecto?.nombre || '', '', fechaMexico(tarea.venceEn),
      ]));
    });

    const wb = XLSX.utils.book_new();

    const hojaResumen = XLSX.utils.aoa_to_sheet(resumen);
    hojaResumen['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, hojaResumen, 'Resumen');

    const hojaDetalle = XLSX.utils.aoa_to_sheet(detalle);
    hojaDetalle['!cols'] = [
      { wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 60 }, { wch: 28 }, { wch: 14 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, hojaDetalle, 'Detalle');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="actividad_${dia}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (error) {
    console.error('[stats.exportarReporteDiaExcel]', error);
    return res.status(500).json({ error: 'Error al generar el reporte del día' });
  }
};

module.exports = {
  getAdminStats,
  getMemberStats,
  getActividadEquipoPorDia,
  exportarReporteDiaExcel,
};
