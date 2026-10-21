// Rutas de la base de conocimiento (/api/conocimiento). Permisos de la
// sección: conocimiento.ver / crear / editar / eliminar, y conocimiento.acceso
// para elegir quién ve cada artículo y cada archivo.
const express = require('express');
const ctrl = require('../controllers/conocimiento.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const { subirConocimiento } = require('../middlewares/uploadDocumento.middleware');

const router = express.Router();

router.use(verificarToken, requiereModulo('conocimiento'), requiere('conocimiento.ver'));

router.get('/', ctrl.listar);
// El permiso va antes de multer: nadie mas puede mandar archivos a la memoria del servidor.
router.post('/documentos', requiere('conocimiento.crear'), subirConocimiento('archivo'), ctrl.crearDocumento);
router.get('/archivos/:id', ctrl.verArchivo);
router.put('/archivos/:id/acceso', requiere('conocimiento.acceso'), ctrl.cambiarAccesoArchivo);
router.delete('/archivos/:id', requiere('conocimiento.editar'), ctrl.eliminarArchivo);
router.get('/:id', ctrl.obtener);
router.post('/', requiere('conocimiento.crear'), ctrl.crear);
router.put('/:id', requiere('conocimiento.editar'), ctrl.editar);
router.put('/:id/acceso', requiere('conocimiento.acceso'), ctrl.cambiarAcceso);
router.delete('/:id', requiere('conocimiento.eliminar'), ctrl.eliminar);
router.post('/:id/archivos', requiere('conocimiento.editar'), subirConocimiento('archivo'), ctrl.subirArchivo);

module.exports = router;
