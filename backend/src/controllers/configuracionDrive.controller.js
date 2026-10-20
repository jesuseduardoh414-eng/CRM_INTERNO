// Google Drive y respaldos (/api/configuracion/drive, solo CONFIGURADOR).
// La conexion la hace el panel con el boton de Google (mismo cliente OAuth
// que Google Calendar) y manda aqui el codigo; ver services/drive.service.js.
const drive = require('../services/drive.service');
const respaldo = require('../services/respaldo.service');
const { pasarDiscoADrive, contarEnDisco } = require('../services/almacenHibrido.service');

const responderError = (res, error, contexto) => {
  if (error instanceof drive.ErrorDrive) return res.status(error.status).json({ error: error.message });
  console.error(contexto, error);
  return res.status(500).json({ error: 'No se pudo completar la operación con Google Drive' });
};

// GET /drive
const estado = async (_req, res) => {
  try {
    return res.json({ ...(await drive.estado()), enDisco: await contarEnDisco(), conservar: respaldo.CONSERVAR });
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
    return res.json({ ...resultado, enDisco: await contarEnDisco(), conservar: respaldo.CONSERVAR });
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

module.exports = { estado, conectar, desconectar, respaldarAhora, subirPendientes };
