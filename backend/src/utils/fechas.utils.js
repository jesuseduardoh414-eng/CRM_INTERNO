// Limites de dia en la zona horaria de la empresa.
//
// El servidor corre en UTC (Vercel no define TZ), asi que `setHours(0,0,0,0)`
// marcaba el inicio del dia *UTC*: las 00:00 UTC son las 18:00 del dia anterior
// en Mexico. Una tarea cerrada a las 7 de la noche contaba como del dia
// siguiente. Estas funciones fijan el corte donde de verdad cambia el dia.
//
// La zona sale del panel de configuracion (operacion.zonaHoraria, por defecto
// America/Mexico_City). El desfase se calcula con Intl para cada instante, asi
// que las zonas con horario de verano (Madrid, Santiago, EE. UU.) tambien
// cortan el dia en el momento correcto. Los nombres "...Mexico" se conservan
// por compatibilidad: hoy significan "en la zona de la empresa".

const ZONA_POR_DEFECTO = 'America/Mexico_City';

// Lectura perezosa para no crear un ciclo de require con la configuracion.
const zonaHoraria = () => {
  try {
    // eslint-disable-next-line global-require
    return require('../services/configuracion.service').configEnCache().operacion?.zonaHoraria || ZONA_POR_DEFECTO;
  } catch (_error) {
    return ZONA_POR_DEFECTO;
  }
};

const formateadores = new Map();
const formateador = (zona) => {
  if (!formateadores.has(zona)) {
    formateadores.set(zona, new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formateadores.get(zona);
};

/**
 * Milisegundos que hay que SUMAR a una hora local para obtener UTC en ese
 * instante (Mexico: +6 h). Positivo al oeste de Greenwich.
 */
const desfaseMs = (instante = Date.now(), zona = zonaHoraria()) => {
  const t = new Date(instante).getTime();
  const partes = Object.fromEntries(formateador(zona).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const localComoUtc = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  // Redondeo al minuto: se descartan los milisegundos del instante.
  return Math.round((t - localComoUtc) / 60000) * 60000;
};

/** Partes de la fecha civil (en la zona de la empresa) de un instante. */
const partesDiaMexico = (instante = new Date()) => {
  const t = new Date(instante).getTime();
  const local = new Date(t - desfaseMs(t));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate() };
};

/**
 * Instante UTC de una hora local de un dia civil (en la zona de la empresa).
 * Se ajusta dos veces para acertar tambien el dia del cambio de horario.
 */
const instanteLocal = ({ year, month, day }, hora = 0, minuto = 0) => {
  const comoUtc = Date.UTC(year, month, day, hora, minuto, 0, 0);
  let t = comoUtc + desfaseMs(comoUtc);
  t = comoUtc + desfaseMs(t);
  return new Date(t);
};

/**
 * Rango [inicio, fin] en UTC que cubre un dia natural de la empresa.
 * `fecha` puede ser 'YYYY-MM-DD'; si no viene, se usa el dia de hoy.
 */
const rangoDiaMexico = (fecha) => {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? new Date(`${fecha}T12:00:00.000Z`) // mediodia UTC: mismo dia civil en America
    : new Date();

  const { year, month, day } = partesDiaMexico(base);
  return {
    inicio: instanteLocal({ year, month, day }, 0),
    fin: new Date(instanteLocal({ year, month, day: day + 1 }, 0).getTime() - 1),
  };
};

/** 'YYYY-MM-DD' del dia (en la zona de la empresa) de un instante. */
const claveDiaMexico = (instante = new Date()) => {
  const { year, month, day } = partesDiaMexico(instante);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * Instante que representa el mediodia (12:00 local) de un dia civil.
 * Es la hora "neutra" con la que se guardan fechas que solo importan como dia.
 */
const mediodiaMexico = (partes) => instanteLocal(partes, 12);

/**
 * Rango [inicio, fin] en UTC de la semana (lunes 00:00 a domingo
 * 23:59:59.999) que contiene un dia dado. `fecha` puede ser 'YYYY-MM-DD', un
 * instante, o nada (hoy).
 */
const rangoSemanaMexico = (fecha) => {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? new Date(`${fecha}T12:00:00.000Z`)
    : (fecha ? new Date(fecha) : new Date());

  const { year, month, day } = partesDiaMexico(base);
  // getUTCDay sobre el dia civil: 0 = domingo. Distancia hasta el lunes anterior.
  const diaSemana = new Date(Date.UTC(year, month, day)).getUTCDay();
  const haciaLunes = (diaSemana + 6) % 7;

  return {
    inicio: instanteLocal({ year, month, day: day - haciaLunes }, 0),
    fin: new Date(instanteLocal({ year, month, day: day - haciaLunes + 7 }, 0).getTime() - 1),
  };
};

module.exports = {
  ZONA_POR_DEFECTO,
  zonaHoraria,
  desfaseMs,
  instanteLocal,
  partesDiaMexico,
  rangoDiaMexico,
  claveDiaMexico,
  mediodiaMexico,
  rangoSemanaMexico,
};
