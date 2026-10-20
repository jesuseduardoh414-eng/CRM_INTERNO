// Finanzas: catalogos (cuentas, listas para los formularios) y bitacora.
// Rutas en routes/finanzas.routes.js. Las partidas de Tesoreria se
// sustituyeron por presupuestos por categoria (2026-10-14): ya no se crean ni
// se editan; las antiguas solo salen como historial en el informe.
const prisma = require('../lib/prisma');
const { moduloActivo } = require('../services/configuracion.service');
const { esAdminGlobal } = require('../utils/permissions.utils');
const F = require('../utils/finanzas.utils');

// ---------------------------------------------------------------------------
// GET /api/finanzas/catalogos  -> listas para los formularios, segun permisos
// ---------------------------------------------------------------------------
const catalogos = async (req, res) => {
  try {
    const u = req.usuario;
    // Directorio, contratos y proyectos son de administradores en el resto del
    // CRM: aqui solo salen a quien los necesita para llenar un formulario
    // (registrar pagos o gastos), y sin montos.
    const escribe = (recurso) => F.puedeFin(u, recurso, 'crear') || F.puedeFin(u, recurso, 'editar');
    const editaVentas = escribe('ventas');
    const editaGastos = F.CATEGORIAS_GASTO.some((c) => escribe(`gastos.${c}`));
    // Las cotizaciones son de proveedores (recibidas) o para clientes (enviadas).
    const editaCotizaciones = escribe('cotizaciones');
    const categorias = F.categoriasVisibles(u);
    const [hayClientes, hayContratos] = await Promise.all([moduloActivo('clientes'), moduloActivo('contratos')]);

    const [cuentas, clientes, proveedores, contratos, proyectos] = await Promise.all([
      prisma.cuentaFinanciera.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
      (editaVentas || editaCotizaciones) && hayClientes
        ? prisma.empresa.findMany({ where: { tipo: { in: ['CLIENTE', 'AMBOS'] }, estado: 'ACTIVO' }, select: F.selectEmpresaCorta, orderBy: { nombre: 'asc' } })
        : [],
      (editaGastos || editaCotizaciones) && hayClientes
        ? prisma.empresa.findMany({ where: { tipo: { in: ['PROVEEDOR', 'AMBOS'] }, estado: 'ACTIVO' }, select: F.selectEmpresaCorta, orderBy: { nombre: 'asc' } })
        : [],
      editaVentas && hayContratos
        ? prisma.contrato.findMany({
          where: { estado: { not: 'CANCELADO' } },
          select: { id: true, folio: true, titulo: true, empresaId: true },
          orderBy: { creadoEn: 'desc' },
        })
        : [],
      editaVentas
        ? prisma.proyecto.findMany({ where: { estado: { not: 'ARCHIVADO' } }, select: { id: true, nombre: true, clienteId: true }, orderBy: { nombre: 'asc' } })
        : [],
    ]);

    return res.json({
      cuentas,
      clientes,
      proveedores,
      contratos,
      proyectos,
      categorias,
      monedas: F.MONEDAS,
      monedaBase: F.MONEDA_BASE,
      metodos: F.METODOS_PAGO,
      tiposCuenta: F.TIPOS_CUENTA,
    });
  } catch (error) {
    console.error('[finanzas.catalogos]', error);
    return res.status(500).json({ error: 'Error al cargar los catálogos de finanzas' });
  }
};

// ---------------------------------------------------------------------------
// Cuentas (a donde entra o de donde sale el dinero)
// ---------------------------------------------------------------------------
const normalizarCuenta = (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('nombre')) {
    const nombre = F.textoOpcional(body.nombre, 120);
    if (!nombre || nombre.length < 2) errores.push('El nombre de la cuenta es obligatorio');
    else data.nombre = nombre;
  }
  if (!parcial || viene('tipo')) {
    const tipo = String(body.tipo || 'BANCO').toUpperCase();
    if (!F.TIPOS_CUENTA.includes(tipo)) errores.push('Tipo de cuenta no válido');
    else data.tipo = tipo;
  }
  if (viene('banco')) data.banco = F.textoOpcional(body.banco, 80);
  if (viene('referencia')) data.referencia = F.textoOpcional(body.referencia, 40);
  if (viene('activa')) data.activa = Boolean(body.activa);
  if (viene('orden')) {
    const orden = Number.parseInt(body.orden, 10);
    data.orden = Number.isInteger(orden) ? Math.max(0, Math.min(999, orden)) : 0;
  }
  return { data, errores };
};

const listarCuentas = async (_req, res) => {
  try {
    const cuentas = await prisma.cuentaFinanciera.findMany({
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: { _count: { select: { pagos: true, gastos: true } } },
    });
    return res.json({ cuentas: cuentas.map(({ _count, ...c }) => ({ ...c, totalPagos: _count.pagos, totalGastos: _count.gastos })) });
  } catch (error) {
    console.error('[finanzas.listarCuentas]', error);
    return res.status(500).json({ error: 'Error al listar las cuentas' });
  }
};

const crearCuenta = async (req, res) => {
  try {
    const { data, errores } = normalizarCuenta(req.body);
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la cuenta', detalles: errores });
    const cuenta = await prisma.cuentaFinanciera.create({ data });
    F.registrarFinanzas(req.usuario, 'cuenta', cuenta.id, 'CREAR', `Creó la cuenta "${cuenta.nombre}"`);
    return res.status(201).json({ mensaje: 'Cuenta creada', cuenta });
  } catch (error) {
    console.error('[finanzas.crearCuenta]', error);
    return res.status(500).json({ error: 'Error al crear la cuenta' });
  }
};

const editarCuenta = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.cuentaFinanciera.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { data, errores } = normalizarCuenta(req.body, { parcial: true });
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos de la cuenta', detalles: errores });
    const cuenta = await prisma.cuentaFinanciera.update({ where: { id }, data });
    F.registrarFinanzas(req.usuario, 'cuenta', id, 'EDITAR', `Editó la cuenta "${cuenta.nombre}"`);
    return res.json({ mensaje: 'Cuenta actualizada', cuenta });
  } catch (error) {
    console.error('[finanzas.editarCuenta]', error);
    return res.status(500).json({ error: 'Error al actualizar la cuenta' });
  }
};

// Con movimientos no se borra: se desactiva (los pagos y gastos la siguen mostrando).
const eliminarCuenta = async (req, res) => {
  const id = F.leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.cuentaFinanciera.findUnique({ where: { id }, include: { _count: { select: { pagos: true, gastos: true } } } });
    if (!actual) return res.status(404).json({ error: 'Cuenta no encontrada' });
    if (actual._count.pagos + actual._count.gastos > 0) {
      await prisma.cuentaFinanciera.update({ where: { id }, data: { activa: false } });
      F.registrarFinanzas(req.usuario, 'cuenta', id, 'DESACTIVAR', `Desactivó la cuenta "${actual.nombre}" (tiene movimientos)`);
      return res.json({ mensaje: 'La cuenta tiene movimientos: se desactivó en vez de borrarse', desactivada: true });
    }
    await prisma.cuentaFinanciera.delete({ where: { id } });
    F.registrarFinanzas(req.usuario, 'cuenta', id, 'ELIMINAR', `Eliminó la cuenta "${actual.nombre}"`);
    return res.json({ mensaje: 'Cuenta eliminada', desactivada: false });
  } catch (error) {
    console.error('[finanzas.eliminarCuenta]', error);
    return res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/bitacora?entidad=pago&entidadId=5&limit=50
// Sin entidad: las ultimas entradas de todo (solo administrador global).
// ---------------------------------------------------------------------------
const bitacora = async (req, res) => {
  try {
    const entidad = String(req.query.entidad || '').toLowerCase();
    const entidadId = F.leerId(req.query.entidadId);
    const limite = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    let where;

    if (entidad || entidadId) {
      if (!F.ENTIDADES_LOG.includes(entidad) || !entidadId) return res.status(400).json({ error: 'Indica la entidad y su id' });
      // El permiso es el del registro al que pertenece la bitacora.
      let permitido = false;
      if (entidad === 'pago') permitido = F.puedeVer(req.usuario, 'ventas');
      else if (entidad === 'gasto') {
        const gasto = await prisma.gasto.findUnique({ where: { id: entidadId }, select: { categoria: true } });
        // Un gasto borrado ya no tiene categoria: su historial solo para el administrador global.
        permitido = gasto ? F.puedeGasto(req.usuario, gasto.categoria) : esAdminGlobal(req.usuario);
      } else if (entidad === 'cotizacion') permitido = F.puedeVer(req.usuario, 'cotizaciones');
      else if (entidad === 'cuenta') permitido = F.puedeVer(req.usuario, 'ventas') || F.puedeVer(req.usuario, 'tesoreria');
      else permitido = F.puedeVer(req.usuario, 'tesoreria'); // presupuesto, y partida o asignacion (historial)
      if (!permitido) return F.sinPermiso(res);
      where = { entidad, entidadId };
    } else if (!esAdminGlobal(req.usuario)) {
      return F.sinPermiso(res);
    }

    const entradas = await prisma.logFinanzas.findMany({ where, orderBy: { creadoEn: 'desc' }, take: limite });
    return res.json({ entradas });
  } catch (error) {
    console.error('[finanzas.bitacora]', error);
    return res.status(500).json({ error: 'Error al leer la bitácora' });
  }
};

module.exports = {
  catalogos,
  listarCuentas,
  crearCuenta,
  editarCuenta,
  eliminarCuenta,
  bitacora,
};
