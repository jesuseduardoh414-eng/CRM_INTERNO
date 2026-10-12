// Rutas de finanzas (/api/finanzas): Ventas (pagos), Tesoreria (partidas y
// asignaciones), Gastos por categoria, informe y comprobantes.
//
// El acceso es por usuario y por recurso (usuarios.permisos_finanzas; ver
// utils/finanzas.utils.js). Aqui se comprueban `ventas`, `tesoreria` e
// `informe`; las categorias de gastos se comprueban en el controlador porque
// dependen de cada registro.
const express = require('express');
const catalogos = require('../controllers/finanzasCatalogos.controller');
const pagos = require('../controllers/finanzasPagos.controller');
const gastos = require('../controllers/finanzasGastos.controller');
const tesoreria = require('../controllers/finanzasTesoreria.controller');
const { informe } = require('../controllers/finanzasInforme.controller');
const comprobantes = require('../controllers/finanzasComprobantes.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const { requiereAccesoFinanzas, requiereNivel, requiereAlguno, requiereEditarGasto } = require('../middlewares/finanzas.middleware');
const uploadComprobante = require('../middlewares/uploadComprobante.middleware');

const router = express.Router();

router.use(verificarToken, requiereModulo('finanzas'), requiereAccesoFinanzas);
// Datos confidenciales: que no queden en caches.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/catalogos', catalogos.catalogos);
router.get('/bitacora', catalogos.bitacora);

// Cuentas: las usan Ventas (destino) y Gastos (origen).
router.get('/cuentas', catalogos.listarCuentas);
router.post('/cuentas', requiereAlguno(['ventas', 'tesoreria'], 'editar'), catalogos.crearCuenta);
router.put('/cuentas/:id', requiereAlguno(['ventas', 'tesoreria'], 'editar'), catalogos.editarCuenta);
router.delete('/cuentas/:id', requiereAlguno(['ventas', 'tesoreria'], 'editar'), catalogos.eliminarCuenta);

// Partidas de tesoreria (las columnas del informe).
router.get('/partidas', catalogos.listarPartidas);
router.post('/partidas', requiereNivel('tesoreria', 'editar'), catalogos.crearPartida);
router.put('/partidas/:id', requiereNivel('tesoreria', 'editar'), catalogos.editarPartida);
router.delete('/partidas/:id', requiereNivel('tesoreria', 'editar'), catalogos.eliminarPartida);

// Ventas: pagos recibidos.
router.get('/pagos', requiereNivel('ventas'), pagos.listar);
router.get('/pagos/resumen', requiereNivel('ventas'), pagos.resumen);
router.get('/pagos/:id', requiereNivel('ventas'), pagos.obtener);
router.post('/pagos', requiereNivel('ventas', 'editar'), pagos.crear);
router.put('/pagos/:id', requiereNivel('ventas', 'editar'), pagos.editar);
router.post('/pagos/:id/anular', requiereNivel('ventas', 'editar'), pagos.anular);
router.delete('/pagos/:id', requiereNivel('ventas', 'editar'), pagos.eliminar);
router.post('/pagos/:id/comprobantes', requiereNivel('ventas', 'editar'), uploadComprobante.single('archivo'), comprobantes.subirPago);

// Gastos (permiso por categoria dentro del controlador).
router.get('/gastos', gastos.listar);
router.get('/gastos/resumen', gastos.resumen);
router.get('/gastos/:id', gastos.obtener);
router.post('/gastos', gastos.crear);
router.put('/gastos/:id', gastos.editar);
router.post('/gastos/:id/pagar', gastos.pagar);
router.post('/gastos/:id/reabrir', gastos.reabrir);
router.post('/gastos/:id/anular', gastos.anular);
router.post('/gastos/:id/duplicar', gastos.duplicar);
router.delete('/gastos/:id', gastos.eliminar);
router.post('/gastos/:id/comprobantes', requiereEditarGasto, uploadComprobante.single('archivo'), comprobantes.subirGasto);

// Tesoreria.
router.get('/tesoreria', requiereNivel('tesoreria'), tesoreria.resumen);
router.get('/tesoreria/asignaciones', requiereNivel('tesoreria'), tesoreria.listarAsignaciones);
router.post('/tesoreria/asignaciones', requiereNivel('tesoreria', 'editar'), tesoreria.crearAsignacion);
router.put('/tesoreria/asignaciones/:id', requiereNivel('tesoreria', 'editar'), tesoreria.editarAsignacion);
router.delete('/tesoreria/asignaciones/:id', requiereNivel('tesoreria', 'editar'), tesoreria.eliminarAsignacion);

// Informe de gastos (JSON o ?formato=excel).
router.get('/informe', requiereNivel('informe'), informe);

// Comprobantes (el permiso depende del pago o gasto dueño).
router.get('/comprobantes/:id', comprobantes.ver);
router.delete('/comprobantes/:id', comprobantes.eliminar);

module.exports = router;
