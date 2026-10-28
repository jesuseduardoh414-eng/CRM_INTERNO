// Finanzas: catalogos cerrados, permisos por usuario y validadores comunes de
// Ventas (pagos), Tesoreria (presupuestos por categoria), Gastos y Cotizaciones.
//
// El espejo del frontend es frontend/src/utils/finanzas.js: si cambia una
// lista o una regla aqui, hay que cambiarla alla.
//
// Permisos: casillas finanzas.* de la tabla de permisos por area y de los
// ajustes de cada persona (utils/permisosArea.utils.js):
//   finanzas.ventas.{ver,crear,editar,eliminar}
//   finanzas.tesoreria.{ver,editar}
//   finanzas.gastos.<CATEGORIA>.{ver,crear,editar,eliminar}
//   finanzas.informe.ver
//   finanzas.cotizaciones.{ver,crear,editar,aprobar,eliminar,acceso}
// En cotizaciones, crear es subir cotizaciones y versiones nuevas; editar es
// corregir datos; aprobar, cambiar el estado; y acceso, elegir quien ve cada
// una (accesoCotizaciones). La version original nunca se reemplaza. De
// fabrica nadie tiene nada: el administrador general (ADMIN del area
// ADMINISTRACION) siempre puede todo. Se comprueba en el servidor: ocultar el
// menu en el frontend no basta.
const {
  puede: puedeClave, POR_CLAVE, CATEGORIAS_GASTO, esAdminGeneral,
} = require('./permisosArea.utils');
const { filasDe } = require('./accesoConocimiento.utils');
const { partesDiaMexico } = require('./fechas.utils');

// Para el Excel y la bitacora (las pantallas usan sus propios textos).
const NOMBRES_CATEGORIA = {
  PRESUPUESTO_GENERAL: 'Presupuesto de gastos – General',
  PRESUPUESTO_OFICINA: 'Presupuesto de gastos – Oficina',
  NOMINA: 'Nómina',
  FIJOS: 'Gastos fijos',
  VARIABLES: 'Gastos variables',
  OTROS: 'Otros',
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const RECURSOS_BASE = ['ventas', 'tesoreria', 'informe', 'cotizaciones'];
const RECURSOS = [...RECURSOS_BASE, ...CATEGORIAS_GASTO.map((c) => `gastos.${c}`)];
const ACCIONES = ['ver', 'crear', 'editar', 'eliminar', 'aprobar', 'acceso'];

const MONEDAS = ['MXN', 'USD', 'EUR'];
// La tesoreria y el informe trabajan en esta moneda; los movimientos en otra
// se registran pero no entran en la bolsa ni en las sumas.
const MONEDA_BASE = 'MXN';
const METODOS_PAGO = ['TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'CHEQUE', 'DEPOSITO', 'OTRO'];
const TIPOS_CUENTA = ['BANCO', 'EFECTIVO', 'PASARELA', 'OTRA'];
const ESTADOS_PAGO = ['REGISTRADO', 'ANULADO'];
const ESTADOS_GASTO = ['PENDIENTE', 'PAGADO', 'ANULADO'];
// RECIBIDA: la cotiza un proveedor. ENVIADA: la cotizamos a un cliente.
const TIPOS_COTIZACION = ['RECIBIDA', 'ENVIADA'];
const ESTADOS_COTIZACION = ['PENDIENTE', 'APROBADA', 'RECHAZADA'];
// 'partida' y 'asignacion' solo quedan como historial (antes del 2026-10-14).
const ENTIDADES_LOG = ['pago', 'gasto', 'presupuesto', 'cotizacion', 'partida', 'asignacion', 'cuenta'];
const MONTO_MAXIMO = 999999999999; // cabe en Decimal(14,2)
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGEX_COLOR = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

/**
 * ¿Puede la accion sobre el recurso? recurso: 'ventas', 'tesoreria',
 * 'informe', 'cotizaciones' o 'gastos.FIJOS'; accion: ver, crear, editar,
 * eliminar, aprobar o acceso. Una combinacion que no existe (p. ej. eliminar
 * en tesoreria) es false.
 */
const puedeFin = (usuario, recurso, accion = 'ver') => {
  const clave = `finanzas.${recurso}.${accion}`;
  return POR_CLAVE.has(clave) && puedeClave(usuario, clave);
};
const puedeVer = (usuario, recurso) => puedeFin(usuario, recurso, 'ver');
const puedeGasto = (usuario, categoria, accion = 'ver') => puedeFin(usuario, `gastos.${categoria}`, accion);
const categoriasCon = (usuario, accion = 'ver') => CATEGORIAS_GASTO.filter((c) => puedeGasto(usuario, c, accion));
const categoriasVisibles = (usuario) => categoriasCon(usuario, 'ver');
const tieneAccesoFinanzas = (usuario) => RECURSOS.some((r) => puedeVer(usuario, r));

/**
 * where de las cotizaciones que la persona ve (null = todas). Una sin
 * restringir la ve quien tiene finanzas.cotizaciones.ver; una restringida,
 * solo quienes esten en su lista de accesos (las mismas filas que la base de
 * conocimiento), tengan o no ese permiso: elegir a alguien es compartirsela.
 * Siempre: el administrador general (todas) y quien la registro.
 */
const accesoCotizaciones = (usuario) => {
  if (esAdminGeneral(usuario)) return null;
  const opciones = [{ creadoPorId: usuario.id }, { restringido: true, accesos: { some: filasDe(usuario) } }];
  if (puedeVer(usuario, 'cotizaciones')) opciones.unshift({ restringido: false });
  return { OR: opciones };
};

const sinPermiso = (res) => res.status(403).json({
  error: 'Tu cuenta no tiene permiso para esta sección de finanzas. Pídeselo al administrador.',
  codigo: 'SIN_PERMISO',
});

// ---------------------------------------------------------------------------
// Validadores y conversiones
// ---------------------------------------------------------------------------

const textoOpcional = (valor, max) => {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = String(valor).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!limpio) return null;
  return limpio.slice(0, max);
};

const leerId = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * 'AAAA-MM-DD' -> Date a medianoche UTC (como guarda Prisma un @db.Date).
 * undefined si no viene, null si viene vacio, false si no es una fecha real.
 */
const leerFecha = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const texto = String(valor).slice(0, 10);
  if (!REGEX_FECHA.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) return false;
  // Mismo rango que los selectores de año: una fecha fuera (un 0226 por un
  // 2026 mal tecleado) contaba en la bolsa pero no salia en ningun resumen.
  const anio = fecha.getUTCFullYear();
  if (anio < 2000 || anio > 2100) return false;
  return fecha;
};

/** Date de una columna @db.Date -> 'AAAA-MM-DD'. */
const fechaATexto = (fecha) => (fecha ? new Date(fecha).toISOString().slice(0, 10) : null);

/** Medianoche UTC del dia civil de hoy en la zona de la empresa. */
const hoyFecha = () => {
  const { year, month, day } = partesDiaMexico();
  return new Date(Date.UTC(year, month, day));
};

/** Suma meses a un @db.Date conservando el dia (recortado al fin de mes). */
const sumarMeses = (fecha, meses) => {
  const y = fecha.getUTCFullYear();
  const m = fecha.getUTCMonth() + meses;
  const d = fecha.getUTCDate();
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, ultimoDia)));
};

/** Rango [inicio, fin) de un mes (0-11) o de un año entero en UTC, para columnas @db.Date. */
const rangoMes = (anio, mes) => ({ inicio: new Date(Date.UTC(anio, mes, 1)), fin: new Date(Date.UTC(anio, mes + 1, 1)) });
const rangoAnio = (anio) => ({ inicio: new Date(Date.UTC(anio, 0, 1)), fin: new Date(Date.UTC(anio + 1, 0, 1)) });

/** Mes (1-12) o null si no es valido. */
const leerMes = (valor) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
};

/** Numero con dos decimales o false si no es un importe valido. */
// Solo cifras con hasta dos decimales (ni "1e3", ni "0x10", ni true).
const REGEX_MONTO = /^\d{1,12}(\.\d{1,2})?$/;
const leerMonto = (valor, { permitirCero = false } = {}) => {
  if (typeof valor !== 'number' && typeof valor !== 'string') return false;
  const texto = String(valor).trim();
  if (!REGEX_MONTO.test(texto)) return false;
  const n = Math.round(Number(texto) * 100) / 100;
  if (!Number.isFinite(n) || n > MONTO_MAXIMO) return false;
  if (!permitirCero && n <= 0) return false;
  return n;
};

// Los importes se suman en centavos enteros para no arrastrar errores de
// coma flotante (0.1 + 0.2). Decimal de Prisma -> Number -> centavos.
const aNumero = (decimal) => (decimal === null || decimal === undefined ? 0 : Number(decimal));
const centavos = (valor) => Math.round(aNumero(valor) * 100);
const sumar = (valores) => valores.reduce((acc, v) => acc + centavos(v), 0) / 100;

const leerAnio = (valor, porDefecto) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : porDefecto;
};

// `fecha` es un @db.Date (medianoche UTC del dia civil): su año es el UTC. Con
// partesDiaMexico un pago del 1 de enero salia con el folio del año anterior.
const folio = (prefijo, id, fecha) => {
  const anio = fecha ? new Date(fecha).getUTCFullYear() : partesDiaMexico().year;
  return `${prefijo}-${anio}-${String(id).padStart(4, '0')}`;
};

// ---------------------------------------------------------------------------
// Selects compartidos
// ---------------------------------------------------------------------------

const selectUsuarioCorto = { id: true, nombre: true, email: true };
const selectEmpresaCorta = { id: true, nombre: true, nombreComercial: true, tipo: true };
const selectCuentaCorta = { id: true, nombre: true, tipo: true, banco: true, activa: true };
const selectPartidaCorta = { id: true, nombre: true, color: true, activa: true };
// De que archivo de tarea o proyecto es copia ("Mandar a finanzas").
const selectOrigen = { adjuntoId: true, origen: true, origenTareaId: true, origenProyectoId: true };
const selectComprobante = {
  id: true, nombreOriginal: true, mime: true, tamano: true, creadoEn: true,
  subidoPor: { select: selectUsuarioCorto },
  ...selectOrigen,
};

/**
 * Cliente para el que es un gasto o una cotizacion (`clienteId` del cuerpo):
 * { clienteId } (null = ninguno), { error } o {} si no viene. Debe ser un
 * cliente del directorio (tipo CLIENTE o AMBOS).
 */
const leerCliente = async (valor) => {
  if (valor === undefined) return {};
  if (valor === null || valor === '') return { clienteId: null };
  const clienteId = leerId(valor);
  if (!clienteId) return { error: 'Cliente no válido' };
  // Require diferido: lib/prisma comprueba el proveedor al cargar.
  const empresa = await require('../lib/prisma').empresa.findUnique({ where: { id: clienteId }, select: { tipo: true } });
  if (!empresa) return { error: 'El cliente no existe en el directorio' };
  if (empresa.tipo === 'PROVEEDOR') return { error: 'Esa empresa es solo proveedor: elige un cliente' };
  return { clienteId };
};

/**
 * where de lo relacionado con una empresa del directorio (?relacionadoCon=):
 * como contraparte o proveedor (empresaId) o como cliente (clienteId).
 */
const relacionadoCon = (valor) => {
  const id = leerId(valor);
  return id ? { OR: [{ empresaId: id }, { clienteId: id }] } : null;
};

// ---------------------------------------------------------------------------
// Bitacora (logs_finanzas). Nunca lanza: un fallo al anotar no debe tumbar
// la operacion que ya se hizo.
// ---------------------------------------------------------------------------

const registrarFinanzas = async (usuario, entidad, entidadId, accion, descripcion) => {
  try {
    // Require diferido: lib/prisma comprueba el proveedor al cargar.
    const prisma = require('../lib/prisma');
    await prisma.logFinanzas.create({
      data: {
        entidad,
        entidadId: Number(entidadId) || 0,
        accion,
        descripcion: String(descripcion || '').slice(0, 2000),
        usuarioId: usuario?.id ?? null,
        usuarioNombre: usuario?.nombre ?? null,
      },
    });
  } catch (error) {
    console.error('[finanzas.bitacora]', error?.message || error);
  }
};

module.exports = {
  CATEGORIAS_GASTO,
  NOMBRES_CATEGORIA,
  MESES,
  RECURSOS,
  MONEDAS,
  MONEDA_BASE,
  METODOS_PAGO,
  TIPOS_CUENTA,
  ESTADOS_PAGO,
  ESTADOS_GASTO,
  TIPOS_COTIZACION,
  ESTADOS_COTIZACION,
  ENTIDADES_LOG,
  REGEX_UUID,
  REGEX_COLOR,
  ACCIONES,
  puedeFin,
  puedeVer,
  puedeGasto,
  categoriasCon,
  categoriasVisibles,
  tieneAccesoFinanzas,
  accesoCotizaciones,
  sinPermiso,
  textoOpcional,
  leerId,
  leerFecha,
  fechaATexto,
  hoyFecha,
  sumarMeses,
  rangoMes,
  rangoAnio,
  leerMonto,
  aNumero,
  centavos,
  sumar,
  leerAnio,
  leerMes,
  folio,
  selectUsuarioCorto,
  selectEmpresaCorta,
  selectCuentaCorta,
  selectPartidaCorta,
  selectOrigen,
  selectComprobante,
  leerCliente,
  relacionadoCon,
  registrarFinanzas,
};
