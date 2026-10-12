// Portal de clientes (/api/portal). Solo cuentas CLIENTE de una empresa
// activa; el configurador puede apagarlo (módulos "clientes" y "portalClientes").
const express = require('express');
const ctrl = require('../controllers/portal.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const uploadProfile = require('../middlewares/uploadProfile.middleware');

const router = express.Router();

router.use(verificarToken, requiereModulo('clientes'), requiereModulo('portalClientes'), ctrl.cargarEmpresaPortal);

router.get('/resumen', ctrl.resumen);
router.get('/perfil', ctrl.perfil);
router.put('/perfil', uploadProfile.single('fotoPerfil'), ctrl.actualizarPerfil);
router.get('/proyectos', ctrl.proyectos);
router.get('/proyectos/:id', ctrl.proyecto);
router.get('/proyectos/:id/mensajes', ctrl.mensajes);
router.post('/proyectos/:id/mensajes', ctrl.enviarMensaje);
router.get('/documentos', ctrl.documentos);
router.get('/reuniones', ctrl.reuniones);
router.get('/contratos', ctrl.contratos);
router.get('/contratos/archivos/:archivoId', ctrl.archivoContrato);

module.exports = router;
