// Subida de un documento (cotizacion o adjunto de la base de conocimiento):
// PDF, imagen u Office. En memoria: el controlador comprueba el contenido real
// (documentos.service.js, firma de bytes) antes de escribir nada en disco. El
// filtro mira solo la extension: los navegadores mandan tipos distintos para
// los archivos de Office (a veces application/octet-stream).
const multer = require('multer');
const { configEnCache } = require('../services/configuracion.service');
const { EXTENSION_SUBIDA } = require('../services/documentos.service');
const { continuar } = require('../lib/contexto');

const fileFilter = (_req, file, cb) => {
  if (EXTENSION_SUBIDA.test(file.originalname || '')) return cb(null, true);
  const error = new Error('Solo se aceptan PDF, imágenes (JPG, PNG, WEBP) y documentos de Word, Excel o PowerPoint.');
  error.esErrorCliente = true;
  error.statusCode = 400;
  return cb(error, false);
};

/**
 * `limiteMB(config)` saca el tamaño maximo del panel de configuracion:
 * cotizaciones usan el de comprobantes, la base de conocimiento el de adjuntos.
 */
const subidaDocumento = (limiteMB) => (campo) => (req, res, next) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.floor(limiteMB(configEnCache()) * 1024 * 1024), files: 1, fields: 20 },
  fileFilter,
}).single(campo)(req, res, (...a) => continuar(req, next, ...a));

module.exports = {
  subirCotizacion: subidaDocumento((c) => c.subidas.comprobantesMaxMB || 10),
  subirConocimiento: subidaDocumento((c) => c.subidas.adjuntosMaxMB || 4),
};
