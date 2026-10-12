// Los activos primero, luego los pausados, y al final lo ya cerrado.
// Se conservan los nombres viejos por si queda algun registro sin migrar.
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

// Pendientes primero, luego en curso y al final lo ya hecho. Un estado
// desconocido se va al final para no romper el orden.
const TAREA_ESTADO_ORDEN = {
  PENDIENTE: 0,
  EN_PROGRESO: 1,
  HECHO: 2,
};

const compareStrings = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });
const getNumeroActividadRank = (tarea) => {
  const numero = Number(tarea?.numeroActividad);
  return Number.isFinite(numero) && numero > 0 ? numero : Number.MAX_SAFE_INTEGER;
};

const getIdRank = (tarea) => {
  const id = Number(tarea?.id);
  return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
};

/**
 * Orden total de tareas: estado (PENDIENTE, EN_PROGRESO, HECHO), numero de
 * actividad (sin numero al final), fecha limite (sin fecha al final) e id.
 *
 * El comparador anterior no era transitivo: las HECHO se ordenaban entre si
 * por fecha de cierre, pero frente a una pendiente se comparaban por numero y
 * ademas se ponian antes a igual numero. Con tres tareas se podia dar
 * a < b, b < c y c < a, y `Array.sort` devolvia un orden distinto segun el
 * tamaño del arreglo. Aqui cada criterio se aplica siempre en el mismo orden
 * y el id (unico) cierra cualquier empate, asi que el resultado es estable.
 */
const compareTareas = (a, b) => {
  const porEstado = (TAREA_ESTADO_ORDEN[a?.estado] ?? 99) - (TAREA_ESTADO_ORDEN[b?.estado] ?? 99);
  if (porEstado !== 0) return porEstado;

  const porNumeroActividad = getNumeroActividadRank(a) - getNumeroActividadRank(b);
  if (porNumeroActividad !== 0) return porNumeroActividad;

  const porVencimiento = getDateMs(a?.venceEn) - getDateMs(b?.venceEn);
  if (porVencimiento !== 0) return porVencimiento;

  const porId = getIdRank(a) - getIdRank(b);
  if (porId !== 0) return porId;

  // Solo se llega aqui sin ids (tareas aun no guardadas): se desempata por
  // creacion y titulo para que el orden siga siendo determinista.
  const porCreacion = getDateMs(a?.creadoEn, 0) - getDateMs(b?.creadoEn, 0);
  if (porCreacion !== 0) return porCreacion;

  return compareStrings(a?.titulo, b?.titulo);
};

const sortTareas = (tareas = []) => [...tareas].sort(compareTareas);

const compareProyectos = (a, b) => {
  const porEstado = (PROYECTO_ESTADO_ORDEN[a.estado] ?? 99) - (PROYECTO_ESTADO_ORDEN[b.estado] ?? 99);
  if (porEstado !== 0) return porEstado;

  const progresoA = a.progresoGeneral ?? a.progreso ?? 0;
  const progresoB = b.progresoGeneral ?? b.progreso ?? 0;
  if (progresoB !== progresoA) return progresoB - progresoA;

  const porCreacion = getDateMs(b.creadoEn, 0) - getDateMs(a.creadoEn, 0);
  if (porCreacion !== 0) return porCreacion;

  return compareStrings(a.nombre, b.nombre);
};

const sortProyectos = (proyectos = []) => [...proyectos].sort(compareProyectos);

module.exports = {
  compareTareas,
  sortTareas,
  compareProyectos,
  sortProyectos,
};
