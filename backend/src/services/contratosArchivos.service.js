/**
 * Almacenamiento de los PDF de contratos en el disco del servidor.
 *
 * Por que disco y no Vercel Blob: los enlaces de Blob son publicos (cualquiera
 * con la URL descarga el archivo). Un contrato firmado es confidencial, asi
 * que vive en CONTRATOS_DIR, fuera de cualquier carpeta servida, y solo sale
 * por GET /api/contratos/archivos/:id despues de verificar sesion y rol admin.
 *
 * CONTRATOS_DIR: ruta absoluta o relativa a backend/. Por defecto
 * backend/storage/contratos. En cPanel conviene apuntarla fuera de
 * public_html (por ejemplo /home/CUENTA/crm_storage/contratos).
 * OJO: en Vercel el disco no persiste; este modulo esta pensado para cPanel o
 * cualquier servidor con disco propio.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const TAMANO_MAXIMO_MB = 25;

const directorio = () => {
  const configurado = process.env.CONTRATOS_DIR;
  return configurado
    ? path.resolve(configurado)
    : path.resolve(__dirname, '../../storage/contratos');
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

// Nombre interno: solo uuid + .pdf. Nunca se usa el nombre que manda el
// cliente para construir rutas (evita path traversal).
const NOMBRE_INTERNO = /^[0-9a-f-]{36}\.pdf$/;

const rutaDe = (nombreInterno) => {
  if (!NOMBRE_INTERNO.test(nombreInterno)) throw new Error('Nombre de archivo interno inválido');
  return path.join(directorio(), nombreInterno);
};

/**
 * Comprueba que el contenido sea de verdad un PDF (no basta la extension ni
 * el Content-Type, que los pone el cliente): cabecera %PDF- al inicio y marca
 * %%EOF cerca del final.
 */
const esPdfValido = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) return false;
  const inicio = buffer.subarray(0, 1024).toString('latin1');
  const fin = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
  return inicio.indexOf('%PDF-') !== -1 && inicio.indexOf('%PDF-') < 1024 && fin.includes('%%EOF');
};

const huella = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** Guarda el buffer y devuelve el nombre interno. `wx` falla si ya existiera. */
const guardar = async (buffer) => {
  await asegurarDirectorio();
  const nombreInterno = `${crypto.randomUUID()}.pdf`;
  await fs.writeFile(rutaDe(nombreInterno), buffer, { flag: 'wx', mode: 0o600 });
  return nombreInterno;
};

const leer = (nombreInterno) => fs.readFile(rutaDe(nombreInterno));

const borrar = async (nombreInterno) => {
  try {
    await fs.unlink(rutaDe(nombreInterno));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

/** Limpia el nombre original para mostrarlo y para Content-Disposition. */
const limpiarNombre = (nombre) => {
  const base = path.basename(String(nombre || 'contrato.pdf'))
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_')
    .trim()
    .slice(0, 200) || 'contrato.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
};

module.exports = { TAMANO_MAXIMO_MB, esPdfValido, huella, guardar, leer, borrar, limpiarNombre, directorio };
