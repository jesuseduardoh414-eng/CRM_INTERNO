/**
 * Almacenamiento de adjuntos (tareas, proyectos, eventos) y fotos de perfil en
 * el disco del servidor.
 *
 * ADJUNTOS_DIR: ruta absoluta o relativa a backend/. Por defecto
 * backend/storage/adjuntos. En cPanel conviene apuntarla fuera de public_html
 * (por ejemplo /home/CUENTA/crm_storage/adjuntos). Se fija en el .env y no en
 * el panel a proposito: una ruta de disco editable desde la web permitiria
 * escribir en cualquier carpeta del servidor.
 *
 * Los archivos se sirven por GET /api/archivos/:carpeta/:nombre con un nombre
 * aleatorio (uuid) imposible de adivinar, y solo con sesion y permiso sobre el
 * archivo (archivos.controller.js, cookie crm_archivos). Nunca se usa el
 * nombre que manda el cliente para construir rutas.
 *
 * Con Google Drive conectado, los adjuntos van a Drive (almacenHibrido); las
 * fotos de perfil se quedan siempre en el disco (pesan poco y se cargan a
 * cada rato). La URL guardada en la base no cambia.
 *
 * Los adjuntos de proyectos y tareas que viven en sus carpetas de Drive
 * (driveProyectos.service.js) usan /api/archivos/drive/<id del archivo en
 * Drive>: el id de Drive es tan imposible de adivinar como un uuid. Al leer
 * se comprueba que el id sea de un adjunto (adjuntos.drive_archivo_id).
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { crearAlmacenHibrido } = require('./almacenHibrido.service');

const CARPETAS = ['adjuntos', 'perfiles'];
const PREFIJO_URL = '/api/archivos/';
const ID_DRIVE = /^[A-Za-z0-9_-]{10,200}$/;
// Lo que se muestra en el navegador en vez de descargarse.
const MIME_EN_LINEA = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
const drive = () => require('./drive.service');

/** URL de un adjunto que vive en Drive. */
const urlDrive = (id) => `${PREFIJO_URL}drive/${id}`;

// Extension segun el tipo real aceptado por los middlewares de subida.
const EXTENSIONES = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};
const TIPOS_POR_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSIONES).filter(([tipo]) => tipo !== 'application/x-zip-compressed').map(([tipo, ext]) => [ext, tipo]),
);
// Se muestran dentro del CRM; el resto siempre se descarga.
const SE_MUESTRAN = new Set(['.pdf', '.png', '.jpg', '.gif', '.webp', '.txt']);

const NOMBRE_INTERNO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,4}$/;

const directorio = () => {
  const configurado = process.env.ADJUNTOS_DIR;
  return configurado ? path.resolve(configurado) : path.resolve(__dirname, '../../storage/adjuntos');
};

const listos = new Map();
const asegurarCarpeta = (carpeta) => {
  if (!listos.has(carpeta)) {
    listos.set(carpeta, fs.mkdir(path.join(directorio(), carpeta), { recursive: true, mode: 0o700 }).catch((error) => {
      listos.delete(carpeta);
      throw error;
    }));
  }
  return listos.get(carpeta);
};

/** Ruta en disco de un archivo, o null si carpeta/nombre no son validos. */
const rutaDe = (carpeta, nombre) => {
  if (!CARPETAS.includes(carpeta) || !NOMBRE_INTERNO.test(String(nombre || ''))) return null;
  if (!TIPOS_POR_EXTENSION[path.extname(nombre)]) return null;
  return path.join(directorio(), carpeta, nombre);
};

// Adjuntos: en Google Drive si esta conectado; si no, en el disco.
const adjuntosHibrido = crearAlmacenHibrido({
  clave: 'adjuntos',
  rutaDe: (nombre) => {
    const ruta = rutaDe('adjuntos', nombre);
    if (!ruta) throw new Error('Nombre de archivo interno inválido');
    return ruta;
  },
  asegurarDirectorio: () => asegurarCarpeta('adjuntos'),
  directorio: () => path.join(directorio(), 'adjuntos'),
  tipoDe: (nombre) => TIPOS_POR_EXTENSION[path.extname(nombre)] || 'application/octet-stream',
  esNombre: (nombre) => Boolean(rutaDe('adjuntos', nombre)),
});

/** Guarda un archivo de multer (memoryStorage) y devuelve su URL relativa. */
const guardar = async (file, carpeta = 'adjuntos') => {
  if (!CARPETAS.includes(carpeta)) throw new Error(`Carpeta de archivos no válida: ${carpeta}`);
  const ext = EXTENSIONES[file.mimetype];
  if (!ext) throw new Error('Tipo de archivo no permitido');
  const nombre = `${crypto.randomUUID()}${ext}`;
  if (carpeta === 'adjuntos') {
    await adjuntosHibrido.guardar(nombre, file.buffer, TIPOS_POR_EXTENSION[ext]);
  } else {
    await asegurarCarpeta(carpeta);
    await fs.writeFile(path.join(directorio(), carpeta, nombre), file.buffer, { flag: 'wx', mode: 0o600 });
  }
  return `${PREFIJO_URL}${carpeta}/${nombre}`;
};

/** "/api/archivos/adjuntos/<uuid>.pdf" -> { carpeta, nombre } (o null si no es nuestro). */
const desdeUrl = (url) => {
  if (typeof url !== 'string' || !url.startsWith(PREFIJO_URL)) return null;
  const [carpeta, nombre, ...resto] = url.slice(PREFIJO_URL.length).split('?')[0].split('/');
  if (resto.length > 0) return null;
  if (carpeta === 'drive') return ID_DRIVE.test(nombre || '') ? { carpeta, nombre } : null;
  return rutaDe(carpeta, nombre) ? { carpeta, nombre } : null;
};

const esLocal = (url) => desdeUrl(url) !== null;

/** Borra archivos por URL. Nunca lanza: la fila en la base ya se borro. */
const borrar = async (urls) => {
  const lista = (Array.isArray(urls) ? urls : [urls]).map(desdeUrl).filter(Boolean);
  const borrarUno = async ({ carpeta, nombre }) => {
    if (carpeta === 'drive') {
      // A la papelera de Drive (30 dias para recuperarlo).
      if (await drive().activo()) await drive().aPapeleraPorId(nombre);
      return;
    }
    if (carpeta === 'adjuntos') { await adjuntosHibrido.borrar(nombre); return; }
    await fs.unlink(rutaDe(carpeta, nombre));
  };
  await Promise.all(lista.map((archivo) => borrarUno(archivo).catch((error) => {
    if (error.code !== 'ENOENT') console.error('No se pudo borrar un adjunto:', error.message);
  })));
};

/** Cabeceras y contenido para servir un archivo; null si no existe. */
const leer = async (carpeta, nombre) => {
  if (carpeta === 'drive') {
    if (!ID_DRIVE.test(String(nombre || '')) || !(await drive().activo())) return null;
    // Solo adjuntos del CRM. La cuenta conectada llega a todo su Drive: sin
    // esto, con el id de cualquier archivo (respaldos de la base, documentos
    // compartidos con la empresa) se bajaba por esta ruta sin iniciar sesion.
    // eslint-disable-next-line global-require
    const esAdjunto = await require('../lib/prisma').adjunto.findFirst({ where: { driveArchivoId: nombre }, select: { id: true } });
    if (!esAdjunto) return null;
    const archivo = await drive().bajarPorId(nombre);
    if (!archivo) return null;
    return {
      contenido: archivo.contenido,
      tipo: archivo.mime,
      enLinea: MIME_EN_LINEA.has(archivo.mime),
      ext: archivo.mime === 'application/pdf' ? '.pdf' : '',
      nombre: archivo.nombre,
      cambiante: true,
    };
  }
  const ruta = rutaDe(carpeta, nombre);
  if (!ruta) return null;
  try {
    const contenido = carpeta === 'adjuntos' ? await adjuntosHibrido.leer(nombre) : await fs.readFile(ruta);
    const ext = path.extname(nombre);
    return { contenido, tipo: TIPOS_POR_EXTENSION[ext], enLinea: SE_MUESTRAN.has(ext), ext };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/** Para el panel: si se puede escribir y cuanto ocupa. */
const estado = async () => {
  const resultado = { ruta: directorio(), ok: false, archivos: 0, bytes: 0, libreBytes: null };
  try {
    await asegurarCarpeta('adjuntos');
    await fs.access(directorio(), fs.constants?.W_OK ?? 2);
    resultado.ok = true;
    for (const carpeta of CARPETAS) {
      const nombres = await fs.readdir(path.join(directorio(), carpeta)).catch(() => []);
      for (const nombre of nombres.slice(0, 50000)) {
        const info = await fs.stat(path.join(directorio(), carpeta, nombre)).catch(() => null);
        if (info?.isFile()) { resultado.archivos += 1; resultado.bytes += info.size; }
      }
    }
    if (typeof fs.statfs === 'function') {
      const disco = await fs.statfs(directorio()).catch(() => null);
      if (disco) resultado.libreBytes = Number(disco.bavail) * Number(disco.bsize);
    }
  } catch (_e) { /* sin permiso: ok=false */ }
  return resultado;
};

module.exports = { CARPETAS, EXTENSIONES, TIPOS_POR_EXTENSION, directorio, rutaDe, guardar, borrar, leer, esLocal, desdeUrl, urlDrive, estado };
