// Permisos de la persona en el frontend. El servidor manda en el usuario
// `permisos` = { clave: valor } ya resuelto (tabla de su área y rol más sus
// ajustes; el administrador general trae todo). Aquí solo se lee para mostrar
// u ocultar menús y botones: la comprobación real es del servidor
// (backend/src/utils/permisosArea.utils.js y permissions.utils.js).
//
// Valores: true/false, o un alcance: ninguno | propios | area | todos.
// Una persona puede tener varias áreas (usuario.area = "MARKETING,DESARROLLO");
// un alcance "area" llega a todas, salvo las casillas de `alcanceAreas`, que
// solo llegan a las áreas cuya tabla lo da.
import { AREA_GENERAL, areasDeTexto } from './areas';

/** Áreas de una persona. */
export const areasDe = (usuario) => areasDeTexto(usuario?.area);

export const esAdminGeneral = (usuario) => usuario?.rol === 'ADMIN' && areasDe(usuario).includes(AREA_GENERAL);

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

/** Áreas a las que llega el alcance "area" de una casilla. */
export const areasDelAlcance = (usuario, clave) => usuario?.alcanceAreas?.[clave] ?? areasDe(usuario);
const enSusAreas = (usuario, proyecto, clave) => areasDeTexto(proyecto?.area).some((a) => areasDelAlcance(usuario, clave).includes(a));
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
  if (alcance === 'area' && enSusAreas(usuario, proyecto, clave)) return true;
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
  if (alcance === 'area' && enSusAreas(usuario, proyecto, clave)) return true;
  return esMiembroDe(usuario, proyecto) && tareaEsSuya;
};
