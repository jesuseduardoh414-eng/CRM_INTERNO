const prisma = require('../lib/prisma');
const { registrarActividad } = require('../utils/logger');
const { puedeAdministrarProyecto, cargarProyectoVisible, cargarTareaVisible: cargarTarea } = require('../utils/permissions.utils');
const { subirArchivo } = require('../utils/blob.utils');
const { nombreUtf8 } = require('../utils/nombreArchivo.utils');
const driveProyectos = require('../services/driveProyectos.service');
const papelera = require('../services/papelera.service');

const getEntityType = (req) => {
  if (req.baseUrl.includes('agenda')) return 'agenda';
  if (req.baseUrl.includes('proyectos')) return 'proyectos';
  return 'tareas';
};

const getFilesFromRequest = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files).flat();
  }
  return [];
};

const canAccessEvento = (evento, usuarioId) => (
  evento.usuarioId === usuarioId ||
  evento.creadoPorId === usuarioId ||
  evento.esGlobal ||
  (evento.invitados || []).some((invitado) => invitado.usuarioId === usuarioId)
);

const canManageEvento = (evento, usuarioId) => (
  evento.usuarioId === usuarioId || evento.creadoPorId === usuarioId
);

// Regla unica de lectura de una tarea (permissions.utils). Devuelve { tarea, permitido }.
const cargarTareaVisible = (usuario, tareaId) => cargarTarea(prisma, usuario, tareaId);

const buildActivityPayload = async ({ entityType, parentId, reqUsuario, adjunto, tituloRef }) => {
  if (entityType === 'tareas') {
    const tarea = await prisma.tarea.findUnique({ where: { id: Number(parentId) } });
    return {
      proyectoId: tarea?.proyectoId || null,
      tareaId: Number(parentId),
      descripcion: `${reqUsuario.nombre} subio ${adjunto.length > 1 ? `${adjunto.length} archivos` : `el archivo "${adjunto[0].nombre}"`} a ${tituloRef}`,
    };
  }

  if (entityType === 'proyectos') {
    return {
      proyectoId: Number(parentId),
      tareaId: null,
      descripcion: `${reqUsuario.nombre} subio ${adjunto.length > 1 ? `${adjunto.length} archivos` : `el archivo "${adjunto[0].nombre}"`} a ${tituloRef}`,
    };
  }

  const evento = await prisma.evento.findUnique({
    where: { id: String(parentId) },
    select: { proyectoId: true, titulo: true },
  });

  if (!evento?.proyectoId) return null;

  return {
    proyectoId: evento.proyectoId,
    tareaId: null,
    descripcion: `${reqUsuario.nombre} subio ${adjunto.length > 1 ? `${adjunto.length} archivos` : `el archivo "${adjunto[0].nombre}"`} al evento "${evento.titulo}"`,
  };
};

const listar = async (req, res) => {
  const { id: parentId } = req.params;
  const entityType = getEntityType(req);

  try {
    // Misma regla de lectura que el resto de datos del proyecto
    // (`puedeVerProyecto`): antes solo se validaba a los ADMIN y cualquier
    // MIEMBRO podia leer los adjuntos de cualquier proyecto cambiando el id.
    if (entityType === 'tareas') {
      const { tarea, permitido } = await cargarTareaVisible(req.usuario, parentId);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para ver adjuntos de esta tarea' });
    } else if (entityType === 'proyectos') {
      const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, parentId);
      if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para ver adjuntos de este proyecto' });
    } else {
      const evento = await prisma.evento.findUnique({
        where: { id: String(parentId) },
        include: { invitados: { select: { usuarioId: true } } },
      });
      if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
      if (!canAccessEvento(evento, req.usuario.id)) {
        return res.status(403).json({ error: 'No tienes permiso para ver adjuntos de este evento' });
      }
    }

    // Lo que se agrego, renombro o borro en las carpetas de Drive desde la
    // ultima vez (espera unos segundos como mucho).
    if (entityType !== 'agenda') await driveProyectos.sincronizarSiHaceFalta();

    const where = entityType === 'tareas'
      ? { tareaId: Number(parentId) }
      : entityType === 'proyectos'
        ? { proyectoId: Number(parentId), tareaId: null, eventoId: null }
        : { eventoId: String(parentId) };

    const adjuntos = await prisma.adjunto.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        usuario: { select: { id: true, nombre: true } },
      },
    });

    res.json({ adjuntos });
  } catch (error) {
    console.error('[adjuntos.listar]', error);
    res.status(500).json({ error: 'Error al obtener los adjuntos' });
  }
};

const subir = async (req, res) => {
  const { id: parentId } = req.params;
  const entityType = getEntityType(req);
  const files = getFilesFromRequest(req);

  if (files.length === 0) {
    return res.status(400).json({ error: 'No se subio ningun archivo' });
  }

  try {
    let createBase = {};
    let tituloRef = '';

    if (entityType === 'tareas') {
      const { tarea, permitido } = await cargarTareaVisible(req.usuario, parentId);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para subir archivos a esta tarea' });
      tituloRef = `la tarea "${tarea.titulo}"`;
      createBase = { tareaId: tarea.id, proyectoId: null, eventoId: null };
    } else if (entityType === 'proyectos') {
      const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, parentId);
      if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para subir archivos a este proyecto' });
      tituloRef = `el proyecto "${proyecto.nombre}"`;
      createBase = { proyectoId: proyecto.id, tareaId: null, eventoId: null };
    } else {
      const evento = await prisma.evento.findUnique({
        where: { id: String(parentId) },
        include: { invitados: { select: { usuarioId: true } } },
      });
      if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
      if (!canManageEvento(evento, req.usuario.id)) {
        return res.status(403).json({ error: 'No tienes permiso para subir archivos a este evento' });
      }
      tituloRef = `el evento "${evento.titulo}"`;
      createBase = { eventoId: String(parentId), tareaId: null, proyectoId: null };
    }

    const createdAdjuntos = [];
    for (const file of files) {
      const nombre = nombreUtf8(file.originalname);
      // Tareas y proyectos: a su carpeta de Drive con su nombre real. Eventos: como antes.
      const { url, driveArchivoId } = createBase.eventoId
        ? { url: await subirArchivo(file, 'adjuntos'), driveArchivoId: null }
        : await driveProyectos.guardarAdjunto(file, nombre, { tareaId: createBase.tareaId, proyectoId: createBase.proyectoId });

      const adjunto = await prisma.adjunto.create({
        data: {
          nombre,
          url,
          driveArchivoId,
          tipo: file.mimetype,
          tamano: file.size,
          usuarioId: req.usuario.id,
          ...createBase,
        },
        include: {
          usuario: { select: { id: true, nombre: true } },
        },
      });
      createdAdjuntos.push(adjunto);
    }

    const actividad = await buildActivityPayload({
      entityType,
      parentId,
      reqUsuario: req.usuario,
      adjunto: createdAdjuntos,
      tituloRef,
    });

    if (actividad?.proyectoId) {
      await registrarActividad(
        req.usuario.id,
        actividad.proyectoId,
        'SUBIR_ARCHIVO',
        actividad.descripcion,
        actividad.tareaId
      );
    }

    res.status(201).json({
      adjunto: createdAdjuntos[0],
      adjuntos: createdAdjuntos,
    });
  } catch (error) {
    console.error('[adjuntos.subir]', error);
    res.status(500).json({ error: 'Error al subir el archivo' });
  }
};

const eliminar = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID de adjunto inválido' });
  try {
    const adjunto = await prisma.adjunto.findUnique({
      where: { id },
      include: {
        tarea: true,
        evento: {
          include: {
            invitados: { select: { usuarioId: true } },
          },
        },
      },
    });

    if (!adjunto) return res.status(404).json({ error: 'Archivo no encontrado' });

    let proyectoScope = null;
    if (adjunto.tarea) {
      proyectoScope = await prisma.proyecto.findUnique({
        where: { id: adjunto.tarea.proyectoId },
        select: { area: true, creadorId: true, miembros: { select: { id: true } } },
      });
    } else if (adjunto.proyectoId) {
      proyectoScope = await prisma.proyecto.findUnique({
        where: { id: adjunto.proyectoId },
        select: { area: true, creadorId: true, miembros: { select: { id: true } } },
      });
    }

    // Modera quien puede editar el proyecto ("proyectos.editar").
    const adminPuedeBorrar = proyectoScope && puedeAdministrarProyecto(req.usuario, proyectoScope);
    const puedeBorrarEvento = adjunto.evento && canManageEvento(adjunto.evento, req.usuario.id);

    if (adjunto.usuarioId !== req.usuario.id && !adminPuedeBorrar && !puedeBorrarEvento) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo' });
    }

    // A la papelera del CRM (services/papelera.service.js): la fila se borra
    // pero queda una copia y el archivo se mueve a la carpeta Papelera.
    let donde = null;
    if (adjunto.tarea) donde = `Tarea: ${adjunto.tarea.titulo}`;
    else if (adjunto.evento) donde = `Evento: ${adjunto.evento.titulo}`;
    else if (adjunto.proyectoId) {
      const p = await prisma.proyecto.findUnique({ where: { id: adjunto.proyectoId }, select: { nombre: true } });
      donde = `Proyecto: ${p?.nombre || adjunto.proyectoId}`;
    }
    const { tarea: _tarea, evento: _evento, ...fila } = adjunto;
    await papelera.conPapelera({
      tipo: 'adjunto', modulo: 'archivos', entidadId: id, nombre: adjunto.nombre, contexto: donde,
      datos: fila, archivos: [papelera.archivoDeAdjunto(adjunto)],
    }, () => prisma.adjunto.delete({ where: { id } }));

    let proyectoId = adjunto.proyectoId;
    let desc = `archivo "${adjunto.nombre}"`;

    if (adjunto.tarea) {
      proyectoId = adjunto.tarea.proyectoId;
      desc += ` de la tarea "${adjunto.tarea.titulo}"`;
    } else if (adjunto.proyectoId) {
      const proyecto = await prisma.proyecto.findUnique({ where: { id: adjunto.proyectoId } });
      if (proyecto) desc += ` del proyecto "${proyecto.nombre}"`;
    } else if (adjunto.evento) {
      proyectoId = adjunto.evento.proyectoId;
      desc += ` del evento "${adjunto.evento.titulo}"`;
    }

    if (proyectoId) {
      await registrarActividad(
        req.usuario.id,
        proyectoId,
        'ELIMINAR_ARCHIVO',
        `${req.usuario.nombre} elimino el ${desc}`,
        adjunto.tareaId || null
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[adjuntos.eliminar]', error);
    res.status(500).json({ error: 'Error al eliminar el archivo' });
  }
};

module.exports = {
  listar,
  subir,
  eliminar,
  canAccessEvento,
};
