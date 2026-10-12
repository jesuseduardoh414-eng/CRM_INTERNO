/**
 * Utilidades de seguridad para validación de contraseñas y sanitización
 */
const crypto = require('crypto');

// Politica de contraseñas. El frontend replica estas mismas reglas en
// `components/auth/PasswordStrength.jsx` para avisar mientras se escribe; si
// cambias una, cambia la otra.
const PASSWORD_MIN = 10; // valor de fábrica; el real sale de la configuración

// Lectura perezosa (evita un ciclo de require con la configuración).
const passwordMinimo = () => {
  try {
    // eslint-disable-next-line global-require
    return require('../services/configuracion.service').configEnCache().seguridad?.passwordMin || PASSWORD_MIN;
  } catch (_error) {
    return PASSWORD_MIN;
  }
};
// bcrypt ignora todo lo que pase de 72 bytes: se rechaza en vez de truncar en
// silencio (dos contraseñas distintas con el mismo prefijo valdrian igual).
const PASSWORD_MAX_BYTES = 72;

const PATRONES_COMUNES = [
  '123456', '654321', 'qwerty', 'asdfgh', 'zxcvbn', 'password', 'contrasena', 'contraseña',
  'admin', 'abcdef', 'omnis', 'letmein', 'welcome', 'bienvenido', '111111', '000000',
];

/**
 * Valida una contraseña nueva. `contexto` (opcional) trae datos de la persona
 * para impedir que la contraseña los contenga (correo, nombre).
 */
const validarPassword = (password, contexto = {}) => {
  const errores = [];
  const texto = String(password || '');

  const minimo = passwordMinimo();
  if (texto.length < minimo) {
    errores.push(`La contraseña debe tener al menos ${minimo} caracteres`);
  }
  if (Buffer.byteLength(texto, 'utf8') > PASSWORD_MAX_BYTES) {
    errores.push(`La contraseña no puede superar ${PASSWORD_MAX_BYTES} bytes`);
  }
  if (!/[A-Z]/.test(texto)) errores.push('Debe contener al menos una letra mayúscula');
  if (!/[a-z]/.test(texto)) errores.push('Debe contener al menos una letra minúscula');
  if (!/[0-9]/.test(texto)) errores.push('Debe contener al menos un número');
  if (!/[^A-Za-z0-9]/.test(texto)) errores.push('Debe contener al menos un carácter especial');

  const minusculas = texto.toLowerCase();
  if (PATRONES_COMUNES.some((p) => minusculas.includes(p))) {
    errores.push('No uses patrones comunes o secuenciales');
  }
  if (/(.)\1{3,}/.test(texto)) {
    errores.push('Evita repetir el mismo carácter más de 3 veces');
  }

  // Nada del correo ni del nombre (partes de 4+ letras).
  const partesPersonales = [
    String(contexto.email || '').split('@')[0],
    ...String(contexto.nombre || '').split(/\s+/),
  ]
    .map((parte) => parte.toLowerCase().trim())
    .filter((parte) => parte.length >= 4);
  if (partesPersonales.some((parte) => minusculas.includes(parte))) {
    errores.push('No incluyas tu nombre ni tu correo en la contraseña');
  }

  return {
    valido: errores.length === 0,
    errores
  };
};

/**
 * Consulta Have I Been Pwned por k-anonimato: solo viajan los 5 primeros
 * caracteres del SHA-1, nunca la contraseña ni su hash completo. Devuelve
 * cuantas veces aparece en filtraciones conocidas (0 si no aparece).
 *
 * Si el servicio no responde en 3 s (o HIBP_DESACTIVADO=true) devuelve 0:
 * una caida de un tercero no debe impedir que alguien cambie su contraseña.
 */
const vecesFiltrada = async (password) => {
  if (String(process.env.HIBP_DESACTIVADO).toLowerCase() === 'true') return 0;
  try {
    const sha1 = crypto.createHash('sha1').update(String(password)).digest('hex').toUpperCase();
    const prefijo = sha1.slice(0, 5);
    const sufijo = sha1.slice(5);
    const respuesta = await fetch(`https://api.pwnedpasswords.com/range/${prefijo}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'OMNIS-CRM' },
      signal: AbortSignal.timeout(3000),
    });
    if (!respuesta.ok) return 0;
    const cuerpo = await respuesta.text();
    for (const linea of cuerpo.split('\n')) {
      const [hashSufijo, conteo] = linea.trim().split(':');
      if (hashSufijo === sufijo) return Number(conteo) || 0;
    }
    return 0;
  } catch (_error) {
    return 0;
  }
};

/**
 * Validacion completa de una contraseña nueva: reglas locales + filtraciones.
 * Devuelve `{ valido, errores }` igual que `validarPassword`.
 */
const validarPasswordNueva = async (password, contexto = {}) => {
  const resultado = validarPassword(password, contexto);
  if (!resultado.valido) return resultado;
  const veces = await vecesFiltrada(password);
  if (veces > 0) {
    return {
      valido: false,
      errores: ['Esta contraseña aparece en filtraciones de datos públicas. Elige otra distinta.'],
    };
  }
  return resultado;
};

// Escapa los caracteres con significado en HTML. Se usa al insertar datos
// escritos por el usuario (nombre, etc.) dentro de plantillas de correo, para
// que nadie pueda meter etiquetas o enlaces propios en un correo del sistema.
const escapeHtml = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Areas validas: las que el configurador definio en el panel (reglas.areas).
// Require diferido: el servicio de configuracion carga Prisma.
const areasValidas = () => require('../services/configuracion.service').configEnCache().reglas.areas.map((a) => a.clave);
const ROLES_VALIDOS = ['ADMIN', 'MIEMBRO'];

const esAreaValida = (area) => areasValidas().includes(String(area || '').toUpperCase());
const esRolValido = (rol) => ROLES_VALIDOS.includes(String(rol || '').toUpperCase());

// Validacion minima de formato de correo (no sustituye a la verificacion por enlace).
const esEmailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

module.exports = {
  PASSWORD_MIN,
  passwordMinimo,
  validarPassword,
  validarPasswordNueva,
  vecesFiltrada,
  escapeHtml,
  areasValidas,
  ROLES_VALIDOS,
  esAreaValida,
  esRolValido,
  esEmailValido,
};
