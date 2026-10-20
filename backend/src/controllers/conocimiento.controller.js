// Base de conocimiento: articulos (procedimientos, guias, preguntas
// frecuentes) con archivos adjuntos. Leer, crear, editar y eliminar son
// permisos de la sección (conocimiento.*). Un borrador (publicado = false)
// solo lo ve quien escribe en la base, y sus archivos tampoco. Rutas en
// routes/conocimiento.routes.js.
const prisma = require('../lib/prisma');
const documentos = require('../services/documentos.service');
const { puede } = require('../utils/permisosArea.utils');
const { construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');

const almacen = documentos.conocimiento;
const MAX_CONTENIDO = 200000;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const selectUsuario = { id: true, nombre: true };
const selectArchivo = { id: true, nombreOriginal: true, mime: true, tamano: true, creadoEn: true, subidoPor: { select: selectUsuario } };
const selectListado = {
  id: true, titulo: true, categoria: true, resumen: true, publicado: true, fijado: true, creadoEn: true, actualizadoEn: true,
  autor: { select: selectUsuario }, editadoPor: { select: selectUsuario }, _count: { select: { archivos: true } },
};
const incluirDetalle = {
  autor: { select: selectUsuario },
  editadoPor: { select: selectUsuario },
  archivos: { orderBy: { creadoEn: 'asc' }, select: selectArchivo },
};

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
const visiblePara = (usuario) => (escribe(usuario) ? null : { publicado: true });

const serializarListado = ({ _count, ...a }) => ({ ...a, totalArchivos: _count?.archivos ?? 0 });

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

// ---------------------------------------------------------------------------
// GET /api/conocimiento?q=&categoria=
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const categoria = texto(req.query.categoria, 80);
    const where = combinarWhere(
      visiblePara(req.usuario),
      construirBusqueda(req.query.q, ['titulo', 'resumen', 'contenido', 'categoria']),
      categoria ? { categoria } : null,
    );
    const [articulos, porCategoria] = await Promise.all([
      prisma.articuloConocimiento.findMany({ where, select: selectListado, orderBy: [{ fijado: 'desc' }, { actualizadoEn: 'desc' }] }),
      prisma.articuloConocimiento.groupBy({ by: ['categoria'], where: visiblePara(req.usuario) || undefined, _count: { _all: true } }),
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
    const articulo = await prisma.articuloConocimiento.findFirst({ where: combinarWhere({ id }, visiblePara(req.usuario)), include: incluirDetalle });
    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
    return res.json({ articulo, puedeEditar: puede(req.usuario, 'conocimiento.editar') });
  } catch (error) {
    console.error('[conocimiento.obtener]', error);
    return res.status(500).json({ error: 'Error al leer el artículo' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/conocimiento   (administradores)
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  try {
    const { data, errores } = await normalizar(req.body);
    if (errores.length) return res.status(400).json({ error: 'Revisa el artículo', detalles: errores });
    const articulo = await prisma.articuloConocimiento.create({
      data: { ...data, autorId: req.usuario.id, editadoPorId: req.usuario.id },
      include: incluirDetalle,
    });
    return res.status(201).json({ mensaje: 'Artículo creado', articulo });
  } catch (error) {
    console.error('[conocimiento.crear]', error);
    return res.status(500).json({ error: 'Error al crear el artículo' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/conocimiento/:id   (administradores)
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.articuloConocimiento.findUnique({ where: { id }, select: { id: true } });
    if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
    const { data, errores } = await normalizar(req.body, { parcial: true });
    if (errores.length) return res.status(400).json({ error: 'Revisa el artículo', detalles: errores });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar' });
    const articulo = await prisma.articuloConocimiento.update({ where: { id }, data: { ...data, editadoPorId: req.usuario.id }, include: incluirDetalle });
    return res.json({ mensaje: 'Artículo actualizado', articulo });
  } catch (error) {
    console.error('[conocimiento.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar el artículo' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/conocimiento/:id   (administradores; borra tambien sus archivos)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.articuloConocimiento.findUnique({ where: { id }, include: { archivos: { select: { archivo: true } } } });
    if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
    await prisma.articuloConocimiento.delete({ where: { id } });
    await Promise.all(actual.archivos.map((a) => almacen.borrar(a.archivo).catch((e) => console.error('[conocimiento.eliminar] disco', e?.message))));
    return res.json({ mensaje: 'Artículo eliminado' });
  } catch (error) {
    console.error('[conocimiento.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el artículo' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/conocimiento/:id/archivos   (administradores; multipart, campo "archivo")
// ---------------------------------------------------------------------------
const subirArchivo = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo (PDF, imagen, Word, Excel o PowerPoint)' });
  const ext = documentos.detectar(req.file.buffer, req.file.originalname);
  if (!ext) return res.status(400).json({ error: 'El archivo no es un PDF, imagen, Word, Excel o PowerPoint válido, o está dañado' });

  let nombreInterno = null;
  try {
    const articulo = await prisma.articuloConocimiento.findUnique({ where: { id }, select: { id: true } });
    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
    const sha256 = documentos.huella(req.file.buffer);
    const repetido = await prisma.archivoConocimiento.findFirst({ where: { articuloId: id, sha256 }, select: { nombreOriginal: true } });
    if (repetido) return res.status(409).json({ error: `Este archivo ya está adjunto (${repetido.nombreOriginal})` });

    nombreInterno = await almacen.guardar(req.file.buffer, ext);
    const archivo = await prisma.$transaction(async (tx) => {
      const creado = await tx.archivoConocimiento.create({
        data: {
          articuloId: id,
          nombreOriginal: documentos.limpiarNombre(req.file.originalname, ext),
          archivo: nombreInterno,
          mime: documentos.TIPOS[ext],
          tamano: req.file.size,
          sha256,
          subidoPorId: req.usuario.id,
        },
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
    const archivo = await prisma.archivoConocimiento.findUnique({ where: { id }, include: { articulo: { select: { publicado: true } } } });
    if (!archivo || (!archivo.articulo.publicado && !escribe(req.usuario))) return res.status(404).json({ error: 'Archivo no encontrado' });
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
// DELETE /api/conocimiento/archivos/:id   (administradores)
// ---------------------------------------------------------------------------
const eliminarArchivo = async (req, res) => {
  const { id } = req.params;
  if (!REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const archivo = await prisma.archivoConocimiento.findUnique({ where: { id }, select: { archivo: true, articuloId: true } });
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
    await prisma.archivoConocimiento.delete({ where: { id } });
    await almacen.borrar(archivo.archivo).catch((e) => console.error('[conocimiento.eliminarArchivo] disco', e?.message));
    return res.json({ mensaje: 'Archivo eliminado' });
  } catch (error) {
    console.error('[conocimiento.eliminarArchivo]', error);
    return res.status(500).json({ error: 'Error al eliminar el archivo' });
  }
};

module.exports = { listar, obtener, crear, editar, eliminar, subirArchivo, verArchivo, eliminarArchivo };
