/**
 * Lectura y escritura de la configuracion de la instalacion, con cache en
 * memoria (30 s). `configEnCache()` es sincrona para quien no puede esperar
 * (plantillas de correo): devuelve lo ultimo conocido o los valores de fabrica
 * y refresca en segundo plano.
 */
const prisma = require('../lib/prisma');
const { DEFECTO, validar } = require('../utils/configuracion.utils');

const CACHE_MS = 30 * 1000;
let cache = null;       // { config, archivos, version, expira }
let enCurso = null;

const leerDeBase = async () => {
  const [fila, archivos] = await Promise.all([
    prisma.configuracion.findUnique({ where: { id: 1 } }),
    prisma.configuracionArchivo.findMany({ select: { clave: true, sha256: true, mime: true, actualizadoEn: true } }),
  ]);
  return {
    config: validar({}, fila?.datos || DEFECTO),
    version: fila?.version || 0,
    actualizadoEn: fila?.actualizadoEn || null,
    archivos: Object.fromEntries(archivos.map((a) => [a.clave, { sha256: a.sha256, mime: a.mime, actualizadoEn: a.actualizadoEn }])),
  };
};

const obtener = async () => {
  if (cache && cache.expira > Date.now()) return cache;
  if (!enCurso) {
    enCurso = leerDeBase()
      .then((datos) => { cache = { ...datos, expira: Date.now() + CACHE_MS }; return cache; })
      .finally(() => { enCurso = null; });
  }
  return enCurso;
};

const invalidar = () => { cache = null; };

/** Version sincrona: ultimo valor conocido (o de fabrica) y refresco en segundo plano. */
const configEnCache = () => {
  if (!cache || cache.expira <= Date.now()) obtener().catch(() => {});
  return cache?.config || validar({}, DEFECTO);
};

const moduloActivo = async (modulo) => {
  const { config } = await obtener();
  return config.modulos?.[modulo] !== false;
};

/** Error con mensaje para el panel (409: el cambio choca con datos existentes). */
class ErrorConfiguracion extends Error {
  constructor(mensaje, status = 409) { super(mensaje); this.status = status; }
}

/**
 * Un area solo se puede quitar si nadie la usa: usuarios, proyectos,
 * plantillas e invitaciones vigentes (todos guardan una o varias areas
 * separadas por coma).
 */
const comprobarAreasQuitadas = async (antes, despues) => {
  const quedan = new Set(despues.map((a) => a.clave));
  const quitadas = antes.filter((a) => !quedan.has(a.clave));
  for (const area of quitadas) {
    const enLista = (campo) => ({
      OR: [
        { [campo]: area.clave },
        { [campo]: { startsWith: `${area.clave},` } },
        { [campo]: { endsWith: `,${area.clave}` } },
        { [campo]: { contains: `,${area.clave},` } },
      ],
    });
    const [usuarios, proyectos, plantillas, invitaciones] = await Promise.all([
      prisma.usuario.count({ where: enLista('area') }),
      prisma.proyecto.count({ where: enLista('area') }),
      prisma.plantillaProyecto.count({ where: enLista('area') }),
      prisma.invitacion.count({ where: { ...enLista('area'), estado: 'pendiente', expiraEn: { gt: new Date() } } }),
    ]);
    const partes = [
      usuarios && `${usuarios} usuario${usuarios === 1 ? '' : 's'}`,
      proyectos && `${proyectos} proyecto${proyectos === 1 ? '' : 's'}`,
      plantillas && `${plantillas} plantilla${plantillas === 1 ? '' : 's'}`,
      invitaciones && `${invitaciones} ${invitaciones === 1 ? 'invitación pendiente' : 'invitaciones pendientes'}`,
    ].filter(Boolean);
    if (partes.length) {
      const nombre = area.nombre || area.clave.charAt(0) + area.clave.slice(1).toLowerCase();
      throw new ErrorConfiguracion(`No se puede quitar el área «${nombre}»: la usan ${partes.join(', ')}. Cámbialos de área primero.`);
    }
  }
  return quitadas.map((a) => a.clave);
};

const guardar = async (cambios, usuarioId) => {
  const actual = await obtener();
  const nueva = validar(cambios, actual.config);
  const quitadas = await comprobarAreasQuitadas(actual.config.reglas.areas, nueva.reglas.areas);
  await prisma.configuracion.upsert({
    where: { id: 1 },
    create: { id: 1, datos: nueva, version: 1, actualizadoPorId: usuarioId },
    update: { datos: nueva, version: { increment: 1 }, actualizadoPorId: usuarioId },
  });
  // Las reglas de acceso (base de conocimiento y cotizaciones) de un area
  // quitada ya no alcanzan a nadie; se borran para que no revivan si otra area
  // toma la clave.
  if (quitadas.length) {
    await prisma.accesoConocimiento.deleteMany({ where: { area: { in: quitadas } } });
    await prisma.accesoCotizacion.deleteMany({ where: { area: { in: quitadas } } });
  }
  invalidar();
  return obtener();
};

const restablecer = async (usuarioId) => {
  await prisma.configuracion.upsert({
    where: { id: 1 },
    create: { id: 1, datos: validar({}, DEFECTO), actualizadoPorId: usuarioId },
    update: { datos: validar({}, DEFECTO), version: { increment: 1 }, actualizadoPorId: usuarioId },
  });
  await prisma.configuracionArchivo.deleteMany({});
  invalidar();
  return obtener();
};

module.exports = { ErrorConfiguracion, obtener, invalidar, configEnCache, moduloActivo, guardar, restablecer };
