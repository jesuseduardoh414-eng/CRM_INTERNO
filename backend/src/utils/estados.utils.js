// Fuente unica de verdad para los estados de un proyecto.
//
// Antes el estado era texto libre: el controlador guardaba lo que llegara y el
// frontend tenia su propio catalogo duplicado en tres archivos. Aqui queda la
// lista cerrada y la normalizacion de los nombres viejos.

const ESTADOS_PROYECTO = ['ACTIVO', 'INACTIVO', 'TERMINADO', 'ARCHIVADO'];

const ESTADO_PROYECTO_DEFAULT = 'ACTIVO';

// Nombres antiguos que pueden seguir vivos en la base o llegar de un cliente
// que aun no se ha recargado. Se traducen en vez de rechazarse.
const ALIAS_ESTADO_PROYECTO = {
  EN_PAUSA: 'INACTIVO',
  PAUSA: 'INACTIVO',
  PAUSADO: 'INACTIVO',
  PENDIENTE: 'INACTIVO',
  CERRADO: 'TERMINADO',
  FINALIZADO: 'TERMINADO',
  HECHO: 'TERMINADO',
};

// Estados que se consideran cerrados: no ocupan agenda ni cuentan en el inicio.
// Se incluyen los nombres viejos para que los filtros sigan siendo correctos
// aunque quede algun registro sin migrar.
const ESTADOS_PROYECTO_OCULTOS = ['TERMINADO', 'ARCHIVADO', 'CERRADO', 'FINALIZADO', 'HECHO'];

const normalizarEstadoProyecto = (valor) => {
  const bruto = String(valor || '').trim().toUpperCase();
  if (!bruto) return ESTADO_PROYECTO_DEFAULT;
  const normalizado = ALIAS_ESTADO_PROYECTO[bruto] || bruto;
  return ESTADOS_PROYECTO.includes(normalizado) ? normalizado : ESTADO_PROYECTO_DEFAULT;
};

const esEstadoProyectoValido = (valor) => {
  const bruto = String(valor || '').trim().toUpperCase();
  return ESTADOS_PROYECTO.includes(ALIAS_ESTADO_PROYECTO[bruto] || bruto);
};

module.exports = {
  ESTADOS_PROYECTO,
  ESTADO_PROYECTO_DEFAULT,
  ESTADOS_PROYECTO_OCULTOS,
  ALIAS_ESTADO_PROYECTO,
  normalizarEstadoProyecto,
  esEstadoProyectoValido,
};
