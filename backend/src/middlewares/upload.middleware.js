const multer = require('multer');
const path = require('path');
const { configEnCache } = require('../services/configuracion.service');
const { puede } = require('../utils/permisosArea.utils');

// Adjuntos de tareas, proyectos y eventos.
//
// Multer deja el archivo en memoria y el controlador lo guarda en el disco del
// servidor (services/almacenamiento.service.js) con un nombre aleatorio.
//
// Tipos y tamaño maximo salen del panel de configuracion (subidas.*), por eso
// el multer se arma en cada peticion. OJO: Vercel corta las peticiones a
// 4.5 MB en total; subir el limite por encima de 4 MB solo sirve en un
// servidor propio (cPanel).

// Tipos MIME aceptados por categoria (las que el configurador puede apagar).
const CATEGORIAS = {
  pdf: ['application/pdf'],
  imagenes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  office: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  texto: ['text/plain', 'text/csv', 'application/json'],
  comprimidos: ['application/zip', 'application/x-zip-compressed'],
};
const MIMES_CSV_WINDOWS = ['application/vnd.ms-excel', 'application/octet-stream'];
const NOMBRES = { pdf: 'PDF', imagenes: 'imágenes', office: 'Office', texto: 'texto/CSV/JSON', comprimidos: 'ZIP' };

const tiposPermitidos = () => {
  const activos = configEnCache().subidas.tiposAdjuntos || {};
  return Object.entries(CATEGORIAS).filter(([categoria]) => activos[categoria] !== false);
};

// Solo se aceptan los tipos de las categorias activas. El error lleva
// `esErrorCliente` para que el manejador global responda 400 con el mensaje.
const errorCliente = (mensaje, statusCode = 400) => Object.assign(new Error(mensaje), { esErrorCliente: true, statusCode });

const fileFilter = (req, file, cb) => {
  // Tambien cubre los archivos que llegan al crear una tarea o un proyecto.
  if (configEnCache().modulos?.adjuntos === false) {
    return cb(errorCliente('Los archivos adjuntos están desactivados en esta instalación.', 403), false);
  }
  const esAgenda = String(req.baseUrl || '').startsWith('/api/agenda');
  if (!esAgenda && !puede(req.usuario, 'tareas.adjuntos')) {
    return cb(errorCliente('Tu cuenta no tiene permiso para subir archivos.', 403), false);
  }
  const permitidas = tiposPermitidos();
  // Windows suele mandar los .csv como application/vnd.ms-excel u
  // octet-stream; se aceptan si la categoria "texto" esta activa. Va antes
  // de la comprobacion general para que Office no lo guarde como .xls.
  const esCsv = path.extname(file.originalname || '').toLowerCase() === '.csv'
    && MIMES_CSV_WINDOWS.includes(file.mimetype);
  if (esCsv && permitidas.some(([categoria]) => categoria === 'texto')) {
    // El almacenamiento saca la extension del mimetype: sin esto se guardaria
    // como .xls (o fallaria con octet-stream).
    file.mimetype = 'text/csv';
    return cb(null, true);
  }
  if (permitidas.some(([, mimes]) => mimes.includes(file.mimetype))) return cb(null, true);
  const lista = permitidas.map(([categoria]) => NOMBRES[categoria]).join(', ') || 'ninguno';
  const error = new Error(`Tipo de archivo no permitido (${file.mimetype || 'desconocido'}). Se aceptan: ${lista}.`);
  error.esErrorCliente = true;
  error.statusCode = 400;
  return cb(error, false);
};

const crear = () => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: configEnCache().subidas.adjuntosMaxMB * 1024 * 1024 },
  fileFilter,
});

// Misma interfaz que multer (single/array/fields), con la configuracion vigente.
const upload = {
  single: (campo) => (req, res, next) => crear().single(campo)(req, res, next),
  array: (campo, maximo) => (req, res, next) => crear().array(campo, maximo)(req, res, next),
  fields: (campos) => (req, res, next) => crear().fields(campos)(req, res, next),
};

module.exports = upload;
module.exports.CATEGORIAS_ADJUNTO = CATEGORIAS;
