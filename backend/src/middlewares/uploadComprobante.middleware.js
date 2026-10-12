// Subida de un comprobante (PDF o imagen) de un pago o de un gasto. En
// memoria: el controlador comprueba el contenido real (firma de bytes) antes
// de escribir nada en disco. El tamaño maximo sale del panel de configuracion
// (subidas.comprobantesMaxMB).
const multer = require('multer');
const { configEnCache } = require('../services/configuracion.service');
const { MIMES } = require('../services/comprobantes.service');

const EXTENSION = /\.(pdf|jpe?g|png|webp)$/i;

const fileFilter = (_req, file, cb) => {
  if (MIMES.includes(file.mimetype) && EXTENSION.test(file.originalname || '')) return cb(null, true);
  const error = new Error('Solo se aceptan comprobantes en PDF, JPG, PNG o WEBP.');
  error.esErrorCliente = true;
  error.statusCode = 400;
  return cb(error, false);
};

const crear = () => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (configEnCache().subidas.comprobantesMaxMB || 10) * 1024 * 1024, files: 1, fields: 5 },
  fileFilter,
});

module.exports = {
  single: (campo) => (req, res, next) => crear().single(campo)(req, res, next),
};
