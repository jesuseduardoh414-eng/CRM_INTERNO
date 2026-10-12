// Catalogo unico de estados de proyecto para el frontend.
//
// Antes esta lista estaba duplicada en ProyectosPage, DashboardPage y EquipoPage,
// cada una con sus propios colores. El backend tiene su equivalente en
// backend/src/utils/estados.utils.js — si cambias uno, cambia el otro.
//
// Colores: variables del tema (index.css), nunca hex, para que el modo oscuro
// funcione. Cada estado trae:
//   color       texto del chip (par con `bg`, >= 4.5:1 en los dos temas)
//   bg          fondo suave del chip
//   dot         color vivo para un punto/indicador sin texto encima
//   glow        halo translúcido para sombras (antes se hacía `${color}55`,
//               que con una variable CSS deja de funcionar)
//   badgeClass  clase utilitaria equivalente (`.badge-success`...)

export const ESTADO_PROYECTO_DEFAULT = 'ACTIVO';

export const ESTADOS_PROYECTO = [
  {
    value: 'ACTIVO',
    labelKey: 'statusActive',
    color: 'var(--badge-success-fg)',
    bg: 'var(--badge-success-bg)',
    dot: 'var(--color-accent-success)',
    glow: 'color-mix(in srgb, var(--color-accent-success) 35%, transparent)',
    badgeClass: 'badge-success',
  },
  {
    value: 'INACTIVO',
    labelKey: 'statusInactive',
    color: 'var(--badge-warning-fg)',
    bg: 'var(--badge-warning-bg)',
    dot: 'var(--color-accent-warning)',
    glow: 'color-mix(in srgb, var(--color-accent-warning) 35%, transparent)',
    badgeClass: 'badge-warning',
  },
  {
    value: 'TERMINADO',
    labelKey: 'statusFinished',
    color: 'var(--badge-info-fg)',
    bg: 'var(--badge-info-bg)',
    dot: 'var(--color-primary)',
    glow: 'var(--color-primary-40)',
    badgeClass: 'badge-info',
  },
  {
    value: 'ARCHIVADO',
    labelKey: 'statusArchived',
    color: 'var(--badge-neutral-fg)',
    bg: 'var(--badge-neutral-bg)',
    dot: 'var(--color-text-muted)',
    glow: 'color-mix(in srgb, var(--color-text-muted) 35%, transparent)',
    badgeClass: 'badge-neutral',
  },
];

// Nombres antiguos que pueden seguir vivos en la base
const ALIAS = {
  EN_PAUSA: 'INACTIVO',
  PAUSA: 'INACTIVO',
  PAUSADO: 'INACTIVO',
  PENDIENTE: 'INACTIVO',
  CERRADO: 'TERMINADO',
  FINALIZADO: 'TERMINADO',
  HECHO: 'TERMINADO',
};

export const normalizarEstadoProyecto = (estado) => {
  const bruto = String(estado || '').trim().toUpperCase();
  if (!bruto) return ESTADO_PROYECTO_DEFAULT;
  const normalizado = ALIAS[bruto] || bruto;
  return ESTADOS_PROYECTO.some((e) => e.value === normalizado)
    ? normalizado
    : ESTADO_PROYECTO_DEFAULT;
};

export const getEstadoProyecto = (estado) => (
  ESTADOS_PROYECTO.find((e) => e.value === normalizarEstadoProyecto(estado)) || ESTADOS_PROYECTO[0]
);

/**
 * Un proyecto esta "listo para revision" cuando todas sus tareas estan hechas
 * pero el admin todavia no ha dado el visto bueno. No se marca solo a proposito:
 * el 100% es una sugerencia, la decision es del admin.
 */
export const estaListoParaRevision = (proyecto) => {
  const total = proyecto?._count?.tareas ?? 0;
  const progreso = proyecto?.progresoGeneral ?? proyecto?.progreso ?? 0;
  return total > 0
    && progreso >= 100
    && normalizarEstadoProyecto(proyecto?.estado) === 'ACTIVO';
};
