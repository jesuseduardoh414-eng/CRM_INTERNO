import {
  House,
  Plane, FileText, Coffee, HeartPulse, Home, Gift, Sun, Ban, Lock, Link2, Star,
} from 'lucide-react';

// Catalogos de las ventanas de la agenda (evento y ajustes). Los colores son
// tokens CSS para que sirvan igual en tema claro y oscuro; el color que se
// guarda en el evento lo calcula el servidor por categoria.
//
// `textoKey` es una clave de utils/textosAgenda (prefijo mod_); `tKey`, una
// del diccionario general de PreferencesContext que ya existia.

/** Categorias de evento. Mismo catalogo que TIPOS_EVENTO del backend. */
export const CATEGORIAS_EVENTO = [
  { id: 'evento', tKey: 'eventTypeEvent', color: 'var(--color-accent-blue)' },
  { id: 'reunion', tKey: 'eventTypeMeeting', color: 'var(--color-accent-purple)' },
  { id: 'recordatorio', textoKey: 'mod_tipoRecordatorio', color: 'var(--color-accent-amber)' },
  { id: 'dia_completo', textoKey: 'mod_tipoTodoElDia', color: 'var(--color-accent-green)' },
  { id: 'actividad', textoKey: 'mod_tipoActividad', color: 'var(--color-accent-pink)' },
];

/** Aviso previo (alerta_minutos). 0 = sin aviso, como lo entiende el backend. */
export const AVISOS_EVENTO = [
  { minutos: 0, textoKey: 'mod_avisoNinguno' },
  { minutos: 5, textoKey: 'mod_avisoMin', n: 5 },
  { minutos: 10, textoKey: 'mod_avisoMin', n: 10 },
  { minutos: 15, textoKey: 'mod_avisoMin', n: 15 },
  { minutos: 30, textoKey: 'mod_avisoMin', n: 30 },
  { minutos: 60, textoKey: 'mod_avisoHora' },
  { minutos: 1440, textoKey: 'mod_avisoDia' },
];

/** Duraciones que se ofrecen al buscar hueco para una reunion. */
export const DURACIONES_REUNION = [30, 45, 60, 90];

/** Dias personales. 'festivo' queda solo para mostrar registros antiguos. */
export const TIPOS_DIA_PERSONAL = [
  { id: 'vacacion', textoKey: 'mod_diaVacacion', color: 'var(--color-success)', icono: Plane },
  { id: 'permiso', textoKey: 'mod_diaPermiso', color: 'var(--color-warning)', icono: FileText },
  { id: 'descanso', textoKey: 'mod_diaDescanso', color: 'var(--color-accent-blue)', icono: Coffee },
  { id: 'incapacidad', textoKey: 'mod_diaIncapacidad', color: 'var(--color-error)', icono: HeartPulse },
  { id: 'homeoffice', textoKey: 'mod_diaHomeOffice', color: 'var(--color-primary)', icono: Home },
  { id: 'cumpleanos', textoKey: 'mod_diaCumpleanos', color: 'var(--color-accent-pink)', icono: Gift },
];
export const TIPO_DIA_PERSONAL_ANTIGUO = { id: 'festivo', textoKey: 'mod_empFestivo', color: 'var(--color-error)', icono: Sun };

/** Calendario de la empresa. Mismo catalogo que TIPOS_DIA_EMPRESA del backend. */
export const TIPOS_DIA_EMPRESA = [
  { id: 'festivo', textoKey: 'mod_empFestivo', color: 'var(--color-error)', icono: Sun },
  { id: 'no_laboral', textoKey: 'mod_empNoLaboral', color: 'var(--color-text-muted)', icono: Ban },
  { id: 'cierre', textoKey: 'mod_empCierre', color: 'var(--color-warning)', icono: Lock },
  { id: 'puente', textoKey: 'mod_empPuente', color: 'var(--color-accent-purple)', icono: Link2 },
  { id: 'homeoffice', textoKey: 'mod_empHomeoffice', color: 'var(--color-accent-green)', icono: House },
  { id: 'especial', textoKey: 'mod_empEspecial', color: 'var(--color-accent-blue)', icono: Star },
];

const dosDigitos = (n) => String(n).padStart(2, '0');

/** Suma `n` dias a una clave 'YYYY-MM-DD' sin pasar por UTC. */
export const sumarDiasClave = (clave, n) => {
  const [anio, mes, dia] = String(clave).split('-').map(Number);
  const d = new Date(anio, mes - 1, dia + n, 12, 0, 0, 0);
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
};

/**
 * Junta dias sueltos en tramos seguidos. `mismoGrupo(a, b)` decide si dos dias
 * consecutivos van en el mismo tramo (p. ej. mismo tipo y motivo). Devuelve
 * [{ desde, hasta, dias: [...] }] en el orden de las claves.
 */
export const agruparEnTramos = (dias, claveDe, mismoGrupo) => {
  const ordenados = [...dias].sort((a, b) => claveDe(a).localeCompare(claveDe(b)));
  const tramos = [];
  ordenados.forEach((dia) => {
    const clave = claveDe(dia);
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && sumarDiasClave(ultimo.hasta, 1) === clave && mismoGrupo(ultimo.dias[0], dia)) {
      ultimo.hasta = clave;
      ultimo.dias.push(dia);
    } else {
      tramos.push({ desde: clave, hasta: clave, dias: [dia] });
    }
  });
  return tramos;
};

/** Solo http(s) y que el navegador lo entienda como URL. Misma regla que el servidor. */
export const esUrlHttp = (valor) => {
  const texto = String(valor || '').trim();
  if (!/^https?:\/\//i.test(texto)) return false;
  try {
    new URL(texto);
    return true;
  } catch {
    return false;
  }
};

// Atajos para crear la sala en la plataforma: se abre su pagina en otra
// pestaña y el enlace se pega aqui. No se llama a ninguna API externa.
export const PLATAFORMAS_VIDEO = [
  { id: 'meet', nombre: 'Google Meet', url: 'https://meet.google.com/new', patron: /meet\.google\.com/i },
  { id: 'zoom', nombre: 'Zoom', url: 'https://zoom.us/meeting/schedule', patron: /zoom\.(us|com)/i },
  { id: 'teams', nombre: 'Teams', url: 'https://teams.microsoft.com/l/meeting/new', patron: /teams\.(microsoft|live)\.com/i },
];

export const plataformaDeEnlace = (url) => PLATAFORMAS_VIDEO.find((p) => p.patron.test(String(url || '')))?.nombre || null;


// ── Dias de la semana (repeticion semanal) ──────────────────────────────────
// Ids como el servidor: 1 = lunes ... 7 = domingo. Ref: 2024-01-01 es lunes.

/** [{ id, inicial, corto, nombre }] en el idioma: L/lun/lunes, M/Mon/Monday... */
export const diasSemanaLocale = (locale) => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(2024, 0, 1 + i, 12);
  return {
    id: i + 1,
    inicial: d.toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
    corto: d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''),
    nombre: d.toLocaleDateString(locale, { weekday: 'long' }),
  };
});

/** "lunes y miércoles" / "Monday, Wednesday and Friday". `formato`: 'nombre' | 'corto'. */
export const textoDiasSemana = (ids, locale, formato = 'nombre') => {
  const dias = diasSemanaLocale(locale);
  const nombres = [...ids].sort((a, b) => a - b).map((id) => dias[id - 1]?.[formato]).filter(Boolean);
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(nombres);
  } catch {
    return nombres.join(', ');
  }
};

/** Dia de la semana (1-7) de una clave 'YYYY-MM-DD'. */
export const diaSemanaClave = (clave) => {
  const [anio, mes, dia] = String(clave).split('-').map(Number);
  const d = new Date(anio, mes - 1, dia, 12).getDay();
  return d === 0 ? 7 : d;
};

/**
 * Claves del rango [desde, hasta] que caen en `diasSemana` (todas si viene
 * vacio). Mismo criterio que el servidor al crear los dias.
 */
export const clavesDelRango = (desde, hasta, diasSemana = []) => {
  const claves = [];
  if (!desde || !hasta || hasta < desde) return claves;
  for (let k = desde, i = 0; k <= hasta && i < 400; k = sumarDiasClave(k, 1), i += 1) {
    if (!diasSemana.length || diasSemana.includes(diaSemanaClave(k))) claves.push(k);
  }
  return claves;
};
