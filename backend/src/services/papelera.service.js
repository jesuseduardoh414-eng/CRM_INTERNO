/**
 * Papelera del CRM: lo que la gente borra no se pierde (pedido del
 * 2026-10-26). Para quien usa el CRM desaparece igual que antes, pero:
 *  - antes de borrar se guarda una copia completa (tabla `papelera`): la fila,
 *    lo que se borra con ella (comentarios y adjuntos de una tarea, archivos
 *    de un contrato...), quien lo borro y cuando;
 *  - sus archivos no se borran: se mueven a la carpeta "Papelera" de "Archivos
 *    del CRM" en Google Drive (no a la papelera de Google, que se vacia sola a
 *    los 30 dias) y a PAPELERA_DIR en el disco.
 * Solo se ve en el panel de configuracion (ver y descargar). Se guarda para
 * siempre salvo que alli se elimine a mano.
 *
 * Uso en un controlador:
 *   await papelera.conPapelera({ tipo, modulo, entidadId, nombre, contexto, datos, archivos },
 *     () => prisma.x.delete(...));
 * Si no se puede guardar la copia, no se borra nada (la peticion falla). Los
 * archivos se mueven despues de borrar las filas y un fallo ahi no lanza: el
 * archivo se queda donde estaba y la copia lo sigue encontrando.
 *
 * `archivos`: [{ nombre, mime, tamano, url }] para adjuntos o
 * [{ nombre, mime, tamano, almacen, archivo }] para contratos, comprobantes,
 * cotizaciones y base de conocimiento.
 */
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../lib/prisma');
const contexto = require('../lib/contexto');
const drive = require('./drive.service');
const almacenamiento = require('./almacenamiento.service');
const contratosArchivos = require('./contratosArchivos.service');
const comprobantes = require('./comprobantes.service');
const documentos = require('./documentos.service');
const registro = require('./registroActividad.service');

const ALMACENES = {
  contratos: contratosArchivos,
  comprobantes,
  cotizaciones: documentos.cotizaciones,
  conocimiento: documentos.conocimiento,
};

/** Carpeta del disco: PAPELERA_DIR o, si falta, junto a la de adjuntos. */
const directorio = () => {
  if (process.env.PAPELERA_DIR) return path.resolve(process.env.PAPELERA_DIR);
  if (process.env.ADJUNTOS_DIR) return path.join(path.dirname(path.resolve(process.env.ADJUNTOS_DIR)), 'papelera');
  return path.resolve(__dirname, '../../storage/papelera');
};

const NOMBRE_SEGURO = /^[0-9A-Za-z][0-9A-Za-z._-]{0,150}$/;
const CLAVES_DISCO = new Set(['adjuntos', ...Object.keys(ALMACENES)]);

/** "contratos/<uuid>.pdf" (relativa a la papelera) y su ruta absoluta. */
const enDisco = (clave, nombre) => {
  if (!CLAVES_DISCO.has(clave) || !NOMBRE_SEGURO.test(String(nombre || ''))) throw new Error('Nombre de archivo inválido');
  return { relativa: `${clave}/${nombre}`, ruta: path.join(directorio(), clave, nombre) };
};
const rutaGuardada = (relativa) => {
  const [clave, nombre, ...resto] = String(relativa || '').split('/');
  if (resto.length) throw new Error('Ruta inválida');
  return enDisco(clave, nombre).ruta;
};

/** Descripcion del archivo de un adjunto (tarea, proyecto o evento) para `archivos`. */
const archivoDeAdjunto = (a) => ({ nombre: a.nombre, mime: a.tipo || null, tamano: a.tamano ?? null, url: a.url });

/** Descripcion de un archivo de un almacen (contratos, comprobantes, cotizaciones, conocimiento). */
const archivoDeAlmacen = (almacen, f) => ({ nombre: f.nombreOriginal, mime: f.mime || (almacen === 'contratos' ? 'application/pdf' : null), tamano: f.tamano ?? null, almacen, archivo: f.archivo });

/** Copia serializable (fechas en ISO, decimales como texto). */
const copia = (datos) => JSON.parse(JSON.stringify(datos ?? null));

const quien = (usuario) => {
  const u = usuario || contexto.actual()?.usuario || null;
  return { borradoPorId: u?.id ?? null, borradoPorNombre: u?.nombre ?? null };
};

/** Guarda la copia y devuelve la fila. Lanza si no se pudo (y entonces no se borra nada). */
const guardar = ({ tipo, modulo, entidadId, nombre, contexto: donde, datos, archivos = [], origen, usuario }) => prisma.elementoBorrado.create({
  data: {
    tipo,
    modulo,
    entidadId: entidadId !== undefined && entidadId !== null ? String(entidadId) : null,
    nombre: String(nombre || 'Sin nombre').slice(0, 255),
    contexto: donde ? String(donde).slice(0, 255) : null,
    datos: copia(datos),
    archivos: archivos.length ? copia(archivos) : undefined,
    origen: origen || contexto.actual()?.origen || 'usuario',
    ...quien(usuario),
  },
});

/** Mueve un archivo a la papelera y devuelve su descripcion con donde quedo. */
const moverUno = async (archivo) => {
  try {
    if (archivo.url) {
      const nombre = almacenamiento.desdeUrl(archivo.url)?.nombre;
      const donde = await almacenamiento.aPapelera(archivo.url, (n) => enDisco('adjuntos', n).ruta);
      if (donde.externo) return archivo;
      return {
        ...archivo,
        drive: donde.drive || null,
        disco: donde.disco ? enDisco('adjuntos', nombre).relativa : null,
        // Si nada se movio, se sigue buscando por su nombre en el almacen de adjuntos.
        ...(nombre && !donde.drive && !donde.disco ? { almacen: 'adjuntos', archivo: nombre } : {}),
      };
    }
    const almacen = ALMACENES[archivo.almacen];
    if (!almacen || !archivo.archivo) return archivo;
    const destino = enDisco(archivo.almacen, archivo.archivo);
    const donde = await almacen.aPapelera(archivo.archivo, destino.ruta);
    return { ...archivo, drive: donde.drive || null, disco: donde.disco ? destino.relativa : null };
  } catch (error) {
    console.error('[papelera] No se pudo mover un archivo:', error.message);
    return archivo;
  }
};

const moverArchivos = async (fila) => {
  const archivos = Array.isArray(fila.archivos) ? fila.archivos : [];
  if (!archivos.length) return fila;
  const movidos = [];
  for (const a of archivos) movidos.push(await moverUno(a));
  return prisma.elementoBorrado.update({ where: { id: fila.id }, data: { archivos: copia(movidos) } }).catch(() => fila);
};

/** Lleva una carpeta de proyecto o tarea de Drive a la papelera del CRM (en vez de tirarla). */
const carpetaDrive = async (id) => {
  if (!id) return;
  try {
    if (await drive.activo()) await drive.aPapeleraCrmPorId(id);
  } catch (error) {
    console.warn('[papelera] No se pudo mover la carpeta de Drive:', error.message);
  }
};

/**
 * Guarda la copia de uno o varios elementos, ejecuta `borrarFilas` y mueve
 * sus archivos. Si `borrarFilas` falla, las copias se quitan y el error sigue.
 */
const conPapelera = async (elementos, borrarFilas) => {
  const lista = Array.isArray(elementos) ? elementos : [elementos];
  const filas = [];
  for (const e of lista) filas.push(await guardar(e));
  let resultado;
  try {
    resultado = await borrarFilas();
  } catch (error) {
    await prisma.elementoBorrado.deleteMany({ where: { id: { in: filas.map((f) => f.id) } } }).catch(() => {});
    throw error;
  }
  for (const f of filas) await moverArchivos(f);
  return resultado;
};

// ── Panel de configuracion ─────────────────────────────────────────────────

const RESUMEN = { id: true, tipo: true, modulo: true, entidadId: true, nombre: true, contexto: true, archivos: true, origen: true, borradoPorId: true, borradoPorNombre: true, borradoEn: true };

const listar = async (filtros = {}, limite = 40) => {
  const { contiene } = require('../utils/paginacion.utils'); // eslint-disable-line global-require
  const where = {};
  if (filtros.modulo) where.modulo = filtros.modulo;
  if (filtros.usuarioId) where.borradoPorId = filtros.usuarioId;
  if (filtros.antesDe) where.id = { lt: filtros.antesDe };
  if (filtros.q) where.OR = [{ nombre: contiene(filtros.q) }, { contexto: contiene(filtros.q) }, { borradoPorNombre: contiene(filtros.q) }];
  const filas = await prisma.elementoBorrado.findMany({ where, orderBy: { id: 'desc' }, take: limite + 1, select: RESUMEN });
  return {
    elementos: filas.slice(0, limite).map(({ archivos, ...f }) => ({ ...f, archivos: Array.isArray(archivos) ? archivos.length : 0 })),
    siguiente: filas.length > limite ? filas[limite - 1].id : null,
  };
};

const obtener = (id) => prisma.elementoBorrado.findUnique({ where: { id } });

/** { contenido, nombre, mime } de un archivo de un elemento, o null si ya no esta en ningun lado. */
const leerArchivo = async (fila, indice) => {
  const archivo = Array.isArray(fila?.archivos) ? fila.archivos[indice] : null;
  if (!archivo) return null;
  const salida = (contenido, mime) => ({ contenido, nombre: archivo.nombre || 'archivo', mime: archivo.mime || mime || 'application/octet-stream' });
  if (archivo.disco) {
    const contenido = await fs.readFile(rutaGuardada(archivo.disco)).catch(() => null);
    if (contenido) return salida(contenido);
  }
  if (archivo.drive && (await drive.activo())) {
    const enDrive = await drive.bajarPorId(archivo.drive).catch(() => null);
    if (enDrive) return salida(enDrive.contenido, enDrive.mime);
  }
  const almacen = archivo.almacen === 'adjuntos' ? { leer: almacenamiento.leerAdjuntoPorNombre } : ALMACENES[archivo.almacen];
  if (almacen && archivo.archivo) {
    const contenido = await almacen.leer(archivo.archivo).catch(() => null);
    if (contenido) return salida(contenido);
  }
  return null;
};

/** Elimina para siempre: los archivos (a la papelera de Google / fuera del disco) y la copia. */
const purgar = async (fila) => {
  for (const archivo of Array.isArray(fila.archivos) ? fila.archivos : []) {
    try {
      if (archivo.disco) await fs.unlink(rutaGuardada(archivo.disco)).catch((e) => { if (e.code !== 'ENOENT') throw e; });
      if (archivo.drive && (await drive.activo())) await drive.aPapeleraPorId(archivo.drive);
      if (!archivo.disco && !archivo.drive) {
        if (archivo.url) await almacenamiento.borrar([archivo.url]);
        else if (archivo.almacen === 'adjuntos' && archivo.archivo) await almacenamiento.borrar([`/api/archivos/adjuntos/${archivo.archivo}`]);
        else if (ALMACENES[archivo.almacen] && archivo.archivo) await ALMACENES[archivo.almacen].borrar(archivo.archivo);
      }
    } catch (error) {
      console.error('[papelera] No se pudo eliminar un archivo:', error.message);
    }
  }
  await prisma.elementoBorrado.delete({ where: { id: fila.id } });
  const ctx = contexto.actual();
  if (ctx) {
    registro.anotar(prisma, ctx, [{
      accion: 'eliminar', modulo: 'papelera', tipo: fila.tipo, entidadId: String(fila.id), entidadNombre: fila.nombre, cambios: null,
    }]);
  }
};

module.exports = { archivoDeAdjunto, archivoDeAlmacen, conPapelera, guardar, moverArchivos, carpetaDrive, listar, obtener, leerArchivo, purgar, directorio };
