const prisma = require('../lib/prisma');
const { registrarActividad } = require('../utils/logger');
const { configEnCache } = require('../services/configuracion.service');
const { esAdmin, puedeAdministrarProyecto, puedeVerProyecto, cargarProyectoVisible } = require('../utils/permissions.utils');

const selectProyectoVisible = { id: true, nombre: true, area: true, creadorId: true, miembros: { select: { id: true } } };

// Carga una tarea con lo minimo de su proyecto que necesita `puedeVerProyecto`
// y aplica la regla unica de lectura. Devuelve { tarea, permitido }.
// (Mismo helper en adjuntos.controller; candidato a permissions.utils.)
const cargarTareaVisible = async (usuario, tareaId) => {
  const id = Number(tareaId);
  if (!Number.isInteger(id)) return { tarea: null, permitido: false };
  const tarea = await prisma.tarea.findUnique({
    where: { id },
    select: {
      id: true,
      titulo: true,
      proyectoId: true,
      asignadoId: true,
      creadorId: true,
      asignados: { select: { id: true } },
      proyecto: { select: selectProyectoVisible },
    },
  });
  if (!tarea) return { tarea: null, permitido: false };
  return { tarea, permitido: await puedeVerProyecto(prisma, usuario, tarea.proyecto) };
};

const listar = async (req, res) => {
  const { id: parentId } = req.params;
  const isTarea = req.baseUrl.includes('tareas');

  try {
    // Misma regla de lectura que el resto de datos del proyecto: antes solo
    // se validaba a los ADMIN y un MIEMBRO podia leer cualquier proyecto.
    if (isTarea) {
      const { tarea, permitido } = await cargarTareaVisible(req.usuario, parentId);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para ver comentarios de esta tarea' });
    } else {
      const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, parentId);
      if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para ver comentarios de este proyecto' });
    }

    const comentarios = await prisma.comentario.findMany({
      where: isTarea ? { tareaId: Number(parentId) } : { proyectoId: Number(parentId) },
      orderBy: { creadoEn: 'asc' },
      include: {
        autor: {
          select: { id: true, nombre: true, area: true }
        }
      }
    });
    res.json({ comentarios });
  } catch (error) {
    console.error('[comentarios.listar]', error);
    res.status(500).json({ error: 'Error al obtener los comentarios' });
  }
};

// Avisa a todos los responsables de la tarea (principal + co-asignados) y a
// quien la creo, sin notificar al propio autor del comentario. Nunca lanza:
// el comentario ya esta guardado y no debe fallar por una notificacion.
const notificarComentarioEnTarea = async (tarea, autor) => {
  const destinatarios = new Set([
    tarea.asignadoId,
    ...(tarea.asignados || []).map((u) => u.id),
    tarea.creadorId,
  ]);
  destinatarios.delete(null);
  destinatarios.delete(undefined);
  destinatarios.delete(autor.id);

  if (destinatarios.size === 0 || !configEnCache().avisos.comentarios) return;

  try {
    await prisma.notificacion.createMany({
      data: [...destinatarios].map((usuarioId) => ({
        usuarioId,
        mensaje: `${autor.nombre} comentó en tu tarea: "${tarea.titulo}"`,
        tipo: 'ESTADO',
        tareaId: tarea.id,
        proyectoId: tarea.proyectoId,
        actorNombre: autor.nombre,
      })),
    });
  } catch (error) {
    console.error('[comentarios.notificar]', error);
  }
};

const crear = async (req, res) => {
  const { id: parentId } = req.params;
  const { contenido } = req.body;
  const isTarea = req.baseUrl.includes('tareas');

  if (!contenido || typeof contenido !== 'string' || contenido.trim() === '') {
    return res.status(400).json({ error: 'El contenido del comentario es requerido' });
  }

  try {
    let proyectoId = null;
    let tituloRef = '';
    let tareaObjetivo = null;

    if (isTarea) {
      const { tarea, permitido } = await cargarTareaVisible(req.usuario, parentId);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para comentar en este proyecto' });
      tareaObjetivo = tarea;
      proyectoId = tarea.proyectoId;
      tituloRef = `la tarea "${tarea.titulo}"`;
    } else {
      const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, parentId);
      if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para comentar en este proyecto' });
      proyectoId = proyecto.id;
      tituloRef = `el proyecto "${proyecto.nombre}"`;
    }

    const comentario = await prisma.comentario.create({
      data: {
        contenido: contenido.trim(),
        tareaId: isTarea ? Number(parentId) : null,
        proyectoId: !isTarea ? Number(parentId) : null,
        autorId: req.usuario.id
      },
      include: {
        autor: {
          select: { id: true, nombre: true, area: true }
        }
      }
    });

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      proyectoId,
      'NUEVO_COMENTARIO',
      `${req.usuario.nombre} comentó en ${tituloRef}`,
      isTarea ? Number(parentId) : null
    );

    // Las notificaciones se crean DESPUES de guardar el comentario.
    if (tareaObjetivo) {
      await notificarComentarioEnTarea(tareaObjetivo, req.usuario);
    }

    res.status(201).json({ comentario });
  } catch (error) {
    console.error('[comentarios.crear]', error);
    res.status(500).json({ error: 'Error al crear el comentario' });
  }
};

const eliminar = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID de comentario inválido' });
  try {
    const comentario = await prisma.comentario.findUnique({ where: { id } });

    if (!comentario) return res.status(404).json({ error: 'Comentario no encontrado' });

    let proyectoScope = null;
    if (comentario.tareaId) {
      const tarea = await prisma.tarea.findUnique({
        where: { id: comentario.tareaId },
        include: { proyecto: { select: { area: true } } }
      });
      proyectoScope = tarea?.proyecto || null;
    } else if (comentario.proyectoId) {
      proyectoScope = await prisma.proyecto.findUnique({
        where: { id: comentario.proyectoId },
        select: { area: true }
      });
    }

    const adminPuedeBorrar = esAdmin(req.usuario) && proyectoScope && puedeAdministrarProyecto(req.usuario, proyectoScope);

    // Solo el autor o un ADMIN con alcance pueden borrarlo
    if (comentario.autorId !== req.usuario.id && !adminPuedeBorrar) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });
    }

    await prisma.comentario.delete({ where: { id } });

    // Registrar en el Log de Actividad
    let proyectoId = comentario.proyectoId;
    let desc = 'comentario';

    if (comentario.tareaId) {
      const tarea = await prisma.tarea.findUnique({ where: { id: comentario.tareaId } });
      if (tarea) {
        proyectoId = tarea.proyectoId;
        desc = `comentario en la tarea "${tarea.titulo}"`;
      }
    } else if (comentario.proyectoId) {
      const proyecto = await prisma.proyecto.findUnique({ where: { id: comentario.proyectoId } });
      if (proyecto) desc = `comentario en el proyecto "${proyecto.nombre}"`;
    }

    await registrarActividad(
      req.usuario.id,
      proyectoId,
      'ELIMINAR_COMENTARIO',
      `${req.usuario.nombre} eliminó un ${desc}`,
      comentario.tareaId || null
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[comentarios.eliminar]', error);
    res.status(500).json({ error: 'Error al eliminar el comentario' });
  }
};

module.exports = {
  listar,
  crear,
  eliminar
};
