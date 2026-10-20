/**
 * Adjuntos de proyectos y tareas en Google Drive, en los dos sentidos.
 *
 * En Drive quedan en "Archivos del CRM › Proyectos › <proyecto> › <tarea>",
 * con su nombre real (drive.service: carpetaDeProyecto / carpetaDeTarea), y
 * su URL es /api/archivos/drive/<id> (almacenamiento.service).
 *
 *  - CRM -> Drive: subir un adjunto lo pone en su carpeta (guardarAdjunto);
 *    borrarlo lo manda a la papelera (almacenamiento.borrar); renombrar o
 *    borrar un proyecto o una tarea renombra o tira su carpeta.
 *  - Drive -> CRM (sincronizarCambiosDrive): con la lista de cambios de Drive,
 *    un archivo nuevo en una de esas carpetas se vuelve adjunto; si se
 *    renombra, se mueve a otra carpeta de tarea o proyecto, se reemplaza o se
 *    borra en Drive, el adjunto tambien. Si se tira a la papelera la carpeta
 *    de una tarea o proyecto, sus adjuntos salen del CRM; si se recupera,
 *    vuelven. Se revisa cada 5 minutos y al abrir los adjuntos.
 *  - Los adjuntos de antes (con su uuid en la subcarpeta Adjuntos o en el
 *    disco) se pasan a su carpeta poco a poco (ordenarAdjuntos).
 *
 * Leer lo que se agrega a mano en Drive necesita el permiso de todo Drive
 * (drive.service permisoCompleto); con el de antes solo funciona del CRM a
 * Drive. Los adjuntos de eventos y lo demas (comprobantes, contratos,
 * cotizaciones, base de conocimiento) siguen en sus subcarpetas por tipo.
 */
const fs = require('fs/promises');
const prisma = require('../lib/prisma');
const drive = require('./drive.service');
const almacenamiento = require('./almacenamiento.service');

const PREFIJO_ADJUNTOS = '/api/archivos/adjuntos/';
const INTERVALO_MS = 5 * 60 * 1000;
const RECIENTE_MS = 20 * 1000;
const POR_TANDA = 100;
// Marca (appProperties) de los archivos que sube o acomoda el propio CRM: si
// la lista de cambios ve uno recien hecho antes de que el CRM guarde su
// adjunto, no lo toma por un archivo agregado en Drive.
const MARCA = { crm: 'adjunto' };
const RECIEN_MS = 10 * 60 * 1000;
const esPropioReciente = (archivo) => archivo?.appProperties?.crm === MARCA.crm
  && archivo.createdTime && Date.now() - new Date(archivo.createdTime).getTime() < RECIEN_MS;

// Ordenar y leer cambios van de uno en uno: mientras se mueve un adjunto de
// antes, la lectura de cambios no debe verlo "nuevo" en su carpeta.
let cola = Promise.resolve();
const enSerie = (fn) => {
  const vuelta = cola.then(fn, fn);
  cola = vuelta.catch(() => {});
  return vuelta;
};

// ── CRM -> Drive ─────────────────────────────────────────────────────────────

/**
 * Guarda el archivo de un adjunto de tarea o proyecto. Con Drive conectado va
 * a su carpeta con su nombre real; si Drive no esta o falla, se guarda como
 * antes (subcarpeta Adjuntos o disco) y ordenarAdjuntos lo pasa despues.
 * Devuelve { url, driveArchivoId }.
 */
const guardarAdjunto = async (file, nombre, { tareaId = null, proyectoId = null }) => {
  if (await drive.activo()) {
    try {
      const carpeta = tareaId ? await drive.carpetaDeTarea(tareaId) : await drive.carpetaDeProyecto(proyectoId);
      const { id } = await drive.subirA(carpeta, nombre, file.buffer, file.mimetype, MARCA);
      return { url: almacenamiento.urlDrive(id), driveArchivoId: id };
    } catch (error) {
      console.error('[drive.proyectos] No se pudo subir a la carpeta; se guarda como antes y se ordena despues:', error.message);
    }
  }
  return { url: await almacenamiento.guardar(file, 'adjuntos'), driveArchivoId: null };
};

/** Renombra en Drive la carpeta de un proyecto o tarea (si tiene). Nunca lanza. */
const renombrarCarpeta = async (driveCarpetaId, nombre) => {
  if (!driveCarpetaId) return;
  try {
    if (await drive.activo()) await drive.actualizarArchivo(driveCarpetaId, { nombre: drive.nombreCarpeta(nombre) });
  } catch (error) {
    console.warn('[drive.proyectos] No se pudo renombrar la carpeta:', error.message);
  }
};

/** Manda a la papelera de Drive la carpeta de un proyecto o tarea borrado. Nunca lanza. */
const tirarCarpeta = async (driveCarpetaId) => {
  if (!driveCarpetaId) return;
  try {
    if (await drive.activo()) await drive.aPapeleraPorId(driveCarpetaId);
  } catch (error) {
    console.warn('[drive.proyectos] No se pudo tirar la carpeta:', error.message);
  }
};

// ── Adjuntos de antes -> su carpeta ──────────────────────────────────────────

const pendientesWhere = {
  driveArchivoId: null,
  url: { startsWith: PREFIJO_ADJUNTOS },
  OR: [{ tareaId: { not: null } }, { proyectoId: { not: null } }],
};
// Los que no se encontraron ni en Drive ni en el disco no se reintentan en
// cada vuelta (hasta reiniciar).
const sinArchivo = new Set();

const contarPorOrdenar = async () => {
  try {
    return await prisma.adjunto.count({ where: pendientesWhere });
  } catch (_e) {
    return 0;
  }
};

/** Pasa a su carpeta de proyecto o tarea hasta `limite` adjuntos de antes. */
const ordenarAdjuntos = ({ limite = POR_TANDA } = {}) => enSerie(async () => {
  const resultado = { movidos: 0, subidos: 0, fallidos: 0 };
  if (!(await drive.activo())) return resultado;
  const adjuntos = await prisma.adjunto.findMany({
    where: { ...pendientesWhere, id: { notIn: [...sinArchivo] } },
    orderBy: { id: 'asc' },
    take: limite,
  });
  for (const adjunto of adjuntos) {
    try {
      const ref = almacenamiento.desdeUrl(adjunto.url);
      if (!ref || ref.carpeta !== 'adjuntos') { sinArchivo.add(adjunto.id); continue; }
      const destino = adjunto.tareaId ? await drive.carpetaDeTarea(adjunto.tareaId) : await drive.carpetaDeProyecto(adjunto.proyectoId);
      let id = await drive.idEnSubcarpeta('adjuntos', ref.nombre);
      if (id) {
        await drive.actualizarArchivo(id, { nombre: adjunto.nombre, agregarPadre: destino, quitarPadre: await drive.carpeta('adjuntos', { crear: false }), propiedades: MARCA });
        resultado.movidos += 1;
      } else {
        const ruta = almacenamiento.rutaDe('adjuntos', ref.nombre);
        const buffer = ruta ? await fs.readFile(ruta).catch(() => null) : null;
        if (!buffer) { sinArchivo.add(adjunto.id); resultado.fallidos += 1; continue; }
        ({ id } = await drive.subirA(destino, adjunto.nombre, buffer, adjunto.tipo || 'application/octet-stream', MARCA));
        await fs.unlink(ruta).catch(() => {});
        resultado.subidos += 1;
      }
      await prisma.adjunto.update({ where: { id: adjunto.id }, data: { driveArchivoId: id, url: almacenamiento.urlDrive(id) } });
    } catch (error) {
      resultado.fallidos += 1;
      console.warn('[drive.proyectos] No se pudo ordenar el adjunto', adjunto.id, error.message);
    }
  }
  return resultado;
});

// ── Drive -> CRM ─────────────────────────────────────────────────────────────

/** carpetaId -> { tareaId, proyectoId } de las carpetas que tiene el CRM. */
const mapaDeCarpetas = async () => {
  const [proyectos, tareas] = await Promise.all([
    prisma.proyecto.findMany({ where: { driveCarpetaId: { not: null } }, select: { id: true, driveCarpetaId: true } }),
    prisma.tarea.findMany({ where: { driveCarpetaId: { not: null } }, select: { id: true, proyectoId: true, driveCarpetaId: true } }),
  ]);
  const mapa = new Map();
  for (const p of proyectos) mapa.set(p.driveCarpetaId, { proyectoId: p.id, tareaId: null });
  for (const t of tareas) mapa.set(t.driveCarpetaId, { proyectoId: null, tareaId: t.id });
  return mapa;
};

/** Quien figura como autor de lo que se agrega en Drive: quien conecto Drive o un administrador. */
const autorDeDrive = async () => {
  const conexion = await drive.leerConexion();
  if (conexion?.conectadoPorId) {
    const existe = await prisma.usuario.findUnique({ where: { id: conexion.conectadoPorId }, select: { id: true } });
    if (existe) return existe.id;
  }
  const admin = await prisma.usuario.findFirst({ where: { rol: 'ADMIN' }, orderBy: { id: 'asc' }, select: { id: true } });
  return admin?.id || null;
};

const crearDesdeDrive = async (archivo, destino, autorId) => {
  if (!autorId || !drive.esArchivoAdjuntable(archivo.mimeType) || esPropioReciente(archivo)) return 0;
  await prisma.adjunto.create({
    data: {
      nombre: String(archivo.name || 'Archivo').slice(0, 255),
      url: almacenamiento.urlDrive(archivo.id),
      tipo: archivo.mimeType || null,
      tamano: archivo.size ? Number(archivo.size) : null,
      usuarioId: autorId,
      tareaId: destino.tareaId,
      proyectoId: destino.proyectoId,
      driveArchivoId: archivo.id,
      desdeDrive: true,
    },
  });
  return 1;
};

/** Adjuntos de una carpeta de tarea o proyecto (los del proyecto, sin los de sus tareas). */
const whereDeCarpeta = (destino) => (destino.tareaId
  ? { tareaId: destino.tareaId, driveArchivoId: { not: null } }
  : { proyectoId: destino.proyectoId, tareaId: null, eventoId: null, driveArchivoId: { not: null } });

/** Una carpeta recuperada de la papelera: vuelven los archivos que tenia. */
const importarCarpeta = async (carpetaId, destino, autorId) => {
  let cambios = 0;
  const hijos = await drive.listarHijos(carpetaId);
  for (const archivo of hijos) {
    if (archivo.mimeType === drive.MIME_CARPETA) continue;
    const existe = await prisma.adjunto.findFirst({ where: { driveArchivoId: archivo.id }, select: { id: true } });
    if (!existe) cambios += await crearDesdeDrive(archivo, destino, autorId);
  }
  return cambios;
};

const aplicarCambio = async (cambio, mapa, autorId) => {
  const archivo = cambio.file;
  const quitado = cambio.removed || !archivo || archivo.trashed;

  // Carpetas: solo importan las de tareas y proyectos del CRM.
  if (archivo?.mimeType === drive.MIME_CARPETA) {
    const destino = mapa.get(cambio.fileId);
    if (!destino) return 0;
    if (quitado) {
      const { count } = await prisma.adjunto.deleteMany({ where: whereDeCarpeta(destino) });
      return count;
    }
    return importarCarpeta(cambio.fileId, destino, autorId);
  }

  const adjunto = await prisma.adjunto.findFirst({ where: { driveArchivoId: cambio.fileId } });
  const destino = quitado ? null : (archivo.parents || []).map((p) => mapa.get(p)).find(Boolean);

  // Borrado, a la papelera o fuera de las carpetas del CRM: sale del CRM (el
  // archivo ya no esta ahi, no se toca en Drive).
  if (!destino) {
    if (!adjunto) return 0;
    await prisma.adjunto.delete({ where: { id: adjunto.id } });
    return 1;
  }
  if (!adjunto) return crearDesdeDrive(archivo, destino, autorId);

  const datos = {};
  if (archivo.name && archivo.name !== adjunto.nombre) datos.nombre = String(archivo.name).slice(0, 255);
  if (archivo.size && Number(archivo.size) !== adjunto.tamano) datos.tamano = Number(archivo.size);
  if (archivo.mimeType && archivo.mimeType !== adjunto.tipo) datos.tipo = archivo.mimeType;
  if (destino.tareaId !== adjunto.tareaId || (!destino.tareaId && destino.proyectoId !== adjunto.proyectoId)) {
    datos.tareaId = destino.tareaId;
    datos.proyectoId = destino.proyectoId;
  }
  if (Object.keys(datos).length === 0) return 0;
  await prisma.adjunto.update({ where: { id: adjunto.id }, data: datos });
  return 1;
};

let enCurso = null;

/**
 * Lee la lista de cambios de Drive desde la ultima vez y la aplica a los
 * adjuntos. Devuelve { cambios } o null si no hay Drive con el permiso de
 * todo Drive. Una sola lectura a la vez.
 */
const sincronizarCambiosDrive = () => {
  if (enCurso) return enCurso;
  enCurso = enSerie(async () => {
    if (!(await drive.activo()) || !(await drive.permisoCompleto())) return null;
    const conexion = await drive.leerConexion();
    let pageToken = conexion.cambiosToken;
    if (!pageToken) {
      // Primera vez con el permiso: se empieza desde ahora.
      await drive.anotar({ cambiosToken: await drive.tokenInicialCambios(), cambiosEn: new Date() });
      return { cambios: 0 };
    }
    const mapa = await mapaDeCarpetas();
    const autorId = await autorDeDrive();
    let cambios = 0;
    let siguiente = null;
    while (pageToken) {
      const pagina = await drive.listarCambios(pageToken);
      for (const cambio of pagina.changes || []) {
        try {
          cambios += await aplicarCambio(cambio, mapa, autorId);
        } catch (error) {
          console.warn('[drive.proyectos] No se pudo aplicar el cambio', cambio.fileId, error.message);
        }
      }
      pageToken = pagina.nextPageToken || null;
      siguiente = pagina.newStartPageToken || siguiente;
    }
    await drive.anotar({ cambiosToken: siguiente || conexion.cambiosToken, cambiosEn: new Date() });
    return { cambios };
  }).finally(() => { enCurso = null; });
  return enCurso;
};

/**
 * Para la lista de adjuntos: trae los cambios de Drive si hace mas de 20 s
 * que no se leen, esperando como mucho `esperaMs` (si tarda mas, sigue en
 * segundo plano y la lista sale con lo que ya hay). Nunca lanza.
 */
const sincronizarSiHaceFalta = async ({ esperaMs = 4000 } = {}) => {
  try {
    const conexion = await drive.leerConexion();
    if (!conexion || (conexion.cambiosEn && Date.now() - new Date(conexion.cambiosEn).getTime() < RECIENTE_MS)) return;
    const trabajo = sincronizarCambiosDrive().catch((error) => console.warn('[drive.proyectos] Sincronizacion:', error.message));
    await Promise.race([trabajo, new Promise((r) => { setTimeout(r, esperaMs).unref?.(); })]);
  } catch (error) {
    console.warn('[drive.proyectos] Sincronizacion:', error.message);
  }
};

let temporizador = null;

/** Cada 5 minutos: cambios de Drive y una tanda de adjuntos de antes. */
const iniciarSincronizacionDrive = () => {
  if (temporizador || process.env.DRIVE_SYNC === 'off') return;
  const vuelta = async () => {
    try { await sincronizarCambiosDrive(); } catch (error) { console.warn('[drive.proyectos] Cambios:', error.message); }
    try { await ordenarAdjuntos(); } catch (error) { console.warn('[drive.proyectos] Ordenar:', error.message); }
  };
  temporizador = setInterval(() => { vuelta(); }, INTERVALO_MS);
  temporizador.unref?.();
  setTimeout(() => { vuelta(); }, 45 * 1000).unref?.();
};

module.exports = {
  guardarAdjunto,
  renombrarCarpeta,
  tirarCarpeta,
  contarPorOrdenar,
  ordenarAdjuntos,
  sincronizarCambiosDrive,
  sincronizarSiHaceFalta,
  iniciarSincronizacionDrive,
};
