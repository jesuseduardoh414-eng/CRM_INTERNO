/**
 * Bitacora de eventos de seguridad (tabla `eventos_seguridad`).
 *
 * Nunca rompe la peticion: si falla la escritura solo se registra en consola.
 * No guarda contraseñas, codigos ni tokens, solo que ocurrio algo, cuando y
 * desde donde.
 */
const prisma = require('../lib/prisma');
const { datosCliente } = require('./sesiones.service');

const TIPOS = Object.freeze({
  LOGIN_OK: 'login_ok',
  LOGIN_FALLIDO: 'login_fallido',
  LOGIN_BLOQUEADO: 'login_bloqueado',
  CUENTA_BLOQUEADA: 'cuenta_bloqueada',
  DOS_FACTORES_FALLIDO: '2fa_fallido',
  DOS_FACTORES_ACTIVADO: '2fa_activado',
  DOS_FACTORES_DESACTIVADO: '2fa_desactivado',
  CODIGOS_RESPALDO_REGENERADOS: 'codigos_respaldo_regenerados',
  CODIGO_RESPALDO_USADO: 'codigo_respaldo_usado',
  LOGOUT: 'logout',
  LOGOUT_TODAS: 'logout_todas',
  SESION_REVOCADA: 'sesion_revocada',
  SESION_REUTILIZADA: 'sesion_reutilizada',
  PASSWORD_CAMBIADA: 'password_cambiada',
  EMAIL_CAMBIADO: 'email_cambiado',
  PASSWORD_RESTABLECIDA: 'password_restablecida',
  RECUPERACION_SOLICITADA: 'recuperacion_solicitada',
  REGISTRO: 'registro',
  EMAIL_VERIFICADO: 'email_verificado',
  INVITACION_ACEPTADA: 'invitacion_aceptada',
  ACCION_CONFIGURADOR: 'accion_configurador',
  // Cambios que otra persona hace en la cuenta (Usuarios): quedan en la
  // bitacora de la afectada con quien lo hizo.
  CUENTA_EDITADA: 'cuenta_editada',
  PERMISOS_CAMBIADOS: 'permisos_cambiados',
  CUENTA_DESACTIVADA: 'cuenta_desactivada',
  CUENTA_ACTIVADA: 'cuenta_activada',
});

const registrarEvento = async (req, { usuarioId = null, email = null, tipo, detalle = null }) => {
  try {
    const { ip, userAgent } = datosCliente(req);
    await prisma.eventoSeguridad.create({
      data: {
        usuarioId,
        email: email ? String(email).slice(0, 191) : null,
        tipo,
        ip,
        userAgent,
        detalle: detalle ? String(detalle).slice(0, 2000) : null,
      },
    });
  } catch (error) {
    console.error('[seguridad] No se pudo registrar el evento', tipo, error?.message || error);
  }
};

const listarEventos = (usuarioId, limite = 30) => prisma.eventoSeguridad.findMany({
  where: { usuarioId },
  orderBy: { creadoEn: 'desc' },
  take: Math.min(Math.max(Number(limite) || 30, 1), 100),
  select: { id: true, tipo: true, ip: true, userAgent: true, detalle: true, creadoEn: true },
});

module.exports = { TIPOS, registrarEvento, listarEventos };
