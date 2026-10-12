// Rutas de contratos (/api/contratos). Solo administradores: el control se
// hace aqui, en el servidor, para todas las rutas.
const express = require('express');
const ctrl = require('../controllers/contratos.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloAdmin } = require('../middlewares/roles.middleware');
const uploadContrato = require('../middlewares/uploadContrato.middleware');
const { moduloActivo } = require('../services/configuracion.service');

const router = express.Router();

router.use(verificarToken, soloAdmin);
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
router.delete('/archivos/:archivoId', ctrl.eliminarArchivo);
router.get('/:id', ctrl.obtener);
router.post('/', ctrl.crear);
router.put('/:id', ctrl.editar);
router.delete('/:id', ctrl.eliminar);
router.post('/:id/archivos', uploadContrato.single('archivo'), ctrl.subirArchivo);

module.exports = router;
