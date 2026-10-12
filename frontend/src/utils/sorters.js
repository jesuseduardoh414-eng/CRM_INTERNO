const PRIORIDAD_ORDEN = {
  ALTA: 0,
  MEDIA: 1,
  BAJA: 2,
};

// Espejo de backend/src/utils/sort.utils.js: los activos primero, luego los
// pausados, despues lo terminado y al final el archivo. Se conservan los
// nombres viejos por si queda algun registro sin migrar.
const PROYECTO_ESTADO_ORDEN = {
  ACTIVO: 0,
  INACTIVO: 1,
  PENDIENTE: 1,
  EN_PAUSA: 1,
  PAUSA: 1,
  PAUSADO: 1,
  TERMINADO: 2,
  FINALIZADO: 2,
  CERRADO: 2,
  HECHO: 2,
  ARCHIVADO: 3,
};

const getDateMs = (value, fallback = Number.MAX_SAFE_INTEGER) => {
  if (!value) return fallback;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? fallback : time;
};

const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });
const getNumeroActividadRank = (tarea) => {
  const numero = Number(tarea?.numeroActividad);
  return Number.isFinite(numero) && numero > 0 ? numero : Number.MAX_SAFE_INTEGER;
};

export const compareTareas = (a, b) => {
  const aHecha = a.estado === 'HECHO';
  const bHecha = b.estado === 'HECHO';

  if (aHecha && bHecha) {
    const porCompletado = getDateMs(b.completadoEn, 0) - getDateMs(a.completadoEn, 0);
    if (porCompletado !== 0) return porCompletado;

    const porCreacion = getDateMs(b.creadoEn, 0) - getDateMs(a.creadoEn, 0);
    if (porCreacion !== 0) return porCreacion;

    return compareText(a.titulo, b.titulo);
  }

  const porNumeroActividad = getNumeroActividadRank(a) - getNumeroActividadRank(b);
  if (porNumeroActividad !== 0) return porNumeroActividad;

  if (aHecha !== bHecha) {
    return aHecha ? -1 : 1;
  }

  const porVencimiento = getDateMs(a.venceEn) - getDateMs(b.venceEn);
  if (porVencimiento !== 0) return porVencimiento;

  const porInicio = getDateMs(a.fechaInicio) - getDateMs(b.fechaInicio);
  if (porInicio !== 0) return porInicio;

  const porPrioridad = (PRIORIDAD_ORDEN[a.prioridad] ?? 1) - (PRIORIDAD_ORDEN[b.prioridad] ?? 1);
  if (porPrioridad !== 0) return porPrioridad;

  const porCreacion = getDateMs(a.creadoEn, 0) - getDateMs(b.creadoEn, 0);
  if (porCreacion !== 0) return porCreacion;

  return compareText(a.titulo, b.titulo);
};

export const sortTareas = (tareas = []) => [...tareas].sort(compareTareas);

export const compareTareasLista = (a, b) => {
  const aHecha = a.estado === 'HECHO';
  const bHecha = b.estado === 'HECHO';

  if (aHecha && bHecha) {
    const porCompletado = getDateMs(b.completadoEn, 0) - getDateMs(a.completadoEn, 0);
    if (porCompletado !== 0) return porCompletado;

    const porCreacion = getDateMs(b.creadoEn, 0) - getDateMs(a.creadoEn, 0);
    if (porCreacion !== 0) return porCreacion;

    return compareText(a.titulo, b.titulo);
  }

  const porNumeroActividad = getNumeroActividadRank(a) - getNumeroActividadRank(b);
  if (porNumeroActividad !== 0) return porNumeroActividad;

  if (aHecha !== bHecha) {
    return aHecha ? 1 : -1;
  }

  const porPrioridad = (PRIORIDAD_ORDEN[a.prioridad] ?? 1) - (PRIORIDAD_ORDEN[b.prioridad] ?? 1);
  if (porPrioridad !== 0) return porPrioridad;

  const porVencimiento = getDateMs(a.venceEn) - getDateMs(b.venceEn);
  if (porVencimiento !== 0) return porVencimiento;

  const porInicio = getDateMs(a.fechaInicio) - getDateMs(b.fechaInicio);
  if (porInicio !== 0) return porInicio;

  const porCreacion = getDateMs(a.creadoEn, 0) - getDateMs(b.creadoEn, 0);
  if (porCreacion !== 0) return porCreacion;

  return compareText(a.titulo, b.titulo);
};

export const sortTareasLista = (tareas = []) => [...tareas].sort(compareTareasLista);

export const compareProyectos = (a, b) => {
  const porEstado = (PROYECTO_ESTADO_ORDEN[a.estado] ?? 99) - (PROYECTO_ESTADO_ORDEN[b.estado] ?? 99);
  if (porEstado !== 0) return porEstado;

  const progresoA = a.progresoGeneral ?? a.progreso ?? 0;
  const progresoB = b.progresoGeneral ?? b.progreso ?? 0;
  if (progresoB !== progresoA) return progresoB - progresoA;

  const porCreacion = getDateMs(b.creadoEn, 0) - getDateMs(a.creadoEn, 0);
  if (porCreacion !== 0) return porCreacion;

  return compareText(a.nombre, b.nombre);
};

export const sortProyectos = (proyectos = []) => [...proyectos].sort(compareProyectos);
