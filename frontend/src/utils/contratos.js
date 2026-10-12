// Catálogos y ayudas del módulo de Contratos. Los valores coinciden con los
// que valida backend/src/controllers/contratos.controller.js.

export const TIPOS_CONTRATO = ['CLIENTE', 'PROVEEDOR'];
export const ESTADOS_CONTRATO = ['BORRADOR', 'EN_REVISION', 'VIGENTE', 'TERMINADO', 'CANCELADO'];
// Para filtrar se suman los dos estados calculados.
export const ESTADOS_FILTRO = ['VIGENTE', 'POR_VENCER', 'VENCIDO', 'BORRADOR', 'EN_REVISION', 'TERMINADO', 'CANCELADO'];
export const CATEGORIAS_CONTRATO = ['SERVICIOS', 'CONSULTORIA', 'COMPRAVENTA', 'ARRENDAMIENTO', 'CONFIDENCIALIDAD', 'LICENCIA', 'OBRA', 'MARCO', 'OTRO'];
export const MONEDAS = ['MXN', 'USD', 'EUR'];
export const PERIODICIDADES = ['UNICO', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'POR_ENTREGABLE'];
export const TIPOS_DOCUMENTO = ['FIRMADO', 'BORRADOR', 'ANEXO', 'CONVENIO', 'OTRO'];
// Límite de PDF: lo fija ConfiguracionContext con archivos.contratosMaxMB.
let pdfMaxMb = 25;
export const fijarPdfMaxMb = (n) => { if (Number.isInteger(n) && n > 0) pdfMaxMb = n; };
export const pdfMaxMegas = () => pdfMaxMb;
export const pdfMaxBytes = () => pdfMaxMb * 1024 * 1024;

// Clase de badge (index.css) por estado mostrado.
export const BADGE_ESTADO = {
  VIGENTE: 'badge-success',
  POR_VENCER: 'badge-warning',
  VENCIDO: 'badge-danger',
  BORRADOR: 'badge-neutral',
  EN_REVISION: 'badge-info',
  TERMINADO: 'badge-neutral',
  CANCELADO: 'badge-neutral',
};

/** Estado que se pinta: "por vencer" tiene prioridad sobre "vigente". */
export const estadoVisible = (contrato) => (contrato.porVencer ? 'POR_VENCER' : contrato.estadoEfectivo || contrato.estado);

export const formatearMonto = (monto, moneda, locale) => {
  if (monto === null || monto === undefined) return null;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: moneda || 'MXN', maximumFractionDigits: 2 }).format(monto);
  } catch {
    return `${monto} ${moneda}`;
  }
};

/** 'AAAA-MM-DD' -> fecha corta local, sin desfase de zona horaria. */
export const formatearFechaCorta = (texto, locale) => {
  if (!texto) return null;
  const [y, m, d] = texto.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
};

export const textoVencimiento = (t, contrato) => {
  const dias = contrato.diasRestantes;
  if (dias === null || dias === undefined || contrato.renovacionAutomatica) return null;
  if (!['VIGENTE', 'VENCIDO'].includes(contrato.estadoEfectivo)) return null;
  if (dias < 0) return t('ctrExpiredAgo', { n: Math.abs(dias) });
  if (dias === 0) return t('ctrToday');
  if (dias === 1) return t('ctrDayLeft');
  return t('ctrDaysLeft', { n: dias });
};

// 'AAAA-MM-DD' -> número de día (UTC), para restar fechas sin desfase horario.
const numeroDia = (texto) => {
  const [y, m, d] = texto.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
};

/**
 * Avance de la vigencia: qué porcentaje del periodo inicio→fin ya pasó.
 * null si al contrato le falta alguna de las dos fechas.
 */
export const progresoVigencia = (contrato) => {
  if (!contrato.fechaInicio || !contrato.fechaFin) return null;
  const inicio = numeroDia(contrato.fechaInicio);
  const total = numeroDia(contrato.fechaFin) - inicio;
  if (total <= 0) return null;
  const ahora = new Date();
  const hoy = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()) / 864e5;
  const porcentaje = Math.round(Math.min(100, Math.max(0, ((hoy - inicio) / total) * 100)));
  return { porcentaje, diasParaIniciar: hoy < inicio ? inicio - hoy : 0 };
};

/** Tono de la barra de vigencia según el estado mostrado. */
export const TONO_VIGENCIA = { VIGENTE: 'success', POR_VENCER: 'warning', VENCIDO: 'danger' };

export const formatearTamano = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
