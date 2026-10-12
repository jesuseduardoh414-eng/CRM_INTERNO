// Politica de contraseñas del lado del cliente. Replica las reglas de
// backend/src/utils/security.utils.js (validarPassword) para avisar mientras
// se escribe; el servidor sigue siendo quien decide. Si cambias una, cambia
// la otra.

// Valor de fábrica; ConfiguracionContext lo actualiza con el de la instalación.
let passwordMin = 10;
export const fijarPasswordMin = (n) => { if (Number.isInteger(n) && n >= 8) passwordMin = n; };
export const obtenerPasswordMin = () => passwordMin;

const PATRONES_COMUNES = [
  '123456', '654321', 'qwerty', 'asdfgh', 'zxcvbn', 'password', 'contrasena', 'contraseña',
  'admin', 'abcdef', 'omnis', 'letmein', 'welcome', 'bienvenido', '111111', '000000',
];

const partesPersonales = ({ email = '', nombre = '' } = {}) => [
  String(email).split('@')[0],
  ...String(nombre).split(/\s+/),
]
  .map((parte) => parte.toLowerCase().trim())
  .filter((parte) => parte.length >= 4);

/**
 * Devuelve la lista de reglas con su estado y un nivel de 0 a 4 para la barra.
 * `contexto` = { email, nombre } de la persona (opcional).
 */
export const evaluarPassword = (password = '', contexto = {}) => {
  const texto = String(password);
  const minusculas = texto.toLowerCase();
  const personales = partesPersonales(contexto);

  const reglas = [
    { clave: 'longitud', textoKey: 'authPwReqLength', vars: { n: passwordMin }, ok: texto.length >= passwordMin && new TextEncoder().encode(texto).length <= 72 },
    { clave: 'mayuscula', textoKey: 'authPwReqUpper', ok: /[A-Z]/.test(texto) },
    { clave: 'minuscula', textoKey: 'authPwReqLower', ok: /[a-z]/.test(texto) },
    { clave: 'numero', textoKey: 'authPwReqNumber', ok: /[0-9]/.test(texto) },
    { clave: 'simbolo', textoKey: 'authPwReqSymbol', ok: /[^A-Za-z0-9]/.test(texto) },
    {
      clave: 'comun',
      textoKey: 'authPwReqCommon',
      ok: texto.length > 0 && !PATRONES_COMUNES.some((p) => minusculas.includes(p)) && !/(.)\1{3,}/.test(texto),
    },
  ];
  if (personales.length > 0) {
    reglas.push({
      clave: 'personal',
      textoKey: 'authPwReqPersonal',
      ok: texto.length > 0 && !personales.some((parte) => minusculas.includes(parte)),
    });
  }

  const cumplidas = reglas.filter((r) => r.ok).length;
  const valida = cumplidas === reglas.length;

  // Nivel visual: 0 vacio, 1 debil, 2 aceptable, 3 fuerte, 4 excelente.
  let nivel = 0;
  if (texto.length > 0) {
    const proporcion = cumplidas / reglas.length;
    if (!valida) nivel = proporcion >= 0.7 ? 2 : 1;
    else nivel = texto.length >= 16 ? 4 : 3;
  }

  return { reglas, valida, nivel };
};
