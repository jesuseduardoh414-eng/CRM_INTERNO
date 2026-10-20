// Rutas de la base de conocimiento (/api/conocimiento). Permisos de la
// sección: conocimiento.ver / crear / editar / eliminar.
const express = require('express');
const ctrl = require('../controllers/conocimiento.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const { subirConocimiento } = require('../middlewares/uploadDocumento.middleware');

const router = express.Router();

router.use(verificarToken, requiereModulo('conocimiento'), requiere('conocimiento.ver'));

router.get('/', ctrl.listar);
router.get('/archivos/:id', ctrl.verArchivo);
router.delete('/archivos/:id', requiere('conocimiento.editar'), ctrl.eliminarArchivo);
router.get('/:id', ctrl.obtener);
router.post('/', requiere('conocimiento.crear'), ctrl.crear);
router.put('/:id', requiere('conocimiento.editar'), ctrl.editar);
router.delete('/:id', requiere('conocimiento.eliminar'), ctrl.eliminar);
// El permiso va antes de multer: nadie mas puede mandar archivos a la memoria del servidor.
router.post('/:id/archivos', requiere('conocimiento.editar'), subirConocimiento('archivo'), ctrl.subirArchivo);

module.exports = router;
