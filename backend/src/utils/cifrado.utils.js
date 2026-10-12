/**
 * Cifrado simetrico (AES-256-GCM) para secretos que hay que poder leer de
 * vuelta, como la semilla TOTP del doble factor. Lo que basta con comparar
 * (contraseñas, refresh tokens, codigos) se guarda como hash, no aqui.
 *
 * La clave sale de AUTH_ENCRYPTION_KEY. Si no esta definida se deriva de
 * JWT_SECRET con otra etiqueta para no reutilizar el mismo material tal cual;
 * conviene definirla aparte en produccion (cambiar JWT_SECRET dejaria
 * ilegibles los secretos 2FA guardados).
 */
const crypto = require('crypto');

const PREFIJO = 'v1';

let claveCache = null;
const obtenerClave = () => {
  if (claveCache) return claveCache;
  const base = process.env.AUTH_ENCRYPTION_KEY || `${process.env.JWT_SECRET}|cifrado-2fa`;
  claveCache = crypto.createHash('sha256').update(String(base)).digest();
  return claveCache;
};

/** Devuelve "v1:iv:tag:datos" en base64url. */
const cifrar = (texto) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIJO, iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join(':');
};

/** Inverso de `cifrar`. Lanza si el texto fue alterado o la clave no coincide. */
const descifrar = (cifrado) => {
  const [prefijo, iv, tag, datos] = String(cifrado || '').split(':');
  if (prefijo !== PREFIJO || !iv || !tag || !datos) throw new Error('Formato de cifrado no reconocido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(datos, 'base64url')), decipher.final()]).toString('utf8');
};

const sha256 = (valor) => crypto.createHash('sha256').update(String(valor)).digest('hex');

/** Comparacion en tiempo constante de dos cadenas hex/ascii. */
const igualesSeguro = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

module.exports = { cifrar, descifrar, sha256, igualesSeguro };
