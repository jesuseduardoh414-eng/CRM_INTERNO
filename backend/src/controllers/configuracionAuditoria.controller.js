// Panel de configuracion (solo CONFIGURADOR): registro de actividad y
// papelera del CRM. Es lo unico del panel que muestra datos de la empresa
// (nombres de proyectos, clientes, documentos): lo decidio el usuario el
// 2026-10-26 ("solo en el panel de configuracion, que se entra aparte").
const prisma = require('../lib/prisma');
const registro = require('../services/registroActividad.service');
const papelera = require('../services/papelera.service');

const ACCIONES = ['crear', 'editar', 'eliminar'];
const ORIGENES = ['usuario', 'drive', 'calendar'];
const MODULOS = [...registro.MODULOS, 'papelera'];

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const fecha = (v) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const texto = (v) => { const t = String(v || '').trim(); return t ? t.slice(0, 100) : null; };
const deLista = (v, lista) => (lista.includes(String(v || '')) ? String(v) : null);

// GET /api/configuracion/actividad?usuarioId&modulo&accion&origen&q&desde&hasta&antesDe
const actividad = async (req, res) => {
  try {
    const q = req.query;
    const resultado = await registro.listar(prisma, {
      usuarioId: entero(q.usuarioId),
      modulo: deLista(q.modulo, MODULOS),
      accion: deLista(q.accion, ACCIONES),
      origen: deLista(q.origen, ORIGENES),
      q: texto(q.q),
      desde: fecha(q.desde),
      hasta: fecha(q.hasta),
      antesDe: entero(q.antesDe),
    });
    return res.json(resultado);
  } catch (error) {
    console.error('[configuracion.actividad]', error);
    return res.status(500).json({ error: 'No se pudo cargar el registro de actividad' });
  }
};

// GET /api/configuracion/actividad/personas  -> para los filtros
const personas = async (_req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { rol: { in: ['ADMIN', 'MIEMBRO', 'CONFIGURADOR'] } },
      select: { id: true, nombre: true, rol: true, estado: true },
      orderBy: { nombre: 'asc' },
    });
    return res.json({ personas: usuarios, modulos: MODULOS });
  } catch (error) {
    console.error('[configuracion.personas]', error);
    return res.status(500).json({ error: 'No se pudo cargar la lista de personas' });
  }
};

// GET /api/configuracion/papelera?modulo&usuarioId&q&antesDe
const listarPapelera = async (req, res) => {
  try {
    const q = req.query;
    return res.json(await papelera.listar({
      modulo: deLista(q.modulo, registro.MODULOS),
      usuarioId: entero(q.usuarioId),
      q: texto(q.q),
      antesDe: entero(q.antesDe),
    }));
  } catch (error) {
    console.error('[configuracion.papelera]', error);
    return res.status(500).json({ error: 'No se pudo cargar la papelera' });
  }
};

// GET /api/configuracion/papelera/:id  -> la copia completa
const verElemento = async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador inválido' });
  try {
    const fila = await papelera.obtener(id);
    if (!fila) return res.status(404).json({ error: 'No está en la papelera' });
    // Donde quedo cada archivo es interno: el panel solo necesita nombre y tamaño.
    const archivos = (Array.isArray(fila.archivos) ? fila.archivos : []).map((a) => ({ nombre: a.nombre, mime: a.mime || null, tamano: a.tamano ?? null }));
    return res.json({ elemento: { ...fila, archivos } });
  } catch (error) {
    console.error('[configuracion.papelera.ver]', error);
    return res.status(500).json({ error: 'No se pudo abrir el elemento' });
  }
};

// GET /api/configuracion/papelera/:id/archivos/:indice  -> descarga
const descargarArchivo = async (req, res) => {
  const id = entero(req.params.id);
  const indice = Number.parseInt(req.params.indice, 10);
  if (!id || !Number.isInteger(indice) || indice < 0) return res.status(400).json({ error: 'Archivo inválido' });
  try {
    const fila = await papelera.obtener(id);
    if (!fila) return res.status(404).json({ error: 'No está en la papelera' });
    const archivo = await papelera.leerArchivo(fila, indice);
    if (!archivo) return res.status(404).json({ error: 'El archivo ya no se encuentra (se borró fuera del CRM o Google Drive no está conectado).' });
    const nombre = String(archivo.nombre).replace(/[\u0000-\u001f\u007f"\\]/g, '_');
    res.set({
      'Content-Type': archivo.mime,
      'Content-Length': String(archivo.contenido.length),
      'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return res.send(archivo.contenido);
  } catch (error) {
    console.error('[configuracion.papelera.descargar]', error);
    return res.status(500).json({ error: 'No se pudo descargar el archivo' });
  }
};

// DELETE /api/configuracion/papelera/:id  -> eliminar para siempre
const eliminarParaSiempre = async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador inválido' });
  try {
    const fila = await papelera.obtener(id);
    if (!fila) return res.status(404).json({ error: 'No está en la papelera' });
    await papelera.purgar(fila);
    return res.json({ mensaje: `«${fila.nombre}» se eliminó para siempre` });
  } catch (error) {
    console.error('[configuracion.papelera.eliminar]', error);
    return res.status(500).json({ error: 'No se pudo eliminar' });
  }
};

module.exports = { actividad, personas, listarPapelera, verElemento, descargarArchivo, eliminarParaSiempre };
