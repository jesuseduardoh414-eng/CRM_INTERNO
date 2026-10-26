// Subida del PDF escaneado de un contrato. En memoria: el controlador valida
// el contenido (cabecera %PDF-) antes de escribir nada en disco. El tamaño
// maximo sale del panel de configuracion (archivos.contratosMaxMB).
const multer = require('multer');
const { configEnCache } = require('../services/configuracion.service');
const { continuar } = require('../lib/contexto');

const fileFilter = (_req, file, cb) => {
  const esPdf = file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname || '');
  if (esPdf) return cb(null, true);
  const error = new Error('Solo se aceptan archivos PDF.');
  error.esErrorCliente = true;
  error.statusCode = 400;
  return cb(error, false);
};

const crear = () => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.floor(configEnCache().subidas.contratosMaxMB * 1024 * 1024), files: 1, fields: 5 },
  fileFilter,
});

module.exports = {
  single: (campo) => (req, res, next) => crear().single(campo)(req, res, (...a) => continuar(req, next, ...a)),
};
