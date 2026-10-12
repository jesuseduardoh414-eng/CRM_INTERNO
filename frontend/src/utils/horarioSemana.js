// Horario laboral por dia de la semana (mismo criterio que el servidor en
// backend/src/utils/horarios.utils.js).
//
// El horario general (entrada, salida y comida) vale para todos los dias
// laborales; `horariosPorDia` guarda solo los dias distintos, con claves
// '1'..'7' (1 = lunes): { '6': { entrada: '09:00', salida: '14:00',
// comidaInicio: null, comidaFin: null } }. Sin comida = null en las dos horas.

export const DIAS_SEMANA_IDS = [1, 2, 3, 4, 5, 6, 7];

/** Horario general de una configuracion (camelCase) con la forma de un dia. */
export const horarioGeneral = (config) => ({
  entrada: config?.horaEntrada,
  salida: config?.horaSalida,
  comidaInicio: config?.horaComidaInicio || null,
  comidaFin: config?.horaComidaFin || null,
});

/**
 * Horario que aplica a un dia (1..7): { laboral, entrada, salida,
 * comidaInicio, comidaFin, propio }. `propio` = el dia tiene horario distinto.
 */
export const horarioDelDia = (config, dia) => {
  const laboral = (config?.diasLaborales || []).map(Number).includes(Number(dia));
  const propio = config?.horariosPorDia?.[String(dia)];
  if (propio) return { laboral, ...propio, propio: true };
  return { laboral, ...horarioGeneral(config), propio: false };
};

export const mismoHorario = (a, b) => (
  a?.entrada === b?.entrada
  && a?.salida === b?.salida
  && (a?.comidaInicio || null) === (b?.comidaInicio || null)
  && (a?.comidaFin || null) === (b?.comidaFin || null)
);

/**
 * Deja en `horariosPorDia` solo los dias laborales que de verdad difieren del
 * general, en orden y con las claves siempre igual (asi comparar con
 * JSON.stringify no da cambios fantasma).
 */
export const limpiarHorariosPorDia = (config) => {
  const general = horarioGeneral(config);
  const laborales = (config?.diasLaborales || []).map(Number);
  const limpio = {};
  DIAS_SEMANA_IDS.forEach((dia) => {
    const propio = config?.horariosPorDia?.[String(dia)];
    if (!propio || !laborales.includes(dia) || mismoHorario(propio, general)) return;
    const conComida = Boolean(propio.comidaInicio && propio.comidaFin);
    limpio[String(dia)] = {
      entrada: propio.entrada,
      salida: propio.salida,
      comidaInicio: conComida ? propio.comidaInicio : null,
      comidaFin: conComida ? propio.comidaFin : null,
    };
  });
  return limpio;
};
