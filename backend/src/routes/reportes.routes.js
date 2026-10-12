// Reportes (/api/reportes). Solo administradores; el reporte por cliente
// depende además del módulo de clientes.
const express = require('express');
const ctrl = require('../controllers/reportes.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloAdmin } = require('../middlewares/roles.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');

const router = express.Router();

router.use(verificarToken, soloAdmin, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/personas', ctrl.personas);
router.get('/clientes', requiereModulo('clientes'), ctrl.clientes);

module.exports = router;
