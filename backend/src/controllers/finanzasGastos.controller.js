// Finanzas / Gastos por categoria (PRESUPUESTO_GENERAL, PRESUPUESTO_OFICINA,
// NOMINA, FIJOS, VARIABLES, OTROS). El permiso es por categoria y por usuario
// (utils/finanzas.utils.js): se comprueba aqui, registro por registro, porque
// depende de la categoria del gasto. Rutas en routes/finanzas.routes.js.
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { partesDiaMexico } = require('../utils/fechas.utils');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const comprobantes = require('../services/comprobantes.service');
const F = require('../utils/finanzas.utils');

const incluirListado = {
  partida: { select: F.selectPartidaCorta },
  empresa: { select: F.selectEmpresaCorta },
  cuenta: { select: F.selectCuentaCorta },
  creadoPor: { select: F.selectUsuarioCorto },
  _count: { select: { comprobantes: true } },
};

const incluirDetalle = {
  partida: { select: F.selectPartidaCorta },
  empresa: { select: F.selectEmpresaCorta },
  cuenta: { select: F.selectCuentaCorta },
  creadoPor: { select: F.selectUsuarioCorto },
  comprobantes: { orderBy: { creadoEn: 'desc' }, select: F.selectComprobante },
};

const diasEntre = (desde, hasta) => Math.round((hasta.getTime() - desde.getTime()) / 86400000);

/** Vencido = pendiente con fecha limite ya pasada. `diasRestantes` negativo si venció. */
const calcularVencimiento = (gasto, hoy) => {
  if (gasto.estado !== 'PENDIENTE' || !gasto.fechaLimite) return { vencido: false, diasRestantes: null };
  const dias = diasEntre(hoy, new Date(gasto.fechaLimite));
  return { vencido: dias < 0, diasRestantes: dias };
};

const serializar = (gasto, hoy = F.hoyFecha()) => {
  const { _count, ...resto } = gasto;
  return {
    ...resto,
    monto: F.aNumero(gasto.monto),
    fecha: F.fechaATexto(gasto.fecha),
    fechaLimite: F.fechaATexto(gasto.fechaLimite),
    pagadoEn: F.fechaATexto(gasto.pagadoEn),
    totalComprobantes: _count?.comprobantes ?? gasto.comprobantes?.length ?? 0,
    ...calcularVencimiento(gasto, hoy),
  };
};

// ---------------------------------------------------------------------------
// Validacion. Con `parcial` (editar) solo se validan los campos que vienen.
// `usuario` decide que categorias puede usar.
// ---------------------------------------------------------------------------
// `partidaActual`: al editar, la partida que ya tenia el gasto; esa se acepta
// aunque este archivada. Cambiar a otra partida archivada no.
const normalizar = async (body = {}, { parcial = false, usuario, partidaActual = null } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('categoria')) {
    const categoria = String(body.categoria || '').toUpperCase();
    if (!F.CATEGORIAS_GASTO.includes(categoria)) errores.push('Categoría de gasto no válida');
    else if (!F.puedeEditar(usuario, `gastos.${categoria}`)) errores.push('No tienes permiso para registrar gastos en esa categoría');
    else data.categoria = categoria;
  }
  if (!parcial || viene('concepto')) {
    const concepto = F.textoOpcional(body.concepto, 255);
    if (!concepto || concepto.length < 3) errores.push('El concepto es obligatorio (mínimo 3 caracteres)');
    else data.concepto = concepto;
  }
  if (viene('descripcion')) data.descripcion = F.textoOpcional(body.descripcion, 2000);
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
    if (fecha === false) errores.push('La fecha del gasto no es válida (AAAA-MM-DD)');
    else data.fecha = fecha || F.hoyFecha();
  }
  if (viene('fechaLimite')) {
    const fechaLimite = F.leerFecha(body.fechaLimite);
    if (fechaLimite === false) errores.push('La fecha límite no es válida (AAAA-MM-DD)');
    else data.fechaLimite = fechaLimite;
  }
  if (!parcial && viene('estado')) {
    // Al crear se admite registrarlo ya pagado; despues se cambia con /pagar.
    const estado = String(body.estado || 'PENDIENTE').toUpperCase();
    if (!['PENDIENTE', 'PAGADO'].includes(estado)) errores.push('El estado inicial debe ser pendiente o pagado');
    else data.estado = estado;
  }
  if (viene('pagadoEn')) {
    const pagadoEn = F.leerFecha(body.pagadoEn);
    if (pagadoEn === false) errores.push('La fecha de pago no es válida (AAAA-MM-DD)');
    else data.pagadoEn = pagadoEn;
  }
  if (viene('metodo')) {
    if (body.metodo === null || body.metodo === '') data.metodo = null;
    else {
      const metodo = String(body.metodo).toUpperCase();
      if (!F.METODOS_PAGO.includes(metodo)) errores.push('Método de pago no válido');
      else data.metodo = metodo;
    }
  }
  if (viene('referencia')) data.referencia = F.textoOpcional(body.referencia, 80);
  if (viene('notas')) data.notas = F.textoOpcional(body.notas, 2000);

  if (viene('partidaId')) {
    const partidaId = body.partidaId === null || body.partidaId === '' ? null : F.leerId(body.partidaId);
    if (body.partidaId && !partidaId) errores.push('Partida no válida');
    else if (partidaId) {
      const partida = await prisma.partida.findUnique({ where: { id: partidaId }, select: { id: true, activa: true } });
      if (!partida) errores.push('La partida no existe');
      else if (!partida.activa && partidaId !== partidaActual) errores.push('La partida está archivada');
      else data.partidaId = partidaId;
    } else data.partidaId = null;
  }
  // Proveedor: ficha del directorio y/o nombre libre (foto del momento).
  let empresa = null;
  if (viene('empresaId')) {
    const empresaId = body.empresaId === null || body.empresaId === '' ? null : F.leerId(body.empresaId);
    if (body.empresaId && !empresaId) errores.push('Proveedor no válido');
    else if (empresaId) {
      empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, nombreComercial: true } });
      if (!empresa) errores.push('El proveedor no existe en el directorio');
      else data.empresaId = empresa.id;
    } else data.empresaId = null;
  }
  if (viene('proveedorNombre')) data.proveedorNombre = F.textoOpcional(body.proveedorNombre, 255);
  if (empresa && !data.proveedorNombre) data.proveedorNombre = empresa.nombreComercial || empresa.nombre;

  if (viene('cuentaId')) {
    const cuentaId = body.cuentaId === null || body.cuentaId === '' ? null : F.leerId(body.cuentaId);
    if (body.cuentaId && !cuentaId) errores.push('Cuenta no válida');
    else if (cuentaId) {
      const cuenta = await prisma.cuentaFinanciera.findUnique({ where: { id: cuentaId }, select: { id: true } });
      if (!cuenta) errores.push('La cuenta no existe');
      else data.cuentaId = cuentaId;
    } else data.cuentaId = null;
  }
  return { data, errores };
};

/** Coherencias que dependen de varios campos (se aplican sobre el registro final). */
const validarCoherencia = (final) => {
  const errores = [];
  if (final.partidaId && final.moneda !== F.MONEDA_BASE) errores.push(`Los gastos con partida deben ir en ${F.MONEDA_BASE}: la tesorería solo maneja esa moneda`);
  if (final.estado === 'PAGADO' && !final.pagadoEn) final.pagadoEn = final.fecha;
  if (final.estado === 'PENDIENTE') final.pagadoEn = null;
  return errores;
};

const cargarVisible = async (id, usuario, include = incluirDetalle) => {
  const gasto = await prisma.gasto.findUnique({ where: { id }, include });
  if (!gasto) return { error: 404 };
  if (F.nivelGasto(usuario, gasto.categoria) === 'ninguno') return { error: 403 };
  return { gasto };
};

const responderError = (res, error) => (error === 404 ? res.status(404).json({ error: 'Gasto no encontrado' }) : F.sinPermiso(res));

// ---------------------------------------------------------------------------
// GET /api/finanzas/gastos
// ?categoria= &estado=(PENDIENTE|PAGADO|ANULADO|VENCIDO) &partidaId= &empresaId=
// &desde= &hasta= &anio= &q= &page= &limit=
// Sin categoria: todas las que el usuario puede ver.
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const visibles = F.categoriasVisibles(req.usuario);
    const categoria = String(req.query.categoria || '').toUpperCase();
    if (categoria && !F.CATEGORIAS_GASTO.includes(categoria)) return res.status(400).json({ error: 'Categoría no válida' });
    if (categoria && !visibles.includes(categoria)) return F.sinPermiso(res);
    if (!visibles.length) return F.sinPermiso(res);

    const estado = String(req.query.estado || '').toUpperCase();
    const partidaId = F.leerId(req.query.partidaId);
    const empresaId = F.leerId(req.query.empresaId);
    const desde = F.leerFecha(req.query.desde);
    const hasta = F.leerFecha(req.query.hasta);
    const anio = F.leerAnio(req.query.anio, null);
    const porLimite = req.query.orden === 'limite';
    if (desde === false || hasta === false) return res.status(400).json({ error: 'Rango de fechas no válido' });

    const where = combinarWhere(
      { categoria: categoria ? categoria : { in: visibles } },
      construirBusqueda(req.query.q, ['folio', 'concepto', 'proveedorNombre', 'referencia']),
      F.ESTADOS_GASTO.includes(estado) ? { estado } : null,
      estado === 'VENCIDO' ? { estado: 'PENDIENTE', fechaLimite: { lt: F.hoyFecha() } } : null,
      partidaId ? { partidaId } : null,
      empresaId ? { empresaId } : null,
      desde ? { fecha: { gte: desde } } : null,
      hasta ? { fecha: { lte: hasta } } : null,
      anio ? { fecha: { gte: F.rangoAnio(anio).inicio, lt: F.rangoAnio(anio).fin } } : null,
      // ?orden=limite: solo los que tienen fecha limite, los mas urgentes primero (panel "Por pagar").
      porLimite ? { fechaLimite: { not: null } } : null,
    );

    const orderBy = porLimite ? [{ fechaLimite: 'asc' }, { id: 'asc' }] : [{ fecha: 'desc' }, { id: 'desc' }];
    const gastos = await prisma.gasto.findMany({ where, include: incluirListado, orderBy });
    const hoy = F.hoyFecha();
    const lista = gastos.map((g) => serializar(g, hoy));
    const { items, meta } = paginar(lista, parsearPaginacion(req.query, { limitePorDefecto: 25 }));
    const vigentes = lista.filter((g) => g.estado !== 'ANULADO' && g.moneda === F.MONEDA_BASE);
    const resumenFiltro = { total: F.sumar(vigentes.map((g) => g.monto)), cantidad: vigentes.length };
    return res.json(meta ? { gastos: items, meta, resumenFiltro } : { gastos: items, resumenFiltro });
  } catch (error) {
    console.error('[finanzas.gastos.listar]', error);
    return res.status(500).json({ error: 'Error al listar los gastos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/gastos/resumen?categoria=&anio=  -> cifras de la cabecera
// ---------------------------------------------------------------------------
const resumen = async (req, res) => {
  try {
    const visibles = F.categoriasVisibles(req.usuario);
    const categoria = String(req.query.categoria || '').toUpperCase();
    if (categoria && !visibles.includes(categoria)) return F.sinPermiso(res);
    if (!visibles.length) return F.sinPermiso(res);

    const hoy = partesDiaMexico();
    const hoyFecha = F.hoyFecha();
    const anio = F.leerAnio(req.query.anio, hoy.year);
    const todos = await prisma.gasto.findMany({
      where: { categoria: categoria ? categoria : { in: visibles }, estado: { not: 'ANULADO' } },
      select: { monto: true, moneda: true, fecha: true, fechaLimite: true, estado: true, categoria: true },
    });
    // Los importes suman solo la moneda base; los conteos de pendientes,
    // vencidos y proximos cuentan todos (coinciden con el filtro de la lista).
    const gastos = todos.filter((g) => g.moneda === F.MONEDA_BASE);
    const cifra = (lista) => ({
      total: F.sumar(lista.filter((g) => g.moneda === F.MONEDA_BASE).map((g) => g.monto)),
      cantidad: lista.length,
    });
    const delAnio = gastos.filter((g) => g.fecha.getUTCFullYear() === anio);
    const delMes = delAnio.filter((g) => anio === hoy.year && g.fecha.getUTCMonth() === hoy.month);
    const pendientes = todos.filter((g) => g.estado === 'PENDIENTE');
    const en7dias = new Date(hoyFecha.getTime() + 7 * 86400000);
    const porCategoria = Object.fromEntries((categoria ? [categoria] : visibles).map((c) => [c, cifra(delAnio.filter((g) => g.categoria === c))]));

    return res.json({
      anio,
      moneda: F.MONEDA_BASE,
      mes: cifra(delMes),
      anual: cifra(delAnio),
      pendientes: cifra(pendientes),
      vencidos: cifra(pendientes.filter((g) => g.fechaLimite && g.fechaLimite < hoyFecha)),
      proximos: cifra(pendientes.filter((g) => g.fechaLimite && g.fechaLimite >= hoyFecha && g.fechaLimite <= en7dias)),
      porMes: Array.from({ length: 12 }, (_v, mes) => cifra(delAnio.filter((g) => g.fecha.getUTCMonth() === mes))),
      porCategoria,
    });
  } catch (error) {
    console.error('[finanzas.gastos.resumen]', error);
    return res.status(500).json({ error: 'Error al calcular el resumen de gastos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/gastos/:id
// ---------------------------------------------------------------------------
const obtener = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const { gasto, error } = await cargarVisible(id, req.usuario);
    if (error) return responderError(res, error);
    return res.json({ gasto: serializar(gasto) });
  } catch (error) {
    console.error('[finanzas.gastos.obtener]', error);
    return res.status(500).json({ error: 'Error al leer el gasto' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/gastos
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  try {
    const { data, errores } = await normalizar(req.body, { usuario: req.usuario });
    if (!errores.length) {
      data.estado = data.estado || 'PENDIENTE';
      errores.push(...validarCoherencia(data));
    }
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del gasto', detalles: errores });

    const gasto = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.gasto.create({ data: { ...data, folio: `TMP-${crypto.randomUUID()}`, creadoPorId: req.usuario.id } });
      return tx.gasto.update({ where: { id: nuevo.id }, data: { folio: F.folio('GAS', nuevo.id, data.fecha) }, include: incluirDetalle });
    });
    F.registrarFinanzas(req.usuario, 'gasto', gasto.id, 'CREAR', `Registró el gasto ${gasto.folio} (${gasto.categoria}) "${gasto.concepto}" por ${F.aNumero(gasto.monto)} ${gasto.moneda}`);
    return res.status(201).json({ mensaje: `Gasto ${gasto.folio} registrado`, gasto: serializar(gasto) });
  } catch (error) {
    console.error('[finanzas.gastos.crear]', error);
    return res.status(500).json({ error: 'Error al registrar el gasto' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/finanzas/gastos/:id
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.gasto.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (!F.puedeEditar(req.usuario, `gastos.${actual.categoria}`)) return F.sinPermiso(res);
    if (actual.estado === 'ANULADO') return res.status(409).json({ error: 'Un gasto anulado no se puede editar' });

    const { data, errores } = await normalizar(req.body, { parcial: true, usuario: req.usuario, partidaActual: actual.partidaId });
    if (!errores.length) {
      const final = { ...actual, ...data };
      errores.push(...validarCoherencia(final));
      // La coherencia puede completar o vaciar pagadoEn (un PAGADO sin fecha
      // toma la del gasto): se guarda lo que quedo en `final`, venga o no en
      // el cuerpo. Antes un pagado editado con pagadoEn vacio quedaba sin fecha.
      const guardado = data.pagadoEn === undefined ? actual.pagadoEn : data.pagadoEn;
      if (final.pagadoEn !== guardado) data.pagadoEn = final.pagadoEn;
    }
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del gasto', detalles: errores });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar' });

    const gasto = await prisma.gasto.update({ where: { id }, data, include: incluirDetalle });
    F.registrarFinanzas(req.usuario, 'gasto', id, 'EDITAR', `Editó el gasto ${gasto.folio} (${Object.keys(data).join(', ')})`);
    return res.json({ mensaje: 'Gasto actualizado', gasto: serializar(gasto) });
  } catch (error) {
    console.error('[finanzas.gastos.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar el gasto' });
  }
};

// Cambios de estado: pagar, reabrir (volver a pendiente) y anular.
const cambiarEstado = (accion) => async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.gasto.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (!F.puedeEditar(req.usuario, `gastos.${actual.categoria}`)) return F.sinPermiso(res);

    const data = {};
    let descripcion = '';
    if (accion === 'pagar') {
      if (actual.estado !== 'PENDIENTE') return res.status(409).json({ error: 'Solo se puede pagar un gasto pendiente' });
      const pagadoEn = F.leerFecha(req.body?.pagadoEn);
      if (pagadoEn === false) return res.status(400).json({ error: 'La fecha de pago no es válida (AAAA-MM-DD)' });
      const extra = await normalizar({ metodo: req.body?.metodo, referencia: req.body?.referencia, cuentaId: req.body?.cuentaId }, { parcial: true, usuario: req.usuario });
      if (extra.errores.length) return res.status(400).json({ error: 'Revisa los datos del pago', detalles: extra.errores });
      Object.assign(data, extra.data, { estado: 'PAGADO', pagadoEn: pagadoEn || F.hoyFecha() });
      descripcion = `Marcó como pagado el gasto ${actual.folio}`;
    } else if (accion === 'reabrir') {
      if (actual.estado !== 'PAGADO') return res.status(409).json({ error: 'Solo se puede reabrir un gasto pagado' });
      Object.assign(data, { estado: 'PENDIENTE', pagadoEn: null });
      descripcion = `Volvió a pendiente el gasto ${actual.folio}`;
    } else {
      if (actual.estado === 'ANULADO') return res.status(409).json({ error: 'El gasto ya está anulado' });
      const motivo = F.textoOpcional(req.body?.motivo, 255);
      Object.assign(data, { estado: 'ANULADO', motivoAnulacion: motivo });
      descripcion = `Anuló el gasto ${actual.folio}${motivo ? `: ${motivo}` : ''}`;
    }

    // Solo si el estado sigue siendo el que se leyo: dos cambios simultaneos
    // (reabrir y anular a la vez) ya no se pisan; el segundo recibe 409.
    const { count } = await prisma.gasto.updateMany({ where: { id, estado: actual.estado }, data });
    if (count === 0) return res.status(409).json({ error: 'El gasto cambió mientras tanto. Recarga y vuelve a intentarlo.' });
    const gasto = await prisma.gasto.findUnique({ where: { id }, include: incluirDetalle });
    F.registrarFinanzas(req.usuario, 'gasto', id, accion.toUpperCase(), descripcion);
    return res.json({ mensaje: descripcion, gasto: serializar(gasto) });
  } catch (error) {
    console.error(`[finanzas.gastos.${accion}]`, error);
    return res.status(500).json({ error: 'Error al cambiar el estado del gasto' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/gastos/:id/duplicar  -> copia al mes siguiente, pendiente,
// sin comprobantes. Es el atajo para los gastos fijos (renta, servicios).
// ---------------------------------------------------------------------------
const duplicar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.gasto.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (!F.puedeEditar(req.usuario, `gastos.${actual.categoria}`)) return F.sinPermiso(res);

    const meses = Math.max(1, Math.min(12, Number.parseInt(req.body?.meses, 10) || 1));
    const fecha = F.sumarMeses(actual.fecha, meses);
    // Una partida archivada ya no recibe gastos nuevos: la copia sale sin partida.
    const partida = actual.partidaId ? await prisma.partida.findUnique({ where: { id: actual.partidaId }, select: { activa: true } }) : null;
    const data = {
      categoria: actual.categoria,
      concepto: actual.concepto,
      descripcion: actual.descripcion,
      monto: actual.monto,
      moneda: actual.moneda,
      fecha,
      fechaLimite: actual.fechaLimite ? F.sumarMeses(actual.fechaLimite, meses) : null,
      estado: 'PENDIENTE',
      metodo: actual.metodo,
      partidaId: partida?.activa ? actual.partidaId : null,
      empresaId: actual.empresaId,
      proveedorNombre: actual.proveedorNombre,
      cuentaId: actual.cuentaId,
      notas: actual.notas,
    };
    const gasto = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.gasto.create({ data: { ...data, folio: `TMP-${crypto.randomUUID()}`, creadoPorId: req.usuario.id } });
      return tx.gasto.update({ where: { id: nuevo.id }, data: { folio: F.folio('GAS', nuevo.id, fecha) }, include: incluirDetalle });
    });
    F.registrarFinanzas(req.usuario, 'gasto', gasto.id, 'DUPLICAR', `Creó el gasto ${gasto.folio} duplicando ${actual.folio}`);
    return res.status(201).json({ mensaje: `Gasto ${gasto.folio} creado a partir de ${actual.folio}`, gasto: serializar(gasto) });
  } catch (error) {
    console.error('[finanzas.gastos.duplicar]', error);
    return res.status(500).json({ error: 'Error al duplicar el gasto' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/finanzas/gastos/:id  (borra tambien sus comprobantes del disco)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.gasto.findUnique({ where: { id }, include: { comprobantes: { select: { archivo: true } } } });
    if (!actual) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (!F.puedeEditar(req.usuario, `gastos.${actual.categoria}`)) return F.sinPermiso(res);
    await prisma.gasto.delete({ where: { id } });
    await Promise.all(actual.comprobantes.map((c) => comprobantes.borrar(c.archivo).catch((e) => console.error('[finanzas.gastos.eliminar] comprobante', e?.message))));
    F.registrarFinanzas(req.usuario, 'gasto', id, 'ELIMINAR', `Eliminó el gasto ${actual.folio} (${actual.categoria}) "${actual.concepto}" por ${F.aNumero(actual.monto)} ${actual.moneda}`);
    return res.json({ mensaje: `Gasto ${actual.folio} eliminado` });
  } catch (error) {
    console.error('[finanzas.gastos.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el gasto' });
  }
};

module.exports = {
  listar,
  resumen,
  obtener,
  crear,
  editar,
  pagar: cambiarEstado('pagar'),
  reabrir: cambiarEstado('reabrir'),
  anular: cambiarEstado('anular'),
  duplicar,
  eliminar,
  serializar,
  incluirDetalle,
};
