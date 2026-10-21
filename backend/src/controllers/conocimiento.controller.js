// Base de conocimiento: articulos (procedimientos, guias, preguntas
// frecuentes) con archivos adjuntos. Leer, crear, editar y eliminar son
// permisos de la sección (conocimiento.*). Un borrador (publicado = false)
// solo lo ve quien escribe en la base, y sus archivos tampoco. Cada articulo
// y cada archivo puede quedar solo para ciertas areas, roles o personas
// (utils/accesoConocimiento.utils.js; cambiarlo es conocimiento.acceso): lo
// que la persona no puede ver responde 404, como si no existiera. Rutas en
// routes/conocimiento.routes.js.
const prisma = require('../lib/prisma');
const documentos = require('../services/documentos.service');
const { configEnCache } = require('../services/configuracion.service');
const { puede, sinPermiso } = require('../utils/permisosArea.utils');
const { accesoArticulos, accesoArchivos, normalizarAcceso } = require('../utils/accesoConocimiento.utils');
const { contiene, combinarWhere } = require('../utils/paginacion.utils');

const almacen = documentos.conocimiento;
const MAX_CONTENIDO = 200000;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const selectUsuario = { id: true, nombre: true };
const selectAccesos = { select: { id: true, area: true, rol: true, usuarioId: true, usuario: { select: selectUsuario } } };
const selectArchivo = { id: true, nombreOriginal: true, mime: true, tamano: true, restringido: true, creadoEn: true, subidoPor: { select: selectUsuario } };

const leerId = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const texto = (valor, max) => {
  if (valor === undefined || valor === null) return valor;
  return String(valor).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
};

/** Quien escribe en la base (crear o editar) ve tambien los borradores. */
const escribe = (usuario) => puede(usuario, 'conocimiento.crear') || puede(usuario, 'conocimiento.editar');
/** Quien elige quien ve cada articulo y archivo (y por eso ve las listas). */
const gestionaAcceso = (usuario) => puede(usuario, 'conocimiento.acceso');

/** where de los articulos que la persona puede abrir (undefined = todos). */
const visiblePara = (usuario) => combinarWhere(escribe(usuario) ? null : { publicado: true }, accesoArticulos(usuario));
/** where de los archivos que la persona puede abrir: su articulo y el archivo. */
const archivoVisiblePara = (usuario) => {
  const articulo = visiblePara(usuario);
  return combinarWhere(accesoArchivos(usuario), articulo ? { articulo } : null);
};

const selectListado = (usuario) => {
  const archivos = accesoArchivos(usuario);
  return {
    id: true, titulo: true, categoria: true, resumen: true, publicado: true, fijado: true, restringido: true, creadoEn: true, actualizadoEn: true,
    autor: { select: selectUsuario }, editadoPor: { select: selectUsuario },
    // Solo cuenta los archivos que la persona ve.
    _count: { select: { archivos: archivos ? { where: archivos } : true } },
  };
};

/** Detalle de un articulo: las listas de acceso solo para quien las gestiona. */
const incluirDetalle = (usuario) => {
  const conAccesos = gestionaAcceso(usuario) ? { accesos: selectAccesos } : {};
  return {
    autor: { select: selectUsuario },
    editadoPor: { select: selectUsuario },
    archivos: { where: accesoArchivos(usuario) || undefined, orderBy: { creadoEn: 'asc' }, select: { ...selectArchivo, ...conAccesos } },
    ...conAccesos,
  };
};

const serializarListado = ({ _count, ...a }) => ({ ...a, totalArchivos: _count?.archivos ?? 0 });

/** Busca en el texto del articulo y en el nombre de los archivos que la persona ve. */
const busqueda = (valor, usuario) => {
  const q = texto(valor, 200);
  if (!q) return null;
  return {
    OR: [
      ...['titulo', 'resumen', 'contenido', 'categoria'].map((campo) => ({ [campo]: contiene(q) })),
      { archivos: { some: combinarWhere({ nombreOriginal: contiene(q) }, accesoArchivos(usuario)) } },
    ],
  };
};

const normalizar = async (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('titulo')) {
    const titulo = texto(body.titulo, 200);
    if (!titulo || titulo.length < 3) errores.push('El título es obligatorio (mínimo 3 caracteres)');
    else data.titulo = titulo;
  }
  if (!parcial || viene('categoria')) {
    const categoria = texto(body.categoria, 80);
    if (!categoria || categoria.length < 2) errores.push('Indica la categoría (por ejemplo: Procedimientos, Ventas, Sistemas)');
    else {
      // Una categoria que ya existe se reutiliza tal como esta escrita, para
      // que "ventas" y "Ventas" no salgan como dos.
      const existentes = await prisma.articuloConocimiento.findMany({ distinct: ['categoria'], select: { categoria: true } });
      const igual = existentes.find((e) => e.categoria.toLowerCase() === categoria.toLowerCase());
      data.categoria = igual ? igual.categoria : categoria;
    }
  }
  if (viene('resumen')) data.resumen = texto(body.resumen, 300) || null;
  if (!parcial || viene('contenido')) {
    const contenido = typeof body.contenido === 'string' ? body.contenido.replace(/\r\n/g, '\n') : '';
    if (contenido.length > MAX_CONTENIDO) errores.push(`El texto es demasiado largo (máximo ${MAX_CONTENIDO.toLocaleString('es-MX')} caracteres)`);
    else data.contenido = contenido;
  }
  if (viene('publicado')) data.publicado = Boolean(body.publicado);
  if (viene('fijado')) data.fijado = Boolean(body.fijado);
  return { data, errores };
};

/**
 * Acceso que manda el formulario ({ restringido, reglas }), si viene. Sin el
 * permiso conocimiento.acceso no se puede tocar: { prohibido: true }.
 */
const leerAcceso = async (entrada, usuario) => {
  if (entrada === undefined) return { acceso: null, errores: [] };
  if (!gestionaAcceso(usuario)) return { prohibido: true };
  const { restringido, filas, errores } = await normalizarAcceso(entrada, {
    areas: (configEnCache().reglas?.areas || []).map((a) => a.clave),
    existentes: async (ids) => (await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id),
  });
  return { acceso: errores.length ? null : { restringido, filas }, errores };
};

/** En multipart el acceso llega como texto JSON. */
const accesoDeFormulario = (valor) => {
  if (valor === undefined || valor === '') return undefined;
  try {
    return JSON.parse(valor);
  } catch {
    return null; // normalizarAcceso lo rechaza
  }
};

/** Datos de Prisma para guardar el acceso al crear (o reemplazarlo al editar). */
const datosAcceso = (acceso, { reemplazar = false } = {}) => {
  if (!acceso) return {};
  return {
    restringido: acceso.restringido,
    accesos: reemplazar ? { deleteMany: {}, create: acceso.filas } : { create: acceso.filas },
  };
};

/** ¿La persona sigue viendo el articulo? (tras quitarse a si misma del acceso). */
const sigueViendo = async (id, usuario) => (await prisma.articuloConocimiento.count({ where: combinarWhere({ id }, visiblePara(usuario)) })) > 0;

// ---------------------------------------------------------------------------
// GET /api/conocimiento?q=&categoria=
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const categoria = texto(req.query.categoria, 80);
    const visibles = visiblePara(req.usuario);
    const where = combinarWhere(visibles, busqueda(req.query.q, req.usuario), categoria ? { categoria } : null);
    const [articulos, porCategoria] = await Promise.all([
      prisma.articuloConocimiento.findMany({ where, select: selectListado(req.usuario), orderBy: [{ fijado: 'desc' }, { actualizadoEn: 'desc' }] }),
      prisma.articuloConocimiento.groupBy({ by: ['categoria'], where: visibles, _count: { _all: true } }),
    ]);
    const categorias = porCategoria
      .map((c) => ({ nombre: c.categoria, total: c._count._all }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return res.json({ articulos: articulos.map(serializarListado), categorias, puedeEditar: puede(req.usuario, 'conocimiento.editar') });
  } catch (error) {
    console.error('[conocimiento.listar]', error);
    return res.status(500).json({ error: 'Error al cargar la base de conocimiento' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/conocimiento/:id
// ---------------------------------------------------------------------------
const obtener = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const articulo = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), include: incluirDetalle(req.usuario) });
    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
    return res.json({ articulo, puedeEditar: puede(req.usuario, 'conocimiento.editar') });
  } catch (error) {
    console.error('[conocimiento.obtener]', error);
    return res.status(500).json({ error: 'Error al leer el artículo' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/conocimiento   (administradores; `acceso` opcional)
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  try {
    const { data, errores } = await normalizar(req.body);
    const acceso = await leerAcceso(req.body.acceso, req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (errores.length || acceso.errores.length) return res.status(400).json({ error: 'Revisa el artículo', detalles: [...errores, ...acceso.errores] });
    const articulo = await prisma.articuloConocimiento.create({
      data: { ...data, ...datosAcceso(acceso.acceso), autorId: req.usuario.id, editadoPorId: req.usuario.id },
      include: incluirDetalle(req.usuario),
    });
    return res.status(201).json({ mensaje: 'Artículo creado', articulo });
  } catch (error) {
    console.error('[conocimiento.crear]', error);
    return res.status(500).json({ error: 'Error al crear el artículo' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/conocimiento/:id   (administradores; `acceso` opcional)
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), select: { id: true } });
    if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
    const { data, errores } = await normalizar(req.body, { parcial: true });
    const acceso = await leerAcceso(req.body.acceso, req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (errores.length || acceso.errores.length) return res.status(400).json({ error: 'Revisa el artículo', detalles: [...errores, ...acceso.errores] });
    if (Object.keys(data).length === 0 && !acceso.acceso) return res.status(400).json({ error: 'No hay cambios que guardar' });
    const articulo = await prisma.articuloConocimiento.update({
      where: { id },
      data: { ...data, ...datosAcceso(acceso.acceso, { reemplazar: true }), editadoPorId: req.usuario.id },
      include: incluirDetalle(req.usuario),
    });
    return res.json({ mensaje: 'Artículo actualizado', articulo, sinAcceso: !(await sigueViendo(id, req.usuario)) });
  } catch (error) {
    console.error('[conocimiento.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar el artículo' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/conocimiento/:id/acceso   (conocimiento.acceso; { restringido, reglas })
// ---------------------------------------------------------------------------
const cambiarAcceso = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), select: { id: true } });
    if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
    const acceso = await leerAcceso(req.body || {}, req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (acceso.errores.length) return res.status(400).json({ error: 'Revisa el acceso', detalles: acceso.errores });
    const articulo = await prisma.articuloConocimiento.update({
      where: { id },
      data: { ...datosAcceso(acceso.acceso, { reemplazar: true }), editadoPorId: req.usuario.id },
      include: incluirDetalle(req.usuario),
    });
    return res.json({ mensaje: 'Acceso actualizado', articulo, sinAcceso: !(await sigueViendo(id, req.usuario)) });
  } catch (error) {
    console.error('[conocimiento.cambiarAcceso]', error);
    return res.status(500).json({ error: 'Error al cambiar el acceso' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/conocimiento/:id   (administradores; borra tambien sus archivos)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), include: { archivos: { select: { archivo: true } } } });
    if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
    // Nadie borra sin saberlo archivos que no puede ver. (Se cuentan los que
    // ve, no los que no: un NOT con columnas nulas deja filas fuera.)
    const soloSuyos = accesoArchivos(req.usuario);
    if (soloSuyos && await prisma.archivoConocimiento.count({ where: { articuloId: id, ...soloSuyos } }) < actual.archivos.length) {
      return res.status(409).json({ error: 'Este artículo tiene archivos restringidos que no puedes ver. Pide al administrador general que lo elimine.' });
    }
    await prisma.articuloConocimiento.delete({ where: { id } });
    await Promise.all(actual.archivos.map((a) => almacen.borrar(a.archivo).catch((e) => console.error('[conocimiento.eliminar] disco', e?.message))));
    return res.json({ mensaje: 'Artículo eliminado' });
  } catch (error) {
    console.error('[conocimiento.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el artículo' });
  }
};

/** Valida el archivo subido: { ext } o { error } (400). */
const revisarSubida = (file) => {
  if (!file) return { error: 'Selecciona un archivo (PDF, imagen, Word, Excel o PowerPoint)' };
  const ext = documentos.detectar(file.buffer, file.originalname);
  if (!ext) return { error: 'El archivo no es un PDF, imagen, Word, Excel o PowerPoint válido, o está dañado' };
  return { ext };
};

/** Fila de archivos_conocimiento para un archivo ya guardado en el almacen. */
const datosArchivo = (file, ext, nombreInterno, sha256, usuarioId) => ({
  nombreOriginal: documentos.limpiarNombre(file.originalname, ext),
  archivo: nombreInterno,
  mime: documentos.TIPOS[ext],
  tamano: file.size,
  sha256,
  subidoPorId: usuarioId,
});

// ---------------------------------------------------------------------------
// POST /api/conocimiento/documentos   (conocimiento.crear; multipart: archivo,
// titulo, categoria, resumen y acceso en JSON). Un articulo por archivo, para
// cargar muchos documentos de una vez, cada uno en su categoria.
// ---------------------------------------------------------------------------
const crearDocumento = async (req, res) => {
  const { ext, error: errorArchivo } = revisarSubida(req.file);
  if (errorArchivo) return res.status(400).json({ error: errorArchivo });

  let nombreInterno = null;
  try {
    const { data, errores } = await normalizar({ titulo: req.body.titulo, categoria: req.body.categoria, resumen: req.body.resumen, contenido: '' });
    const acceso = await leerAcceso(accesoDeFormulario(req.body.acceso), req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (errores.length || acceso.errores.length) return res.status(400).json({ error: 'Revisa el documento', detalles: [...errores, ...acceso.errores] });

    nombreInterno = await almacen.guardar(req.file.buffer, ext);
    const articulo = await prisma.articuloConocimiento.create({
      data: {
        ...data,
        ...datosAcceso(acceso.acceso),
        autorId: req.usuario.id,
        editadoPorId: req.usuario.id,
        archivos: { create: datosArchivo(req.file, ext, nombreInterno, documentos.huella(req.file.buffer), req.usuario.id) },
      },
      include: incluirDetalle(req.usuario),
    });
    return res.status(201).json({ mensaje: 'Documento creado', articulo });
  } catch (error) {
    if (nombreInterno) await almacen.borrar(nombreInterno).catch(() => {});
    console.error('[conocimiento.crearDocumento]', error);
    return res.status(500).json({ error: 'Error al guardar el documento' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/conocimiento/:id/archivos   (administradores; multipart, campo
// "archivo" y, opcional, "acceso" en JSON para que nazca restringido)
// ---------------------------------------------------------------------------
const subirArchivo = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { ext, error: errorArchivo } = revisarSubida(req.file);
  if (errorArchivo) return res.status(400).json({ error: errorArchivo });

  let nombreInterno = null;
  try {
    const articulo = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), select: { id: true } });
    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
    const acceso = await leerAcceso(accesoDeFormulario(req.body?.acceso), req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (acceso.errores.length) return res.status(400).json({ error: 'Revisa el acceso', detalles: acceso.errores });
    const sha256 = documentos.huella(req.file.buffer);
    const repetido = await prisma.archivoConocimiento.findFirst({ where: { articuloId: id, sha256 }, select: { nombreOriginal: true, id: true } });
    if (repetido) {
      // El nombre solo si la persona puede ver ese archivo.
      const loVe = await prisma.archivoConocimiento.count({ where: combinarWhere({ id: repetido.id }, accesoArchivos(req.usuario)) });
      return res.status(409).json({ error: loVe ? `Este archivo ya está adjunto (${repetido.nombreOriginal})` : 'Este archivo ya está adjunto' });
    }

    nombreInterno = await almacen.guardar(req.file.buffer, ext);
    const archivo = await prisma.$transaction(async (tx) => {
      const creado = await tx.archivoConocimiento.create({
        data: { articuloId: id, ...datosArchivo(req.file, ext, nombreInterno, sha256, req.usuario.id), ...datosAcceso(acceso.acceso) },
        select: selectArchivo,
      });
      await tx.articuloConocimiento.update({ where: { id }, data: { editadoPorId: req.usuario.id } });
      return creado;
    });
    return res.status(201).json({ mensaje: 'Archivo adjuntado', archivo });
  } catch (error) {
    if (nombreInterno) await almacen.borrar(nombreInterno).catch(() => {});
    console.error('[conocimiento.subirArchivo]', error);
    return res.status(500).json({ error: 'Error al guardar el archivo' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/conocimiento/archivos/:id   (?descargar=1)
// ---------------------------------------------------------------------------
const verArchivo = async (req, res) => {
  const { id } = req.params;
  if (!REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const archivo = await prisma.archivoConocimiento.findFirst({ where: combinarWhere({ id }, archivoVisiblePara(req.usuario)) });
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
    let contenido;
    try {
      contenido = await almacen.leer(archivo.archivo);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(410).json({ error: 'El archivo ya no está en el servidor' });
      throw error;
    }
    return documentos.enviar(res, { contenido, mime: archivo.mime, nombreOriginal: archivo.nombreOriginal, descargar: Boolean(req.query.descargar) });
  } catch (error) {
    console.error('[conocimiento.verArchivo]', error);
    return res.status(500).json({ error: 'Error al leer el archivo' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/conocimiento/archivos/:id/acceso   (conocimiento.acceso)
// ---------------------------------------------------------------------------
const cambiarAccesoArchivo = async (req, res) => {
  const { id } = req.params;
  if (!REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const actual = await prisma.archivoConocimiento.findFirst({ where: combinarWhere({ id }, archivoVisiblePara(req.usuario)), select: { id: true, articuloId: true } });
    if (!actual) return res.status(404).json({ error: 'Archivo no encontrado' });
    const acceso = await leerAcceso(req.body || {}, req.usuario);
    if (acceso.prohibido) return sinPermiso(res);
    if (acceso.errores.length) return res.status(400).json({ error: 'Revisa el acceso', detalles: acceso.errores });
    const archivo = await prisma.archivoConocimiento.update({
      where: { id },
      data: datosAcceso(acceso.acceso, { reemplazar: true }),
      select: { ...selectArchivo, accesos: selectAccesos },
    });
    return res.json({ mensaje: 'Acceso actualizado', archivo });
  } catch (error) {
    console.error('[conocimiento.cambiarAccesoArchivo]', error);
    return res.status(500).json({ error: 'Error al cambiar el acceso' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/conocimiento/archivos/:id   (administradores)
// ---------------------------------------------------------------------------
const eliminarArchivo = async (req, res) => {
  const { id } = req.params;
  if (!REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const archivo = await prisma.archivoConocimiento.findFirst({ where: combinarWhere({ id }, archivoVisiblePara(req.usuario)), select: { archivo: true, articuloId: true } });
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
    await prisma.archivoConocimiento.delete({ where: { id } });
    await almacen.borrar(archivo.archivo).catch((e) => console.error('[conocimiento.eliminarArchivo] disco', e?.message));
    return res.json({ mensaje: 'Archivo eliminado' });
  } catch (error) {
    console.error('[conocimiento.eliminarArchivo]', error);
    return res.status(500).json({ error: 'Error al eliminar el archivo' });
  }
};

module.exports = {
  listar, obtener, crear, editar, cambiarAcceso, eliminar, crearDocumento, subirArchivo, verArchivo, cambiarAccesoArchivo, eliminarArchivo,
};
