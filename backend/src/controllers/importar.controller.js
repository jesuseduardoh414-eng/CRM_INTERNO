/**
 * Controlador de Importación Masiva de Tareas
 *
 * POST /api/proyectos/:id/tareas/importar            (directo, sin vista previa)
 * POST /api/proyectos/:id/tareas/importar/preview
 * POST /api/proyectos/:id/tareas/importar/confirmar
 * GET  /api/proyectos/:id/tareas/exportar/json
 * GET  /api/proyectos/:id/tareas/exportar/excel
 * GET  /api/tareas/plantilla/json
 * GET  /api/tareas/plantilla/excel
 */

const path = require('path');
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { registrarActividad } = require('../utils/logger');
const { serializeTasksForExport } = require('../utils/plantillas.utils');
const { esAdmin, puedeAdministrarProyecto, cargarProyectoVisible } = require('../utils/permissions.utils');
const { visibilidadTareasPara } = require('./tareas.controller');
const {
  ErrorImportacion,
  construirVistaPrevia,
  parseRowsFromFile,
  procesarFilas,
  generarPlantillaJSON,
  generarPlantillaExcel,
} = require('../utils/importador.utils');

const MODOS_ASIGNACION = ['yo', 'miembro', 'archivo'];

const toFileSlug = (value) => String(value || 'proyecto')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase() || 'proyecto';

// Los errores "de usuario" (archivo mal formado, fila invalida, miembro que no
// pertenece al proyecto...) llegan como ErrorImportacion y se devuelven con su
// mensaje. Cualquier otro error es un 500 generico: el detalle va al log.
const responderErrorImportacion = (res, error, contexto) => {
  if (error instanceof ErrorImportacion) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  console.error(contexto, error);
  return res.status(500).json({ error: 'Error interno al procesar la importación' });
};

// Quien importa debe poder crear tareas en el proyecto: ADMIN con permiso
// sobre el area, o MIEMBRO que pertenezca al proyecto.
const resolverAsignadoPorDefecto = (modoAsignacion, proyecto, usuario, asignadoIdRaw) => {
  if (modoAsignacion === 'yo') {
    if (!proyecto.miembros.some((m) => m.id === usuario.id)) {
      throw new ErrorImportacion('Para asignarte las tareas debes ser miembro del proyecto');
    }
    return usuario.id;
  }

  if (modoAsignacion === 'miembro') {
    const miembroId = parseInt(asignadoIdRaw, 10);
    if (Number.isNaN(miembroId)) {
      throw new ErrorImportacion('El miembro seleccionado no es valido');
    }
    if (!proyecto.miembros.some((m) => m.id === miembroId)) {
      throw new ErrorImportacion('El miembro seleccionado no pertenece a este proyecto');
    }
    return miembroId;
  }

  // modo 'archivo': se respeta la columna de correo del archivo
  return null;
};

// Preparacion comun a los tres caminos de importacion (directo, vista previa y
// confirmar): proyecto, permiso y responsable por defecto. Antes el camino
// directo tenia su propia validacion, distinta de la de los otros dos.
const prepararImportacion = async (req) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) throw new ErrorImportacion('ID de proyecto inválido');

  const proyecto = await prisma.proyecto.findUnique({
    where: { id: proyectoId },
    include: { miembros: { select: { id: true, email: true, nombre: true } } },
  });
  if (!proyecto) throw new ErrorImportacion('Proyecto no encontrado', 404);

  if (esAdmin(req.usuario)) {
    if (!puedeAdministrarProyecto(req.usuario, proyecto)) {
      throw new ErrorImportacion('No tienes permiso para importar tareas en este proyecto', 403);
    }
  } else if (!proyecto.miembros.some((m) => m.id === req.usuario.id)) {
    throw new ErrorImportacion('No tienes permiso para importar tareas en este proyecto', 403);
  }

  const modoSolicitado = String(req.body?.modoAsignacion || 'archivo');
  if (!MODOS_ASIGNACION.includes(modoSolicitado)) {
    throw new ErrorImportacion(`Modo de asignación inválido. Usa: ${MODOS_ASIGNACION.join(', ')}`);
  }
  const asignadoPorDefecto = resolverAsignadoPorDefecto(modoSolicitado, proyecto, req.usuario, req.body?.asignadoId);

  return { proyectoId, proyecto, modoAsignacion: modoSolicitado, asignadoPorDefecto };
};

const leerFilasDelArchivo = (file) => {
  if (!file) {
    throw new ErrorImportacion('No se recibió ningún archivo. Envía el archivo en el campo "archivo"');
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  return parseRowsFromFile(file.buffer, ext);
};

//  POST /api/proyectos/:id/tareas/importar  (sin vista previa)
const importar = async (req, res) => {
  try {
    const { proyectoId, proyecto, asignadoPorDefecto } = await prepararImportacion(req);
    const filas = leerFilasDelArchivo(req.file);

    const resultado = await procesarFilas(
      filas,
      proyectoId,
      proyecto.miembros,
      registrarActividad,
      req.usuario.id,
      asignadoPorDefecto,
      { proyectoNombre: proyecto.nombre },
    );

    return res.status(200).json({
      creadas: resultado.creadas,
      errores: resultado.errores,
      tareas: resultado.tareas || [],
    });
  } catch (error) {
    return responderErrorImportacion(res, error, '[importar tareas]');
  }
};

//  POST /api/proyectos/:id/tareas/importar/preview
const vistaPreviaImportacion = async (req, res) => {
  try {
    const { proyecto, modoAsignacion, asignadoPorDefecto } = await prepararImportacion(req);
    const filas = leerFilasDelArchivo(req.file);
    const preview = construirVistaPrevia(filas, proyecto.miembros, asignadoPorDefecto, {
      creadorId: req.usuario.id,
    });

    return res.status(200).json({
      archivo: req.file.originalname,
      modoAsignacion,
      ...preview,
    });
  } catch (error) {
    return responderErrorImportacion(res, error, '[preview importar tareas]');
  }
};

//  POST /api/proyectos/:id/tareas/importar/confirmar
const confirmarImportacion = async (req, res) => {
  try {
    const { proyectoId, proyecto, asignadoPorDefecto } = await prepararImportacion(req);
    const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];

    if (filas.length === 0) {
      throw new ErrorImportacion('No hay filas para importar');
    }

    const resultado = await procesarFilas(
      filas,
      proyectoId,
      proyecto.miembros,
      registrarActividad,
      req.usuario.id,
      asignadoPorDefecto,
      { proyectoNombre: proyecto.nombre },
    );

    return res.status(200).json(resultado);
  } catch (error) {
    return responderErrorImportacion(res, error, '[confirmar importar tareas]');
  }
};

//  GET /api/tareas/plantilla/json
const plantillaJSON = (_req, res) => {
  const datos = generarPlantillaJSON();
  const json  = JSON.stringify(datos, null, 2);

  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_tareas.json"');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(json);
};

//  GET /api/tareas/plantilla/excel
const plantillaExcel = (_req, res) => {
  const buffer = generarPlantillaExcel();

  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_tareas.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
};

// Carga el proyecto con las tareas que el usuario puede ver, con la misma
// regla que el listado: el ADMIN ve todas y el MIEMBRO solo las suyas, las
// sin responsable y las que creo. Devuelve null si no existe o no lo puede ver.
const cargarProyectoParaExportar = async (proyectoId, usuario) => {
  const { proyecto: visible, permitido } = await cargarProyectoVisible(prisma, usuario, proyectoId);
  if (!visible) return { status: 404, error: 'Proyecto no encontrado' };
  if (!permitido) return { status: 403, error: 'No tienes permiso para acceder a este proyecto' };

  const proyecto = await prisma.proyecto.findUnique({
    where: { id: visible.id },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      estado: true,
      area: true,
      fechaInicio: true,
      fechaFin: true,
      tareas: {
        where: esAdmin(usuario) ? undefined : visibilidadTareasPara(usuario.id),
        include: {
          asignado: { select: { id: true, nombre: true, email: true, area: true } },
        },
      },
    },
  });

  return { proyecto };
};

const exportarJSON = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) {
    return res.status(400).json({ error: 'ID de proyecto inválido' });
  }

  try {
    const acceso = await cargarProyectoParaExportar(proyectoId, req.usuario);
    if (acceso.error) return res.status(acceso.status).json({ error: acceso.error });
    const { proyecto } = acceso;

    const tareas = serializeTasksForExport({ proyecto, tareas: proyecto.tareas });
    const payload = {
      proyecto: {
        id: proyecto.id,
        nombre: proyecto.nombre,
        descripcion: proyecto.descripcion,
        estado: proyecto.estado,
        area: proyecto.area,
        fechaInicio: proyecto.fechaInicio,
        fechaFin: proyecto.fechaFin,
      },
      tareas,
    };

    const fileSlug = toFileSlug(proyecto.nombre);
    res.setHeader('Content-Disposition', `attachment; filename="${fileSlug}_tareas.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('[tareas.exportarJSON]', error);
    return res.status(500).json({ error: 'Error al exportar tareas' });
  }
};

const exportarExcel = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) {
    return res.status(400).json({ error: 'ID de proyecto inválido' });
  }

  try {
    const acceso = await cargarProyectoParaExportar(proyectoId, req.usuario);
    if (acceso.error) return res.status(acceso.status).json({ error: acceso.error });
    const { proyecto } = acceso;

    const tareas = serializeTasksForExport({ proyecto, tareas: proyecto.tareas });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(tareas);
    XLSX.utils.book_append_sheet(wb, ws, 'Tareas');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileSlug = toFileSlug(proyecto.nombre);
    res.setHeader('Content-Disposition', `attachment; filename="${fileSlug}_tareas.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (error) {
    console.error('[tareas.exportarExcel]', error);
    return res.status(500).json({ error: 'Error al exportar tareas' });
  }
};

module.exports = { importar, vistaPreviaImportacion, confirmarImportacion, plantillaJSON, plantillaExcel, exportarJSON, exportarExcel };
