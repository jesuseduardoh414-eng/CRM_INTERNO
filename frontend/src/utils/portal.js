// Utilidades del portal de clientes y de las redirecciones por tipo de cuenta.

/** Inicio de cada tipo de cuenta. */
export const inicioDe = (usuario) => {
  if (usuario?.rol === 'CONFIGURADOR') return '/configuracion';
  if (usuario?.rol === 'CLIENTE') return '/portal';
  return '/dashboard';
};

/** Clave SWR del resumen del portal (lo comparten el marco, el inicio y la cuenta). */
export const CLAVE_RESUMEN = ['portal', 'resumen'];

/** Fecha "solo día" que llega como ISO (fechas de proyecto, tareas, contratos). */
export const fechaDia = (valor, locale, opciones = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!valor) return null;
  const [y, m, d] = String(valor).slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, opciones).format(new Date(y, m - 1, d));
};

/** Instante real (mensajes, documentos, reuniones) en la hora local de quien mira. */
export const fechaHora = (valor, locale, opciones = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => (
  valor ? new Intl.DateTimeFormat(locale, opciones).format(new Date(valor)) : null
);

export const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
