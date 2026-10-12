// Catalogo unico de estado y prioridad de tarea para el frontend.
//
// Antes cada vista tenia su propia tabla: la lista decia "Alta / Media / Baja",
// el Kanban "Critica / Media / Normal" y el gantt pintaba Alta en rojo y Baja
// en verde; y "Hecho" se llamaba "Hechas", "Completado" o "Haciendo" segun
// donde se mirara. Los colores salen de las variables CSS de index.css para
// que el modo oscuro los adapte solo.
//
// `color` es el tono solido (puntos, barras, iconos); `bg` y `fg` son el par
// fondo/texto de una etiqueta (badge).

import { AREA_GENERAL } from './areas';

export const ESTADOS_TAREA = [
  {
    value: 'PENDIENTE',
    labelKey: 'statusTodo',
    color: 'var(--color-text-muted)',
    bg: 'var(--badge-neutral-bg)',
    fg: 'var(--badge-neutral-fg)',
  },
  {
    value: 'EN_PROGRESO',
    labelKey: 'statusInProgress',
    color: 'var(--color-accent-blue)',
    bg: 'var(--badge-info-bg)',
    fg: 'var(--badge-info-fg)',
  },
  {
    value: 'HECHO',
    labelKey: 'statusDone',
    color: 'var(--color-accent-green)',
    bg: 'var(--badge-success-bg)',
    fg: 'var(--badge-success-fg)',
  },
];

export const PRIORIDADES_TAREA = [
  {
    value: 'BAJA',
    labelKey: 'priorityLow',
    color: 'var(--color-accent-blue)',
    bg: 'var(--badge-info-bg)',
    fg: 'var(--badge-info-fg)',
  },
  {
    value: 'MEDIA',
    labelKey: 'priorityMedium',
    color: 'var(--color-accent-amber)',
    bg: 'var(--badge-warning-bg)',
    fg: 'var(--badge-warning-fg)',
  },
  {
    value: 'ALTA',
    labelKey: 'priorityHigh',
    color: 'var(--color-accent-pink)',
    bg: 'var(--badge-danger-bg)',
    fg: 'var(--badge-danger-fg)',
  },
];

export const ESTADO_TAREA_DEFAULT = 'PENDIENTE';
export const PRIORIDAD_TAREA_DEFAULT = 'MEDIA';

export const CICLO_ESTADOS_TAREA = ESTADOS_TAREA.map((estado) => estado.value);

export const getEstadoTarea = (valor) => (
  ESTADOS_TAREA.find((estado) => estado.value === valor) || ESTADOS_TAREA[0]
);

export const getPrioridadTarea = (valor) => (
  PRIORIDADES_TAREA.find((prioridad) => prioridad.value === valor) || PRIORIDADES_TAREA[1]
);

/** PENDIENTE -> EN_PROGRESO -> HECHO -> PENDIENTE */
export const siguienteEstadoTarea = (estado) => {
  const indice = CICLO_ESTADOS_TAREA.indexOf(estado);
  return CICLO_ESTADOS_TAREA[(indice + 1) % CICLO_ESTADOS_TAREA.length];
};

/** Responsables de una tarea, con compatibilidad con el campo antiguo `asignado`. */
export const asignadosDeTarea = (tarea) => {
  if (Array.isArray(tarea?.asignados) && tarea.asignados.length > 0) return tarea.asignados;
  return tarea?.asignado ? [tarea.asignado] : [];
};

const areasDeProyecto = (area) => String(area || '')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);

/**
 * Replica de la regla del backend (`puedeAccederTarea` en tareas.controller y
 * `puedeAdministrarProyecto` en permissions.utils) para no mostrar acciones que
 * el servidor va a rechazar:
 *
 *  - Admin global (area ADMINISTRACION): siempre.
 *  - Admin de area: solo en proyectos de su area.
 *  - Miembro: si la tarea no tiene responsable, si es el creador o si es uno de
 *    los responsables.
 */
export const puedeGestionarTarea = (tarea, usuario, proyecto) => {
  if (!tarea || !usuario) return false;

  if (usuario.rol === 'ADMIN') {
    if (usuario.area === AREA_GENERAL) return true;
    return areasDeProyecto(proyecto?.area).includes(String(usuario.area || '').toUpperCase());
  }

  // El backend exige ademas ser miembro del proyecto (`esMiembro &&
  // puedeAccederTarea`): quien creo una tarea pero ya salio del proyecto no
  // puede tocarla. Si no viene la lista de miembros, no se bloquea por eso.
  const miembros = proyecto?.miembros;
  if (Array.isArray(miembros) && !miembros.some((m) => m.id === usuario.id)) return false;

  const asignados = asignadosDeTarea(tarea);
  if (asignados.length === 0) return true;
  if (tarea.creador?.id === usuario.id || tarea.creadorId === usuario.id) return true;
  return asignados.some((asignado) => asignado.id === usuario.id);
};
