/**
 * Middleware de subida exclusivo para importación de tareas
 * Tipos permitidos: .json, .xlsx, .xls
 * Tamaño máximo: 4MB (Vercel corta en 4.5MB)
 */

const multer = require('multer');
const path   = require('path');

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const ext  = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;

  const extOk  = ['.json', '.xlsx', '.xls'].includes(ext);
  const mimeOk = [
    'application/json',
    'text/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ].includes(mime);

  if (extOk || mimeOk) {
    cb(null, true);
  } else {
    // `esErrorCliente` hace que el manejador global responda 400 con este
    // mensaje en vez de un 500 generico.
    const error = new Error('Solo se permiten archivos .json, .xlsx o .xls');
    error.esErrorCliente = true;
    error.statusCode = 400;
    cb(error, false);
  }
};

const uploadImport = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 20 }, // 4MB
  fileFilter,
});

module.exports = uploadImport;
