const prisma = require('../lib/prisma');

/**
 * Registra una actividad en el log de auditoría
 * @param {number} usuarioId - ID del usuario que realiza la acción
 * @param {number} proyectoId - ID del proyecto asociado
 * @param {string} accion - Tipo de acción (e.g., "CREAR_TAREA")
 * @param {string} descripcion - Descripción legible
 */
const registrarActividad = async (usuarioId, proyectoId, accion, descripcion, tareaId = null) => {
  try {
    await prisma.logActividad.create({
      data: {
        usuarioId,
        proyectoId,
        accion,
        descripcion,
        tareaId
      }
    });
  } catch (error) {
    console.error('Error al registrar actividad:', error);
  }
};

module.exports = { registrarActividad };
