// Adjuntos y fotos de perfil. Desde 2026-10 se guardan en el disco del
// servidor (services/almacenamiento.service.js); Vercel Blob solo se usa para
// borrar archivos antiguos que se subieron alli.
const almacenamiento = require('../services/almacenamiento.service');

// Tipos de archivo que se aceptan como adjunto (tarea, proyecto, evento).
// Se excluyen a proposito html/svg/js: Blob los serviria tal cual y se
// podrian usar para alojar paginas de phishing con apariencia legitima.
const TIPOS_ADJUNTO_PERMITIDOS = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/json',
]);

const TIPOS_IMAGEN_PERFIL = new Set(['image/png', 'image/jpeg', 'image/webp']);

const esBlobVercel = (url) => typeof url === 'string' && /blob\.vercel-storage\.com/.test(url);

// Guarda un archivo de multer (memoryStorage) y devuelve su URL relativa
// (/api/archivos/<carpeta>/<uuid>.<ext>). `carpeta`: adjuntos o perfiles.
const subirArchivo = (file, carpeta = 'adjuntos') => almacenamiento.guardar(file, carpeta);

// Borra archivos de forma "best effort": nunca lanza, para no romper la
// peticion que ya borro las filas en la base. Los del disco se borran siempre;
// los antiguos de Vercel Blob, solo si sigue configurado su token.
const borrarBlobs = async (urls) => {
  const lista = Array.isArray(urls) ? urls : [urls];
  await almacenamiento.borrar(lista);
  const remotos = lista.filter(esBlobVercel);
  if (remotos.length === 0 || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await require('@vercel/blob').del(remotos);
  } catch (error) {
    console.error('No se pudieron borrar blobs huerfanos:', error?.message || error);
  }
};

module.exports = {
  TIPOS_ADJUNTO_PERMITIDOS,
  TIPOS_IMAGEN_PERFIL,
  esBlobVercel,
  esLocal: almacenamiento.esLocal,
  subirArchivo,
  borrarBlobs,
};
