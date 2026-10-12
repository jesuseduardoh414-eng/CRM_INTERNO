/**
 * Horario laboral por dia de la semana.
 *
 * El horario general (entrada, salida y comida) vale para todos los dias
 * laborales; `horariosPorDia` guarda solo los dias que son distintos, por
 * ejemplo el sabado de medio turno: { "6": { entrada: '09:00', salida: '14:00',
 * comidaInicio: null, comidaFin: null } }. Claves 1..7 (1 = lunes); sin comida
 * = null en las dos horas.
 */
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Limpia lo que manda el cliente. Devuelve { horarios } o { error }.
 * Ignora dias fuera de 1..7; un dia con datos invalidos es un error claro.
 */
const validarHorariosPorDia = (entrada) => {
  if (entrada === undefined || entrada === null) return { horarios: {} };
  if (typeof entrada !== 'object' || Array.isArray(entrada)) return { error: 'horarios_por_dia debe ser un objeto' };
  const horarios = {};
  for (const [clave, valor] of Object.entries(entrada)) {
    const dia = Number(clave);
    if (!Number.isInteger(dia) || dia < 1 || dia > 7 || !valor) continue;
    const { entrada: ini, salida: fin } = valor;
    if (!REGEX_HORA.test(String(ini || '')) || !REGEX_HORA.test(String(fin || '')) || fin <= ini) {
      return { error: 'Cada horario por día necesita entrada y salida válidas (la salida después de la entrada)' };
    }
    let comidaInicio = valor.comidaInicio || null;
    let comidaFin = valor.comidaFin || null;
    if (comidaInicio || comidaFin) {
      if (!REGEX_HORA.test(String(comidaInicio || '')) || !REGEX_HORA.test(String(comidaFin || '')) || comidaFin <= comidaInicio) {
        return { error: 'La comida de un horario por día no es válida' };
      }
    } else {
      comidaInicio = null;
      comidaFin = null;
    }
    horarios[String(dia)] = { entrada: ini, salida: fin, comidaInicio, comidaFin };
  }
  return { horarios };
};

/**
 * Horario que aplica a un dia (1..7) segun la configuracion de la persona o
 * de la empresa: { laboral, entrada, salida, comidaInicio, comidaFin }.
 */
const horarioDelDia = (config, dia) => {
  const laboral = (config.diasLaborales || []).map(Number).includes(Number(dia));
  const propio = config.horariosPorDia?.[String(dia)];
  if (propio) return { laboral, ...propio };
  return {
    laboral,
    entrada: config.horaEntrada,
    salida: config.horaSalida,
    comidaInicio: config.horaComidaInicio || null,
    comidaFin: config.horaComidaFin || null,
  };
};

module.exports = { validarHorariosPorDia, horarioDelDia };
