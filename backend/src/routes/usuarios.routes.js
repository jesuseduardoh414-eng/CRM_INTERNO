// Rutas de Usuarios — Gestión Administrativa
const express = require('express');
const {
  listar, listarParaProyectos, obtenerPerfil, actualizarPerfil, crear, editar, eliminar, toggleEstado, actividad,
  obtenerPermisos, guardarPermisos,
} = require('../controllers/usuarios.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { requiere }       = require('../middlewares/roles.middleware');
const uploadProfile = require('../middlewares/uploadProfile.middleware');

const router = express.Router();

// Todas las rutas de usuarios requieren estar logueado
router.use(verificarToken);

// Listar usuarios
router.get('/', listar);
router.get('/catalogo/proyectos', listarParaProyectos);
router.get('/perfil', obtenerPerfil);
router.put('/perfil', uploadProfile.single('fotoPerfil'), actualizarPerfil);

// Operaciones de gestión (permisos de la seccion Usuarios; el alcance por
// area lo revisa el controlador)
router.post('/',           requiere('usuarios.invitar'), crear);
router.get('/:id/actividad', actividad);
router.put('/:id',         requiere('usuarios.editar'), editar);
router.put('/:id/estado',  requiere('usuarios.desactivar'), toggleEstado);
router.delete('/:id',      requiere('usuarios.desactivar'), eliminar);

// Ajustes de permisos por persona (solo el administrador general)
router.get('/:id/permisos', obtenerPermisos);
router.put('/:id/permisos', guardarPermisos);

module.exports = router;
