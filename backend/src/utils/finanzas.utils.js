// Finanzas: catalogos cerrados, permisos por usuario y validadores comunes de
// Ventas (pagos), Tesoreria (partidas) y Gastos.
//
// El espejo del frontend es frontend/src/utils/finanzas.js: si cambia una
// lista o una regla aqui, hay que cambiarla alla.
//
// Permisos: cada usuario lleva en `usuarios.permisos_finanzas` un JSON con el
// nivel (ninguno | ver | editar) de cada recurso:
//   { ventas, tesoreria, informe, gastos: { PRESUPUESTO_GENERAL, ..., OTROS } }
// El administrador global (ADMIN del area ADMINISTRACION) siempre tiene
// `editar` en todo y no se le consulta el JSON. El resto (admins de area,
// miembros) solo ve lo que se le dio. Se comprueba en el servidor: ocultar el
// menu en el frontend no basta.
const { esAdminGlobal } = require('./permissions.utils');
const { partesDiaMexico } = require('./fechas.utils');

const CATEGORIAS_GASTO = ['PRESUPUESTO_GENERAL', 'PRESUPUESTO_OFICINA', 'NOMINA', 'FIJOS', 'VARIABLES', 'OTROS'];
const NIVELES = ['ninguno', 'ver', 'editar'];
const RECURSOS_BASE = ['ventas', 'tesoreria', 'informe'];
const RECURSOS = [...RECURSOS_BASE, ...CATEGORIAS_GASTO.map((c) => `gastos.${c}`)];

const MONEDAS = ['MXN', 'USD', 'EUR'];
// La tesoreria y el informe trabajan en esta moneda; los movimientos en otra
// se registran pero no entran en la bolsa ni en las sumas.
const MONEDA_BASE = 'MXN';
const METODOS_PAGO = ['TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'CHEQUE', 'DEPOSITO', 'OTRO'];
const TIPOS_CUENTA = ['BANCO', 'EFECTIVO', 'PASARELA', 'OTRA'];
const ESTADOS_PAGO = ['REGISTRADO', 'ANULADO'];
const ESTADOS_GASTO = ['PENDIENTE', 'PAGADO', 'ANULADO'];
const ENTIDADES_LOG = ['pago', 'gasto', 'partida', 'asignacion', 'cuenta'];
const MONTO_MAXIMO = 999999999999; // cabe en Decimal(14,2)
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGEX_COLOR = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

const nivelValido = (valor) => (NIVELES.includes(valor) ? valor : 'ninguno');

/**
 * Deja el JSON de permisos con todas las claves y niveles validos. Devuelve
 * null si no concede nada (asi la columna queda vacia). Acepta undefined/null.
 */
const normalizarPermisos = (entrada) => {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const g = e.gastos && typeof e.gastos === 'object' ? e.gastos : {};
  const permisos = {
    ventas: nivelValido(e.ventas),
    tesoreria: nivelValido(e.tesoreria),
    informe: nivelValido(e.informe),
    gastos: Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, nivelValido(g[c])])),
  };
  const concedeAlgo = RECURSOS_BASE.some((r) => permisos[r] !== 'ninguno')
    || CATEGORIAS_GASTO.some((c) => permisos.gastos[c] !== 'ninguno');
  return concedeAlgo ? permisos : null;
};

/** Nivel de un usuario sobre un recurso ('ventas', 'tesoreria', 'informe', 'gastos.FIJOS'). */
const nivelDe = (usuario, recurso) => {
  if (esAdminGlobal(usuario)) return 'editar';
  const p = usuario?.permisosFinanzas;
  if (!p || typeof p !== 'object') return 'ninguno';
  if (recurso.startsWith('gastos.')) return nivelValido(p.gastos?.[recurso.slice(7)]);
  return nivelValido(p[recurso]);
};

const puedeVer = (usuario, recurso) => nivelDe(usuario, recurso) !== 'ninguno';
const puedeEditar = (usuario, recurso) => nivelDe(usuario, recurso) === 'editar';
const nivelGasto = (usuario, categoria) => nivelDe(usuario, `gastos.${categoria}`);
const categoriasVisibles = (usuario) => CATEGORIAS_GASTO.filter((c) => nivelGasto(usuario, c) !== 'ninguno');
const categoriasEditables = (usuario) => CATEGORIAS_GASTO.filter((c) => nivelGasto(usuario, c) === 'editar');
const tieneAccesoFinanzas = (usuario) => RECURSOS.some((r) => puedeVer(usuario, r));

/** Lo que se manda al frontend para armar el menu: el nivel de cada recurso. */
const resumenPermisos = (usuario) => ({
  ventas: nivelDe(usuario, 'ventas'),
  tesoreria: nivelDe(usuario, 'tesoreria'),
  informe: nivelDe(usuario, 'informe'),
  gastos: Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, nivelGasto(usuario, c)])),
});

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
const selectComprobante = {
  id: true, nombreOriginal: true, mime: true, tamano: true, creadoEn: true,
  subidoPor: { select: selectUsuarioCorto },
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
  NIVELES,
  RECURSOS,
  MONEDAS,
  MONEDA_BASE,
  METODOS_PAGO,
  TIPOS_CUENTA,
  ESTADOS_PAGO,
  ESTADOS_GASTO,
  ENTIDADES_LOG,
  REGEX_UUID,
  REGEX_COLOR,
  normalizarPermisos,
  nivelDe,
  puedeVer,
  puedeEditar,
  nivelGasto,
  categoriasVisibles,
  categoriasEditables,
  tieneAccesoFinanzas,
  resumenPermisos,
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
  folio,
  selectUsuarioCorto,
  selectEmpresaCorta,
  selectCuentaCorta,
  selectPartidaCorta,
  selectComprobante,
  registrarFinanzas,
};
