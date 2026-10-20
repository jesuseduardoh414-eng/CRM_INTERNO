// Rutas de Proyectos — todas protegidas con JWT
const express = require('express');
const { listar, equipo, crear, editar, eliminar, listarPlantillas, guardarComoPlantilla } = require('../controllers/proyectos.controller');
const { listarPorProyecto } = require('../controllers/logs.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
// Permisos por area y persona (utils/permisosArea.utils.js): la ruta pide la
// casilla y el controlador mira hasta donde llega (sus proyectos, su area, todos).
const { requiere }      = require('../middlewares/roles.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');

const router = express.Router();

// Aplicar verificarToken a todas las rutas de proyectos
router.use(verificarToken);

const upload = require('../middlewares/upload.middleware');

const { listar: listarComentarios, crear: crearComentario } = require('../controllers/comentarios.controller');
const { listar: listarAdjuntos, subir: subirAdjunto, eliminar: eliminarAdjunto } = require('../controllers/adjuntos.controller');

router.get('/',              listar);
router.get('/plantillas',    requiereModulo('plantillas'), listarPlantillas);
// Crear: "proyectos.crear" (fuera del area general, solo en su propia area).
router.post('/',             requiere('proyectos.crear'), upload.array('archivos', 5), crear);
router.put('/:id',           requiere('proyectos.editar'), upload.array('archivos', 5), editar);
router.delete('/:id',        requiere('proyectos.eliminar'), eliminar);
router.get('/:id/equipo',    equipo); // Equipo asignado al proyecto
router.get('/:id/logs',      listarPorProyecto); // Historial de actividad
router.post('/:id/plantilla', requiereModulo('plantillas'), requiere('proyectos.plantillas'), guardarComoPlantilla);

// Comentarios de Proyecto
router.get('/:id/comentarios',  requiereModulo('comentarios'), listarComentarios);
router.post('/:id/comentarios', requiereModulo('comentarios'), requiere('tareas.comentar'), crearComentario);

// Archivos de Proyecto
router.get('/:id/adjuntos',  listarAdjuntos);
router.post('/:id/adjuntos', requiereModulo('adjuntos'), requiere('tareas.adjuntos'), upload.fields([{ name: 'archivo', maxCount: 1 }, { name: 'archivos', maxCount: 10 }]), subirAdjunto);
router.delete('/adjuntos/:id', eliminarAdjunto);

// Portal de clientes: conversación con el cliente y archivos compartidos
const portalEquipo = require('../controllers/portalEquipo.controller');
const portal = [requiereModulo('clientes'), requiereModulo('portalClientes')];
router.get('/:id/portal', portal, portalEquipo.verPortalProyecto);
router.post('/:id/portal/mensajes', portal, portalEquipo.responderCliente);
router.patch('/adjuntos/:id/visible-cliente', portal, portalEquipo.compartirDocumento);

module.exports = router;
