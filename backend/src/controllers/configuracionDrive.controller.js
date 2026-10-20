// Google Drive y respaldos (/api/configuracion/drive, solo CONFIGURADOR).
// La conexion la hace el panel con el boton de Google (mismo cliente OAuth
// que Google Calendar) y manda aqui el codigo; ver services/drive.service.js.
const drive = require('../services/drive.service');
const respaldo = require('../services/respaldo.service');
const { pasarDiscoADrive, contarEnDisco } = require('../services/almacenHibrido.service');
const driveProyectos = require('../services/driveProyectos.service');

// Lo que el panel muestra ademas del estado de la conexion.
const extras = async () => ({
  enDisco: await contarEnDisco(),
  porOrdenar: await driveProyectos.contarPorOrdenar(),
  conservar: respaldo.CONSERVAR,
});

const responderError = (res, error, contexto) => {
  if (error instanceof drive.ErrorDrive) return res.status(error.status).json({ error: error.message });
  console.error(contexto, error);
  return res.status(500).json({ error: 'No se pudo completar la operación con Google Drive' });
};

// GET /drive
const estado = async (_req, res) => {
  try {
    return res.json({ ...(await drive.estado()), ...(await extras()) });
  } catch (error) {
    return responderError(res, error, '[drive.estado]');
  }
};

// POST /drive/conectar { code }
const conectar = async (req, res) => {
  const codigo = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!codigo) return res.status(400).json({ error: 'Falta el código de autorización de Google' });
  try {
    const resultado = await drive.conectar(codigo, req.usuario.id);
    // Se empieza a leer la lista de cambios y se acomodan los adjuntos de
    // antes en sus carpetas, en segundo plano.
    setImmediate(async () => {
      try { await driveProyectos.sincronizarCambiosDrive(); } catch (error) { console.warn('[drive.conectar] Cambios:', error.message); }
      try { await driveProyectos.ordenarAdjuntos({ limite: 500 }); } catch (error) { console.warn('[drive.conectar] Ordenar:', error.message); }
    });
    return res.json({ ...resultado, ...(await extras()) });
  } catch (error) {
    return responderError(res, error, '[drive.conectar]');
  }
};

// DELETE /drive
const desconectar = async (_req, res) => {
  try {
    await drive.desconectar();
    return res.json({ ok: true });
  } catch (error) {
    return responderError(res, error, '[drive.desconectar]');
  }
};

// POST /drive/respaldo — respaldo de la base ahora mismo
const respaldarAhora = async (_req, res) => {
  try {
    return res.json(await respaldo.respaldar());
  } catch (error) {
    return responderError(res, error, '[drive.respaldo]');
  }
};

// POST /drive/pendientes — sube a Drive los archivos que siguen en el disco
const subirPendientes = async (_req, res) => {
  try {
    return res.json(await pasarDiscoADrive());
  } catch (error) {
    return responderError(res, error, '[drive.pendientes]');
  }
};

// POST /drive/ordenar — pasa los adjuntos de antes a su carpeta de proyecto o tarea
const ordenar = async (_req, res) => {
  try {
    return res.json({ ...(await driveProyectos.ordenarAdjuntos({ limite: 300 })), porOrdenar: await driveProyectos.contarPorOrdenar() });
  } catch (error) {
    return responderError(res, error, '[drive.ordenar]');
  }
};

module.exports = { estado, conectar, desconectar, respaldarAhora, subirPendientes, ordenar };
