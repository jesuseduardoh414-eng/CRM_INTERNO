// Panel de configuracion de la instalacion (solo rol CONFIGURADOR) y la
// version publica que leen todas las pantallas (incluido el login).
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const servicio = require('../services/configuracion.service');
const { ARCHIVOS_MARCA, validarArchivoMarca } = require('../utils/configuracion.utils');
const { cifrar } = require('../utils/cifrado.utils');

/** URLs (relativas al backend) de las imagenes subidas, con version para la cache. */
const urlsArchivos = (archivos) => Object.fromEntries(
  Object.entries(archivos).map(([clave, a]) => [clave, `/api/configuracion/archivos/${clave}?v=${a.sha256.slice(0, 12)}`]),
);

// La contraseña SMTP (cifrada) nunca sale de la API: solo si hay una guardada.
const sinSecretos = (config) => {
  const { passwordCifrada, ...correo } = config.correo || {};
  const { secretCifrado, ...google } = config.google || {};
  return {
    ...config,
    correo: { ...correo, passwordGuardada: Boolean(passwordCifrada) },
    google: { ...google, secretGuardado: Boolean(secretCifrado) },
  };
};

const respuesta = ({ config, archivos, version, actualizadoEn }) => ({
  ...sinSecretos(config),
  archivos: urlsArchivos(archivos),
  version,
  actualizadoEn,
});

// GET /api/configuracion/publica  (sin sesion: la usa el login)
const publica = async (_req, res) => {
  try {
    const datos = await servicio.obtener();
    // Ni el remitente, ni el servidor, ni el diseño de los correos hacen falta fuera del panel.
    const { reglas, correo: _correo, disenoCorreo: _diseno, textosCorreo: _textos, ...resto } = respuesta(datos);
    const { remitenteCorreo: _remitente, ...reglasPublicas } = reglas;
    res.set('Cache-Control', 'no-cache');
    return res.json({ ...resto, reglas: reglasPublicas });
  } catch (error) {
    console.error('[configuracion.publica]', error);
    return res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
};

// GET /api/configuracion
const obtener = async (_req, res) => {
  try {
    const datos = await servicio.obtener();
    return res.json({ ...respuesta(datos), limitesArchivos: ARCHIVOS_MARCA });
  } catch (error) {
    console.error('[configuracion.obtener]', error);
    return res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
};

// PUT /api/configuracion  (parcial: solo las secciones que se manden)
const guardar = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Datos de configuración inválidos' });
  }
  try {
    const cambios = { ...req.body };
    if (cambios.correo && typeof cambios.correo === 'object') {
      // El panel manda `password` en claro solo cuando la cambia: '' o ausente
      // = conservar la guardada; null = borrarla. Nunca se acepta la cifrada.
      const { password, passwordCifrada: _ignorada, passwordGuardada: _info, ...correo } = cambios.correo;
      if (typeof password === 'string' && password !== '') {
        if (password.length > 200) return res.status(400).json({ error: 'La contraseña del correo es demasiado larga' });
        correo.passwordCifrada = cifrar(password);
      } else if (password === null) {
        correo.passwordCifrada = null;
      }
      cambios.correo = correo;
    }
    if (cambios.google && typeof cambios.google === 'object') {
      // Igual que la contraseña SMTP: '' o ausente = conservar; null = borrar.
      const { secret, secretCifrado: _ignorado, secretGuardado: _info, ...google } = cambios.google;
      if (typeof secret === 'string' && secret.trim() !== '') {
        if (secret.length > 200) return res.status(400).json({ error: 'El secreto de Google es demasiado largo' });
        google.secretCifrado = cifrar(secret.trim());
      } else if (secret === null) {
        google.secretCifrado = null;
      }
      cambios.google = google;
    }
    const datos = await servicio.guardar(cambios, req.usuario.id);
    return res.json({ mensaje: 'Configuración guardada', configuracion: respuesta(datos) });
  } catch (error) {
    if (error instanceof servicio.ErrorConfiguracion) return res.status(error.status).json({ error: error.message });
    console.error('[configuracion.guardar]', error);
    return res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
};

// POST /api/configuracion/restablecer  -> vuelve a la marca de fabrica
const restablecer = async (req, res) => {
  try {
    const datos = await servicio.restablecer(req.usuario.id);
    return res.json({ mensaje: 'Configuración restablecida', configuracion: respuesta(datos) });
  } catch (error) {
    console.error('[configuracion.restablecer]', error);
    return res.status(500).json({ error: 'No se pudo restablecer la configuración' });
  }
};

// POST /api/configuracion/archivos/:clave  (multipart: archivo)
const subirArchivo = async (req, res) => {
  const { clave } = req.params;
  if (!ARCHIVOS_MARCA[clave]) return res.status(404).json({ error: 'Tipo de imagen no reconocido' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen' });

  let mime;
  try {
    mime = validarArchivoMarca(clave, req.file.buffer, req.file.mimetype);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    await prisma.configuracionArchivo.upsert({
      where: { clave },
      create: { clave, mime, contenido: req.file.buffer, sha256 },
      update: { mime, contenido: req.file.buffer, sha256 },
    });
    servicio.invalidar();
    const datos = await servicio.obtener();
    return res.status(201).json({ mensaje: 'Imagen actualizada', configuracion: respuesta(datos) });
  } catch (error) {
    console.error('[configuracion.subirArchivo]', error);
    return res.status(500).json({ error: 'No se pudo guardar la imagen' });
  }
};

// DELETE /api/configuracion/archivos/:clave  -> vuelve a la imagen de fabrica
const eliminarArchivo = async (req, res) => {
  const { clave } = req.params;
  if (!ARCHIVOS_MARCA[clave]) return res.status(404).json({ error: 'Tipo de imagen no reconocido' });
  try {
    await prisma.configuracionArchivo.deleteMany({ where: { clave } });
    servicio.invalidar();
    const datos = await servicio.obtener();
    return res.json({ mensaje: 'Imagen eliminada', configuracion: respuesta(datos) });
  } catch (error) {
    console.error('[configuracion.eliminarArchivo]', error);
    return res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
};

// GET /api/configuracion/archivos/:clave  (publica)
const verArchivo = async (req, res) => {
  const { clave } = req.params;
  if (!ARCHIVOS_MARCA[clave]) return res.status(404).end();
  try {
    const archivo = await prisma.configuracionArchivo.findUnique({ where: { clave } });
    if (!archivo) return res.status(404).end();

    const etag = `"${archivo.sha256}"`;
    const versionada = req.query.v && archivo.sha256.startsWith(String(req.query.v));
    res.set({
      'Content-Type': archivo.mime,
      ETag: etag,
      'Cache-Control': versionada ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      // Aunque alguien abra un SVG directamente, no puede ejecutar nada.
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      // El frontend vive en otro origen: helmet pone same-origin por defecto.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.send(Buffer.from(archivo.contenido));
  } catch (error) {
    console.error('[configuracion.verArchivo]', error);
    return res.status(500).end();
  }
};

module.exports = { publica, obtener, guardar, restablecer, subirArchivo, eliminarArchivo, verArchivo };
