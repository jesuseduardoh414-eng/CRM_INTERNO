/**
 * Google Drive como almacen de los archivos del CRM y de sus respaldos.
 *
 * Una cuenta de Google de la empresa se conecta una vez desde el panel de
 * configuracion (seccion "Google Drive y respaldos") con el mismo cliente
 * OAuth que Google Calendar. Todo vive en la carpeta "Archivos del CRM" de su
 * Mi unidad y ocupa el espacio de Google Workspace de la empresa:
 *  - Proyectos › <proyecto> › <tarea>: los adjuntos de proyectos y tareas, con
 *    su nombre real y en los dos sentidos (driveProyectos.service.js): lo que
 *    se agrega, renombra o borra ahi desde Drive tambien cambia en el CRM.
 *  - Una subcarpeta por tipo (Adjuntos, Comprobantes, Contratos, Cotizaciones,
 *    Base de conocimiento, Respaldos) para lo demas, con su nombre interno
 *    (uuid + extension): un archivo se encuentra por nombre dentro de su
 *    subcarpeta. Quien decide si se usa Drive o el disco es
 *    almacenHibrido.service.js.
 *
 * Permiso: desde 2026-10-20 se pide todo Drive ("drive"); con "drive.file" el
 * CRM solo veia lo que el mismo creaba y no podia leer lo que se agrega a mano
 * en las carpetas de proyecto. Una conexion de antes sigue funcionando con su
 * permiso (sin leer lo agregado en Drive) hasta que se vuelva a conectar.
 *
 * La conexion (cuenta y refresh token cifrado) va en la tabla conexion_drive.
 * GOOGLE_APIS_URL_PRUEBA y GOOGLE_OAUTH_URL_PRUEBA solo sirven para las
 * pruebas automaticas (un Drive falso en local); en produccion no se ponen.
 */
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { cifrar, descifrar } = require('../utils/cifrado.utils');
const { credencialesGoogle } = require('./google-calendar.service');

const APIS = (process.env.GOOGLE_APIS_URL_PRUEBA || 'https://www.googleapis.com').replace(/\/+$/, '');
const OAUTH = (process.env.GOOGLE_OAUTH_URL_PRUEBA || 'https://oauth2.googleapis.com').replace(/\/+$/, '');
const SCOPE = 'https://www.googleapis.com/auth/drive';
const SCOPE_ANTERIOR = 'https://www.googleapis.com/auth/drive.file';
const MIME_CARPETA = 'application/vnd.google-apps.folder';
const CARPETA_RAIZ = 'Archivos del CRM';
const CARPETA_PROYECTOS = 'Proyectos';
const SUBCARPETAS = {
  adjuntos: 'Adjuntos',
  comprobantes: 'Comprobantes',
  contratos: 'Contratos',
  cotizaciones: 'Cotizaciones',
  conocimiento: 'Base de conocimiento',
  respaldos: 'Respaldos',
  // Lo que se borra en el CRM (services/papelera.service.js). No es la papelera
  // de Google, que se vacia sola a los 30 dias.
  papelera: 'Papelera',
};
// Hasta este tamaño se sube en una sola peticion; arriba, con subida reanudable.
const LIMITE_MULTIPART = 4 * 1024 * 1024;
const CACHE_CONEXION_MS = 30 * 1000;

/** Error con mensaje para mostrar y status HTTP sugerido. */
class ErrorDrive extends Error {
  constructor(mensaje, status = 502) { super(mensaje); this.status = status; }
}

// ── Conexion ────────────────────────────────────────────────────────────────

let conexion = null;
let conexionExpira = 0;
let token = null; // { valor, expira }
const carpetas = new Map(); // clave -> Promise<id>
const ids = new Map(); // "clave/nombre" -> id

/** Olvida lo que se tenga en memoria (tras conectar, desconectar o un error de permiso). */
const olvidar = () => {
  conexionExpira = 0;
  token = null;
  carpetas.clear();
  ids.clear();
  // eslint-disable-next-line no-use-before-define
  vigentes.clear();
};

const leerConexion = async () => {
  if (conexionExpira > Date.now()) return conexion;
  try {
    conexion = await prisma.conexionDrive.findUnique({ where: { id: 1 } });
  } catch (error) {
    // Sin la migracion aplicada el CRM sigue funcionando con el disco.
    if (error?.code !== 'P2021') throw error;
    conexion = null;
  }
  conexionExpira = Date.now() + CACHE_CONEXION_MS;
  return conexion;
};

/** ¿Se guardan y leen archivos en Drive? (conectado, con carpeta y sin revocar) */
const activo = async () => {
  const c = await leerConexion();
  return Boolean(c?.carpetaId && c.estado === 'ok');
};

/** ¿La cuenta dio el permiso de todo Drive? (sin el, no se ve lo agregado a mano) */
const tienePermisoCompleto = (c) => String(c?.alcance || '').split(' ').includes(SCOPE);
const permisoCompleto = async () => tienePermisoCompleto(await leerConexion());

const anotar = async (datos) => {
  await prisma.conexionDrive.update({ where: { id: 1 }, data: datos }).catch(() => {});
  conexionExpira = 0;
};

/** Google ya no acepta el permiso: se deja de usar Drive hasta reconectar. */
const marcarRevocada = (mensaje) => anotar({ estado: 'revocada', ultimoError: mensaje.slice(0, 500) });

const postForm = async (url, campos) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
};

// Las credenciales salen de la configuracion en cache; recien arrancado el
// servidor la cache esta vacia, asi que primero se espera a leerla.
const configLista = () => require('./configuracion.service').obtener();

// Errores de Google con la causa y el paso de la guía del panel que lo arregla.
const LLAVE_RECHAZADA = 'Google no reconoce la llave: el ID de cliente y el secreto no coinciden o el secreto se borró. Vuelve a copiarlos del mismo cliente en Google Cloud (paso 6 de la guía).';
const API_APAGADA = 'La API de Google Drive no está activada en el proyecto de Google Cloud de la llave. Actívala (paso 3 de la guía), espera un minuto y vuelve a intentarlo.';

/** Error del intercambio de codigos de OAuth, explicado. */
const motivoOAuth = (data) => {
  switch (data?.error) {
    case 'invalid_client': return LLAVE_RECHAZADA;
    case 'unauthorized_client': return 'La llave de Google no es de tipo "Aplicación web". Crea un cliente de ese tipo (paso 5 de la guía) y pega su ID y secreto.';
    case 'redirect_uri_mismatch': return 'Google no reconoce la dirección del CRM. Agrégala en "Orígenes autorizados de JavaScript" del cliente (paso 5 de la guía).';
    default: return null;
  }
};

/** Un 403 de Drive porque la API no esta activada en el proyecto. */
const esApiApagada = (data) => {
  const e = data?.error || {};
  return (e.details || []).some((d) => d?.reason === 'SERVICE_DISABLED')
    || (e.errors || []).some((d) => d?.reason === 'accessNotConfigured')
    || /has not been used in project|it is disabled/i.test(e.message || '');
};

const credenciales = async () => {
  await configLista();
  const { clientId, clientSecret } = credencialesGoogle();
  if (!clientId || !clientSecret) {
    throw new ErrorDrive('Falta la llave de Google (ID de cliente y secreto). Pégala en el paso 6 de la guía de Google Drive del panel.', 409);
  }
  return { clientId, clientSecret };
};

const accessToken = async () => {
  if (token && token.expira > Date.now() + 60 * 1000) return token.valor;
  const c = await leerConexion();
  if (!c) throw new ErrorDrive('Google Drive no está conectado.', 409);
  let refresh;
  try {
    refresh = descifrar(c.refreshTokenCifrado);
  } catch (_e) {
    throw new ErrorDrive('No se pudo leer la conexión con Google Drive (¿cambió AUTH_ENCRYPTION_KEY?). Vuelve a conectarla.', 409);
  }
  const { clientId, clientSecret } = await credenciales();
  const { ok, data } = await postForm(`${OAUTH}/token`, {
    client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token',
  });
  if (!ok) {
    if (data.error === 'invalid_grant') {
      const mensaje = 'Google retiró el permiso del CRM sobre Drive (se quitó el acceso o cambió la cuenta). Vuelve a conectar Google Drive en el panel.';
      await marcarRevocada(mensaje);
      throw new ErrorDrive(mensaje, 409);
    }
    throw new ErrorDrive(motivoOAuth(data) || `Google no entregó acceso a Drive: ${data.error_description || data.error || 'error desconocido'}`);
  }
  token = { valor: data.access_token, expira: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  // Google dice que permisos tiene el token: si cambiaron (p. ej. se quito el
  // de todo Drive desde la cuenta), se anota para el panel.
  if (data.scope && data.scope !== c.alcance) await anotar({ alcance: String(data.scope).slice(0, 500) });
  return token.valor;
};

// ── Peticiones a la API de Drive ────────────────────────────────────────────

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Peticion a Drive con el token. Un 401 renueva el token una vez; 429 y 5xx
 * se reintentan con espera. Devuelve el Response (el que llama decide como
 * leerlo); lanza ErrorDrive en cualquier otro error, salvo los `permitidos`.
 */
const pedir = async (url, { metodo = 'GET', cabeceras = {}, cuerpo, permitidos = [] } = {}) => {
  for (let intento = 1; ; intento += 1) {
    const res = await fetch(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...cabeceras },
      body: cuerpo,
    });
    if (res.ok || permitidos.includes(res.status)) return res;
    if (res.status === 401 && intento === 1) { token = null; continue; }
    if ((res.status === 429 || res.status >= 500) && intento < 4) { await esperar(500 * 2 ** intento); continue; }
    const data = await res.json().catch(() => ({}));
    const motivo = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    if (res.status === 403 && /storage quota|quota has been exceeded/i.test(motivo)) {
      throw new ErrorDrive('La cuenta de Google conectada se quedó sin espacio en Drive.', 507);
    }
    if (res.status === 403 && esApiApagada(data)) throw new ErrorDrive(API_APAGADA, 409);
    throw new ErrorDrive(`Google Drive respondió: ${motivo}`, res.status === 404 ? 404 : 502);
  }
};

const pedirJson = async (url, opciones) => (await pedir(url, opciones)).json();

/** Literal para las consultas de Drive ('nombre con \' escapada'). */
const literal = (texto) => `'${String(texto).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const buscar = async (q, campos = 'id,name,size,md5Checksum,createdTime', extra = '') => {
  const url = `${APIS}/drive/v3/files?spaces=drive&pageSize=1000&fields=${encodeURIComponent(`files(${campos})`)}&q=${encodeURIComponent(q)}${extra}`;
  return (await pedirJson(url)).files || [];
};

const crearCarpeta = async (nombre, padre) => (await pedirJson(`${APIS}/drive/v3/files?fields=id`, {
  metodo: 'POST',
  cabeceras: { 'Content-Type': 'application/json; charset=UTF-8' },
  cuerpo: JSON.stringify({ name: nombre, mimeType: MIME_CARPETA, parents: [padre] }),
})).id;

const buscarCarpeta = async (nombre, padre) => (await buscar(
  `name = ${literal(nombre)} and ${literal(padre)} in parents and mimeType = '${MIME_CARPETA}' and trashed = false`,
  'id',
))[0]?.id || null;

/** Id de la subcarpeta (Adjuntos, Respaldos...); la crea si `crear`. */
const carpeta = async (clave, { crear = true } = {}) => {
  const nombre = SUBCARPETAS[clave];
  if (!nombre) throw new Error(`Subcarpeta de Drive desconocida: ${clave}`);
  if (carpetas.has(clave)) return carpetas.get(clave);
  const c = await leerConexion();
  const promesa = (async () => {
    const existente = await buscarCarpeta(nombre, c.carpetaId);
    if (existente || !crear) return existente;
    return crearCarpeta(nombre, c.carpetaId);
  })();
  carpetas.set(clave, promesa);
  try {
    const id = await promesa;
    if (!id) carpetas.delete(clave); // no se creo: que se vuelva a buscar
    return id;
  } catch (error) {
    carpetas.delete(clave);
    throw error;
  }
};

const recordar = (clave, nombre, id) => {
  if (ids.size > 20000) ids.clear();
  ids.set(`${clave}/${nombre}`, id);
};

/** Id de un archivo por su nombre interno, o null si no esta. */
const buscarId = async (clave, nombre) => {
  const llave = `${clave}/${nombre}`;
  if (ids.has(llave)) return ids.get(llave);
  const padre = await carpeta(clave, { crear: false });
  if (!padre) return null;
  const encontrado = (await buscar(`name = ${literal(nombre)} and ${literal(padre)} in parents and trashed = false`, 'id'))[0];
  if (encontrado) recordar(clave, nombre, encontrado.id);
  return encontrado?.id || null;
};

const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

/**
 * Sube un archivo a la carpeta `padre` (id) y comprueba que llegue entero
 * (md5). `propiedades`: appProperties (solo las ve el CRM). Devuelve { id, bytes }.
 */
const subirA = async (padre, nombre, buffer, mime = 'application/octet-stream', propiedades = undefined) => {
  const meta = JSON.stringify({ name: nombre, parents: [padre], mimeType: mime, appProperties: propiedades });
  let creado;
  if (buffer.length <= LIMITE_MULTIPART) {
    const limite = `crm${crypto.randomUUID().replace(/-/g, '')}`;
    const cuerpo = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${mime}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${limite}--`),
    ]);
    creado = await pedirJson(`${APIS}/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum,size`, {
      metodo: 'POST',
      cabeceras: { 'Content-Type': `multipart/related; boundary=${limite}` },
      cuerpo,
    });
  } else {
    const inicio = await pedir(`${APIS}/upload/drive/v3/files?uploadType=resumable&fields=id,md5Checksum,size`, {
      metodo: 'POST',
      cabeceras: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(buffer.length),
      },
      cuerpo: meta,
    });
    const destino = inicio.headers.get('location');
    if (!destino) throw new ErrorDrive('Google Drive no abrió la subida del archivo.');
    creado = await pedirJson(destino, { metodo: 'PUT', cabeceras: { 'Content-Type': mime }, cuerpo: buffer });
  }
  if (creado.md5Checksum && creado.md5Checksum !== md5(buffer)) {
    await pedir(`${APIS}/drive/v3/files/${encodeURIComponent(creado.id)}`, { metodo: 'DELETE', permitidos: [404] }).catch(() => {});
    throw new ErrorDrive('El archivo llegó dañado a Google Drive.');
  }
  return { id: creado.id, bytes: Number(creado.size) || buffer.length };
};

/** Sube un archivo a su subcarpeta por tipo (con su nombre interno). Devuelve { id, bytes }. */
const subir = async (clave, nombre, buffer, mime = 'application/octet-stream') => {
  const subido = await subirA(await carpeta(clave), nombre, buffer, mime);
  recordar(clave, nombre, subido.id);
  return subido;
};

// ── Archivos por id (adjuntos de proyectos y tareas) ────────────────────────

const urlArchivo = (id, resto = '') => `${APIS}/drive/v3/files/${encodeURIComponent(id)}${resto}`;

/** Metadatos de un archivo o carpeta, o null si no existe (o no se puede ver). */
const metadatos = async (id, campos = 'id,name,mimeType,parents,trashed,size,md5Checksum') => {
  const res = await pedir(urlArchivo(id, `?fields=${encodeURIComponent(campos)}`), { permitidos: [404] });
  return res.status === 404 ? null : res.json();
};

// Los documentos de Google (Docs, Hojas, Presentaciones) no tienen archivo:
// se bajan convertidos.
const EXPORTAR = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MIME_GOOGLE = 'application/vnd.google-apps.';
/** ¿Se puede guardar como adjunto? (todo menos carpetas y documentos de Google sin conversion) */
const esArchivoAdjuntable = (mime) => !String(mime || '').startsWith(MIME_GOOGLE) || Boolean(EXPORTAR[mime]);

/** { contenido, mime, nombre } de un archivo por id, o null si ya no esta. */
const bajarPorId = async (id) => {
  const meta = await metadatos(id, 'id,name,mimeType,trashed');
  if (!meta || meta.trashed || !esArchivoAdjuntable(meta.mimeType)) return null;
  const exportar = EXPORTAR[meta.mimeType];
  const res = await pedir(
    exportar ? urlArchivo(id, `/export?mimeType=${encodeURIComponent(exportar)}`) : urlArchivo(id, '?alt=media'),
    { permitidos: [404] },
  );
  if (res.status === 404) return null;
  return { contenido: Buffer.from(await res.arrayBuffer()), mime: exportar || meta.mimeType || 'application/octet-stream', nombre: meta.name };
};

/** Renombra y/o mueve (agregar un padre y quitar otro) un archivo o carpeta. */
const actualizarArchivo = async (id, { nombre, agregarPadre, quitarPadre, propiedades } = {}) => {
  const params = new URLSearchParams({ fields: 'id,name,parents' });
  if (agregarPadre) params.set('addParents', agregarPadre);
  if (quitarPadre) params.set('removeParents', quitarPadre);
  const res = await pedir(urlArchivo(id, `?${params}`), {
    metodo: 'PATCH',
    cabeceras: { 'Content-Type': 'application/json; charset=UTF-8' },
    cuerpo: JSON.stringify({ name: nombre || undefined, appProperties: propiedades }),
    permitidos: [404],
  });
  return res.status === 404 ? null : res.json();
};

/** Archivos y carpetas (no borrados) dentro de una carpeta. */
const listarHijos = (carpetaId) => buscar(`${literal(carpetaId)} in parents and trashed = false`, 'id,name,mimeType,size,parents,appProperties,createdTime');

/** Id del archivo de la subcarpeta Adjuntos con ese nombre interno (los de antes). */
const idEnSubcarpeta = (clave, nombre) => buscarId(clave, nombre);

// ── Carpetas de proyectos y tareas ──────────────────────────────────────────

/** Nombre de carpeta valido en Drive a partir del nombre de un proyecto o tarea. */
const nombreCarpeta = (texto) => String(texto || '').replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sin nombre';

// Carpetas que se comprobaron hace poco (no se vuelve a preguntar a Google en
// cada subida) y trabajos en curso (no crear dos carpetas si llegan juntos).
const vigentes = new Map(); // id -> expira
const enCurso = new Map();
const unaVez = (llave, fn) => {
  if (!enCurso.has(llave)) enCurso.set(llave, fn().finally(() => enCurso.delete(llave)));
  return enCurso.get(llave);
};
const carpetaVigente = async (id) => {
  if (!id) return false;
  if ((vigentes.get(id) || 0) > Date.now()) return true;
  const meta = await metadatos(id, 'id,mimeType,trashed');
  const ok = Boolean(meta && !meta.trashed && meta.mimeType === MIME_CARPETA);
  if (ok) vigentes.set(id, Date.now() + 10 * 60 * 1000);
  else vigentes.delete(id);
  return ok;
};

/** Carpeta "Proyectos" dentro de "Archivos del CRM". */
const carpetaProyectos = () => unaVez('proyectos', async () => {
  const c = await leerConexion();
  if (await carpetaVigente(c.proyectosCarpetaId)) return c.proyectosCarpetaId;
  const id = await buscarCarpeta(CARPETA_PROYECTOS, c.carpetaId) || await crearCarpeta(CARPETA_PROYECTOS, c.carpetaId);
  await anotar({ proyectosCarpetaId: id });
  return id;
});

/** Carpeta de un proyecto (la crea si no existe o si la borraron en Drive). */
const carpetaDeProyecto = (proyectoId) => unaVez(`p${proyectoId}`, async () => {
  const proyecto = await prisma.proyecto.findUnique({ where: { id: proyectoId }, select: { id: true, nombre: true, driveCarpetaId: true } });
  if (!proyecto) throw new ErrorDrive('El proyecto ya no existe.', 404);
  if (await carpetaVigente(proyecto.driveCarpetaId)) return proyecto.driveCarpetaId;
  const id = await crearCarpeta(nombreCarpeta(proyecto.nombre), await carpetaProyectos());
  vigentes.set(id, Date.now() + 10 * 60 * 1000);
  await prisma.proyecto.update({ where: { id: proyectoId }, data: { driveCarpetaId: id } });
  return id;
});

/** Carpeta de una tarea, dentro de la de su proyecto. */
const carpetaDeTarea = (tareaId) => unaVez(`t${tareaId}`, async () => {
  const tarea = await prisma.tarea.findUnique({ where: { id: tareaId }, select: { id: true, titulo: true, proyectoId: true, driveCarpetaId: true } });
  if (!tarea) throw new ErrorDrive('La tarea ya no existe.', 404);
  if (await carpetaVigente(tarea.driveCarpetaId)) return tarea.driveCarpetaId;
  const id = await crearCarpeta(nombreCarpeta(tarea.titulo), await carpetaDeProyecto(tarea.proyectoId));
  vigentes.set(id, Date.now() + 10 * 60 * 1000);
  await prisma.tarea.update({ where: { id: tareaId }, data: { driveCarpetaId: id } });
  return id;
});

// ── Lista de cambios de Drive ───────────────────────────────────────────────

/** Marca desde la que pedir cambios (lo de antes no se trae). */
const tokenInicialCambios = async () => (await pedirJson(`${APIS}/drive/v3/changes/startPageToken`)).startPageToken;

/** Una pagina de cambios desde `pageToken`. */
const listarCambios = (pageToken) => pedirJson(`${APIS}/drive/v3/changes?${new URLSearchParams({
  pageToken,
  includeRemoved: 'true',
  spaces: 'drive',
  pageSize: '1000',
  fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,trashed,size,appProperties,createdTime))',
})}`);

/** Contenido de un archivo, o null si no esta en Drive. */
const bajar = async (clave, nombre) => {
  const id = await buscarId(clave, nombre);
  if (!id) return null;
  const res = await pedir(`${APIS}/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { permitidos: [404] });
  if (res.status === 404) {
    ids.delete(`${clave}/${nombre}`);
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
};

/** Lo manda a la papelera de Drive (se puede recuperar durante 30 dias). */
const aPapelera = async (clave, nombre) => {
  const id = await buscarId(clave, nombre);
  if (!id) return false;
  await pedir(`${APIS}/drive/v3/files/${encodeURIComponent(id)}?fields=id`, {
    metodo: 'PATCH',
    cabeceras: { 'Content-Type': 'application/json; charset=UTF-8' },
    cuerpo: JSON.stringify({ trashed: true }),
    permitidos: [404],
  });
  ids.delete(`${clave}/${nombre}`);
  return true;
};

/** md5 del archivo en Drive (para comprobar copias), o null si no esta. */
const huellaEnDrive = async (clave, nombre) => {
  const padre = await carpeta(clave, { crear: false });
  if (!padre) return null;
  const encontrado = (await buscar(`name = ${literal(nombre)} and ${literal(padre)} in parents and trashed = false`, 'id,md5Checksum'))[0];
  if (encontrado) recordar(clave, nombre, encontrado.id);
  return encontrado?.md5Checksum || null;
};

// ── Respaldos ───────────────────────────────────────────────────────────────

/** Respaldos guardados, del mas nuevo al mas viejo. */
const listarRespaldos = async () => {
  const padre = await carpeta('respaldos', { crear: false });
  if (!padre) return [];
  return buscar(`${literal(padre)} in parents and trashed = false`, 'id,name,size,createdTime,webViewLink', '&orderBy=createdTime%20desc');
};

const aPapeleraPorId = (id) => pedir(`${APIS}/drive/v3/files/${encodeURIComponent(id)}?fields=id`, {
  metodo: 'PATCH',
  cabeceras: { 'Content-Type': 'application/json; charset=UTF-8' },
  cuerpo: JSON.stringify({ trashed: true }),
  permitidos: [404],
});

/**
 * Mueve un archivo o carpeta a "Archivos del CRM/Papelera" (y lo saca de la
 * papelera de Google si estaba ahi). Devuelve false si ya no existe.
 */
const aPapeleraCrmPorId = async (id) => {
  const meta = await metadatos(id, 'id,parents,trashed');
  if (!meta) return false;
  const destino = await carpeta('papelera');
  const params = new URLSearchParams({ fields: 'id', addParents: destino });
  const quitar = (meta.parents || []).filter((p) => p !== destino).join(',');
  if (quitar) params.set('removeParents', quitar);
  const res = await pedir(urlArchivo(id, `?${params}`), {
    metodo: 'PATCH',
    cabeceras: { 'Content-Type': 'application/json; charset=UTF-8' },
    cuerpo: JSON.stringify(meta.trashed ? { trashed: false } : {}),
    permitidos: [404],
  });
  return res.status !== 404;
};

/** Igual, por nombre interno dentro de una subcarpeta. Devuelve el id o null. */
const aPapeleraCrm = async (clave, nombre) => {
  const id = await buscarId(clave, nombre);
  if (!id) return null;
  ids.delete(`${clave}/${nombre}`);
  return (await aPapeleraCrmPorId(id)) ? id : null;
};

// ── Conectar y desconectar ──────────────────────────────────────────────────

/**
 * Cambia el codigo que entrega el boton de Google (popup) por un permiso
 * permanente, guarda la conexion y prepara la carpeta "Archivos del CRM".
 */
const conectar = async (codigo, usuarioId) => {
  const { clientId, clientSecret } = await credenciales();
  const { ok, data } = await postForm(`${OAUTH}/token`, {
    code: codigo, client_id: clientId, client_secret: clientSecret, redirect_uri: 'postmessage', grant_type: 'authorization_code',
  });
  if (!ok) {
    const motivo = data.error === 'invalid_grant'
      ? 'La autorización de Google caducó o ya se usó. Vuelve a pulsar Conectar.'
      : motivoOAuth(data);
    throw new ErrorDrive(motivo || `Google no aceptó la conexión: ${data.error_description || data.error || 'error desconocido'}`, 400);
  }
  if (!String(data.scope || '').split(' ').includes(SCOPE)) {
    throw new ErrorDrive('No se dio permiso sobre Google Drive. Vuelve a intentarlo y marca la casilla de Google Drive ("ver, editar, crear y borrar…").', 400);
  }
  const acceso = { Authorization: `Bearer ${data.access_token}` };
  const sobre = await (await fetch(`${APIS}/drive/v3/about?fields=user(emailAddress)`, { headers: acceso })).json().catch(() => ({}));
  if (esApiApagada(sobre)) throw new ErrorDrive(API_APAGADA, 409);
  const cuenta = sobre?.user?.emailAddress;
  if (!cuenta) throw new ErrorDrive('No se pudo saber qué cuenta de Google se conectó.');

  const actual = await leerConexion();
  if (actual && actual.cuenta.toLowerCase() !== cuenta.toLowerCase()) {
    throw new ErrorDrive(`Drive ya está conectado con ${actual.cuenta}. Para cambiar de cuenta, desconéctala primero (los archivos ya guardados se quedan en esa cuenta).`, 409);
  }
  let refresh = data.refresh_token;
  if (!refresh && actual) {
    try { refresh = descifrar(actual.refreshTokenCifrado); } catch (_e) { refresh = null; }
  }
  if (!refresh) {
    throw new ErrorDrive('Google no entregó un permiso permanente. Quita el acceso del CRM en myaccount.google.com/permissions y vuelve a conectar.', 409);
  }

  // La marca de cambios se reinicia: con el permiso nuevo se empieza a leer
  // desde ahora (driveProyectos.service).
  const alcance = String(data.scope || '').slice(0, 500);
  await prisma.conexionDrive.upsert({
    where: { id: 1 },
    create: { id: 1, cuenta, refreshTokenCifrado: cifrar(refresh), conectadoPorId: usuarioId ?? null, alcance },
    update: { cuenta, refreshTokenCifrado: cifrar(refresh), estado: 'ok', ultimoError: null, conectadoPorId: usuarioId ?? null, alcance, cambiosToken: null },
  });
  olvidar();
  token = { valor: data.access_token, expira: Date.now() + (Number(data.expires_in) || 3600) * 1000 };

  // La carpeta raiz: la que el CRM ya hubiera creado en esta cuenta (al
  // reconectar) o una nueva en Mi unidad.
  const raiz = await buscarCarpeta(CARPETA_RAIZ, 'root') || await crearCarpeta(CARPETA_RAIZ, 'root');
  await prisma.conexionDrive.update({ where: { id: 1 }, data: { carpetaId: raiz } });
  conexionExpira = 0;
  return estado();
};

/** Quita la conexion. Los archivos se quedan en el Drive de esa cuenta. */
const desconectar = async () => {
  const c = await leerConexion();
  if (c) {
    try {
      await postForm(`${OAUTH}/revoke`, { token: descifrar(c.refreshTokenCifrado) });
    } catch (_e) { /* si Google no lo acepta, igual se borra aqui */ }
    await prisma.conexionDrive.delete({ where: { id: 1 } }).catch(() => {});
  }
  olvidar();
};

/** Resumen para el panel. Con `detalle`, consulta a Google (espacio y respaldos). */
const estado = async ({ detalle = true } = {}) => {
  await configLista();
  const c = await leerConexion();
  const { clientId, clientSecret } = credencialesGoogle();
  const base = {
    credenciales: Boolean(clientId && clientSecret),
    clientId: clientId || null,
    scope: SCOPE,
    conectado: Boolean(c),
  };
  if (!c) return base;
  const resultado = {
    ...base,
    activo: Boolean(c.carpetaId && c.estado === 'ok'),
    // Sin el permiso de todo Drive (conexion de antes del 2026-10-20) no se ve
    // lo que se agrega a mano en las carpetas de proyecto: hay que reconectar.
    permisoCompleto: tienePermisoCompleto(c),
    cuenta: c.cuenta,
    estado: c.estado,
    ultimoError: c.ultimoError,
    conectadoEn: c.conectadoEn,
    carpetaUrl: c.carpetaId ? `https://drive.google.com/drive/folders/${c.carpetaId}` : null,
    ultimoRespaldo: c.ultimoRespaldoEn ? { en: c.ultimoRespaldoEn, bytes: c.ultimoRespaldoBytes } : null,
  };
  if (!detalle || !resultado.activo) return resultado;
  try {
    const sobre = await pedirJson(`${APIS}/drive/v3/about?fields=storageQuota`);
    const q = sobre.storageQuota || {};
    resultado.espacio = { usado: Number(q.usage) || 0, limite: q.limit ? Number(q.limit) : null };
    resultado.respaldos = (await listarRespaldos()).slice(0, 10).map((r) => ({
      nombre: r.name, bytes: Number(r.size) || 0, creado: r.createdTime, url: r.webViewLink || null,
    }));
  } catch (error) {
    resultado.errorConsulta = error.message;
  }
  return resultado;
};

module.exports = {
  ErrorDrive,
  SCOPE,
  SCOPE_ANTERIOR,
  SUBCARPETAS,
  MIME_CARPETA,
  activo,
  permisoCompleto,
  leerConexion,
  anotar,
  olvidar,
  subir,
  subirA,
  bajar,
  bajarPorId,
  metadatos,
  actualizarArchivo,
  listarHijos,
  esArchivoAdjuntable,
  idEnSubcarpeta,
  carpeta,
  nombreCarpeta,
  carpetaDeProyecto,
  carpetaDeTarea,
  tokenInicialCambios,
  listarCambios,
  aPapelera,
  huellaEnDrive,
  md5,
  listarRespaldos,
  aPapeleraPorId,
  aPapeleraCrm,
  aPapeleraCrmPorId,
  conectar,
  desconectar,
  estado,
};
