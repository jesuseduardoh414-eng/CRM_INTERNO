// Rutas de configuracion (/api/configuracion).
//  Públicas: GET /publica, GET /archivos/:clave  (las necesita el login)
//  Solo CONFIGURADOR: GET /, PUT /, POST /restablecer,
//                     POST /archivos/:clave, DELETE /archivos/:clave,
//                     /administradores y /configuradores (listar, invitar, acciones),
//                     POST /correo/prueba, POST /correo/verificar, GET /estado,
//                     GET /correo/plantillas, POST /correo/vista-previa,
//                     /drive (Google Drive y respaldos)
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/configuracion.controller');
const sistema = require('../controllers/configuracionSistema.controller');
const drive = require('../controllers/configuracionDrive.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloConfigurador } = require('../middlewares/roles.middleware');
const { limiteAccionSensible } = require('../middlewares/rateLimit.middleware');

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 2 },
});

const router = express.Router();

router.get('/publica', ctrl.publica);
router.get('/archivos/:clave', ctrl.verArchivo);

router.use(verificarToken, soloConfigurador, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', ctrl.obtener);
router.put('/', ctrl.guardar);
router.post('/restablecer', limiteAccionSensible, ctrl.restablecer);
router.post('/archivos/:clave', subida.single('archivo'), ctrl.subirArchivo);
router.delete('/archivos/:clave', ctrl.eliminarArchivo);

// Administradores de la empresa (alta y restablecer acceso)
router.get('/administradores', sistema.listarAdministradores);
router.post('/administradores', limiteAccionSensible, sistema.invitarAdministrador);
router.post('/administradores/invitaciones/:id/reenviar', limiteAccionSensible, sistema.reenviarInvitacionAdmin);
router.delete('/administradores/invitaciones/:id', sistema.eliminarInvitacionAdmin);
router.post('/administradores/:id/acciones', limiteAccionSensible, sistema.accionAdministrador);

// Otras cuentas de configuración (la primera se crea por consola)
router.get('/configuradores', sistema.listarConfiguradores);
router.post('/configuradores', limiteAccionSensible, sistema.invitarConfigurador);
router.post('/configuradores/invitaciones/:id/reenviar', limiteAccionSensible, sistema.reenviarInvitacionConfigurador);
router.delete('/configuradores/invitaciones/:id', sistema.eliminarInvitacionConfigurador);
router.post('/configuradores/:id/acciones', limiteAccionSensible, sistema.accionConfigurador);

// Correo y estado del sistema
router.post('/correo/prueba', limiteAccionSensible, sistema.correoPrueba);
router.post('/correo/verificar', limiteAccionSensible, sistema.verificarCorreo);
router.get('/correo/plantillas', sistema.plantillasCorreo);
router.post('/correo/vista-previa', sistema.vistaPreviaCorreo);
router.get('/estado', sistema.estadoSistema);

// Google Drive: archivos del CRM y respaldo diario de la base
router.get('/drive', drive.estado);
router.post('/drive/conectar', limiteAccionSensible, drive.conectar);
router.delete('/drive', limiteAccionSensible, drive.desconectar);
router.post('/drive/respaldo', limiteAccionSensible, drive.respaldarAhora);
router.post('/drive/pendientes', limiteAccionSensible, drive.subirPendientes);
router.post('/drive/ordenar', limiteAccionSensible, drive.ordenar);

module.exports = router;
