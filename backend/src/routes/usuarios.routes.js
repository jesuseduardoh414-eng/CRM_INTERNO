// Rutas de Usuarios — Gestión Administrativa
const express = require('express');
const { listar, listarParaProyectos, obtenerPerfil, actualizarPerfil, crear, editar, eliminar, toggleEstado, actividad } = require('../controllers/usuarios.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { soloAdmin }      = require('../middlewares/roles.middleware');
const uploadProfile = require('../middlewares/uploadProfile.middleware');

const router = express.Router();

// Todas las rutas de usuarios requieren estar logueado
router.use(verificarToken);

// Listar usuarios
router.get('/', listar);
router.get('/catalogo/proyectos', listarParaProyectos);
router.get('/perfil', obtenerPerfil);
router.put('/perfil', uploadProfile.single('fotoPerfil'), actualizarPerfil);

// Operaciones de gestión (solo para administradores)
router.post('/',           soloAdmin, crear);
router.get('/:id/actividad', soloAdmin, actividad);
router.put('/:id',         soloAdmin, editar);
router.put('/:id/estado',  soloAdmin, toggleEstado);
router.delete('/:id',      soloAdmin, eliminar);

module.exports = router;
