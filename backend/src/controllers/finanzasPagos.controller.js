// Finanzas / Ventas: pagos recibidos de clientes (ingresos). Rutas en
// routes/finanzas.routes.js; el permiso `ventas` (ver / editar) se comprueba
// en la ruta. Los comprobantes van en finanzasComprobantes.controller.js.
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { partesDiaMexico } = require('../utils/fechas.utils');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const F = require('../utils/finanzas.utils');
const papelera = require('../services/papelera.service');

const incluirListado = {
  empresa: { select: F.selectEmpresaCorta },
  cuenta: { select: F.selectCuentaCorta },
  contrato: { select: { id: true, folio: true, titulo: true } },
  proyecto: { select: { id: true, nombre: true } },
  creadoPor: { select: F.selectUsuarioCorto },
  _count: { select: { comprobantes: true } },
};

const incluirDetalle = {
  empresa: { select: F.selectEmpresaCorta },
  cuenta: { select: F.selectCuentaCorta },
  contrato: { select: { id: true, folio: true, titulo: true } },
  proyecto: { select: { id: true, nombre: true } },
  creadoPor: { select: F.selectUsuarioCorto },
  comprobantes: { orderBy: { creadoEn: 'desc' }, select: F.selectComprobante },
};

const serializar = (pago) => {
  const { _count, ...resto } = pago;
  return {
    ...resto,
    monto: F.aNumero(pago.monto),
    fecha: F.fechaATexto(pago.fecha),
    totalComprobantes: _count?.comprobantes ?? pago.comprobantes?.length ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Validacion. Con `parcial` (editar) solo se validan los campos que vienen.
// ---------------------------------------------------------------------------
const normalizar = async (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('concepto')) {
    const concepto = F.textoOpcional(body.concepto, 255);
    if (!concepto || concepto.length < 3) errores.push('El concepto es obligatorio (mínimo 3 caracteres)');
    else data.concepto = concepto;
  }
  if (!parcial || viene('monto')) {
    const monto = F.leerMonto(body.monto);
    if (monto === false) errores.push('El monto debe ser un número mayor que cero');
    else data.monto = monto;
  }
  if (!parcial || viene('moneda')) {
    const moneda = String(body.moneda || F.MONEDA_BASE).toUpperCase();
    if (!F.MONEDAS.includes(moneda)) errores.push('Moneda no válida');
    else data.moneda = moneda;
  }
  if (!parcial || viene('fecha')) {
    const fecha = F.leerFecha(body.fecha);
    if (fecha === false) errores.push('La fecha del pago no es válida (AAAA-MM-DD)');
    else data.fecha = fecha || F.hoyFecha();
  }
  if (!parcial || viene('metodo')) {
    const metodo = String(body.metodo || 'TRANSFERENCIA').toUpperCase();
    if (!F.METODOS_PAGO.includes(metodo)) errores.push('Método de pago no válido');
    else data.metodo = metodo;
  }
  if (viene('referencia')) data.referencia = F.textoOpcional(body.referencia, 80);
  if (viene('notas')) data.notas = F.textoOpcional(body.notas, 2000);

  // Cliente: ficha del directorio y/o nombre libre. Si viene la ficha y no el
  // nombre, se guarda el nombre como foto de ese momento.
  let empresa = null;
  if (viene('empresaId')) {
    const empresaId = body.empresaId === null || body.empresaId === '' ? null : F.leerId(body.empresaId);
    if (body.empresaId && !empresaId) errores.push('Cliente no válido');
    else if (empresaId) {
      empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, nombreComercial: true } });
      if (!empresa) errores.push('El cliente no existe en el directorio');
      else data.empresaId = empresa.id;
    } else data.empresaId = null;
  }
  if (viene('clienteNombre')) data.clienteNombre = F.textoOpcional(body.clienteNombre, 255);
  if (empresa && !data.clienteNombre) data.clienteNombre = empresa.nombreComercial || empresa.nombre;
  if (!parcial && !data.empresaId && !data.clienteNombre) errores.push('Indica qué cliente hizo el pago');

  if (viene('cuentaId')) {
    const cuentaId = body.cuentaId === null || body.cuentaId === '' ? null : F.leerId(body.cuentaId);
    if (body.cuentaId && !cuentaId) errores.push('Cuenta no válida');
    else if (cuentaId) {
      const cuenta = await prisma.cuentaFinanciera.findUnique({ where: { id: cuentaId }, select: { id: true } });
      if (!cuenta) errores.push('La cuenta destino no existe');
      else data.cuentaId = cuentaId;
    } else data.cuentaId = null;
  }
  if (viene('contratoId')) {
    const contratoId = body.contratoId === null || body.contratoId === '' ? null : F.leerId(body.contratoId);
    if (body.contratoId && !contratoId) errores.push('Contrato no válido');
    else if (contratoId) {
      const contrato = await prisma.contrato.findUnique({ where: { id: contratoId }, select: { id: true } });
      if (!contrato) errores.push('El contrato no existe');
      else data.contratoId = contratoId;
    } else data.contratoId = null;
  }
  if (viene('proyectoId')) {
    const proyectoId = body.proyectoId === null || body.proyectoId === '' ? null : F.leerId(body.proyectoId);
    if (body.proyectoId && !proyectoId) errores.push('Proyecto no válido');
    else if (proyectoId) {
      const proyecto = await prisma.proyecto.findUnique({ where: { id: proyectoId }, select: { id: true } });
      if (!proyecto) errores.push('El proyecto no existe');
      else data.proyectoId = proyectoId;
    } else data.proyectoId = null;
  }
  return { data, errores };
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/pagos
// ?q= &estado= &empresaId= &cuentaId= &desde= &hasta= &anio= &page= &limit=
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const estado = String(req.query.estado || '').toUpperCase();
    const empresaId = F.leerId(req.query.empresaId);
    const cuentaId = F.leerId(req.query.cuentaId);
    const desde = F.leerFecha(req.query.desde);
    const hasta = F.leerFecha(req.query.hasta);
    const anio = F.leerAnio(req.query.anio, null);
    if (desde === false || hasta === false) return res.status(400).json({ error: 'Rango de fechas no válido' });

    const where = combinarWhere(
      construirBusqueda(req.query.q, ['folio', 'concepto', 'clienteNombre', 'referencia']),
      F.ESTADOS_PAGO.includes(estado) ? { estado } : null,
      empresaId ? { empresaId } : null,
      cuentaId ? { cuentaId } : null,
      desde ? { fecha: { gte: desde } } : null,
      hasta ? { fecha: { lte: hasta } } : null,
      anio ? { fecha: { gte: F.rangoAnio(anio).inicio, lt: F.rangoAnio(anio).fin } } : null,
    );

    const pagos = await prisma.pago.findMany({ where, include: incluirListado, orderBy: [{ fecha: 'desc' }, { id: 'desc' }] });
    const lista = pagos.map(serializar);
    const { items, meta } = paginar(lista, parsearPaginacion(req.query, { limitePorDefecto: 25 }));
    const vigentes = lista.filter((p) => p.estado === 'REGISTRADO' && p.moneda === F.MONEDA_BASE);
    const resumenFiltro = { total: F.sumar(vigentes.map((p) => p.monto)), cantidad: vigentes.length };
    return res.json(meta ? { pagos: items, meta, resumenFiltro } : { pagos: items, resumenFiltro });
  } catch (error) {
    console.error('[finanzas.pagos.listar]', error);
    return res.status(500).json({ error: 'Error al listar los pagos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/pagos/resumen?anio=  -> cifras de la cabecera de Ventas
// ---------------------------------------------------------------------------
const resumen = async (req, res) => {
  try {
    const hoy = partesDiaMexico();
    const anio = F.leerAnio(req.query.anio, hoy.year);
    const pagos = await prisma.pago.findMany({
      where: { estado: 'REGISTRADO' },
      select: { monto: true, moneda: true, fecha: true, cuentaId: true, cuenta: { select: { id: true, nombre: true } } },
    });
    const enBase = pagos.filter((p) => p.moneda === F.MONEDA_BASE);
    const delAnio = enBase.filter((p) => p.fecha.getUTCFullYear() === anio);
    const delMes = delAnio.filter((p) => anio === hoy.year && p.fecha.getUTCMonth() === hoy.month);
    const cifra = (lista) => ({ total: F.sumar(lista.map((p) => p.monto)), cantidad: lista.length });

    const porMes = Array.from({ length: 12 }, (_v, mes) => cifra(delAnio.filter((p) => p.fecha.getUTCMonth() === mes)));
    const porCuenta = {};
    delAnio.forEach((p) => {
      const clave = p.cuentaId || 0;
      porCuenta[clave] = porCuenta[clave] || { cuentaId: p.cuentaId, nombre: p.cuenta?.nombre || null, total: 0, cantidad: 0 };
      porCuenta[clave].total = F.sumar([porCuenta[clave].total, p.monto]);
      porCuenta[clave].cantidad += 1;
    });
    const otrasMonedas = {};
    pagos.filter((p) => p.moneda !== F.MONEDA_BASE).forEach((p) => {
      otrasMonedas[p.moneda] = otrasMonedas[p.moneda] || { moneda: p.moneda, total: 0, cantidad: 0 };
      otrasMonedas[p.moneda].total = F.sumar([otrasMonedas[p.moneda].total, p.monto]);
      otrasMonedas[p.moneda].cantidad += 1;
    });

    return res.json({
      anio,
      moneda: F.MONEDA_BASE,
      mes: cifra(delMes),
      anual: cifra(delAnio),
      historico: cifra(enBase),
      porMes,
      porCuenta: Object.values(porCuenta).sort((a, b) => b.total - a.total),
      otrasMonedas: Object.values(otrasMonedas),
    });
  } catch (error) {
    console.error('[finanzas.pagos.resumen]', error);
    return res.status(500).json({ error: 'Error al calcular el resumen de ventas' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/pagos/:id
// ---------------------------------------------------------------------------
const obtener = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const pago = await prisma.pago.findUnique({ where: { id }, include: incluirDetalle });
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    return res.json({ pago: serializar(pago) });
  } catch (error) {
    console.error('[finanzas.pagos.obtener]', error);
    return res.status(500).json({ error: 'Error al leer el pago' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/pagos
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  try {
    const { data, errores } = await normalizar(req.body);
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del pago', detalles: errores });

    // El folio sale del id: se crea con uno temporal unico y se corrige en la
    // misma transaccion, asi dos altas simultaneas nunca chocan.
    const pago = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.pago.create({ data: { ...data, folio: `TMP-${crypto.randomUUID()}`, creadoPorId: req.usuario.id } });
      return tx.pago.update({ where: { id: nuevo.id }, data: { folio: F.folio('PAG', nuevo.id, data.fecha) }, include: incluirDetalle });
    });
    F.registrarFinanzas(req.usuario, 'pago', pago.id, 'CREAR', `Registró el pago ${pago.folio} de ${pago.clienteNombre || 'cliente'} por ${F.aNumero(pago.monto)} ${pago.moneda}`);
    return res.status(201).json({ mensaje: `Pago ${pago.folio} registrado`, pago: serializar(pago) });
  } catch (error) {
    console.error('[finanzas.pagos.crear]', error);
    return res.status(500).json({ error: 'Error al registrar el pago' });
  }
};

// Quien edita ventas sin poder verlas no recibe el pago de vuelta: con
// "editar" sobre ids ajenos se podia leer cualquiera.
const respuestaPago = (usuario, pago) => (F.puedeVer(usuario, 'ventas')
  ? { pago: serializar(pago) }
  : { pago: { id: pago.id, folio: pago.folio } });

// ---------------------------------------------------------------------------
// PUT /api/finanzas/pagos/:id
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.pago.findUnique({ where: { id }, select: { id: true, estado: true, folio: true, empresaId: true, clienteNombre: true } });
    if (!actual) return res.status(404).json({ error: 'Pago no encontrado' });
    if (actual.estado === 'ANULADO') return res.status(409).json({ error: 'Un pago anulado no se puede editar' });

    const { data, errores } = await normalizar(req.body, { parcial: true });
    // Al editar se puede cambiar el cliente, pero no dejar el pago sin ninguno.
    const empresaFinal = data.empresaId !== undefined ? data.empresaId : actual.empresaId;
    const nombreFinal = data.clienteNombre !== undefined ? data.clienteNombre : actual.clienteNombre;
    if (!empresaFinal && !nombreFinal) errores.push('Indica qué cliente hizo el pago');
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del pago', detalles: errores });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar' });

    const pago = await prisma.pago.update({ where: { id }, data, include: incluirDetalle });
    F.registrarFinanzas(req.usuario, 'pago', id, 'EDITAR', `Editó el pago ${pago.folio} (${Object.keys(data).join(', ')})`);
    return res.json({ mensaje: 'Pago actualizado', ...respuestaPago(req.usuario, pago) });
  } catch (error) {
    console.error('[finanzas.pagos.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar el pago' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/pagos/:id/anular  { motivo }
// El registro se conserva (con su folio y comprobantes) pero deja de sumar.
// ---------------------------------------------------------------------------
const anular = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.pago.findUnique({ where: { id }, select: { id: true, estado: true, folio: true } });
    if (!actual) return res.status(404).json({ error: 'Pago no encontrado' });
    if (actual.estado === 'ANULADO') return res.status(409).json({ error: 'El pago ya está anulado' });
    const motivo = F.textoOpcional(req.body?.motivo, 255);
    const pago = await prisma.pago.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo }, include: incluirDetalle });
    F.registrarFinanzas(req.usuario, 'pago', id, 'ANULAR', `Anuló el pago ${pago.folio}${motivo ? `: ${motivo}` : ''}`);
    return res.json({ mensaje: `Pago ${pago.folio} anulado`, ...respuestaPago(req.usuario, pago) });
  } catch (error) {
    console.error('[finanzas.pagos.anular]', error);
    return res.status(500).json({ error: 'Error al anular el pago' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/finanzas/pagos/:id  (va a la papelera del CRM con sus comprobantes)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.pago.findUnique({ where: { id }, include: { comprobantes: true } });
    if (!actual) return res.status(404).json({ error: 'Pago no encontrado' });
    // A la papelera del CRM (services/papelera.service.js): los comprobantes no se borran.
    await papelera.conPapelera({
      tipo: 'pago', modulo: 'finanzas', entidadId: id, nombre: [actual.folio, actual.concepto].filter(Boolean).join(' · '),
      contexto: actual.clienteNombre ? `Cliente: ${actual.clienteNombre}` : null, datos: actual,
      archivos: actual.comprobantes.map((c) => papelera.archivoDeAlmacen('comprobantes', c)),
    }, () => prisma.pago.delete({ where: { id } }));
    F.registrarFinanzas(req.usuario, 'pago', id, 'ELIMINAR', `Eliminó el pago ${actual.folio} de ${actual.clienteNombre || 'cliente'} por ${F.aNumero(actual.monto)} ${actual.moneda}`);
    return res.json({ mensaje: `Pago ${actual.folio} eliminado` });
  } catch (error) {
    console.error('[finanzas.pagos.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el pago' });
  }
};

module.exports = { listar, resumen, obtener, crear, editar, anular, eliminar, serializar, incluirDetalle };
