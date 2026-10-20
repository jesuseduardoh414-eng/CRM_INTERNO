// Permisos de la persona en el frontend. El servidor manda en el usuario
// `permisos` = { clave: valor } ya resuelto (tabla de su área y rol más sus
// ajustes; el administrador general trae todo). Aquí solo se lee para mostrar
// u ocultar menús y botones: la comprobación real es del servidor
// (backend/src/utils/permisosArea.utils.js y permissions.utils.js).
//
// Valores: true/false, o un alcance: ninguno | propios | area | todos.
import { AREA_GENERAL } from './areas';

export const esAdminGeneral = (usuario) => usuario?.rol === 'ADMIN' && usuario?.area === AREA_GENERAL;

export const valorPermiso = (usuario, clave) => usuario?.permisos?.[clave];

/** true si la casilla está concedida (true o un alcance distinto de ninguno). */
export const puede = (usuario, clave) => {
  const valor = valorPermiso(usuario, clave);
  return valor === true || (typeof valor === 'string' && valor !== 'ninguno');
};

/** Alcance de una casilla de tipo alcance ('ninguno' si no la tiene). */
export const alcanceDe = (usuario, clave) => {
  const valor = valorPermiso(usuario, clave);
  return typeof valor === 'string' ? valor : 'ninguno';
};

const areasDe = (valor) => String(valor || '').split(',').map((a) => a.trim()).filter(Boolean);
const esMiembroDe = (usuario, proyecto) => (proyecto?.miembros || []).some((m) => (m?.id ?? m) === usuario?.id);
const esCreadorDe = (usuario, proyecto) => Boolean(usuario) && (proyecto?.creadorId === usuario.id || proyecto?.creador?.id === usuario.id);

/**
 * ¿El alcance de la casilla llega a este proyecto? "propios" = creador o
 * miembro; "area" = los de su área más los propios. Para proyectos.editar y
 * proyectos.eliminar.
 */
export const alcanzaProyecto = (usuario, proyecto, clave) => {
  const alcance = alcanceDe(usuario, clave);
  if (!usuario || !proyecto || alcance === 'ninguno') return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && areasDe(proyecto.area).includes(usuario.area)) return true;
  return esCreadorDe(usuario, proyecto) || esMiembroDe(usuario, proyecto);
};

/**
 * Acción sobre tareas ("tareas.crear" | "tareas.editar" | "tareas.eliminar").
 * Con "propios" hace falta ser miembro del proyecto y que la tarea sea suya
 * (sin responsable, asignada a la persona o creada por ella).
 */
export const puedeEnTareas = (usuario, proyecto, clave, tareaEsSuya = true) => {
  const alcance = alcanceDe(usuario, clave);
  if (!usuario || !proyecto || alcance === 'ninguno') return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && areasDe(proyecto.area).includes(usuario.area)) return true;
  return esMiembroDe(usuario, proyecto) && tareaEsSuya;
};
