// Rutas del directorio de clientes y proveedores (/api/empresas). Permisos de
// la sección Clientes (clientes.ver / crear / editar / eliminar), y el
// configurador puede apagar el módulo ("clientes").
const express = require('express');
const ctrl = require('../controllers/empresas.controller');
const accesos = require('../controllers/portalEquipo.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');

const router = express.Router();

router.use(verificarToken, requiere('clientes.ver'), requiereModulo('clientes'));
// Datos comerciales: que no queden en caches.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/', ctrl.listar);
router.get('/resumen', ctrl.resumen);
router.get('/catalogo', ctrl.catalogo);
router.put('/contactos/:contactoId', requiere('clientes.editar'), ctrl.editarContacto);
router.delete('/contactos/:contactoId', requiere('clientes.editar'), ctrl.eliminarContacto);
router.get('/:id', ctrl.obtener);
router.post('/', requiere('clientes.crear'), ctrl.crear);
router.put('/:id', requiere('clientes.editar'), ctrl.editar);
router.delete('/:id', requiere('clientes.eliminar'), ctrl.eliminar);
router.post('/:id/contactos', requiere('clientes.editar'), ctrl.crearContacto);

// Accesos al portal de clientes de esta empresa
const portal = [requiereModulo('portalClientes'), requiere('clientes.editar')];
router.get('/:id/accesos', portal, accesos.listarAccesos);
router.post('/:id/accesos', portal, accesos.invitarAcceso);
router.post('/:id/accesos/invitaciones/:invitacionId/reenviar', portal, accesos.reenviarAcceso);
router.delete('/:id/accesos/invitaciones/:invitacionId', portal, accesos.cancelarInvitacion);
router.put('/:id/accesos/:usuarioId', portal, accesos.cambiarEstadoAcceso);

module.exports = router;
