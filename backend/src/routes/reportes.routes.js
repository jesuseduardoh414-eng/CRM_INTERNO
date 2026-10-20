// Reportes (/api/reportes). Permiso "reportes.ver"; el reporte por cliente
// pide además ver clientes y el módulo de clientes.
const express = require('express');
const ctrl = require('../controllers/reportes.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');

const router = express.Router();

router.use(verificarToken, requiere('reportes.ver'), (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/personas', ctrl.personas);
router.get('/clientes', requiere('clientes.ver'), requiereModulo('clientes'), ctrl.clientes);

module.exports = router;
