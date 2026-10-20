// Rutas de la Agenda Personal
const express = require('express');
const router = express.Router();
const agendaController = require('../controllers/agenda.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const { listar: listarAdjuntos, subir: subirAdjunto, eliminar: eliminarAdjunto } = require('../controllers/adjuntos.controller');
const upload = require('../middlewares/upload.middleware');
const { requiereModulo } = require('../middlewares/modulos.middleware');
const { requiere } = require('../middlewares/roles.middleware');
const equipo = require('../controllers/agendaEquipo.controller');

// Todas las rutas de agenda requieren autenticación
router.use(verificarToken);

// Configuración laboral (Debe ir antes de /:id para evitar conflictos)
router.get('/config-laboral', agendaController.getConfigLaboral);
router.put('/config-laboral', agendaController.updateConfigLaboral);
const google = [requiereModulo('agenda'), requiereModulo('googleCalendar')];
router.get('/google-calendar/status', google, agendaController.getGoogleCalendarStatus);
router.post('/google-calendar/connect', google, agendaController.connectGoogleCalendarController);
router.post('/google-calendar/sync', google, agendaController.sincronizarGoogleCalendar);
// Desconectar siempre se permite: apagar el modulo no debe dejar cuentas atadas.
router.delete('/google-calendar/connect', agendaController.disconnectGoogleCalendarController);

// Endpoints principales. Horario laboral, disponibilidad y dias especiales
// quedan fuera del modulo: los usan los proyectos para ver la disponibilidad.
const agenda = requiereModulo('agenda');
router.get('/',               agenda, agendaController.listar);
router.post('/',              agenda, agendaController.crear);
router.get('/recordatorios', agenda, agendaController.recordatoriosProximos);
router.get('/invitaciones/pendientes', agenda, agendaController.invitacionesPendientes);
router.patch('/:id/responder', agenda, agendaController.responderInvitacion);
router.get('/disponibilidad', agendaController.consultarDisponibilidad);
router.put('/:id',            agenda, agendaController.editar);
router.delete('/:id',         agenda, agendaController.eliminar);
router.get('/:id/adjuntos',   agenda, listarAdjuntos);
router.post('/:id/adjuntos',  agenda, requiereModulo('adjuntos'), upload.fields([{ name: 'archivo', maxCount: 1 }, { name: 'archivos', maxCount: 10 }]), subirAdjunto);
router.delete('/adjuntos/:id', eliminarAdjunto);

// Calendario de la empresa (todos lo leen; lo editan los administradores)
router.get('/dias-empresa', equipo.listarDiasEmpresa);
router.get('/dias-empresa/registros', requiere('agenda.diasEmpresa'), equipo.registrosDiasEmpresa);
router.post('/dias-empresa', requiere('agenda.diasEmpresa'), equipo.crearDiaEmpresa);
router.delete('/dias-empresa/:id', requiere('agenda.diasEmpresa'), equipo.eliminarDiaEmpresa);

// Vista de equipo (administradores) y horarios libres para reuniones
router.get('/equipo', requiere('agenda.equipo'), requiereModulo('agenda'), equipo.agendaEquipo);
router.get('/sugerir-horarios', requiereModulo('agenda'), equipo.sugerirHorarios);

// Días especiales (personales)
router.get('/dias-especiales', agendaController.listarDiasEspeciales);
router.post('/dias-especiales', agendaController.crearDiaEspecial);
router.delete('/dias-especiales/:id', agendaController.eliminarDiaEspecial);

module.exports = router;
