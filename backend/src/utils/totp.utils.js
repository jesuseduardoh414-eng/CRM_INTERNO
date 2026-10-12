/**
 * TOTP (RFC 6238) sin dependencias: HMAC-SHA1, 6 digitos, pasos de 30 s.
 * Compatible con Google Authenticator, Microsoft Authenticator, 1Password,
 * Authy, etc.
 *
 * `verificarTotp` devuelve el numero de paso que coincidio (o null). Quien
 * llama guarda ese paso y lo pasa como `ultimoPaso` la siguiente vez, para que
 * un mismo codigo no pueda usarse dos veces (anti-replay).
 */
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIODO = 30;
const DIGITOS = 6;
const VENTANA = 1; // se acepta el paso anterior y el siguiente (reloj desfasado)

const base32Encode = (buffer) => {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
};

const base32Decode = (texto) => {
  const limpio = String(texto).toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caracter of limpio) {
    const indice = ALFABETO.indexOf(caracter);
    if (indice === -1) throw new Error('Secreto base32 inválido');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** Secreto nuevo de 160 bits (lo que recomienda la RFC 4226). */
const generarSecreto = () => base32Encode(crypto.randomBytes(20));

const codigoEnPaso = (secreto, paso) => {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = crypto.createHmac('sha1', base32Decode(secreto)).update(contador).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario = ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3];
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0');
};

const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PERIODO);

const verificarTotp = (secreto, codigo, ultimoPaso = null) => {
  const limpio = String(codigo || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(limpio)) return null;

  const actual = pasoActual();
  for (let desfase = -VENTANA; desfase <= VENTANA; desfase += 1) {
    const paso = actual + desfase;
    if (ultimoPaso !== null && ultimoPaso !== undefined && paso <= ultimoPaso) continue;
    const esperado = codigoEnPaso(secreto, paso);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio))) return paso;
  }
  return null;
};

const uriOtpauth = ({ secreto, cuenta, emisor = 'OMNIS CRM' }) => {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  const params = new URLSearchParams({ secret: secreto, issuer: emisor, algorithm: 'SHA1', digits: String(DIGITOS), period: String(PERIODO) });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
};

module.exports = { generarSecreto, verificarTotp, uriOtpauth, codigoEnPaso, pasoActual };
