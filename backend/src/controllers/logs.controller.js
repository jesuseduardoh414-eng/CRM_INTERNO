const prisma = require('../lib/prisma');
const { esAdmin, cargarProyectoVisible } = require('../utils/permissions.utils');
const { contiene } = require('../utils/paginacion.utils');

const listarPorProyecto = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });

  try {
    // Misma regla de lectura que el resto de datos del proyecto: antes solo
    // se validaba a los ADMIN y un MIEMBRO podia leer el historial de
    // cualquier proyecto cambiando el id.
    const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, proyectoId);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!permitido) {
      return res.status(403).json({ error: 'No tienes permiso para ver el historial de este proyecto' });
    }

    const usuarioEsAdmin = esAdmin(req.usuario);
    const accionesSoloDeTarea = [
      'CREAR_TAREA',
      'EDITAR_TAREA',
      'ELIMINAR_TAREA',
      'CAMBIO_ESTADO'
    ];

    const logs = await prisma.logActividad.findMany({
      where: {
        proyectoId,
        ...(usuarioEsAdmin ? {} : {
          OR: [
            {
              tareaId: null,
              accion: { notIn: accionesSoloDeTarea },
              NOT: { descripcion: contiene('tarea') }
            },
            { tarea: { asignadoId: null } },
            { tarea: { asignadoId: req.usuario.id } },
            { tarea: { creadorId: req.usuario.id } }
          ]
        })
      },
      orderBy: { creadoEn: 'desc' },
      take: 50, // Limitamos a los últimos 50 para rendimiento
      include: {
        usuario: {
          select: { id: true, nombre: true, area: true }
        }
      }
    });

    res.json({ logs });
  } catch (error) {
    console.error('[logs.listarPorProyecto]', error);
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
};

module.exports = {
  listarPorProyecto
};
