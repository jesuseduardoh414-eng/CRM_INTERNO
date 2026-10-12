// Rutas de Tareas con control de roles
// DELETE y operaciones destructivas requieren rol ADMIN

const express = require('express');
const { listar, crear, editar, eliminar, eliminarVarias, actualizarEstado } = require('../controllers/tareas.controller');
const { importar, vistaPreviaImportacion, confirmarImportacion, plantillaJSON, plantillaExcel, exportarJSON, exportarExcel } = require('../controllers/importar.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloAdmin }      = require('../middlewares/roles.middleware');
const { listar: listarComentarios, crear: crearComentario, eliminar: eliminarComentario } = require('../controllers/comentarios.controller');
const { listar: listarAdjuntos, subir: subirAdjunto, eliminar: eliminarAdjunto } = require('../controllers/adjuntos.controller');
const upload = require('../middlewares/upload.middleware');
const uploadImport = require('../middlewares/uploadImport.middleware');
const { requiereModulo, requierePermiso } = require('../middlewares/modulos.middleware');

const routerProyecto = express.Router({ mergeParams: true });
const routerTarea    = express.Router();

routerProyecto.use(verificarToken);
routerTarea.use(verificarToken);

//  Plantillas descargables
routerTarea.get('/plantilla/json',  requiereModulo('importar'), plantillaJSON);
routerTarea.get('/plantilla/excel', requiereModulo('importar'), plantillaExcel);

// Listar y crear tareas (cualquier usuario autenticado)
routerProyecto.get('/exportar/json', exportarJSON);
routerProyecto.get('/exportar/excel', exportarExcel);
routerProyecto.get('/',  listar);
routerProyecto.post('/', requierePermiso('crearTareas'), upload.array('archivos', 5), crear);

//  Importación masiva
const puedeImportar = [requiereModulo('importar'), requierePermiso('crearTareas')];
routerProyecto.post('/importar/preview', puedeImportar, uploadImport.single('archivo'), vistaPreviaImportacion);
routerProyecto.post('/importar/confirmar', puedeImportar, confirmarImportacion);
routerProyecto.post('/importar', puedeImportar, uploadImport.single('archivo'), importar);

// Editar y cambiar estado (cualquier usuario autenticado)
routerTarea.put('/:id',          requierePermiso('editarTareas'), editar);
routerTarea.patch('/:id/estado', requierePermiso('editarTareas'), actualizarEstado);

// Eliminar tarea (ADMIN o Miembro del proyecto)
// El borrado en bloque va como POST y antes que '/:id' para que la ruta fija
// no se confunda con un identificador.
routerTarea.post('/eliminar-multiples', requierePermiso('borrarTareas'), eliminarVarias);
routerTarea.delete('/:id', requierePermiso('borrarTareas'), eliminar);

// Comentarios de una tarea
routerTarea.get('/:id/comentarios', requiereModulo('comentarios'), listarComentarios);
routerTarea.post('/:id/comentarios', requiereModulo('comentarios'), crearComentario);
routerTarea.delete('/comentarios/:id', requiereModulo('comentarios'), eliminarComentario);

// Adjuntos de una tarea. Los archivos viven en el disco del servidor y se
// abren por GET /api/archivos/... (campo `url` del adjunto).
routerTarea.get('/:id/adjuntos',         listarAdjuntos);
routerTarea.post('/:id/adjuntos',        requiereModulo('adjuntos'), requierePermiso('subirAdjuntos'), upload.fields([{ name: 'archivo', maxCount: 1 }, { name: 'archivos', maxCount: 10 }]), subirAdjunto);
routerTarea.delete('/adjuntos/:id',      eliminarAdjunto);

module.exports = { routerProyecto, routerTarea };
