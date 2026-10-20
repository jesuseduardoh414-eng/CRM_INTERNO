/**
 * Comprobantes de pagos y gastos (transferencias, facturas, tickets) en el
 * disco del servidor. Mismo esquema que los PDF de contratos
 * (contratosArchivos.service.js): viven en COMPROBANTES_DIR, fuera de
 * cualquier carpeta servida, y solo salen por GET /api/finanzas/comprobantes/:id
 * despues de comprobar sesion y permiso sobre el pago o gasto.
 *
 * Se admiten PDF e imagenes (JPG, PNG, WEBP): la captura de una transferencia
 * suele ser una imagen. El tipo se decide por el contenido (firma de bytes),
 * no por la extension ni por el Content-Type que manda el cliente.
 *
 * COMPROBANTES_DIR: ruta absoluta o relativa a backend/. Por defecto
 * backend/storage/comprobantes. En Vercel el disco es de solo lectura: este
 * modulo esta pensado para cPanel, Render con disco o cualquier servidor propio.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { nombreUtf8 } = require('../utils/nombreArchivo.utils');
const { crearAlmacenHibrido } = require('./almacenHibrido.service');

const TIPOS = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIMES = Object.keys(TIPOS);

const directorio = () => {
  const configurado = process.env.COMPROBANTES_DIR;
  return configurado
    ? path.resolve(configurado)
    : path.resolve(__dirname, '../../storage/comprobantes');
};

let directorioListo = null;
const asegurarDirectorio = () => {
  if (!directorioListo) {
    directorioListo = fs.mkdir(directorio(), { recursive: true, mode: 0o700 }).catch((error) => {
      directorioListo = null;
      throw error;
    });
  }
  return directorioListo;
};

// Nombre interno: uuid + extension conocida. Nunca se usa el nombre que manda
// el cliente para construir rutas (evita path traversal).
const NOMBRE_INTERNO = /^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;

const rutaDe = (nombreInterno) => {
  if (!NOMBRE_INTERNO.test(nombreInterno)) throw new Error('Nombre de archivo interno inválido');
  return path.join(directorio(), nombreInterno);
};

/**
 * Tipo real del contenido por su firma de bytes, o null si no es ninguno de
 * los admitidos.
 */
const detectarMime = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) return null;
  const inicio = buffer.subarray(0, 16);
  if (inicio.subarray(0, 5).toString('latin1') === '%PDF-') {
    const fin = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
    return fin.includes('%%EOF') ? 'application/pdf' : null;
  }
  if (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) return 'image/jpeg';
  if (inicio.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (inicio.subarray(0, 4).toString('latin1') === 'RIFF' && inicio.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

const huella = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// En Google Drive si esta conectado; si no, en el disco (almacenHibrido.service.js).
const almacen = crearAlmacenHibrido({
  clave: 'comprobantes',
  rutaDe,
  asegurarDirectorio,
  directorio,
  tipoDe: (nombre) => MIMES.find((m) => nombre.endsWith(`.${TIPOS[m]}`)) || 'application/octet-stream',
  esNombre: (nombre) => NOMBRE_INTERNO.test(nombre),
});

/** Guarda el buffer y devuelve el nombre interno. */
const guardar = async (buffer, mime) => {
  const extension = TIPOS[mime];
  if (!extension) throw new Error('Tipo de comprobante no admitido');
  const nombreInterno = `${crypto.randomUUID()}.${extension}`;
  await almacen.guardar(nombreInterno, buffer, mime);
  return nombreInterno;
};

const leer = (nombreInterno) => almacen.leer(nombreInterno);

const borrar = (nombreInterno) => almacen.borrar(nombreInterno);

/** Limpia el nombre original para mostrarlo y para Content-Disposition. */
const limpiarNombre = (nombre, mime) => {
  const extension = TIPOS[mime] || 'bin';
  const base = path.basename(nombreUtf8(nombre) || `comprobante.${extension}`)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_')
    .trim()
    .slice(0, 200) || `comprobante.${extension}`;
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`;
};

module.exports = { MIMES, TIPOS, detectarMime, huella, guardar, leer, borrar, limpiarNombre, directorio };
