// Rutas de finanzas (/api/finanzas): Ventas (pagos), Tesoreria (bolsa de
// ingresos y presupuesto mensual por categoria), Gastos por categoria,
// informe, comprobantes y Cotizaciones.
//
// El acceso son las casillas finanzas.* (tabla por area y ajustes por
// persona; ver utils/finanzas.utils.js). Aqui se comprueban ventas,
// tesoreria, informe y cotizaciones; las categorias de gastos se comprueban en
// el controlador porque dependen de cada registro.
const express = require('express');
const catalogos = require('../controllers/finanzasCatalogos.controller');
const pagos = require('../controllers/finanzasPagos.controller');
const gastos = require('../controllers/finanzasGastos.controller');
const tesoreria = require('../controllers/finanzasTesoreria.controller');
const { informe } = require('../controllers/finanzasInforme.controller');
const comprobantes = require('../controllers/finanzasComprobantes.controller');
const cotizaciones = require('../controllers/finanzasCotizaciones.controller');
const desdeAdjunto = require('../controllers/finanzasDesdeAdjunto.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const {
  requiereAccesoFinanzas, requiereVerCotizaciones, requiereFin, requiereAlgunaFin, requiereComprobanteGasto,
} = require('../middlewares/finanzas.middleware');
const uploadComprobante = require('../middlewares/uploadComprobante.middleware');
const { subirCotizacion } = require('../middlewares/uploadDocumento.middleware');

const router = express.Router();

router.use(verificarToken, requiereModulo('finanzas'));
// Datos confidenciales: que no queden en caches.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// Cotizaciones. Van antes del filtro general de finanzas: una cotizacion
// restringida la ven quienes esten en su lista aunque no tengan ningun permiso
// de finanzas (requiereVerCotizaciones; el controlador filtra cuales).
// Subir (cotizacion o version) pide `crear`; corregir datos, `editar`;
// cambiar el estado, `aprobar`; borrar la cotizacion completa, `eliminar`;
// y elegir quien la ve, `acceso`. La version original nunca se reemplaza.
// El permiso va antes de multer: sin el, cualquiera mandaba archivos grandes.
// /compartidas (cuantas ve) no pide permiso: el menu pregunta con ella.
router.get('/cotizaciones/compartidas', cotizaciones.compartidas);
router.get('/cotizaciones/con-permiso', requiereFin('cotizaciones', 'acceso'), cotizaciones.conPermiso);
router.get('/cotizaciones', requiereVerCotizaciones, cotizaciones.listar);
router.get('/cotizaciones/versiones/:id/archivo', requiereVerCotizaciones, cotizaciones.verArchivo);
router.get('/cotizaciones/:id', requiereVerCotizaciones, cotizaciones.obtener);
router.post('/cotizaciones', requiereFin('cotizaciones', 'crear'), subirCotizacion('archivo'), cotizaciones.crear);
router.post('/cotizaciones/:id/versiones', requiereFin('cotizaciones', 'crear'), subirCotizacion('archivo'), cotizaciones.nuevaVersion);
router.put('/cotizaciones/:id', requiereFin('cotizaciones', 'editar'), cotizaciones.editar);
router.put('/cotizaciones/:id/acceso', requiereFin('cotizaciones', 'acceso'), cotizaciones.cambiarAcceso);
router.post('/cotizaciones/:id/estado', requiereFin('cotizaciones', 'aprobar'), cotizaciones.cambiarEstado);
router.delete('/cotizaciones/:id', requiereFin('cotizaciones', 'eliminar'), cotizaciones.eliminar);
// La bitacora revisa el permiso del registro al que pertenece (la de una
// cotizacion, que la persona la vea); sin registro, solo el administrador general.
router.get('/bitacora', catalogos.bitacora);

// "Mandar a finanzas" un archivo de una tarea o de un proyecto: a
// cotizaciones y/o gastos variables (cada destino revisa su permiso en el
// controlador). Sin registro: a donde ya se mandó cada archivo, filtrado por
// lo que la persona ve.
const mandaAFinanzas = requiereAlgunaFin([['cotizaciones', 'crear'], ['gastos.VARIABLES', 'crear'], ['gastos.VARIABLES', 'editar']]);
router.get('/desde-adjunto', desdeAdjunto.copias);
router.get('/desde-adjunto/:adjuntoId', mandaAFinanzas, desdeAdjunto.contexto);
router.post('/desde-adjunto/:adjuntoId', mandaAFinanzas, desdeAdjunto.mandar);

router.use(requiereAccesoFinanzas);

router.get('/catalogos', catalogos.catalogos);

// Cuentas: las usan Ventas (destino) y Gastos (origen).
const gestionaCuentas = requiereAlgunaFin([['ventas', 'editar'], ['tesoreria', 'editar']]);
router.get('/cuentas', catalogos.listarCuentas);
router.post('/cuentas', gestionaCuentas, catalogos.crearCuenta);
router.put('/cuentas/:id', gestionaCuentas, catalogos.editarCuenta);
router.delete('/cuentas/:id', gestionaCuentas, catalogos.eliminarCuenta);

// Ventas: pagos recibidos. El comprobante lo sube quien registra o corrige.
router.get('/pagos', requiereFin('ventas'), pagos.listar);
router.get('/pagos/resumen', requiereFin('ventas'), pagos.resumen);
router.get('/pagos/:id', requiereFin('ventas'), pagos.obtener);
router.post('/pagos', requiereFin('ventas', 'crear'), pagos.crear);
router.put('/pagos/:id', requiereFin('ventas', 'editar'), pagos.editar);
router.post('/pagos/:id/anular', requiereFin('ventas', 'editar'), pagos.anular);
router.delete('/pagos/:id', requiereFin('ventas', 'eliminar'), pagos.eliminar);
router.post('/pagos/:id/comprobantes', requiereAlgunaFin([['ventas', 'crear'], ['ventas', 'editar']]), uploadComprobante.single('archivo'), comprobantes.subirPago);

// Gastos (permiso por categoria dentro del controlador).
router.get('/gastos', gastos.listar);
router.get('/gastos/resumen', gastos.resumen);
router.get('/gastos/presupuesto', gastos.presupuesto);
router.get('/gastos/:id', gastos.obtener);
router.post('/gastos', gastos.crear);
router.put('/gastos/:id', gastos.editar);
router.post('/gastos/:id/pagar', gastos.pagar);
router.post('/gastos/:id/reabrir', gastos.reabrir);
router.post('/gastos/:id/anular', gastos.anular);
router.post('/gastos/:id/duplicar', gastos.duplicar);
router.delete('/gastos/:id', gastos.eliminar);
router.post('/gastos/:id/comprobantes', requiereComprobanteGasto, uploadComprobante.single('archivo'), comprobantes.subirGasto);

// Tesoreria.
router.get('/tesoreria', requiereFin('tesoreria'), tesoreria.resumen);
router.put('/tesoreria/presupuestos', requiereFin('tesoreria', 'editar'), tesoreria.guardarPresupuestos);

// Informe de gastos (JSON o ?formato=excel).
router.get('/informe', requiereFin('informe'), informe);

// Comprobantes (el permiso depende del pago o gasto dueño).
router.get('/comprobantes/:id', comprobantes.ver);
router.delete('/comprobantes/:id', comprobantes.eliminar);

module.exports = router;
