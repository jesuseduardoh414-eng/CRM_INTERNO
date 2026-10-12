/**
 * Fechas "de calendario" (sin hora) en hora local.
 *
 * El backend guarda las fechas de proyecto y de tarea como `YYYY-MM-DD` (a
 * medianoche UTC los proyectos, a mediodia UTC las tareas). Si eso se pasa a
 * `new Date(iso)` y se formatea en hora local (Mexico, UTC-6) sale el dia
 * anterior. Y al reves: `new Date().toISOString().slice(0, 10)` devuelve el dia
 * en UTC, que de noche ya es "manana".
 *
 * Regla: una fecha de calendario viaja como clave `YYYY-MM-DD` y, cuando hace
 * falta un `Date`, se construye a mediodia local, lejos de cualquier cambio de
 * dia por huso horario.
 */

const dosDigitos = (n) => String(n).padStart(2, '0');

/** Date (o algo convertible) -> 'YYYY-MM-DD' en hora local. Sin argumento: hoy. */
export const claveDiaLocal = (fecha = new Date()) => {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
};

/** 'YYYY-MM-DD' -> Date a mediodia local. Clave vacia o invalida -> null. */
export const fechaDesdeClave = (clave) => {
  if (!clave || typeof clave !== 'string') return null;
  const [anio, mes, dia] = clave.slice(0, 10).split('-').map(Number);
  if (!anio || !mes || !dia) return null;
  const fecha = new Date(anio, mes - 1, dia, 12, 0, 0, 0);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/** ISO del backend ('2026-08-07T00:00:00.000Z') -> 'YYYY-MM-DD' tal cual viene. */
export const claveDesdeISO = (iso) => (iso ? String(iso).slice(0, 10) : '');

/** ISO del backend -> Date a mediodia local del dia que representa. */
export const fechaLocalDesdeISO = (iso) => fechaDesdeClave(claveDesdeISO(iso));

/** Compara una clave con el dia de hoy: -1 pasado, 0 hoy, 1 futuro. */
export const compararConHoy = (clave) => {
  const hoy = claveDiaLocal();
  if (!clave) return 0;
  if (clave < hoy) return -1;
  if (clave > hoy) return 1;
  return 0;
};

/**
 * ¿Vence dentro de los proximos `dias` (hoy incluido) sin haber vencido aun?
 * Con `dias` 0 o vacio el aviso esta apagado.
 */
export const estaPorVencer = (iso, dias) => {
  if (!iso || !dias || dias <= 0) return false;
  const vence = fechaDesdeClave(claveDesdeISO(iso));
  const hoy = fechaDesdeClave(claveDiaLocal());
  if (!vence || !hoy) return false;
  const diferencia = Math.round((vence - hoy) / 86400000);
  return diferencia >= 0 && diferencia <= dias;
};
