// Finanzas: comprobantes (PDF o imagen) de pagos y gastos. Viven en disco
// (services/comprobantes.service.js) y solo se sirven a quien puede ver el
// pago o el gasto al que pertenecen.
const prisma = require('../lib/prisma');
const comprobantes = require('../services/comprobantes.service');
const F = require('../utils/finanzas.utils');
const papelera = require('../services/papelera.service');

const selectRegistro = { id: true, nombreOriginal: true, mime: true, tamano: true, creadoEn: true, subidoPor: { select: F.selectUsuarioCorto } };

/** ¿Puede la accion sobre el pago o gasto dueño del comprobante? */
const puedeSobre = (usuario, registro, accion) => {
  if (registro.pagoId) return F.puedeFin(usuario, 'ventas', accion);
  if (registro.gasto) return F.puedeGasto(usuario, registro.gasto.categoria, accion);
  return false;
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/pagos/:id/comprobantes
// POST /api/finanzas/gastos/:id/comprobantes   (multipart, campo "archivo")
// ---------------------------------------------------------------------------
const subir = (tipo) => async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo (PDF, JPG, PNG o WEBP)' });

  const mime = comprobantes.detectarMime(req.file.buffer);
  if (!mime) return res.status(400).json({ error: 'El archivo no es un PDF ni una imagen válida, o está dañado' });

  let nombreInterno = null;
  try {
    let padre;
    if (tipo === 'pago') {
      padre = await prisma.pago.findUnique({ where: { id }, select: { id: true, folio: true } });
      if (!padre) return res.status(404).json({ error: 'Pago no encontrado' });
      if (!F.puedeFin(req.usuario, 'ventas', 'crear') && !F.puedeFin(req.usuario, 'ventas', 'editar')) return F.sinPermiso(res);
    } else {
      padre = await prisma.gasto.findUnique({ where: { id }, select: { id: true, folio: true, categoria: true } });
      if (!padre) return res.status(404).json({ error: 'Gasto no encontrado' });
      if (!F.puedeGasto(req.usuario, padre.categoria, 'crear') && !F.puedeGasto(req.usuario, padre.categoria, 'editar')) return F.sinPermiso(res);
    }
    const campoPadre = tipo === 'pago' ? 'pagoId' : 'gastoId';

    const sha256 = comprobantes.huella(req.file.buffer);
    const duplicado = await prisma.comprobanteFinanciero.findFirst({ where: { [campoPadre]: id, sha256 }, select: { nombreOriginal: true } });
    if (duplicado) return res.status(409).json({ error: `Este archivo ya está cargado (${duplicado.nombreOriginal})` });

    nombreInterno = await comprobantes.guardar(req.file.buffer, mime);
    // Registro y fecha del padre juntos: si algo falla no queda una fila
    // apuntando a un archivo que el catch ya borro.
    const registro = await prisma.$transaction(async (tx) => {
      const creado = await tx.comprobanteFinanciero.create({
        data: {
          [campoPadre]: id,
          nombreOriginal: comprobantes.limpiarNombre(req.file.originalname, mime),
          archivo: nombreInterno,
          mime,
          tamano: req.file.size,
          sha256,
          subidoPorId: req.usuario.id,
        },
        select: selectRegistro,
      });
      if (tipo === 'pago') await tx.pago.update({ where: { id }, data: { actualizadoEn: new Date() } });
      else await tx.gasto.update({ where: { id }, data: { actualizadoEn: new Date() } });
      return creado;
    });
    F.registrarFinanzas(req.usuario, tipo, id, 'COMPROBANTE', `Subió el comprobante "${registro.nombreOriginal}" a ${padre.folio}`);
    return res.status(201).json({ mensaje: 'Comprobante cargado', comprobante: registro });
  } catch (error) {
    // Si el registro fallo despues de escribir en disco, no se deja basura.
    if (nombreInterno) await comprobantes.borrar(nombreInterno).catch(() => {});
    console.error('[finanzas.comprobantes.subir]', error);
    return res.status(500).json({ error: 'Error al guardar el comprobante' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/comprobantes/:id  (?descargar=1 para bajarlo)
// ---------------------------------------------------------------------------
const ver = async (req, res) => {
  const { id } = req.params;
  if (!F.REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const registro = await prisma.comprobanteFinanciero.findUnique({ where: { id }, include: { gasto: { select: { categoria: true } } } });
    if (!registro) return res.status(404).json({ error: 'Comprobante no encontrado' });
    if (!puedeSobre(req.usuario, registro, 'ver')) return F.sinPermiso(res);

    let contenido;
    try {
      contenido = await comprobantes.leer(registro.archivo);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(410).json({ error: 'El comprobante ya no está en el servidor' });
      throw error;
    }
    const disposicion = req.query.descargar ? 'attachment' : 'inline';
    const nombreAscii = registro.nombreOriginal.replace(/[^\x20-\x7e]/g, '_');
    res.set({
      'Content-Type': registro.mime,
      'Content-Length': String(contenido.length),
      'Content-Disposition': `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(registro.nombreOriginal)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    return res.send(contenido);
  } catch (error) {
    console.error('[finanzas.comprobantes.ver]', error);
    return res.status(500).json({ error: 'Error al leer el comprobante' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/finanzas/comprobantes/:id
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const { id } = req.params;
  if (!F.REGEX_UUID.test(String(id || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const registro = await prisma.comprobanteFinanciero.findUnique({ where: { id }, include: { gasto: { select: { categoria: true, folio: true } }, pago: { select: { folio: true } } } });
    if (!registro) return res.status(404).json({ error: 'Comprobante no encontrado' });
    // Quitar un comprobante es corregir el pago o gasto
    if (!puedeSobre(req.usuario, registro, 'editar')) return F.sinPermiso(res);
    // A la papelera del CRM (services/papelera.service.js): el archivo no se borra.
    const { gasto: _gasto, pago: _pago, ...fila } = registro;
    await papelera.conPapelera({
      tipo: 'comprobante', modulo: 'finanzas', entidadId: id, nombre: registro.nombreOriginal,
      contexto: registro.pago ? `Pago ${registro.pago.folio}` : (registro.gasto ? `Gasto ${registro.gasto.folio}` : null),
      datos: fila, archivos: [papelera.archivoDeAlmacen('comprobantes', registro)],
    }, () => prisma.comprobanteFinanciero.delete({ where: { id } }));
    F.registrarFinanzas(req.usuario, registro.pagoId ? 'pago' : 'gasto', registro.pagoId || registro.gastoId, 'QUITAR_COMPROBANTE', `Quitó el comprobante "${registro.nombreOriginal}" de ${registro.pago?.folio || registro.gasto?.folio}`);
    return res.json({ mensaje: 'Comprobante eliminado' });
  } catch (error) {
    console.error('[finanzas.comprobantes.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el comprobante' });
  }
};

module.exports = { subirPago: subir('pago'), subirGasto: subir('gasto'), ver, eliminar };
