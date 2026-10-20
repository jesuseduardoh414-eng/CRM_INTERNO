/**
 * Documentos privados en el disco del servidor: archivos de las cotizaciones
 * (finanzas) y adjuntos de la base de conocimiento. Mismo esquema que los
 * comprobantes (comprobantes.service.js): nombre interno uuid, fuera de
 * cualquier carpeta servida, y solo salen por la API despues de comprobar
 * sesion y permiso.
 *
 * Se admiten PDF, imagenes (JPG, PNG, WEBP) y documentos de Office (Word,
 * Excel, PowerPoint, nuevos y antiguos). El tipo se decide por el contenido
 * (firma de bytes); la extension solo distingue entre los formatos de Office,
 * que comparten firma (ZIP los nuevos, OLE los antiguos).
 *
 * Carpetas: COTIZACIONES_DIR y CONOCIMIENTO_DIR (ruta absoluta o relativa a
 * backend/). Si no estan, van junto a COMPROBANTES_DIR y ADJUNTOS_DIR
 * respectivamente (con /home/CUENTA/crm_archivos/comprobantes quedan en
 * /home/CUENTA/crm_archivos/cotizaciones), y si tampoco, en backend/storage/.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { nombreUtf8 } = require('../utils/nombreArchivo.utils');
const { crearAlmacenHibrido } = require('./almacenHibrido.service');

const TIPOS = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};
const EXTENSIONES = Object.keys(TIPOS);
// Extensiones que acepta la subida (jpeg es jpg).
const EXTENSION_SUBIDA = /\.(pdf|jpe?g|png|webp|docx|xlsx|pptx|doc|xls|ppt)$/i;
// Office nuevo: un ZIP con [Content_Types].xml y la carpeta de su programa.
const CARPETA_OFFICE = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };
const FIRMA_OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const extensionDe = (nombre) => {
  const ext = path.extname(String(nombre || '')).slice(1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
};

/**
 * Extension real del contenido, o null si no es un tipo admitido o no
 * coincide con lo que dice el nombre (un .docx que no es Word).
 */
const detectar = (buffer, nombreOriginal) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) return null;
  const inicio = buffer.subarray(0, 16);
  const declarada = extensionDe(nombreOriginal);
  if (inicio.subarray(0, 5).toString('latin1') === '%PDF-') {
    const fin = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
    return fin.includes('%%EOF') ? 'pdf' : null;
  }
  if (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) return 'jpg';
  if (inicio.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (inicio.subarray(0, 4).toString('latin1') === 'RIFF' && inicio.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (inicio[0] === 0x50 && inicio[1] === 0x4b && inicio[2] === 0x03 && inicio[3] === 0x04 && CARPETA_OFFICE[declarada]) {
    // Los nombres de las entradas del ZIP van sin comprimir.
    const texto = buffer.toString('latin1');
    return texto.includes('[Content_Types].xml') && texto.includes(CARPETA_OFFICE[declarada]) ? declarada : null;
  }
  if (inicio.subarray(0, 8).equals(FIRMA_OLE) && ['doc', 'xls', 'ppt'].includes(declarada)) return declarada;
  return null;
};

const huella = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** Limpia el nombre original para mostrarlo y para Content-Disposition. */
const limpiarNombre = (nombre, ext) => {
  const base = path.basename(nombreUtf8(nombre) || `documento.${ext}`)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_')
    .trim()
    .slice(0, 200) || `documento.${ext}`;
  return extensionDe(base) === ext ? base : `${base}.${ext}`;
};

const NOMBRE_INTERNO = new RegExp(`^[0-9a-f-]{36}\\.(${EXTENSIONES.join('|')})$`);

/**
 * Un almacen en su carpeta. `variable`: la que fija la carpeta; `vecinaDe`:
 * si falta, la carpeta va junto a la de esta otra variable; `carpeta`: el
 * nombre de la carpeta.
 */
const crearAlmacen = ({ variable, vecinaDe, carpeta }) => {
  const directorio = () => {
    if (process.env[variable]) return path.resolve(process.env[variable]);
    if (process.env[vecinaDe]) return path.join(path.dirname(path.resolve(process.env[vecinaDe])), carpeta);
    return path.resolve(__dirname, '../../storage', carpeta);
  };
  let listo = null;
  const asegurar = () => {
    if (!listo) {
      listo = fs.mkdir(directorio(), { recursive: true, mode: 0o700 }).catch((error) => {
        listo = null;
        throw error;
      });
    }
    return listo;
  };
  const rutaDe = (nombreInterno) => {
    if (!NOMBRE_INTERNO.test(nombreInterno)) throw new Error('Nombre de archivo interno inválido');
    return path.join(directorio(), nombreInterno);
  };
  // En Google Drive si esta conectado; si no, en el disco (almacenHibrido.service.js).
  const almacen = crearAlmacenHibrido({
    clave: carpeta,
    rutaDe,
    asegurarDirectorio: asegurar,
    directorio,
    tipoDe: (nombre) => TIPOS[extensionDe(nombre)] || 'application/octet-stream',
    esNombre: (nombre) => NOMBRE_INTERNO.test(nombre),
  });
  return {
    directorio,
    /** Guarda el buffer (ya validado con `detectar`) y devuelve el nombre interno. */
    guardar: async (buffer, ext) => {
      if (!TIPOS[ext]) throw new Error('Tipo de documento no admitido');
      const nombreInterno = `${crypto.randomUUID()}.${ext}`;
      await almacen.guardar(nombreInterno, buffer, TIPOS[ext]);
      return nombreInterno;
    },
    leer: (nombreInterno) => almacen.leer(nombreInterno),
    borrar: (nombreInterno) => almacen.borrar(nombreInterno),
  };
};

const SE_MUESTRAN = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Responde con el archivo. PDF e imagenes se pueden ver en el navegador; los
 * de Office siempre se descargan. Con `descargar` siempre se descarga.
 */
const enviar = (res, { contenido, mime, nombreOriginal, descargar = false }) => {
  const disposicion = descargar || !SE_MUESTRAN.has(mime) ? 'attachment' : 'inline';
  const nombreAscii = nombreOriginal.replace(/[^\x20-\x7e]/g, '_');
  res.set({
    'Content-Type': mime,
    'Content-Length': String(contenido.length),
    'Content-Disposition': `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(nombreOriginal)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  return res.send(contenido);
};

module.exports = {
  TIPOS,
  EXTENSION_SUBIDA,
  detectar,
  huella,
  limpiarNombre,
  crearAlmacen,
  enviar,
  cotizaciones: crearAlmacen({ variable: 'COTIZACIONES_DIR', vecinaDe: 'COMPROBANTES_DIR', carpeta: 'cotizaciones' }),
  conocimiento: crearAlmacen({ variable: 'CONOCIMIENTO_DIR', vecinaDe: 'ADJUNTOS_DIR', carpeta: 'conocimiento' }),
};
