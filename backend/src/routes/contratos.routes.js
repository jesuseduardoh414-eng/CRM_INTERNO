// Rutas de contratos (/api/contratos). Permisos de la sección Contratos
// (contratos.ver / crear / editar / eliminar), revisados aqui en el servidor.
const express = require('express');
const ctrl = require('../controllers/contratos.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const uploadContrato = require('../middlewares/uploadContrato.middleware');
const { moduloActivo } = require('../services/configuracion.service');

const router = express.Router();

router.use(verificarToken, requiere('contratos.ver'));
// El configurador puede apagar el modulo desde su panel.
router.use(async (_req, res, next) => {
  try {
    if (await moduloActivo('contratos')) return next();
    return res.status(404).json({ error: 'El módulo de contratos está desactivado', codigo: 'MODULO_DESACTIVADO' });
  } catch (error) {
    return next(error);
  }
});
// Datos confidenciales: que no queden en caches.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/', ctrl.listar);
router.get('/resumen', ctrl.resumen);
router.get('/catalogos', ctrl.catalogos);
router.get('/archivos/:archivoId', ctrl.verArchivo);
router.delete('/archivos/:archivoId', requiere('contratos.editar'), ctrl.eliminarArchivo);
router.get('/:id', ctrl.obtener);
router.post('/', requiere('contratos.crear'), ctrl.crear);
router.put('/:id', requiere('contratos.editar'), ctrl.editar);
router.delete('/:id', requiere('contratos.eliminar'), ctrl.eliminar);
// El permiso va antes de multer: sin el, el archivo ni se recibe.
router.post('/:id/archivos', requiere('contratos.editar'), uploadContrato.single('archivo'), ctrl.subirArchivo);

module.exports = router;
