// Modulo de compatibilidad. El envio real vive en email.service.js (SMTP del
// panel o del .env, con Nodemailer); aqui solo se reexporta para no romper a quien todavia importe de
// './correo'.
const { enviarInvitacion } = require('./email.service');

module.exports = { enviarInvitacion };
