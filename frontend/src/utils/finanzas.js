// Catálogos, permisos y ayudas del módulo de Finanzas (Ventas, Tesorería y
// Gastos). Los valores coinciden con backend/src/utils/finanzas.utils.js:
// si cambia una lista allá, cambia aquí.
import { mutate } from 'swr';
import { formatearFechaCorta, formatearMonto, formatearTamano } from './contratos';

export { formatearFechaCorta, formatearMonto, formatearTamano };

// ── Datos en pantalla ─────────────────────────────────────────────────────
// Ventas, Tesorería y Gastos se alimentan unas a otras (un pago cambia la
// bolsa, una partida nueva sale en Gastos). Con la deduplicación global de
// SWR (30 s) una pantalla recién abierta reutilizaba datos viejos: aquí se
// acorta, y tras cada cambio se recargan todas las claves de finanzas.
export const OPCIONES_SWR_FINANZAS = { dedupingInterval: 2000 };
const esClaveFinanzas = (clave) => String(Array.isArray(clave) ? clave[0] : clave).startsWith('finanzas-');
export const recargarFinanzas = () => mutate(esClaveFinanzas);

export const CATEGORIAS_GASTO = ['PRESUPUESTO_GENERAL', 'PRESUPUESTO_OFICINA', 'NOMINA', 'FIJOS', 'VARIABLES', 'OTROS'];
export const NIVELES = ['ninguno', 'ver', 'editar'];
export const MONEDAS = ['MXN', 'USD', 'EUR'];
// La tesorería y el informe trabajan en esta moneda.
export const MONEDA_BASE = 'MXN';
export const METODOS_PAGO = ['TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'CHEQUE', 'DEPOSITO', 'OTRO'];
export const TIPOS_CUENTA = ['BANCO', 'EFECTIVO', 'PASARELA', 'OTRA'];
export const ESTADOS_PAGO = ['REGISTRADO', 'ANULADO'];
export const ESTADOS_GASTO = ['PENDIENTE', 'PAGADO', 'ANULADO'];
// Para filtrar se suma el estado calculado "vencido".
export const ESTADOS_FILTRO_GASTO = ['PENDIENTE', 'VENCIDO', 'PAGADO', 'ANULADO'];

// Clase de badge (index.css) por estado mostrado.
export const BADGE_ESTADO_GASTO = { PENDIENTE: 'badge-warning', VENCIDO: 'badge-danger', PAGADO: 'badge-success', ANULADO: 'badge-neutral' };
export const BADGE_ESTADO_PAGO = { REGISTRADO: 'badge-success', ANULADO: 'badge-neutral' };

/** Estado que se pinta: "vencido" tiene prioridad sobre "pendiente". */
export const estadoVisibleGasto = (gasto) => (gasto?.vencido ? 'VENCIDO' : gasto?.estado);

// ── Permisos ──────────────────────────────────────────────────────────────
// El backend manda en el usuario `finanzas: { ventas, tesoreria, informe,
// gastos: { CATEGORIA: nivel } }` ya resuelto (el administrador global trae
// `editar` en todo). Aquí solo se lee; la comprobación real es del servidor.

export const nivelFinanzas = (usuario, recurso) => {
  const f = usuario?.finanzas;
  if (!f) return 'ninguno';
  if (recurso.startsWith('gastos.')) return f.gastos?.[recurso.slice(7)] || 'ninguno';
  return f[recurso] || 'ninguno';
};
export const puedeVerFinanzas = (usuario, recurso) => nivelFinanzas(usuario, recurso) !== 'ninguno';
export const puedeEditarFinanzas = (usuario, recurso) => nivelFinanzas(usuario, recurso) === 'editar';
export const categoriasVisibles = (usuario) => CATEGORIAS_GASTO.filter((c) => puedeVerFinanzas(usuario, `gastos.${c}`));
export const categoriasEditables = (usuario) => CATEGORIAS_GASTO.filter((c) => puedeEditarFinanzas(usuario, `gastos.${c}`));
export const tieneAccesoFinanzas = (usuario) => ['ventas', 'tesoreria', 'informe'].some((r) => puedeVerFinanzas(usuario, r)) || categoriasVisibles(usuario).length > 0;
export const tieneAccesoGastos = (usuario) => categoriasVisibles(usuario).length > 0 || puedeVerFinanzas(usuario, 'informe');

/** Matriz vacía para el editor de permisos de un usuario. */
export const permisosVacios = () => ({
  ventas: 'ninguno',
  tesoreria: 'ninguno',
  informe: 'ninguno',
  gastos: Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, 'ninguno'])),
});

/** Lo guardado en el usuario (puede ser null o incompleto) -> matriz completa. */
export const permisosDesde = (guardados) => {
  const base = permisosVacios();
  if (!guardados || typeof guardados !== 'object') return base;
  ['ventas', 'tesoreria', 'informe'].forEach((r) => { if (NIVELES.includes(guardados[r])) base[r] = guardados[r]; });
  CATEGORIAS_GASTO.forEach((c) => { if (NIVELES.includes(guardados.gastos?.[c])) base.gastos[c] = guardados.gastos[c]; });
  return base;
};

// ── Rutas ─────────────────────────────────────────────────────────────────

/** 'PRESUPUESTO_GENERAL' -> '/gastos/presupuesto-general' */
export const slugCategoria = (categoria) => String(categoria).toLowerCase().replace(/_/g, '-');
export const rutaCategoria = (categoria) => `/gastos/${slugCategoria(categoria)}`;
export const categoriaDesdeSlug = (slug) => CATEGORIAS_GASTO.find((c) => slugCategoria(c) === String(slug || '').toLowerCase()) || null;
export const RUTA_INFORME = '/gastos/informe';

// ── Comprobantes ──────────────────────────────────────────────────────────
// Límite: lo fija ConfiguracionContext con subidas.comprobantesMaxMB.
let comprobanteMaxMb = 10;
export const fijarComprobanteMaxMb = (n) => { if (Number.isInteger(n) && n > 0) comprobanteMaxMb = n; };
export const comprobanteMaxMegas = () => comprobanteMaxMb;
export const comprobanteMaxBytes = () => comprobanteMaxMb * 1024 * 1024;
export const ACEPTA_COMPROBANTE = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';
// Igual que el servidor: tipo Y extensión conocidos (si no, el servidor lo rechaza).
export const esComprobanteValido = (archivo) => (
  ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(archivo?.type)
  && /\.(pdf|jpe?g|png|webp)$/i.test(archivo?.name || '')
);
export const esImagen = (mime) => String(mime || '').startsWith('image/');

// ── Fechas ────────────────────────────────────────────────────────────────

/** 'AAAA-MM-DD' de hoy en la zona del navegador (para los formularios). */
export const hoyClave = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Nombre del mes (1-12) en el idioma elegido. */
export const nombreMes = (mes, locale, forma = 'long') => new Intl.DateTimeFormat(locale, { month: forma }).format(new Date(2026, mes - 1, 1));

/** Años para los selectores: del actual hacia atrás hasta 2024, más uno adelante. */
export const aniosSelector = () => {
  const actual = new Date().getFullYear();
  const lista = [];
  for (let a = actual + 1; a >= Math.min(2024, actual - 1); a -= 1) lista.push(a);
  return lista;
};
