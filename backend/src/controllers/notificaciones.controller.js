const prisma = require('../lib/prisma');

// Para notificaciones antiguas que no guardaron `actorNombre`: se deduce del
// texto. Las nuevas ya traen el campo en la fila y no pasan por aqui.
const extraerActorNombre = (mensaje = '') => {
  const patrones = [
    /^(.*?) te ha invitado a:/i,
    /^(.*?) coment[oó] en tu tarea:/i,
  ];

  for (const patron of patrones) {
    const match = mensaje.match(patron);
    if (match?.[1]) return match[1].trim();
  }

  return null;
};

const listar = async (req, res) => {
  try {
    const notificacionesBase = await prisma.notificacion.findMany({
      where: { usuarioId: req.usuario.id },
      orderBy: { creadaEn: 'desc' },
      take: 20,
    });

    const tareaIds = [...new Set(
      notificacionesBase
        .map((notificacion) => notificacion.tareaId)
        .filter((value) => Number.isInteger(value))
    )];

    const tareas = tareaIds.length > 0
      ? await prisma.tarea.findMany({
          where: { id: { in: tareaIds } },
          select: {
            id: true,
            titulo: true,
            proyectoId: true,
            creadorId: true,
            asignadoId: true,
            creador: {
              select: { id: true, nombre: true },
            },
            proyecto: {
              select: { id: true, nombre: true },
            },
          },
        })
      : [];

    const tareasMap = new Map(tareas.map((tarea) => [tarea.id, tarea]));

    // Proyectos referenciados directamente en la fila (`proyectoId`), para
    // notificaciones que no cuelgan de una tarea.
    const proyectoIds = [...new Set(
      notificacionesBase
        .map((notificacion) => notificacion.proyectoId)
        .filter((value) => Number.isInteger(value))
    )];

    const proyectos = proyectoIds.length > 0
      ? await prisma.proyecto.findMany({
          where: { id: { in: proyectoIds } },
          select: { id: true, nombre: true },
        })
      : [];

    const proyectosMap = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto]));

    const notificaciones = notificacionesBase.map((notificacion) => {
      const tarea = notificacion.tareaId ? tareasMap.get(notificacion.tareaId) || null : null;
      const proyecto = (notificacion.proyectoId && proyectosMap.get(notificacion.proyectoId))
        || tarea?.proyecto
        || null;
      return {
        ...notificacion,
        tarea,
        proyecto,
        // Se prefieren los campos guardados en la fila; el regex y el creador
        // de la tarea quedan solo como respaldo para filas antiguas.
        proyectoId: notificacion.proyectoId ?? tarea?.proyectoId ?? null,
        eventoId: notificacion.eventoId ?? null,
        actorNombre: notificacion.actorNombre
          || extraerActorNombre(notificacion.mensaje)
          || tarea?.creador?.nombre
          || null,
      };
    });

    res.json({ notificaciones });
  } catch (error) {
    console.error('[notificaciones.listar]', error);
    res.status(500).json({ error: 'Error al obtener las notificaciones' });
  }
};

const marcarLeida = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notificacion.updateMany({
      where: { id: Number(id), usuarioId: req.usuario.id },
      data: { leida: true }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[notificaciones.marcarLeida]', error);
    res.status(500).json({ error: 'Error al actualizar la notificación' });
  }
};

const marcarTodasLeidas = async (req, res) => {
  try {
    await prisma.notificacion.updateMany({
      where: { usuarioId: req.usuario.id, leida: false },
      data: { leida: true }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[notificaciones.marcarTodasLeidas]', error);
    res.status(500).json({ error: 'Error al actualizar las notificaciones' });
  }
};

const eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notificacion.deleteMany({
      where: { id: Number(id), usuarioId: req.usuario.id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[notificaciones.eliminar]', error);
    res.status(500).json({ error: 'Error al eliminar la notificación' });
  }
};

module.exports = {
  listar,
  marcarLeida,
  marcarTodasLeidas,
  eliminar
};
