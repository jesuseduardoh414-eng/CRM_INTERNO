const express = require('express');
const { listar, marcarLeida, marcarTodasLeidas, eliminar } = require('../controllers/notificaciones.controller');
const { verificarToken } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(verificarToken);

router.get('/', listar);
router.put('/todas/leidas', marcarTodasLeidas);
router.put('/:id/leida', marcarLeida);
router.delete('/:id', eliminar);

module.exports = router;
