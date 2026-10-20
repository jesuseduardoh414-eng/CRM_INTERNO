const express = require('express');
const {
  getAdminStats,
  getMemberStats,
  getActividadEquipoPorDia,
  exportarReporteDiaExcel,
} = require('../controllers/stats.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloMiembro } = require('../middlewares/roles.middleware');
const { esAdmin } = require('../utils/permissions.utils');
const { puede, sinPermiso } = require('../utils/permisosArea.utils');
const { requiereModulo } = require('../middlewares/modulos.middleware');

const router = express.Router();

// Tableros del equipo: el inicio de los administradores y la seccion Reportes
// (permiso "reportes.ver"). Fuera del administrador general, solo su area.
const veTablerosEquipo = (req, res, next) => (
  esAdmin(req.usuario) || puede(req.usuario, 'reportes.ver') ? next() : sinPermiso(res)
);

router.get('/admin', verificarToken, veTablerosEquipo, getAdminStats);
router.get('/member', verificarToken, soloMiembro, getMemberStats);

// Actividad del equipo de un dia concreto (?fecha=YYYY-MM-DD)
router.get('/actividad-equipo', verificarToken, veTablerosEquipo, getActividadEquipoPorDia);

// Reporte del dia en Excel (?fecha=YYYY-MM-DD&proyectoId=N)
router.get('/reporte-dia/excel', verificarToken, veTablerosEquipo, requiereModulo('reporteDiario'), exportarReporteDiaExcel);

module.exports = router;
