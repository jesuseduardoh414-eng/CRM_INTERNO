const DAY_MS = 24 * 60 * 60 * 1000;

const toDateOnlyMidday = (value) => {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  return date;
};

const diffDays = (from, to) => {
  const start = toDateOnlyMidday(from);
  const end = toDateOnlyMidday(to);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
};

const addDays = (date, days) => {
  const base = toDateOnlyMidday(date);
  base.setDate(base.getDate() + days);
  return base;
};

const buildTaskKeys = (tareas = []) => {
  const sorted = [...tareas].sort((a, b) => {
    const numeroDiff = (a.numeroActividad ?? Number.MAX_SAFE_INTEGER) - (b.numeroActividad ?? Number.MAX_SAFE_INTEGER);
    if (numeroDiff !== 0) return numeroDiff;
    const createdDiff = new Date(a.creadoEn).getTime() - new Date(b.creadoEn).getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id - b.id;
  });

  const keyById = new Map();
  sorted.forEach((tarea, index) => {
    keyById.set(tarea.id, `TAREA_${String(index + 1).padStart(2, '0')}`);
  });
  return keyById;
};

const buildTemplateTasksFromProject = ({ proyecto, tareas }) => {
  const baseDate = proyecto.fechaInicio ? toDateOnlyMidday(proyecto.fechaInicio) : toDateOnlyMidday(new Date());
  const keyById = buildTaskKeys(tareas);

  return [...tareas]
    .sort((a, b) => {
      const numeroDiff = (a.numeroActividad ?? Number.MAX_SAFE_INTEGER) - (b.numeroActividad ?? Number.MAX_SAFE_INTEGER);
      if (numeroDiff !== 0) return numeroDiff;
      const createdDiff = new Date(a.creadoEn).getTime() - new Date(b.creadoEn).getTime();
      if (createdDiff !== 0) return createdDiff;
      return a.id - b.id;
    })
    .map((tarea, index) => ({
      clave: keyById.get(tarea.id),
      titulo: tarea.titulo,
      descripcion: tarea.descripcion || null,
      prioridad: tarea.prioridad || 'MEDIA',
      orden: index,
      offsetInicioDias: diffDays(baseDate, tarea.fechaInicio || proyecto.fechaInicio || baseDate),
      offsetVenceDias: tarea.venceEn ? diffDays(baseDate, tarea.venceEn) : null,
      dependeDeClave: tarea.dependeDeId ? keyById.get(tarea.dependeDeId) || null : null,
    }));
};

const serializeTasksForExport = ({ proyecto, tareas }) => {
  const keyById = buildTaskKeys(tareas);

  return [...tareas]
    .sort((a, b) => {
      const numeroDiff = (a.numeroActividad ?? Number.MAX_SAFE_INTEGER) - (b.numeroActividad ?? Number.MAX_SAFE_INTEGER);
      if (numeroDiff !== 0) return numeroDiff;
      const createdDiff = new Date(a.creadoEn).getTime() - new Date(b.creadoEn).getTime();
      if (createdDiff !== 0) return createdDiff;
      return a.id - b.id;
    })
    .map((tarea, index) => ({
      clave: keyById.get(tarea.id),
      numeroActividad: tarea.numeroActividad ?? index + 1,
      titulo: tarea.titulo,
      descripcion: tarea.descripcion || '',
      estado: tarea.estado,
      prioridad: tarea.prioridad,
      fechaInicio: tarea.fechaInicio ? toDateOnlyMidday(tarea.fechaInicio).toISOString().slice(0, 10) : '',
      venceEn: tarea.venceEn ? toDateOnlyMidday(tarea.venceEn).toISOString().slice(0, 10) : '',
      asignadoNombre: tarea.asignado?.nombre || '',
      asignadoEmail: tarea.asignado?.email || '',
      dependeDeClave: tarea.dependeDeId ? keyById.get(tarea.dependeDeId) || '' : '',
      orden: index + 1,
      completadoEn: tarea.completadoEn ? new Date(tarea.completadoEn).toISOString() : '',
      proyectoNombre: proyecto.nombre,
    }));
};

module.exports = {
  DAY_MS,
  addDays,
  buildTemplateTasksFromProject,
  serializeTasksForExport,
};
