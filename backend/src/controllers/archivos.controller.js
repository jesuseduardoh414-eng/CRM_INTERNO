// GET /api/archivos/:carpeta/:nombre — adjuntos y fotos de perfil guardados en
// el disco del servidor o en Google Drive (services/almacenamiento.service.js).
//
// Antes era publica (el nombre es un uuid imposible de adivinar), pero quien
// tuviera la URL la conservaba para siempre: alguien que salio del proyecto o
// del CRM, o un enlace copiado fuera. Ahora pide sesion: el frontend los
// muestra con <img>/<iframe>/enlaces, que no pueden mandar el token, asi que
// llega la cookie httpOnly crm_archivos (sesiones.service.js) o, en las
// descargas con fetch, el access token. Ademas se comprueba el permiso sobre
// el archivo: fotos de perfil, cualquier sesion; adjuntos, quien ve la tarea,
// el proyecto o el evento (y el cliente, lo que se le compartio).
const prisma = require('../lib/prisma');
const almacenamiento = require('../services/almacenamiento.service');
const { sesionDeArchivos } = require('../services/sesiones.service');
const { usuarioDeSesion } = require('../middlewares/auth.middleware');
const { cargarTareaVisible, cargarProyectoVisible } = require('../utils/permissions.utils');
const { canAccessEvento } = require('./adjuntos.controller');
const { configEnCache } = require('../services/configuracion.service');

// Origenes que pueden incrustar el archivo (vista previa de PDF en el CRM).
// Los de desarrollo solo si el frontend no es https (produccion).
const origenesMarco = () => {
  const frontend = process.env.FRONTEND_URL;
  const desarrollo = /^https:/i.test(frontend || '') ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return ["'self'", frontend, ...desarrollo].filter(Boolean).map((o) => o.replace(/\/+$/, '')).join(' ');
};

/** ¿Puede esta persona ver este adjunto? (lo mismo que para listarlo) */
const puedeVerAdjunto = async (usuario, adjunto) => {
  if (usuario.rol === 'CLIENTE') {
    // Solo los documentos del proyecto que se le compartieron (como su portal).
    if (!adjunto.visibleCliente || adjunto.tareaId || adjunto.eventoId || !adjunto.proyecto) return false;
    if (adjunto.proyecto.clienteId !== usuario.empresaId || adjunto.proyecto.estado === 'ARCHIVADO') return false;
    if (configEnCache().modulos?.clientes === false) return false;
    const empresa = await prisma.empresa.findUnique({ where: { id: usuario.empresaId }, select: { estado: true, tipo: true } });
    return Boolean(empresa) && empresa.estado === 'ACTIVO' && empresa.tipo !== 'PROVEEDOR';
  }
  if (!['ADMIN', 'MIEMBRO'].includes(usuario.rol)) return false;
  if (adjunto.usuarioId === usuario.id) return true; // quien lo subio
  if (adjunto.tareaId) return (await cargarTareaVisible(prisma, usuario, adjunto.tareaId)).permitido;
  if (adjunto.eventoId) return Boolean(adjunto.evento) && canAccessEvento(adjunto.evento, usuario.id);
  if (adjunto.proyectoId) return (await cargarProyectoVisible(prisma, usuario, adjunto.proyectoId)).permitido;
  return false;
};

const puedeVerArchivo = async ({ usuario, debeActivar2FA }, carpeta, nombre) => {
  if (carpeta === 'perfiles') return true;
  if (debeActivar2FA || !['adjuntos', 'drive'].includes(carpeta)) return false;
  const adjunto = await prisma.adjunto.findFirst({
    where: carpeta === 'drive' ? { driveArchivoId: String(nombre) } : { url: `/api/archivos/adjuntos/${nombre}` },
    select: {
      usuarioId: true, tareaId: true, proyectoId: true, eventoId: true, visibleCliente: true,
      proyecto: { select: { clienteId: true, estado: true } },
      evento: { select: { usuarioId: true, creadoPorId: true, esGlobal: true, invitados: { select: { usuarioId: true } } } },
    },
  });
  return Boolean(adjunto) && puedeVerAdjunto(usuario, adjunto);
};

const sinAcceso = (res, estado) => {
  res.set('Cache-Control', 'no-store');
  return res.status(estado).end();
};

const ver = async (req, res) => {
  try {
    const datos = sesionDeArchivos(req);
    const sesion = datos ? await usuarioDeSesion(datos) : null;
    if (!sesion?.usuario) return sinAcceso(res, 401);
    // 404 tambien sin permiso: no se confirma que el archivo exista.
    if (!(await puedeVerArchivo(sesion, req.params.carpeta, req.params.nombre))) return sinAcceso(res, 404);

    const archivo = await almacenamiento.leer(req.params.carpeta, req.params.nombre);
    if (!archivo) return sinAcceso(res, 404);
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
      // Solo en la cache del navegador de quien lo pidio. Las fotos cambian de
      // nombre al cambiar. Un adjunto se revalida en cada uso (no-cache + ETag:
      // 304 si nada cambio), asi tras salir o perder el permiso ya no se abre
      // ni desde la cache de ese navegador.
      'Cache-Control': req.params.carpeta === 'perfiles' ? 'private, max-age=86400' : 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': csp,
      // En produccion el frontend es el mismo origen: ninguna otra pagina
      // (tampoco un subdominio hermano, a donde si viaja la cookie Strict)
      // puede incrustarlo. En desarrollo el frontend esta en otro puerto.
      'Cross-Origin-Resource-Policy': /^https:/i.test(process.env.FRONTEND_URL || '') ? 'same-origin' : 'cross-origin',
    });
    return res.send(archivo.contenido);
  } catch (error) {
    console.error('[archivos.ver]', error);
    return res.status(500).end();
  }
};

module.exports = { ver };
