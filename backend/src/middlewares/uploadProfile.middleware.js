const multer = require('multer');
const { TIPOS_IMAGEN_PERFIL } = require('../utils/blob.utils');
const { configEnCache } = require('../services/configuracion.service');

// Foto de perfil: solo PNG, JPEG o WebP (nada de SVG ni GIF, que pueden
// llevar scripts o ser enormes). El tamaño maximo sale del panel de
// configuracion (archivos.fotoPerfilMaxMB), por eso se arma en cada peticion.
const fileFilter = (_req, file, cb) => {
  if (TIPOS_IMAGEN_PERFIL.has(file.mimetype)) {
    return cb(null, true);
  }
  const error = new Error('La foto de perfil debe ser una imagen PNG, JPG o WebP');
  error.esErrorCliente = true;
  error.statusCode = 400;
  return cb(error, false);
};

const crear = () => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.floor(configEnCache().subidas.fotoPerfilMaxMB * 1024 * 1024), files: 1, fields: 20 },
  fileFilter,
});

module.exports = {
  single: (campo) => (req, res, next) => crear().single(campo)(req, res, next),
};
