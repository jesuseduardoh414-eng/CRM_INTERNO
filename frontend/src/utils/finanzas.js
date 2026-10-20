// Catálogos, permisos y ayudas del módulo de Finanzas (Ventas, Tesorería,
// Gastos y Cotizaciones). Los valores coinciden con backend/src/utils/finanzas.utils.js:
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
export const MONEDAS = ['MXN', 'USD', 'EUR'];
// La tesorería y el informe trabajan en esta moneda.
export const MONEDA_BASE = 'MXN';
export const METODOS_PAGO = ['TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'CHEQUE', 'DEPOSITO', 'OTRO'];
export const TIPOS_CUENTA = ['BANCO', 'EFECTIVO', 'PASARELA', 'OTRA'];
export const ESTADOS_PAGO = ['REGISTRADO', 'ANULADO'];
export const ESTADOS_GASTO = ['PENDIENTE', 'PAGADO', 'ANULADO'];
// RECIBIDA: la cotiza un proveedor. ENVIADA: la cotizamos a un cliente.
export const TIPOS_COTIZACION = ['RECIBIDA', 'ENVIADA'];
export const ESTADOS_COTIZACION = ['PENDIENTE', 'APROBADA', 'RECHAZADA'];
// Para filtrar se suma el estado calculado "vencido".
export const ESTADOS_FILTRO_GASTO = ['PENDIENTE', 'VENCIDO', 'PAGADO', 'ANULADO'];

// Clase de badge (index.css) por estado mostrado.
export const BADGE_ESTADO_GASTO = { PENDIENTE: 'badge-warning', VENCIDO: 'badge-danger', PAGADO: 'badge-success', ANULADO: 'badge-neutral' };
export const BADGE_ESTADO_PAGO = { REGISTRADO: 'badge-success', ANULADO: 'badge-neutral' };
export const BADGE_ESTADO_COTIZACION = { PENDIENTE: 'badge-warning', APROBADA: 'badge-success', RECHAZADA: 'badge-danger' };

/** Estado que se pinta: "vencido" tiene prioridad sobre "pendiente". */
export const estadoVisibleGasto = (gasto) => (gasto?.vencido ? 'VENCIDO' : gasto?.estado);

// ── Permisos ──────────────────────────────────────────────────────────────
// Las casillas finanzas.* llegan ya resueltas en usuario.permisos (ver
// utils/permisos.js): ventas y cada categoría de gastos con ver / crear /
// editar / eliminar; tesorería con ver / editar; informe con ver; y
// cotizaciones con ver / crear (subir y versiones) / editar (corregir datos) /
// aprobar (estado) / eliminar. Aquí solo se lee; la comprobación real es del
// servidor.

/** recurso: 'ventas', 'tesoreria', 'informe', 'cotizaciones' o 'gastos.FIJOS'. */
export const puedeFinanzas = (usuario, recurso, accion = 'ver') => usuario?.permisos?.[`finanzas.${recurso}.${accion}`] === true;
export const puedeVerFinanzas = (usuario, recurso) => puedeFinanzas(usuario, recurso, 'ver');
/** Categorías de gastos en las que puede la acción. */
export const categoriasCon = (usuario, accion = 'ver') => CATEGORIAS_GASTO.filter((c) => puedeFinanzas(usuario, `gastos.${c}`, accion));
export const categoriasVisibles = (usuario) => categoriasCon(usuario, 'ver');
const RECURSOS_BASE = ['ventas', 'tesoreria', 'informe', 'cotizaciones'];
export const tieneAccesoFinanzas = (usuario) => RECURSOS_BASE.some((r) => puedeVerFinanzas(usuario, r)) || categoriasVisibles(usuario).length > 0;
export const tieneAccesoGastos = (usuario) => categoriasVisibles(usuario).length > 0 || puedeVerFinanzas(usuario, 'informe');

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

// ── Documentos (cotizaciones y base de conocimiento) ──────────────────────
// PDF, imágenes y Office. Igual que el servidor: la extensión decide qué se
// acepta y el servidor comprueba el contenido.
export const ACEPTA_DOCUMENTO = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
export const esDocumentoValido = (archivo) => /\.(pdf|jpe?g|png|webp|docx?|xlsx?|pptx?)$/i.test(archivo?.name || '');
/** PDF e imágenes se pueden ver en el CRM; Office solo se descarga. */
export const seVeEnElCrm = (mime) => mime === 'application/pdf' || esImagen(mime);

// ── Fechas ────────────────────────────────────────────────────────────────

/** 'AAAA-MM-DD' de hoy en la zona del navegador (para los formularios). */
export const hoyClave = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "octubre de 2026" en el idioma elegido (mes 1-12). */
export const nombreMesAnio = (anio, mes, locale) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(anio, mes - 1, 1));

/** { anio, mes } movido `delta` meses (negativo hacia atrás). */
export const moverMes = ({ anio, mes }, delta) => {
  const d = new Date(anio, mes - 1 + delta, 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
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
