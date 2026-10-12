/**
 * Utilidades compartidas por las vistas de la agenda (mes, semana, día,
 * lista y equipo). Aquí no hay JSX: solo fechas, colores y reglas de "qué
 * cae en qué día", para que todas las vistas pinten lo mismo.
 */
import { claveDiaLocal, claveDesdeISO, fechaDesdeClave } from '../../utils/fechasLocales';
import { horarioDelDia } from '../../utils/horarioSemana';

// Colores por tipo, siempre desde variables: un hex fijo rompe el modo oscuro.
export const COLORES_TIPO = {
  proyecto: 'var(--color-accent-blue)',
  tarea: 'var(--color-accent-green)',
  evento: 'var(--color-accent-purple)',
  reunion: 'var(--color-accent-pink)',
};

/** Version translucida de un color (sirve con variables CSS, que `#rrggbbaa` no admite). */
export const tenue = (color, porcentaje = 10) => `color-mix(in srgb, ${color} ${porcentaje}%, transparent)`;

// ── Días de la empresa y días personales ────────────────────────────────────
// Los de empresa marcan a todos (o a un área); `especial` solo informa.
export const TIPOS_EMPRESA_NO_LABORALES = ['festivo', 'no_laboral', 'cierre', 'puente'];
// Personales que significan "no está trabajando". Home office y cumpleaños no.
export const TIPOS_PERSONALES_AUSENTE = ['vacacion', 'permiso', 'descanso', 'incapacidad', 'festivo'];

// Pares fondo/texto de los badges: ya están ajustados a contraste en los dos temas.
const BADGE = {
  danger: { bg: 'var(--badge-danger-bg)', fg: 'var(--badge-danger-fg)' },
  warning: { bg: 'var(--badge-warning-bg)', fg: 'var(--badge-warning-fg)' },
  success: { bg: 'var(--badge-success-bg)', fg: 'var(--badge-success-fg)' },
  info: { bg: 'var(--badge-info-bg)', fg: 'var(--badge-info-fg)' },
  neutral: { bg: 'var(--badge-neutral-bg)', fg: 'var(--badge-neutral-fg)' },
};

// Colores de acento (como los eventos) para que se lean como elementos.
const acento = (variable) => ({ bg: tenue(variable, 14), fg: variable });

export const ESTILO_DIA_EMPRESA = {
  festivo: BADGE.danger,
  cierre: BADGE.danger,
  no_laboral: BADGE.neutral,
  puente: BADGE.warning,
  homeoffice: acento('var(--color-accent-green)'),
  especial: BADGE.info,
};

export const ESTILO_DIA_PERSONAL = {
  vacacion: acento('var(--color-accent-green)'),
  permiso: acento('var(--color-accent-warning)'),
  descanso: acento('var(--color-accent-purple)'),
  incapacidad: acento('var(--color-accent-error)'),
  homeoffice: acento('var(--color-accent-blue)'),
  cumpleanos: { bg: tenue('var(--color-accent-pink)', 14), fg: 'var(--color-accent-pink)' },
  festivo: BADGE.danger,
};

export const estiloDiaEmpresa = (tipo) => ESTILO_DIA_EMPRESA[tipo] || BADGE.info;
export const estiloDiaPersonal = (tipo) => ESTILO_DIA_PERSONAL[tipo] || BADGE.neutral;

// 'HH:MM' -> "9:30" / "10" (sin ceros ni minutos en punto), para insignias estrechas
const horaCompacta = (hora, conMinutos = true) => {
  const [h, m] = String(hora || '').split(':');
  const hh = String(Number(h));
  return !conMinutos && m === '00' ? hh : `${hh}:${m}`;
};

/** "10:00–12:00" (o "10–12" compacto) de un día personal por horas; null si es de día completo. */
export const horasDiaPersonal = (dia, compacto = false) => (
  dia?.horaInicio && dia?.horaFin
    ? `${horaCompacta(dia.horaInicio, !compacto)}–${horaCompacta(dia.horaFin, !compacto)}`
    : null
);

/** ¿El día de empresa aplica a esta persona? `area` null = a todos. */
export const diaEmpresaAplica = (dia, areasPersona = null) =>
  !dia?.area || !areasPersona || areasPersona.includes(dia.area);

// ── Fechas ──────────────────────────────────────────────────────────────────

export const LABORALES_DEFAULT = [1, 2, 3, 4, 5];

/** Clave 'YYYY-MM-DD' en hora LOCAL (nunca `toISOString()`, que da el dia en UTC). */
export const getDateKey = (date) => claveDiaLocal(date);

export const capitalizar = (texto = '') => texto.charAt(0).toUpperCase() + texto.slice(1);

export const inicioDelDia = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
export const finDelDia = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/** Date nuevo `dias` días después (a mediodía, lejos de cambios de horario). */
export const sumarDias = (value, dias) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + dias);
  return date;
};

/** Lunes de la semana de `date` (la semana de la agenda empieza en lunes). */
export const inicioDeSemana = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const dia = d.getDay();
  d.setDate(d.getDate() - dia + (dia === 0 ? -6 : 1));
  return d;
};

/** Lista de `n` fechas consecutivas desde `desde` (a mediodía local). */
export const diasDesde = (desde, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + i, 12, 0, 0, 0);
  return d;
});

/** Lunes=1 ... Domingo=7, como `diasLaborales` del horario. */
export const diaSemanaLaboral = (date) => (date.getDay() === 0 ? 7 : date.getDay());

export const getDiasSemana = (locale, formato = 'long') => {
  // Semana empieza Lunes. Ref: 2024-01-01 es Lunes.
  return Array.from({ length: 7 }, (_, i) => capitalizar(new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: formato })));
};

export const formatHora = (value, locale) =>
  new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/** Hora corta para celdas estrechas: "9:00", "14:30" (24 h, sin a.m./p.m.). */
export const formatHoraCorta = (value, locale) =>
  new Date(value).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });

export const horaDecimal = (value, fallback = 0) => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours)) return fallback;
  return hours + (Number.isFinite(minutes) ? minutes / 60 : 0);
};

/** Fecha local a una hora en punto, sin arrastrar los minutos del dia base. */
export const fechaConHora = (date, hora) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hora, 0, 0, 0);

/**
 * Fecha para `?fecha=`. Si viene como 'YYYY-MM-DD' se construye en local:
 * `new Date('2026-10-02')` es medianoche UTC y en Mexico cae en el dia anterior.
 */
export const fechaDesdeParametro = (valor) => {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return fechaDesdeClave(valor);
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

export const normalizarConfigLaboral = (config) => ({
  diasLaborales: config?.diasLaborales || config?.dias_laborales || LABORALES_DEFAULT,
  horaEntrada: config?.horaEntrada || config?.hora_entrada || '09:00',
  horaSalida: config?.horaSalida || config?.hora_salida || '18:00',
  horaComidaInicio: config?.horaComidaInicio || config?.hora_comida_inicio || '14:00',
  horaComidaFin: config?.horaComidaFin || config?.hora_comida_fin || '15:00',
  // Dias con horario distinto al general (p. ej. sabado medio turno)
  horariosPorDia: config?.horariosPorDia || config?.horarios_por_dia || {},
});

// ── Elementos de la agenda ──────────────────────────────────────────────────

// El servidor manda los proyectos como bloque virtual `tipo: 'proyecto'`; el
// titulo "Proyecto: X" se sigue aceptando por si queda algun dato antiguo.
export const esBloqueProyecto = (evento) =>
  evento?.tipo === 'proyecto' ||
  (typeof evento?.titulo === 'string' && evento.titulo.trim().startsWith('Proyecto:'));

export const esEventoRecurrente = (evento) =>
  !!(evento?.esRecurrente || evento?.esOcurrencia || evento?.patronRecurrencia);

/** Tipo para colores y filtros: proyecto | tarea | reunion | evento. */
export const getTipoAgenda = (evento) => {
  if (evento?.tipo === 'tarea') return 'tarea';
  if (evento?.tipo === 'reunion') return 'reunion';
  if (esBloqueProyecto(evento)) return 'proyecto';
  return 'evento';
};

/** Título sin los prefijos "TAREA:" / "Proyecto:" que pone el servidor. */
export const tituloLimpio = (item) => String(item?.titulo || '')
  .replace(/^TAREA:\s*/i, '')
  .replace(/^Proyecto:\s*/i, '')
  .trim();

/** Fondo de un bloque de agenda: el color del servidor o el del tipo. */
export const colorBloque = (evento) => evento?.color || COLORES_TIPO[getTipoAgenda(evento)] || COLORES_TIPO.evento;

/** Color del punto/icono: el del tipo (más legible que el color libre del evento). */
export const colorTipo = (evento) => COLORES_TIPO[getTipoAgenda(evento)] || COLORES_TIPO.evento;

/**
 * Texto legible sobre un color elegido por el usuario (los bloques de evento
 * llevan el color que manda el servidor).
 */
export const textoLegibleSobre = (hex) => {
  // Si el fondo es una variable del tema (no un hex), el texto legible es el
  // mismo que sobre el color primario.
  if (String(hex || '').startsWith('var(')) return 'var(--color-on-primary)';
  const limpio = String(hex || '').replace('#', '');
  if (limpio.length < 6) return '#ffffff';
  const r = parseInt(limpio.slice(0, 2), 16);
  const g = parseInt(limpio.slice(2, 4), 16);
  const b = parseInt(limpio.slice(4, 6), 16);
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.6 ? '#0f172a' : '#ffffff';
};

export const getProyectoIdAgenda = (evento) => {
  const id = evento?.proyecto?.id || evento?.proyectoId;
  if (id) return String(id);
  if (getTipoAgenda(evento) === 'proyecto') {
    const match = String(evento?.id || '').match(/proyecto-(\d+)/i);
    return match ? match[1] : null;
  }
  return null;
};

export const getProyectoNombreAgenda = (evento) => {
  if (evento?.proyecto?.nombre) return evento.proyecto.nombre;
  if (getTipoAgenda(evento) === 'proyecto') return tituloLimpio(evento);
  return null;
};

export const normalizarNombreProyecto = (nombre) => String(nombre || '').trim().toLowerCase();

export const agendaItemPerteneceAProyecto = (evento, proyectoSeleccionado) => {
  if (!proyectoSeleccionado) return true;
  const itemProjectId = getProyectoIdAgenda(evento);
  const itemProjectName = normalizarNombreProyecto(getProyectoNombreAgenda(evento));
  return (
    (itemProjectId && proyectoSeleccionado.ids?.includes(itemProjectId)) ||
    (itemProjectName && itemProjectName === proyectoSeleccionado.key)
  );
};

/** Personas de un evento: el organizador primero y luego los invitados que no rechazaron. */
export const participantesDe = (item) => {
  const lista = [];
  const vistos = new Set();
  const agregar = (persona) => {
    if (!persona?.id || vistos.has(persona.id)) return;
    vistos.add(persona.id);
    lista.push(persona);
  };
  agregar(item?.creador);
  (item?.invitados || []).forEach((invitado) => {
    if (invitado.estado !== 'rechazado') agregar(invitado.usuario);
  });
  return lista;
};

/** Fecha de comparación a mediodía local (null si no es válida). */
export const aFechaComparacion = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
};

/** Claves de inicio y fin (día local) de un elemento. */
export const clavesItem = (item) => ({
  inicio: getDateKey(item.fechaInicio),
  fin: getDateKey(item.fechaFin || item.fechaInicio),
});

export const eventoOcurreEnFecha = (evento, date) => {
  const { inicio, fin } = clavesItem(evento);
  const clave = getDateKey(date);
  return !!inicio && clave >= inicio && clave <= fin;
};

/**
 * Una tarea larga se pinta en su día de inicio, en su día de entrega y en los
 * días laborables de en medio (no en fines de semana ni festivos).
 * `esLaborable(date)` decide eso con el horario y los días marcados.
 */
export const itemAgendaOcurreEnFecha = (evento, date, esLaborable) => {
  if (!eventoOcurreEnFecha(evento, date)) return false;
  if (evento?.tipo !== 'tarea') return true;
  const { inicio, fin } = clavesItem(evento);
  const clave = getDateKey(date);
  if (clave === inicio || clave === fin) return true;
  return esLaborable ? esLaborable(date) : true;
};

/**
 * Orden dentro de un día: proyectos, todo el día, con hora (por hora) y al
 * final las tareas.
 */
const PESO_ORDEN = { proyecto: 0, todoElDia: 1, hora: 2, tarea: 3 };
export const ordenarItemsDia = (items) => [...items].sort((a, b) => {
  const pa = getTipoAgenda(a) === 'proyecto' ? PESO_ORDEN.proyecto : a.tipo === 'tarea' ? PESO_ORDEN.tarea : a.todoElDia ? PESO_ORDEN.todoElDia : PESO_ORDEN.hora;
  const pb = getTipoAgenda(b) === 'proyecto' ? PESO_ORDEN.proyecto : b.tipo === 'tarea' ? PESO_ORDEN.tarea : b.todoElDia ? PESO_ORDEN.todoElDia : PESO_ORDEN.hora;
  if (pa !== pb) return pa - pb;
  return new Date(a.fechaInicio) - new Date(b.fechaInicio);
});

/** Diferencia en días entre dos fechas (por día local). */
export const getDayDiff = (from, to) => {
  const start = aFechaComparacion(from);
  const end = aFechaComparacion(to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
};

/** Agrupa una lista con `fecha` 'YYYY-MM-DD' en un Map clave -> [dias]. */
export const agruparPorClave = (dias = []) => {
  const mapa = new Map();
  dias.forEach((dia) => {
    const clave = claveDesdeISO(dia.fecha);
    if (!clave) return;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(dia);
  });
  return mapa;
};

// ── Rejilla de horas (semana y día) ─────────────────────────────────────────

/**
 * Horario de una fecha segun la configuracion laboral, en horas decimales:
 * { laboral, entrada, salida, comidaInicio, comidaFin, hayComida }. Respeta
 * los dias con horario propio (el sabado de 9 a 14 sin comida...).
 */
export const horarioLaboralDeFecha = (configLaboral, fecha) => {
  const h = horarioDelDia(configLaboral || {}, diaSemanaLaboral(fecha));
  const comidaInicio = horaDecimal(h.comidaInicio, 0);
  const comidaFin = horaDecimal(h.comidaFin, 0);
  return {
    laboral: h.laboral,
    entrada: horaDecimal(h.entrada, 9),
    salida: horaDecimal(h.salida, 18),
    comidaInicio,
    comidaFin,
    hayComida: Boolean(h.comidaInicio && h.comidaFin) && comidaFin > comidaInicio,
  };
};

// Rango base de la rejilla: de la entrada mas temprana a la salida mas tardia
// de los dias laborales a la vista (o del horario general si no hay ninguno).
const getRangoLaboralBase = (configLaboral, fechas = []) => {
  const horarios = fechas.map((fecha) => horarioLaboralDeFecha(configLaboral, fecha)).filter((h) => h.laboral);
  const entrada = horarios.length ? Math.min(...horarios.map((h) => h.entrada)) : horaDecimal(configLaboral?.horaEntrada, 9);
  const salida = horarios.length ? Math.max(...horarios.map((h) => h.salida)) : horaDecimal(configLaboral?.horaSalida, 18);
  const pareceTodoElDia = entrada <= 0 && salida >= 23;
  return {
    inicio: Math.floor(pareceTodoElDia ? 9 : entrada),
    finExclusivo: Math.ceil(pareceTodoElDia ? 18 : salida),
  };
};

/** Horas a mostrar: el horario laboral, ampliado si algún evento cae fuera. */
export const getRangoHorasVisible = (configLaboral, eventos = [], fechas = []) => {
  const rangoBase = getRangoLaboralBase(configLaboral, fechas);
  let inicio = rangoBase.inicio;
  let finExclusivo = rangoBase.finExclusivo;

  const keys = new Set(fechas.map((fecha) => getDateKey(fecha)));
  eventos.forEach((evento) => {
    if (evento.todoElDia || evento.tipo === 'tarea' || esBloqueProyecto(evento)) return;
    const start = new Date(evento.fechaInicio);
    const end = evento.fechaFin ? new Date(evento.fechaFin) : new Date(start.getTime() + 3600000);
    const tocaVisible = keys.size === 0 || keys.has(getDateKey(start)) || keys.has(getDateKey(end));
    if (!tocaVisible) return;
    // Un evento que cruza la medianoche no estira la rejilla a 0-24.
    if (getDateKey(start) !== getDateKey(end)) return;
    inicio = Math.min(inicio, Math.floor(start.getHours() + start.getMinutes() / 60));
    finExclusivo = Math.max(finExclusivo, Math.ceil(end.getHours() + end.getMinutes() / 60));
  });

  inicio = Math.max(0, inicio);
  finExclusivo = Math.min(24, Math.max(inicio + 1, finExclusivo));
  return { inicio, finExclusivo };
};

/**
 * Reparte en columnas los eventos que se solapan (como Google Calendar): cada
 * grupo de eventos encadenados comparte el ancho a partes iguales.
 * Entrada: [{ inicio, fin, ... }] en horas decimales. Añade `columna` y `columnas`.
 */
export const repartirSolapes = (bloques) => {
  const ordenados = [...bloques].sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
  const resultado = [];
  let grupo = [];
  let finGrupo = -1;

  const cerrarGrupo = () => {
    const columnasFin = [];
    grupo.forEach((bloque) => {
      let col = columnasFin.findIndex((fin) => fin <= bloque.inicio);
      if (col === -1) { col = columnasFin.length; columnasFin.push(bloque.fin); } else columnasFin[col] = bloque.fin;
      bloque.columna = col;
    });
    grupo.forEach((bloque) => { bloque.columnas = columnasFin.length; resultado.push(bloque); });
    grupo = [];
  };

  ordenados.forEach((bloque) => {
    if (grupo.length && bloque.inicio >= finGrupo) cerrarGrupo();
    grupo.push({ ...bloque });
    finGrupo = Math.max(finGrupo, bloque.fin);
  });
  if (grupo.length) cerrarGrupo();
  return resultado;
};

/**
 * Props para que un elemento que no es <button> responda al teclado igual que
 * al raton (Enter o Espacio).
 */
export const propsClicable = (onClick) => ({
  role: 'button',
  tabIndex: 0,
  onClick,
  onKeyDown: (ev) => {
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onClick(ev);
    }
  },
});

export { claveDiaLocal, claveDesdeISO, fechaDesdeClave };
