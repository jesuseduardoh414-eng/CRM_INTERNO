// Controlador del modulo de autenticacion.
//
// Flujos:
//  - Registro (segun REGISTRO_MODO) -> codigo de 6 digitos por correo ->
//    verificacion -> aprobacion de un admin (o acceso directo en modo abierto).
//  - Login con bloqueo progresivo por cuenta -> 2FA (TOTP o codigo de
//    respaldo) si esta activo -> sesion (access 15 min + refresh rotatorio).
//  - Recuperacion por enlace de un solo uso (30 min) que cierra todas las
//    sesiones y avisa por correo.
//  - Gestion desde el perfil: cambiar contraseña, activar/desactivar 2FA,
//    ver y cerrar sesiones, ver la bitacora de seguridad.
//  - Invitaciones (admin) como hasta ahora.
//
// Reglas anti-enumeracion: login, registro, reenvio de codigo y "olvide mi
// contraseña" responden igual (mensaje y, en lo posible, tiempo) exista o no
// el correo. Los estados de la cuenta (bloqueada, sin verificar, pendiente)
// solo se revelan a quien ya demostro conocer la contraseña.
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const QRCode  = require('qrcode');
const prisma  = require('../lib/prisma');
const {
  validarPasswordNueva,
  esAreaValida,
  esRolValido,
  esEmailValido,
  areasValidas,
} = require('../utils/security.utils');
const { cifrar, descifrar, sha256, igualesSeguro } = require('../utils/cifrado.utils');
const { generarSecreto, verificarTotp, uriOtpauth } = require('../utils/totp.utils');
const { permisosEfectivos } = require('../utils/permisosArea.utils');
const { moduloActivo: moduloActivoConfig } = require('../services/configuracion.service');
const {
  ErrorSesion,
  datosCliente,
  crearSesion,
  rotarSesion,
  revocarPorRefresh,
  revocarSesion,
  revocarTodas,
  listarActivas,
  esDispositivoConocido,
} = require('../services/sesiones.service');
const { TIPOS, registrarEvento, listarEventos } = require('../services/seguridad.service');
const correo = require('../services/email.service');
const { configEnCache } = require('../services/configuracion.service');
const { reglasAcceso, debeActivar2FA } = require('../utils/politicas.utils');
const { invalidarCacheUsuario } = require('../middlewares/auth.middleware');
const { esAdminGlobal, veTodosLosUsuarios, gestionaUsuariosDe } = require('../utils/permissions.utils');
const { puede } = require('../utils/permisosArea.utils');

// ---------------------------------------------------------------------------
// Constantes y ayudas
// ---------------------------------------------------------------------------

const BCRYPT_COSTE = 12;
// Intentos y minutos de bloqueo salen de la configuración (seguridad.*).
const BLOQUEO_MAX_MIN = 24 * 60;
const CODIGO_VIGENCIA_MS = 15 * 60 * 1000;
const CODIGO_REENVIO_MS = 60 * 1000;
const CODIGO_MAX_INTENTOS = 5;
const RESET_VIGENCIA_MS = 30 * 60 * 1000;
const DESAFIO_2FA_TTL = '5m';
const AUDIENCIA_2FA = 'omnis-crm-2fa';
const EMISOR = 'omnis-crm';
const TOTAL_CODIGOS_RESPALDO = 10;

const MSG_CREDENCIALES = 'Correo o contraseña incorrectos';

/**
 * 'cerrado' (por defecto) | 'aprobacion' | 'abierto'. El CRM es de uso
 * interno: por decision del usuario las cuentas se crean solo por invitacion.
 * Un valor desconocido tambien cae en 'cerrado' (lo seguro).
 */
const modoRegistro = () => {
  const modo = String(reglasAcceso().registro || process.env.REGISTRO_MODO || 'cerrado').toLowerCase().trim();
  return ['cerrado', 'aprobacion', 'abierto'].includes(modo) ? modo : 'cerrado';
};

/** Dominios permitidos para registrarse (REGISTRO_DOMINIOS=omnis.mx,otra.com). Vacio = cualquiera. */
const dominiosRegistro = () => String(reglasAcceso().dominiosRegistro || process.env.REGISTRO_DOMINIOS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

const normalizarEmail = (email) => String(email || '').toLowerCase().trim();

const esTexto = (valor, max = 500) => typeof valor === 'string' && valor.length > 0 && valor.length <= max;

const usuarioPublico = (usuario) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  email: usuario.email,
  telefono: usuario.telefono ?? null,
  puesto: usuario.puesto ?? null,
  biografia: usuario.biografia ?? null,
  fotoPerfilUrl: usuario.fotoPerfilUrl ?? null,
  area: usuario.area,
  rol: usuario.rol,
  // Cuentas del portal de clientes: empresa del directorio que ven.
  empresaId: usuario.empresaId ?? null,
  dosFactoresActivo: Boolean(usuario.dosFactoresActivo),
  // La política exige 2FA y aún no la activó: el frontend lo manda a hacerlo.
  debeActivar2FA: debeActivar2FA(usuario),
  // Todas las casillas ya resueltas (area + rol + ajustes de la persona): el
  // frontend decide con esto qué menús y botones muestra.
  permisos: permisosEfectivos(usuario, configEnCache()),
});

// Hash ficticio contra el que se compara cuando el correo no existe, para que
// un login con correo desconocido tarde lo mismo que uno con contraseña
// incorrecta. Se calcula una sola vez, en el primer uso.
let hashFicticio = null;
const obtenerHashFicticio = async () => {
  if (!hashFicticio) {
    hashFicticio = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_COSTE);
  }
  return hashFicticio;
};

const minutosBloqueo = (intentos) => {
  const { intentosBloqueo, bloqueoMinutos } = reglasAcceso();
  const tramo = Math.max(Math.floor(intentos / intentosBloqueo) - 1, 0);
  return Math.min(bloqueoMinutos * 2 ** tramo, BLOQUEO_MAX_MIN);
};

const minutosRestantes = (hasta) => Math.max(Math.ceil((hasta.getTime() - Date.now()) / 60000), 1);

const generarCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// Codigos de respaldo: 10 caracteres sin ambiguos (0/O, 1/I/L), "XXXXX-XXXXX".
const ALFABETO_RESPALDO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizarRespaldo = (codigo) => String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const generarCodigosRespaldo = () => Array.from({ length: TOTAL_CODIGOS_RESPALDO }, () => {
  let texto = '';
  for (let i = 0; i < 10; i += 1) texto += ALFABETO_RESPALDO[crypto.randomInt(0, ALFABETO_RESPALDO.length)];
  return `${texto.slice(0, 5)}-${texto.slice(5)}`;
});

const contextoCorreo = (req) => ({ ...datosCliente(req), fecha: new Date() });

/**
 * Suma un intento fallido (contraseña o 2FA) y bloquea la cuenta cada
 * INTENTOS_POR_BLOQUEO fallos, con duracion que se duplica: 15, 30, 60 min...
 * hasta 24 h. El contador se reinicia al entrar bien o al restablecer la
 * contraseña por correo.
 */
const registrarFallo = async (req, usuario, tipo) => {
  const actualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { intentosFallidos: { increment: 1 } },
    select: { intentosFallidos: true },
  });
  await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo, detalle: `Intento fallido nº ${actualizado.intentosFallidos}` });

  if (actualizado.intentosFallidos % reglasAcceso().intentosBloqueo === 0) {
    const minutos = minutosBloqueo(actualizado.intentosFallidos);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { bloqueadoHasta: new Date(Date.now() + minutos * 60000) },
    });
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.CUENTA_BLOQUEADA, detalle: `${minutos} min` });
    correo.enviarAvisoBloqueo({ email: usuario.email, nombre: usuario.nombre, minutos, contexto: contextoCorreo(req) });
  }
};

const respuestaBloqueo = (res, hasta) => {
  const minutos = minutosRestantes(hasta);
  return res.status(423).json({
    error: `Por seguridad, tu cuenta está bloqueada ${minutos} min más por intentos fallidos. Espera o restablece tu contraseña.`,
    codigo: 'CUENTA_BLOQUEADA',
    reintentarEnMin: minutos,
  });
};

/** Abre la sesion tras validar credenciales (y 2FA si aplica). */
const completarLogin = async (req, res, usuario, { recordar }) => {
  const conocido = await esDispositivoConocido(usuario.id, req);

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoLoginEn: new Date() },
  });
  const tokens = await crearSesion(usuario.id, req, { recordar });
  await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.LOGIN_OK, detalle: recordar ? 'Sesión prolongada' : null });

  if (!conocido && configEnCache().avisos.nuevoDispositivo) {
    correo.enviarAvisoNuevoInicio({ email: usuario.email, nombre: usuario.nombre, contexto: contextoCorreo(req) });
  }

  return res.json({ mensaje: 'Inicio de sesión correcto', ...tokens, usuario: usuarioPublico(usuario) });
};

/** Comprueba la contraseña actual de alguien ya autenticado. */
const passwordCorrecta = async (usuarioId, password) => {
  if (!esTexto(password, 200)) return false;
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { password: true } });
  if (!usuario) return false;
  return bcrypt.compare(password, usuario.password);
};

/** Valida un codigo TOTP o, si no lo es, uno de respaldo (y lo consume). */
const verificarSegundoFactor = async (usuario, codigoBruto) => {
  const codigo = String(codigoBruto || '').trim();
  if (!codigo || codigo.length > 20) return { ok: false };

  if (/^\d{6}$/.test(codigo.replace(/\s+/g, ''))) {
    let secreto;
    try {
      secreto = descifrar(usuario.dosFactoresSecreto);
    } catch (error) {
      console.error('[2fa] No se pudo descifrar el secreto del usuario', usuario.id, error?.message);
      return { ok: false };
    }
    const paso = verificarTotp(secreto, codigo, usuario.dosFactoresUltimoPaso);
    if (paso === null) return { ok: false };
    // Anti-replay tambien entre peticiones simultaneas: solo una puede subir el paso.
    const { count } = await prisma.usuario.updateMany({
      where: {
        id: usuario.id,
        OR: [{ dosFactoresUltimoPaso: null }, { dosFactoresUltimoPaso: { lt: paso } }],
      },
      data: { dosFactoresUltimoPaso: paso },
    });
    return { ok: count === 1, metodo: 'totp' };
  }

  const normalizado = normalizarRespaldo(codigo);
  if (normalizado.length !== 10) return { ok: false };
  const hashes = Array.isArray(usuario.codigosRespaldo) ? usuario.codigosRespaldo : [];
  const hash = sha256(normalizado);
  const indice = hashes.findIndex((h) => igualesSeguro(h, hash));
  if (indice === -1) return { ok: false };
  const restantes = hashes.filter((_, i) => i !== indice);
  await prisma.usuario.update({ where: { id: usuario.id }, data: { codigosRespaldo: restantes } });
  return { ok: true, metodo: 'respaldo', restantes: restantes.length };
};

// ---------------------------------------------------------------------------
// GET /api/auth/config
// ---------------------------------------------------------------------------
const config = (_req, res) => res.json({
  registro: modoRegistro(),
  dominios: dominiosRegistro(),
  passwordMin: reglasAcceso().passwordMin,
  permitirRecordar: reglasAcceso().recordarDias > 0,
  recordarDias: reglasAcceso().recordarDias,
  areas: areasValidas(),
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
const register = async (req, res) => {
  const modo = modoRegistro();
  if (modo === 'cerrado') {
    return res.status(403).json({ error: 'El registro está deshabilitado. Solicita una invitación al administrador.', codigo: 'REGISTRO_CERRADO' });
  }

  const { nombre, email, password, area, aceptaTerminos } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim().replace(/\s+/g, ' ') : '';
  const emailNormalizado = normalizarEmail(email);

  if (nombreLimpio.length < 3 || nombreLimpio.length > 100) {
    return res.status(400).json({ error: 'Escribe tu nombre completo (entre 3 y 100 caracteres)' });
  }
  if (!esEmailValido(emailNormalizado) || emailNormalizado.length > 191) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  }
  if (!esAreaValida(area)) {
    return res.status(400).json({ error: 'Selecciona un área válida' });
  }
  if (aceptaTerminos !== true) {
    return res.status(400).json({ error: 'Debes aceptar los términos de uso y la política de privacidad' });
  }
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'La contraseña es requerida' });
  }

  const dominios = dominiosRegistro();
  if (dominios.length > 0 && !dominios.includes(emailNormalizado.split('@')[1])) {
    return res.status(400).json({ error: `Solo se admiten correos corporativos (${dominios.map((d) => `@${d}`).join(', ')})` });
  }

  const validacion = await validarPasswordNueva(password, { email: emailNormalizado, nombre: nombreLimpio });
  if (!validacion.valido) {
    return res.status(400).json({ error: 'La contraseña no cumple los requisitos', detalles: validacion.errores });
  }

  const respuestaNeutra = {
    mensaje: 'Si el correo puede registrarse, te enviamos un código de verificación de 6 dígitos.',
    email: emailNormalizado,
  };

  try {
    // El hash se calcula siempre, exista o no la cuenta, para no delatarla por tiempo.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COSTE);
    const codigo = generarCodigo();
    const datosCodigo = {
      verificationToken: sha256(codigo),
      verificationTokenExpires: new Date(Date.now() + CODIGO_VIGENCIA_MS),
      verificacionIntentos: 0,
    };

    const existente = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });

    if (existente && existente.estado !== 'pendiente_verificacion') {
      correo.enviarAvisoRegistroExistente({ email: existente.email, nombre: existente.nombre });
      return res.status(201).json(respuestaNeutra);
    }

    let usuario;
    if (existente) {
      // Registro previo sin verificar: se reemplazan sus datos. Sin acceso al
      // correo nadie puede terminarlo, asi que no hay nada que proteger.
      usuario = await prisma.usuario.update({
        where: { id: existente.id },
        data: { nombre: nombreLimpio, password: passwordHash, area: String(area).toUpperCase(), ...datosCodigo },
      });
    } else {
      usuario = await prisma.usuario.create({
        data: {
          nombre: nombreLimpio,
          email: emailNormalizado,
          password: passwordHash,
          area: String(area).toUpperCase(),
          rol: 'MIEMBRO',
          estado: 'pendiente_verificacion',
          verificado: false,
          passwordCambiadoEn: new Date(),
          ...datosCodigo,
        },
      });
    }

    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.REGISTRO });
    correo.enviarCodigoVerificacion({ email: usuario.email, nombre: usuario.nombre, codigo })
      .catch((error) => console.error('[register] No se pudo enviar el código:', error?.message || error));

    return res.status(201).json(respuestaNeutra);
  } catch (error) {
    if (error?.code === 'P2002') return res.status(201).json(respuestaNeutra);
    console.error('[register]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/verificar-email  { email, codigo }
// ---------------------------------------------------------------------------
const verificarEmail = async (req, res) => {
  const emailNormalizado = normalizarEmail(req.body?.email);
  const codigo = String(req.body?.codigo || '').replace(/\s+/g, '');
  const errorGenerico = { error: 'El código es incorrecto o ya caducó', codigo: 'CODIGO_INVALIDO' };

  if (!esEmailValido(emailNormalizado) || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json(errorGenerico);
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });
    if (!usuario || usuario.estado !== 'pendiente_verificacion' || !usuario.verificationToken) {
      return res.status(400).json(errorGenerico);
    }

    if (!usuario.verificationTokenExpires || usuario.verificationTokenExpires < new Date()
      || usuario.verificacionIntentos >= CODIGO_MAX_INTENTOS) {
      return res.status(400).json({ error: 'El código caducó o se agotaron los intentos. Pide uno nuevo.', codigo: 'CODIGO_EXPIRADO' });
    }

    if (!igualesSeguro(sha256(codigo), usuario.verificationToken)) {
      const { verificacionIntentos } = await prisma.usuario.update({
        where: { id: usuario.id },
        data: { verificacionIntentos: { increment: 1 } },
        select: { verificacionIntentos: true },
      });
      const restantes = Math.max(CODIGO_MAX_INTENTOS - verificacionIntentos, 0);
      return res.status(400).json({
        error: restantes > 0 ? `Código incorrecto. Te quedan ${restantes} intento${restantes === 1 ? '' : 's'}.` : 'Código incorrecto. Pide uno nuevo.',
        codigo: restantes > 0 ? 'CODIGO_INVALIDO' : 'CODIGO_EXPIRADO',
        intentosRestantes: restantes,
      });
    }

    const abierto = modoRegistro() === 'abierto';
    const { count } = await prisma.usuario.updateMany({
      where: { id: usuario.id, estado: 'pendiente_verificacion', verificationToken: usuario.verificationToken },
      data: {
        verificado: true,
        verificationToken: null,
        verificationTokenExpires: null,
        verificacionIntentos: 0,
        estado: abierto ? 'activo' : 'pendiente',
      },
    });
    if (count === 0) return res.status(400).json(errorGenerico);

    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.EMAIL_VERIFICADO });

    if (abierto) {
      return completarLogin(req, res, usuario, { recordar: false });
    }

    // Aviso a quien puede aprobar la cuenta ("usuarios.desactivar" con alcance
    // sobre su area): notificacion en la campana y correo.
    const equipo = await prisma.usuario.findMany({
      where: { rol: { in: ['ADMIN', 'MIEMBRO'] }, OR: [{ estado: 'activo' }, { estado: null }] },
      select: { id: true, email: true, area: true, rol: true, permisos: true, permisosFinanzas: true },
    });
    const destinatarios = equipo.filter((admin) => puede(admin, 'usuarios.desactivar') && gestionaUsuariosDe(admin, usuario.area));
    if (destinatarios.length > 0) {
      await prisma.notificacion.createMany({
        data: destinatarios.map((admin) => ({
          usuarioId: admin.id,
          tipo: 'registro_pendiente',
          mensaje: `${usuario.nombre} (${usuario.email}) se registró en ${usuario.area} y espera aprobación`,
          actorNombre: usuario.nombre,
        })),
      }).catch((error) => console.error('[verificarEmail] notificaciones', error?.message));
      destinatarios.forEach((admin) => correo.enviarAvisoRegistroPendiente({
        emailAdmin: admin.email, nombre: usuario.nombre, email: usuario.email, area: usuario.area,
      }));
    }

    return res.json({
      mensaje: 'Correo verificado. Un administrador revisará tu cuenta y te avisaremos por correo cuando esté activa.',
      pendienteAprobacion: true,
    });
  } catch (error) {
    console.error('[verificarEmail]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/reenviar-codigo  { email }
// ---------------------------------------------------------------------------
const reenviarCodigo = async (req, res) => {
  const emailNormalizado = normalizarEmail(req.body?.email);
  const respuesta = { mensaje: 'Si hay un registro pendiente con ese correo, te enviamos un código nuevo.', esperaSegundos: 60 };
  if (!esEmailValido(emailNormalizado)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });
    if (!usuario || usuario.estado !== 'pendiente_verificacion') return res.json(respuesta);

    const emitidoEn = usuario.verificationTokenExpires
      ? usuario.verificationTokenExpires.getTime() - CODIGO_VIGENCIA_MS
      : 0;
    if (Date.now() - emitidoEn < CODIGO_REENVIO_MS) return res.json(respuesta);

    const codigo = generarCodigo();
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        verificationToken: sha256(codigo),
        verificationTokenExpires: new Date(Date.now() + CODIGO_VIGENCIA_MS),
        verificacionIntentos: 0,
      },
    });
    correo.enviarCodigoVerificacion({ email: usuario.email, nombre: usuario.nombre, codigo })
      .catch((error) => console.error('[reenviarCodigo]', error?.message || error));
    return res.json(respuesta);
  } catch (error) {
    console.error('[reenviarCodigo]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/auth/verify/:token  (enlace antiguo, se mantiene por compatibilidad)
// ---------------------------------------------------------------------------
const verifyAccount = async (req, res) => {
  const { token } = req.params;
  if (!esTexto(token, 200)) return res.status(400).json({ error: 'Token de verificación inválido o ya utilizado' });

  try {
    const usuario = await prisma.usuario.findFirst({ where: { verificationToken: token } });
    if (!usuario) {
      return res.status(400).json({ error: 'Token de verificación inválido o ya utilizado' });
    }
    if (usuario.verificationTokenExpires && usuario.verificationTokenExpires < new Date()) {
      return res.status(400).json({ error: 'El enlace de verificación ha expirado' });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { verificado: true, verificationToken: null },
    });

    return res.json({ mensaje: 'Cuenta verificada correctamente. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('[verifyAccount]', error);
    return res.status(500).json({ error: 'Error al verificar cuenta' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/login  { email, password, recordar }
// ---------------------------------------------------------------------------
const login = async (req, res) => {
  const { email, password, recordar } = req.body || {};

  if (!esTexto(email, 191) || !esTexto(password, 200)) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
  }
  const emailNormalizado = normalizarEmail(email);

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });

    // Siempre se hace un bcrypt.compare, exista o no el usuario, y la
    // respuesta es la misma: no se distingue "correo desconocido" de
    // "contraseña incorrecta" ni por mensaje ni por tiempo.
    const hash = usuario?.password || await obtenerHashFicticio();
    const passwordValida = await bcrypt.compare(password, hash);

    if (!usuario) {
      await registrarEvento(req, { email: emailNormalizado, tipo: TIPOS.LOGIN_FALLIDO, detalle: 'Correo no registrado' });
      return res.status(401).json({ error: MSG_CREDENCIALES });
    }

    // Cuenta bloqueada: solo se dice a quien acierta la contraseña. A los
    // demas se les responde lo mismo que a un fallo normal.
    if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
      await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.LOGIN_BLOQUEADO });
      return passwordValida ? respuestaBloqueo(res, usuario.bloqueadoHasta) : res.status(401).json({ error: MSG_CREDENCIALES });
    }

    if (!passwordValida) {
      await registrarFallo(req, usuario, TIPOS.LOGIN_FALLIDO);
      return res.status(401).json({ error: MSG_CREDENCIALES });
    }

    // El estado se comprueba DESPUES de validar la contraseña.
    if (usuario.estado === 'pendiente_verificacion') {
      return res.status(403).json({
        error: 'Aún no verificas tu correo. Escribe el código que te enviamos.',
        codigo: 'EMAIL_NO_VERIFICADO',
        email: usuario.email,
      });
    }
    if (usuario.estado === 'pendiente') {
      return res.status(403).json({
        error: 'Tu cuenta está pendiente de aprobación por un administrador. Te avisaremos por correo cuando esté activa.',
        codigo: 'PENDIENTE_APROBACION',
      });
    }
    if (usuario.estado && usuario.estado !== 'activo') {
      return res.status(403).json({ error: 'Tu cuenta no está activa, contacta al administrador', codigo: 'CUENTA_INACTIVA' });
    }
    // El portal de clientes se retiró: las cuentas de cliente ya no entran.
    if (usuario.rol === 'CLIENTE' && !(await moduloActivoConfig('portalClientes'))) {
      return res.status(403).json({ error: 'El portal de clientes ya no está disponible. Contacta a tu asesor.', codigo: 'PORTAL_DESACTIVADO' });
    }

    if (usuario.dosFactoresActivo && usuario.dosFactoresSecreto) {
      const desafio = jwt.sign(
        { typ: '2fa', recordar: Boolean(recordar) },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: DESAFIO_2FA_TTL, issuer: EMISOR, audience: AUDIENCIA_2FA, subject: String(usuario.id), jwtid: crypto.randomUUID() },
      );
      return res.json({ requiere2FA: true, desafio, mensaje: 'Introduce el código de tu app de autenticación' });
    }

    return completarLogin(req, res, usuario, { recordar: Boolean(recordar) });
  } catch (error) {
    console.error('[login]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/login  { desafio, codigo }
// ---------------------------------------------------------------------------
const login2fa = async (req, res) => {
  const { desafio, codigo } = req.body || {};
  if (!esTexto(desafio, 2000) || !esTexto(codigo, 20)) {
    return res.status(400).json({ error: 'Falta el código de verificación' });
  }

  let payload;
  try {
    payload = jwt.verify(desafio, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: EMISOR, audience: AUDIENCIA_2FA });
    if (payload.typ !== '2fa') throw new Error('tipo');
  } catch (_error) {
    return res.status(401).json({ error: 'La verificación caducó. Vuelve a iniciar sesión.', codigo: 'DESAFIO_EXPIRADO' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: Number(payload.sub) } });
    if (!usuario || !usuario.dosFactoresActivo || (usuario.estado && usuario.estado !== 'activo')) {
      return res.status(401).json({ error: 'La verificación caducó. Vuelve a iniciar sesión.', codigo: 'DESAFIO_EXPIRADO' });
    }
    if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
      return respuestaBloqueo(res, usuario.bloqueadoHasta);
    }

    const resultado = await verificarSegundoFactor(usuario, codigo);
    if (!resultado.ok) {
      await registrarFallo(req, usuario, TIPOS.DOS_FACTORES_FALLIDO);
      return res.status(401).json({ error: 'Código incorrecto o ya utilizado', codigo: 'CODIGO_2FA_INVALIDO' });
    }
    if (resultado.metodo === 'respaldo') {
      await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.CODIGO_RESPALDO_USADO, detalle: `Quedan ${resultado.restantes}` });
    }

    return completarLogin(req, res, usuario, { recordar: Boolean(payload.recordar) });
  } catch (error) {
    console.error('[login2fa]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/refresh  { refreshToken }
// ---------------------------------------------------------------------------
const refresh = async (req, res) => {
  try {
    const tokens = await rotarSesion(req.body?.refreshToken, req);
    return res.json(tokens);
  } catch (error) {
    if (error instanceof ErrorSesion) {
      if (error.reutilizado) {
        const { usuarioId } = error.reutilizado;
        invalidarCacheUsuario(usuarioId);
        await registrarEvento(req, { usuarioId, tipo: TIPOS.SESION_REUTILIZADA, detalle: 'Refresh token reutilizado; sesión revocada' });
        const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { email: true, nombre: true } });
        if (usuario) correo.enviarAvisoSesionComprometida({ ...usuario, contexto: contextoCorreo(req) });
      }
      return res.status(error.status).json({ error: error.message, codigo: error.codigo });
    }
    console.error('[refresh]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/logout  { refreshToken }
// ---------------------------------------------------------------------------
// No exige access token: puede haber caducado y aun asi hay que poder cerrar.
const logout = async (req, res) => {
  try {
    const sesionId = await revocarPorRefresh(req.body?.refreshToken);
    if (sesionId) {
      const sesion = await prisma.sesion.findUnique({ where: { id: sesionId }, select: { usuarioId: true } });
      if (sesion) {
        invalidarCacheUsuario(sesion.usuarioId);
        await registrarEvento(req, { usuarioId: sesion.usuarioId, tipo: TIPOS.LOGOUT });
      }
    }
  } catch (error) {
    console.error('[logout]', error);
  }
  return res.json({ mensaje: 'Sesión cerrada' });
};

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
const me = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: {
        id: true, nombre: true, email: true, telefono: true, puesto: true, biografia: true,
        fotoPerfilUrl: true, area: true, rol: true, creadoEn: true, dosFactoresActivo: true, empresaId: true,
        permisosFinanzas: true, permisos: true,
      },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { permisosFinanzas: _pf, permisos: _p, ...publico } = usuario;
    return res.json({ usuario: { ...publico, ...usuarioPublico(usuario) } });
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/auth/seguridad  -> resumen para la pantalla de Perfil
// ---------------------------------------------------------------------------
const resumenSeguridad = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { dosFactoresActivo: true, codigosRespaldo: true, ultimoLoginEn: true, passwordCambiadoEn: true, creadoEn: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({
      dosFactoresActivo: usuario.dosFactoresActivo,
      codigosRespaldoRestantes: Array.isArray(usuario.codigosRespaldo) ? usuario.codigosRespaldo.length : 0,
      ultimoLoginEn: usuario.ultimoLoginEn,
      passwordCambiadoEn: usuario.passwordCambiadoEn,
      creadoEn: usuario.creadoEn,
    });
  } catch (error) {
    console.error('[resumenSeguridad]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password  { email }
// ---------------------------------------------------------------------------
const forgotPassword = async (req, res) => {
  const emailNormalizado = normalizarEmail(req.body?.email);
  if (!esEmailValido(emailNormalizado)) return res.status(400).json({ error: 'Escribe un correo válido' });

  const respuestaNeutra = { mensaje: 'Si el correo está registrado, recibirás un enlace de recuperación' };

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });
    const puedeRecuperar = usuario && usuario.estado !== 'pendiente_verificacion' && usuario.estado !== 'inactivo';
    if (!puedeRecuperar) return res.json(respuestaNeutra);

    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { resetToken: sha256(token), resetTokenExpires: new Date(Date.now() + RESET_VIGENCIA_MS) },
    });
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.RECUPERACION_SOLICITADA });

    // Sin await: esperar al proveedor de correo haria que la respuesta tarde
    // mas cuando el correo existe, y eso lo delataria.
    correo.sendResetEmail(usuario.email, token)
      .catch((error) => console.error('[forgotPassword] No se pudo enviar:', error?.message || error));

    return res.json(respuestaNeutra);
  } catch (error) {
    console.error('[forgotPassword]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const buscarPorResetToken = (token) => {
  if (!esTexto(token, 200)) return null;
  return prisma.usuario.findFirst({
    where: { resetToken: sha256(token), resetTokenExpires: { gt: new Date() } },
  });
};

/** Oculta parte del correo: j***s@omnis.mx */
const enmascararEmail = (email) => {
  const [local, dominio] = String(email).split('@');
  if (!dominio) return '';
  const visible = local.length <= 2 ? local[0] : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}`;
  return `${visible}@${dominio}`;
};

// ---------------------------------------------------------------------------
// GET /api/auth/reset-password/:token  -> ¿sigue valido el enlace?
// ---------------------------------------------------------------------------
const validarResetToken = async (req, res) => {
  try {
    const usuario = await buscarPorResetToken(req.params.token);
    if (!usuario) return res.status(400).json({ error: 'El enlace no es válido o ya caducó', codigo: 'TOKEN_INVALIDO' });
    return res.json({ valido: true, email: enmascararEmail(usuario.email) });
  } catch (error) {
    console.error('[validarResetToken]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password/:token  { password }
// ---------------------------------------------------------------------------
const resetPassword = async (req, res) => {
  const { password } = req.body || {};
  if (!esTexto(password, 200)) return res.status(400).json({ error: 'La nueva contraseña es requerida' });

  try {
    const usuario = await buscarPorResetToken(req.params.token);
    if (!usuario) {
      return res.status(400).json({ error: 'El enlace no es válido o ya caducó. Pide uno nuevo.', codigo: 'TOKEN_INVALIDO' });
    }

    const validacion = await validarPasswordNueva(password, { email: usuario.email, nombre: usuario.nombre });
    if (!validacion.valido) {
      return res.status(400).json({ error: 'La contraseña no cumple los requisitos', detalles: validacion.errores });
    }
    if (await bcrypt.compare(password, usuario.password)) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la anterior' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COSTE);
    // Un solo uso, tambien con dos peticiones a la vez.
    const { count } = await prisma.usuario.updateMany({
      where: { id: usuario.id, resetToken: usuario.resetToken },
      data: {
        password: passwordHash,
        passwordCambiadoEn: new Date(),
        resetToken: null,
        resetTokenExpires: null,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });
    if (count === 0) return res.status(400).json({ error: 'El enlace ya se utilizó', codigo: 'TOKEN_INVALIDO' });

    await revocarTodas(usuario.id);
    invalidarCacheUsuario(usuario.id);
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.PASSWORD_RESTABLECIDA });
    correo.enviarAvisoPasswordCambiada({ email: usuario.email, nombre: usuario.nombre, contexto: contextoCorreo(req) });

    return res.json({ mensaje: 'Contraseña actualizada. Cerramos todas tus sesiones por seguridad; ya puedes entrar con la nueva.' });
  } catch (error) {
    console.error('[resetPassword]', error);
    return res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/cambiar-password  { passwordActual, passwordNueva }
// ---------------------------------------------------------------------------
const cambiarPassword = async (req, res) => {
  const { passwordActual, passwordNueva } = req.body || {};
  if (!esTexto(passwordActual, 200) || !esTexto(passwordNueva, 200)) {
    return res.status(400).json({ error: 'Escribe tu contraseña actual y la nueva' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (!(await bcrypt.compare(passwordActual, usuario.password))) {
      await registrarFallo(req, usuario, TIPOS.LOGIN_FALLIDO);
      return res.status(400).json({ error: 'La contraseña actual no es correcta', codigo: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    if (passwordActual === passwordNueva) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
    }

    const validacion = await validarPasswordNueva(passwordNueva, { email: usuario.email, nombre: usuario.nombre });
    if (!validacion.valido) {
      return res.status(400).json({ error: 'La contraseña no cumple los requisitos', detalles: validacion.errores });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { password: await bcrypt.hash(passwordNueva, BCRYPT_COSTE), passwordCambiadoEn: new Date(), intentosFallidos: 0 },
    });
    const { count: cerradas } = await revocarTodas(usuario.id, req.sesionId);
    invalidarCacheUsuario(usuario.id);
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.PASSWORD_CAMBIADA });
    correo.enviarAvisoPasswordCambiada({ email: usuario.email, nombre: usuario.nombre, contexto: contextoCorreo(req) });

    return res.json({ mensaje: 'Contraseña actualizada', sesionesCerradas: cerradas });
  } catch (error) {
    console.error('[cambiarPassword]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// Sesiones y bitacora (perfil)
// ---------------------------------------------------------------------------
const listarSesiones = async (req, res) => {
  try {
    const sesiones = await listarActivas(req.usuario.id);
    return res.json(sesiones.map((s) => ({ ...s, actual: s.id === req.sesionId })));
  } catch (error) {
    console.error('[listarSesiones]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const cerrarSesion = async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return res.status(400).json({ error: 'Sesión inválida' });
  try {
    const { count } = await revocarSesion(id, req.usuario.id);
    if (count === 0) return res.status(404).json({ error: 'La sesión no existe o ya estaba cerrada' });
    invalidarCacheUsuario(req.usuario.id);
    await registrarEvento(req, { usuarioId: req.usuario.id, email: req.usuario.email, tipo: TIPOS.SESION_REVOCADA });
    return res.json({ mensaje: 'Sesión cerrada', actual: id === req.sesionId });
  } catch (error) {
    console.error('[cerrarSesion]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const cerrarOtrasSesiones = async (req, res) => {
  try {
    const { count } = await revocarTodas(req.usuario.id, req.sesionId);
    invalidarCacheUsuario(req.usuario.id);
    await registrarEvento(req, { usuarioId: req.usuario.id, email: req.usuario.email, tipo: TIPOS.LOGOUT_TODAS, detalle: `${count} sesiones` });
    return res.json({ mensaje: count > 0 ? `Cerramos ${count} sesión(es)` : 'No había otras sesiones abiertas', cerradas: count });
  } catch (error) {
    console.error('[cerrarOtrasSesiones]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const eventosSeguridad = async (req, res) => {
  try {
    return res.json(await listarEventos(req.usuario.id, req.query.limite));
  } catch (error) {
    console.error('[eventosSeguridad]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// Doble factor (perfil)
// ---------------------------------------------------------------------------

// POST /api/auth/2fa/configurar { password } -> secreto + QR (aun no activo)
const configurar2fa = async (req, res) => {
  try {
    if (!(await passwordCorrecta(req.usuario.id, req.body?.password))) {
      return res.status(400).json({ error: 'La contraseña no es correcta', codigo: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { email: true, dosFactoresActivo: true } });
    if (usuario.dosFactoresActivo) {
      return res.status(409).json({ error: 'La verificación en dos pasos ya está activa' });
    }

    const secreto = generarSecreto();
    await prisma.usuario.update({ where: { id: req.usuario.id }, data: { dosFactoresPendiente: cifrar(secreto) } });
    const otpauth = uriOtpauth({ secreto, cuenta: usuario.email, emisor: configEnCache().marca.nombreSistema });
    const qr = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: '#10233f', light: '#ffffff' } });

    return res.json({ secreto, otpauth, qr });
  } catch (error) {
    console.error('[configurar2fa]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /api/auth/2fa/activar { codigo } -> activa y devuelve codigos de respaldo (una sola vez)
const activar2fa = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario?.dosFactoresPendiente) {
      return res.status(400).json({ error: 'Primero inicia la configuración de la verificación en dos pasos' });
    }
    const secreto = descifrar(usuario.dosFactoresPendiente);
    const paso = verificarTotp(secreto, req.body?.codigo);
    if (paso === null) {
      return res.status(400).json({ error: 'El código no coincide. Revisa que la hora de tu teléfono sea correcta.', codigo: 'CODIGO_2FA_INVALIDO' });
    }

    const codigos = generarCodigosRespaldo();
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        dosFactoresActivo: true,
        dosFactoresSecreto: usuario.dosFactoresPendiente,
        dosFactoresPendiente: null,
        dosFactoresUltimoPaso: paso,
        codigosRespaldo: codigos.map((c) => sha256(normalizarRespaldo(c))),
      },
    });
    // Las demas sesiones se abrieron sin segundo factor: se cierran.
    await revocarTodas(usuario.id, req.sesionId);
    invalidarCacheUsuario(usuario.id);
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.DOS_FACTORES_ACTIVADO });
    correo.enviarAvisoDosFactores({ email: usuario.email, nombre: usuario.nombre, activado: true, contexto: contextoCorreo(req) });

    return res.json({ mensaje: 'Verificación en dos pasos activada', codigosRespaldo: codigos });
  } catch (error) {
    console.error('[activar2fa]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /api/auth/2fa/desactivar { password, codigo }
const desactivar2fa = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario?.dosFactoresActivo) return res.status(400).json({ error: 'La verificación en dos pasos no está activa' });
    if (!esTexto(req.body?.password, 200) || !(await bcrypt.compare(req.body.password, usuario.password))) {
      return res.status(400).json({ error: 'La contraseña no es correcta', codigo: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    const resultado = await verificarSegundoFactor(usuario, req.body?.codigo);
    if (!resultado.ok) {
      await registrarFallo(req, usuario, TIPOS.DOS_FACTORES_FALLIDO);
      return res.status(400).json({ error: 'Código incorrecto o ya utilizado', codigo: 'CODIGO_2FA_INVALIDO' });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { dosFactoresActivo: false, dosFactoresSecreto: null, dosFactoresPendiente: null, dosFactoresUltimoPaso: null, codigosRespaldo: null },
    });
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.DOS_FACTORES_DESACTIVADO });
    correo.enviarAvisoDosFactores({ email: usuario.email, nombre: usuario.nombre, activado: false, contexto: contextoCorreo(req) });
    return res.json({ mensaje: 'Verificación en dos pasos desactivada' });
  } catch (error) {
    console.error('[desactivar2fa]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /api/auth/2fa/codigos-respaldo { password } -> genera codigos nuevos (invalida los anteriores)
const regenerarCodigosRespaldo = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { id: true, email: true, password: true, dosFactoresActivo: true } });
    if (!usuario?.dosFactoresActivo) return res.status(400).json({ error: 'La verificación en dos pasos no está activa' });
    if (!esTexto(req.body?.password, 200) || !(await bcrypt.compare(req.body.password, usuario.password))) {
      return res.status(400).json({ error: 'La contraseña no es correcta', codigo: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    const codigos = generarCodigosRespaldo();
    await prisma.usuario.update({ where: { id: usuario.id }, data: { codigosRespaldo: codigos.map((c) => sha256(normalizarRespaldo(c))) } });
    await registrarEvento(req, { usuarioId: usuario.id, email: usuario.email, tipo: TIPOS.CODIGOS_RESPALDO_REGENERADOS });
    return res.json({ mensaje: 'Códigos de respaldo nuevos generados', codigosRespaldo: codigos });
  } catch (error) {
    console.error('[regenerarCodigosRespaldo]', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------------------------------------------------------------------------
// INVITACIONES
// ---------------------------------------------------------------------------

// Vigencia de las invitaciones: seguridad.invitacionHoras (por defecto 48).
const vigenciaInvitacionMs = () => reglasAcceso().invitacionHoras * 60 * 60 * 1000;

/**
 * Crea (o renueva) la invitación de un correo y devuelve el token nuevo.
 * Si ya habia invitaciones no aceptadas para ese correo se reutiliza la mas
 * reciente y se borran las duplicadas. Los datos deben llegar ya validados
 * (area dentro del enum, rol ADMIN/MIEMBRO, correo normalizado).
 * La usan `invitar` (auth) y `crear` (usuarios) para que ambos flujos
 * terminen en la misma tabla y el enlace /invitacion/:token funcione.
 */
const generarInvitacion = async ({ nombre, email, area, rol, creadoPor, empresaId = null }) => {
  const emailNormalizado = normalizarEmail(email);
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEn = new Date(Date.now() + vigenciaInvitacionMs());
  const datos = {
    nombre: String(nombre).trim(),
    email: emailNormalizado,
    area: String(area).toUpperCase(),
    rol: String(rol).toLowerCase(),
    token,
    expiraEn,
    estado: 'pendiente',
    creadoPor,
    empresaId,
  };

  const invitacionesExistentes = await prisma.invitacion.findMany({
    where: { email: emailNormalizado, estado: { not: 'aceptada' } },
    orderBy: { creadoEn: 'desc' },
    select: { id: true },
  });

  let invitacion;
  if (invitacionesExistentes.length > 0) {
    const [invitacionActual, ...duplicadas] = invitacionesExistentes;
    invitacion = await prisma.invitacion.update({ where: { id: invitacionActual.id }, data: datos });
    if (duplicadas.length > 0) {
      await prisma.invitacion.deleteMany({ where: { id: { in: duplicadas.map((inv) => inv.id) } } });
    }
  } else {
    invitacion = await prisma.invitacion.create({ data: datos });
  }

  return { invitacion, token };
};

const invitar = async (req, res) => {
  const { nombre, email, area, rol } = req.body;

  if (!nombre || !email || !area || !rol) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  const emailNormalizado = normalizarEmail(email);
  if (!esEmailValido(emailNormalizado)) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  }
  if (!esAreaValida(area)) {
    return res.status(400).json({ error: 'Área no válida' });
  }
  if (!esRolValido(rol)) {
    return res.status(400).json({ error: 'Rol no válido' });
  }
  const areaNormalizada = String(area).toUpperCase();

  try {
    const usuarioExistente = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });
    if (usuarioExistente) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    if (!gestionaUsuariosDe(req.usuario, areaNormalizada)) {
      return res.status(403).json({ error: 'Solo puedes invitar usuarios de tu propia área' });
    }
    if (String(rol).toUpperCase() === 'ADMIN' && !esAdminGlobal(req.usuario)) {
      return res.status(403).json({ error: 'Solo el administrador global puede asignar el rol de administrador' });
    }

    const { token } = await generarInvitacion({
      nombre,
      email: emailNormalizado,
      area: areaNormalizada,
      rol,
      creadoPor: req.usuario.id,
    });

    // La invitacion ya esta guardada: si falla el correo se avisa, pero no
    // se responde 500 (se puede reenviar desde la lista de invitaciones).
    try {
      await correo.enviarInvitacion({ nombre: String(nombre).trim(), email: emailNormalizado, token });
    } catch (errorCorreo) {
      console.error('[invitar] No se pudo enviar el correo:', errorCorreo?.message || errorCorreo);
      return res.status(201).json({
        mensaje: `Invitación guardada para ${emailNormalizado}`,
        advertencia: 'La invitación se guardó pero no se pudo enviar el correo. Puedes reenviarla desde la lista de invitaciones.',
      });
    }

    return res.status(201).json({ mensaje: `Invitación enviada a ${emailNormalizado}` });
  } catch (error) {
    console.error('[invitar]', error);
    return res.status(500).json({ error: 'Error al enviar invitación' });
  }
};

const verificarInvitacion = async (req, res) => {
  const { token } = req.params;
  if (!esTexto(token, 200)) return res.status(404).json({ error: 'Invitación no válida' });

  try {
    const invitacion = await prisma.invitacion.findUnique({
      where: { token },
      include: { empresa: { select: { nombre: true, nombreComercial: true } } },
    });

    if (!invitacion) {
      return res.status(404).json({ error: 'Invitación no válida' });
    }

    if (invitacion.estado === 'aceptada') {
      return res.status(409).json({ error: 'Invitación ya utilizada' });
    }

    if (invitacion.expiraEn < new Date() || invitacion.estado === 'expirada') {
      return res.status(410).json({ error: 'Invitación expirada' });
    }

    const esCliente = invitacion.rol === 'cliente';
    // Portal retirado: se avisa al abrir el enlace, no despues de llenar el formulario.
    if (esCliente && !(await moduloActivoConfig('portalClientes'))) {
      return res.status(410).json({ error: 'El portal de clientes ya no está disponible, esta invitación no se puede usar.' });
    }
    return res.json({
      nombre: invitacion.nombre,
      email: invitacion.email,
      area: esCliente ? null : invitacion.area,
      esCliente,
      empresa: esCliente ? (invitacion.empresa?.nombreComercial || invitacion.empresa?.nombre || null) : null,
    });
  } catch (error) {
    console.error('[verificarInvitacion]', error);
    return res.status(500).json({ error: 'Error al verificar invitación' });
  }
};

const aceptarInvitacion = async (req, res) => {
  const { token } = req.params;
  const { password, confirmar_password } = req.body || {};

  if (!esTexto(password, 200) || !esTexto(confirmar_password, 200)) {
    return res.status(400).json({ error: 'La contraseña es requerida' });
  }

  if (password !== confirmar_password) {
    return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  }

  try {
    const invitacion = await prisma.invitacion.findUnique({ where: { token } });

    if (!invitacion || invitacion.estado !== 'pendiente' || invitacion.expiraEn < new Date()) {
      return res.status(400).json({ error: 'Invitación inválida o expirada' });
    }

    // Misma politica de contraseña que en el resto del modulo.
    const validacion = await validarPasswordNueva(password, { email: invitacion.email, nombre: invitacion.nombre });
    if (!validacion.valido) {
      return res.status(400).json({ error: 'La contraseña no cumple los requisitos', detalles: validacion.errores });
    }

    // Invitación al portal de clientes: la empresa debe seguir existiendo y
    // activa (si se desactivó después de invitar, no se crea la cuenta).
    const esCliente = invitacion.rol === 'cliente';
    if (esCliente) {
      if (!(await moduloActivoConfig('portalClientes'))) {
        return res.status(410).json({ error: 'El portal de clientes ya no está disponible, esta invitación no se puede usar.' });
      }
      const empresa = invitacion.empresaId
        ? await prisma.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { estado: true } })
        : null;
      if (!empresa || empresa.estado !== 'ACTIVO') {
        return res.status(400).json({ error: 'Esta invitación ya no es válida. Pide a tu contacto que te la vuelva a enviar.' });
      }
    }

    // `Invitacion.area` es texto libre; `Usuario.area` es el enum Area.
    if (!esCliente && !esAreaValida(invitacion.area)) {
      return res.status(400).json({ error: 'La invitación tiene un área no válida. Pide al administrador que la vuelva a enviar.' });
    }

    const emailNormalizado = normalizarEmail(invitacion.email);
    const existente = await prisma.usuario.findUnique({ where: { email: emailNormalizado }, select: { id: true } });
    if (existente) {
      return res.status(409).json({ error: 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COSTE);

    // Crear el usuario y marcar la invitacion en una sola transaccion: si
    // dos peticiones llegan a la vez con el mismo token, solo una gana.
    const nuevoUsuario = await prisma.$transaction(async (tx) => {
      const marcada = await tx.invitacion.updateMany({
        where: { id: invitacion.id, estado: 'pendiente' },
        data: { estado: 'aceptada' },
      });
      if (marcada.count === 0) {
        const error = new Error('Invitación ya utilizada');
        error.codigo = 'INVITACION_USADA';
        throw error;
      }

      return tx.usuario.create({
        data: {
          nombre: invitacion.nombre,
          email: emailNormalizado,
          password: passwordHash,
          // Las cuentas del portal no pertenecen a ningún área del equipo.
          area: esCliente ? '' : String(invitacion.area).toUpperCase(),
          rol: esCliente ? 'CLIENTE' : (String(invitacion.rol).toUpperCase() === 'ADMIN' ? 'ADMIN' : 'MIEMBRO'),
          empresaId: esCliente ? invitacion.empresaId : null,
          estado: 'activo',
          verificado: true,
          passwordCambiadoEn: new Date(),
        }
      });
    });

    await registrarEvento(req, { usuarioId: nuevoUsuario.id, email: nuevoUsuario.email, tipo: TIPOS.INVITACION_ACEPTADA });
    return completarLogin(req, res, nuevoUsuario, { recordar: false });
  } catch (error) {
    if (error?.codigo === 'INVITACION_USADA' || error?.code === 'P2002') {
      return res.status(409).json({ error: 'La invitación ya fue utilizada o el correo ya está registrado' });
    }
    console.error('[aceptarInvitacion]', error);
    return res.status(500).json({ error: 'Error al aceptar invitación' });
  }
};

const reenviarInvitacion = async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  try {
    const invitacion = await prisma.invitacion.findFirst({
      where: {
        email: normalizarEmail(email),
        estado: { not: 'aceptada' },
        rol: { not: 'cliente' },
        ...(veTodosLosUsuarios(req.usuario) ? {} : { area: req.usuario.area })
      }
    });

    if (!invitacion) {
      return res.status(404).json({ error: 'No se encontró una invitación pendiente para este email' });
    }

    const nuevoToken = crypto.randomBytes(32).toString('hex');
    const nuevaExpiracion = new Date(Date.now() + vigenciaInvitacionMs());

    await prisma.invitacion.update({
      where: { id: invitacion.id },
      data: {
        token: nuevoToken,
        expiraEn: nuevaExpiracion,
        estado: 'pendiente'
      }
    });

    await correo.enviarInvitacion({ nombre: invitacion.nombre, email: invitacion.email, token: nuevoToken });

    return res.json({ mensaje: 'Invitación reenviada correctamente' });
  } catch (error) {
    console.error('[reenviarInvitacion]', error);
    return res.status(500).json({ error: 'Error al reenviar invitación' });
  }
};

const listarInvitaciones = async (req, res) => {
  try {
    const invitaciones = await prisma.invitacion.findMany({
      // Las del portal de clientes se gestionan desde la ficha de la empresa.
      where: { rol: { not: 'cliente' }, ...(veTodosLosUsuarios(req.usuario) ? {} : { area: req.usuario.area }) },
      orderBy: { creadoEn: 'desc' },
      include: { creador: { select: { nombre: true } } }
    });
    return res.json(invitaciones);
  } catch (error) {
    console.error('[listarInvitaciones]', error);
    return res.status(500).json({ error: 'Error al listar invitaciones' });
  }
};

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eliminarInvitacion = async (req, res) => {
  const { id } = req.params;
  if (!REGEX_UUID.test(String(id || ''))) {
    return res.status(400).json({ error: 'ID de invitación inválido' });
  }

  try {
    const invitacion = await prisma.invitacion.findUnique({ where: { id } });

    if (!invitacion) {
      return res.status(404).json({ error: 'Invitación no encontrada' });
    }

    if (!gestionaUsuariosDe(req.usuario, invitacion.area)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta invitación' });
    }

    if (invitacion.estado === 'aceptada') {
      return res.status(409).json({ error: 'No se puede eliminar una invitación aceptada' });
    }

    await prisma.invitacion.delete({ where: { id } });

    return res.json({ mensaje: 'Invitación eliminada correctamente' });
  } catch (error) {
    console.error('[eliminarInvitacion]', error);
    return res.status(500).json({ error: 'Error al eliminar invitación' });
  }
};

module.exports = {
  config,
  register,
  verificarEmail,
  reenviarCodigo,
  verifyAccount,
  login,
  login2fa,
  refresh,
  logout,
  me,
  resumenSeguridad,
  forgotPassword,
  validarResetToken,
  resetPassword,
  cambiarPassword,
  listarSesiones,
  cerrarSesion,
  cerrarOtrasSesiones,
  eventosSeguridad,
  configurar2fa,
  activar2fa,
  desactivar2fa,
  regenerarCodigosRespaldo,
  invitar,
  generarInvitacion,
  verificarInvitacion,
  aceptarInvitacion,
  reenviarInvitacion,
  listarInvitaciones,
  eliminarInvitacion
};
