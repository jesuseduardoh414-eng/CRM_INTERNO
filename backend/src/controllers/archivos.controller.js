// GET /api/archivos/:carpeta/:nombre — adjuntos y fotos de perfil guardados en
// el disco del servidor (services/almacenamiento.service.js). Es publica como
// lo era Vercel Blob: el nombre es un uuid imposible de adivinar y el frontend
// los muestra con <img>/<iframe>, que no pueden mandar el token.
const almacenamiento = require('../services/almacenamiento.service');

// Origenes que pueden incrustar el archivo (vista previa de PDF en el CRM).
const origenesMarco = () => ["'self'", process.env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']
  .filter(Boolean)
  .map((o) => o.replace(/\/+$/, ''))
  .join(' ');

const ver = async (req, res) => {
  try {
    const archivo = await almacenamiento.leer(req.params.carpeta, req.params.nombre);
    if (!archivo) return res.status(404).end();
    // El visor de PDF del navegador no funciona dentro de 'sandbox'; el resto
    // de archivos si lo lleva, por si alguien abre uno directamente.
    const csp = archivo.ext === '.pdf'
      ? `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors ${origenesMarco()}`
      : `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors ${origenesMarco()}`;
    res.removeHeader('X-Frame-Options');
    const disposicion = archivo.enLinea ? 'inline' : 'attachment';
    res.set({
      'Content-Type': archivo.tipo,
      // Los de Drive llevan su nombre real; los del disco se llaman por su uuid.
      'Content-Disposition': archivo.nombre ? `${disposicion}; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}` : disposicion,
      // Un archivo de Drive se puede reemplazar alla con la misma URL.
      'Cache-Control': archivo.cambiante ? 'private, max-age=300' : 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': csp,
      // El frontend vive en otro origen: helmet pone same-origin por defecto.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return res.send(archivo.contenido);
  } catch (error) {
    console.error('[archivos.ver]', error);
    return res.status(500).end();
  }
};

module.exports = { ver };
