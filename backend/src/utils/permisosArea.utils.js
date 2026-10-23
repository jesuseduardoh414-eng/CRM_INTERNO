// Permisos por area (panel de configuracion) y por persona (Usuarios).
//
// Cada area tiene una tabla con dos columnas: lo que pueden sus MIEMBROS y lo
// que pueden sus ADMINISTRADORES. A una persona se le pueden ajustar casillas
// sueltas (usuarios.permisos, solo las que cambian). El administrador general
// (ADMIN del area ADMINISTRACION) siempre puede todo y no se configura.
//
//   efectivo = ajuste de la persona  ??  tabla de su area/rol  ??  valor de fabrica
//
// Una persona puede estar en varias areas (usuarios.area = "MARKETING,DESARROLLO",
// como los proyectos). Tiene lo que le da cada una: de cada casilla, el valor
// mas amplio de sus tablas; y un alcance "area" llega solo a las areas cuya
// tabla lo da (areasDelAlcance), salvo que sea un ajuste de la persona.
//
// Tipos de casilla:
//   bool     si / no
//   alcance  hasta donde llega: ninguno | propios | area | todos (cada permiso
//            dice cuales admite). "propios" = en lo que la persona participa;
//            "area" = lo de su area mas lo propio; "todos" = todo.
//
// Los valores de fabrica reproducen como funcionaba el CRM antes de esta
// tabla (los de los miembros salen de los interruptores viejos del panel,
// configuracion.permisos). El espejo de textos esta en
// frontend/src/utils/textosPermisos.js; la estructura la manda el servidor.

const ALCANCES = ['ninguno', 'propios', 'area', 'todos'];
const ROLES = ['miembro', 'admin'];
const CATEGORIAS_GASTO = ['PRESUPUESTO_GENERAL', 'PRESUPUESTO_OFICINA', 'NOMINA', 'FIJOS', 'VARIABLES', 'OTROS'];

const bool = (clave, miembro, admin) => ({ clave, tipo: 'bool', defecto: { miembro, admin } });
const alcance = (clave, opciones, miembro, admin) => ({ clave, tipo: 'alcance', opciones, defecto: { miembro, admin } });
const TODOS_ALCANCES = ALCANCES;
const CRUD_FINANZAS = (base) => [bool(`${base}.ver`, false, false), bool(`${base}.crear`, false, false), bool(`${base}.editar`, false, false), bool(`${base}.eliminar`, false, false)];

/**
 * Catalogo. `defecto.miembro` puede ser una funcion de los interruptores
 * viejos (configuracion.permisos) para respetar lo que ya estaba elegido.
 */
const CATALOGO = [
  {
    seccion: 'proyectos',
    permisos: [
      alcance('proyectos.ver', TODOS_ALCANCES, (v) => (v.verTodosProyectos ? 'todos' : 'propios'), 'area'),
      bool('proyectos.crear', (v) => Boolean(v.crearProyectos), true),
      alcance('proyectos.editar', TODOS_ALCANCES, 'ninguno', 'area'),
      alcance('proyectos.eliminar', TODOS_ALCANCES, 'ninguno', 'area'),
      bool('proyectos.plantillas', (v) => Boolean(v.guardarPlantillas), true),
    ],
  },
  {
    seccion: 'tareas',
    permisos: [
      alcance('tareas.ver', ['propios', 'todos'], 'propios', 'todos'),
      alcance('tareas.crear', TODOS_ALCANCES, (v) => (v.crearTareas ? 'propios' : 'ninguno'), 'area'),
      alcance('tareas.editar', TODOS_ALCANCES, (v) => (v.editarTareas ? 'propios' : 'ninguno'), 'area'),
      alcance('tareas.eliminar', TODOS_ALCANCES, (v) => (v.borrarTareas ? 'propios' : 'ninguno'), 'area'),
      bool('tareas.adjuntos', (v) => v.subirAdjuntos !== false, true),
      bool('tareas.comentar', true, true),
    ],
  },
  {
    seccion: 'agenda',
    permisos: [
      alcance('agenda.equipo', ['ninguno', 'area', 'todos'], 'ninguno', 'area'),
      alcance('agenda.diasEmpresa', ['ninguno', 'area', 'todos'], 'ninguno', 'area'),
      bool('agenda.eventosEmpresa', false, true),
    ],
  },
  {
    seccion: 'clientes',
    permisos: [bool('clientes.ver', false, true), bool('clientes.crear', false, true), bool('clientes.editar', false, true), bool('clientes.eliminar', false, true)],
  },
  {
    seccion: 'contratos',
    permisos: [bool('contratos.ver', false, true), bool('contratos.crear', false, true), bool('contratos.editar', false, true), bool('contratos.eliminar', false, true)],
  },
  {
    seccion: 'reportes',
    permisos: [bool('reportes.ver', false, true)],
  },
  {
    seccion: 'usuarios',
    permisos: [
      alcance('usuarios.ver', ['ninguno', 'area', 'todos'], 'ninguno', 'area'),
      bool('usuarios.invitar', false, true),
      bool('usuarios.editar', false, true),
      bool('usuarios.desactivar', false, true),
    ],
  },
  {
    seccion: 'conocimiento',
    permisos: [
      bool('conocimiento.ver', true, true),
      bool('conocimiento.crear', false, true),
      bool('conocimiento.editar', false, true),
      bool('conocimiento.eliminar', false, true),
      // Restringir articulos y archivos a areas, roles o personas.
      bool('conocimiento.acceso', false, true),
    ],
  },
  {
    seccion: 'finanzas',
    permisos: [
      ...CRUD_FINANZAS('finanzas.ventas'),
      bool('finanzas.tesoreria.ver', false, false),
      bool('finanzas.tesoreria.editar', false, false),
      ...CATEGORIAS_GASTO.flatMap((c) => CRUD_FINANZAS(`finanzas.gastos.${c}`)),
      bool('finanzas.informe.ver', false, false),
      bool('finanzas.cotizaciones.ver', false, false),
      bool('finanzas.cotizaciones.crear', false, false),
      bool('finanzas.cotizaciones.editar', false, false),
      bool('finanzas.cotizaciones.aprobar', false, false),
      bool('finanzas.cotizaciones.eliminar', false, false),
    ],
  },
];

const PERMISOS = CATALOGO.flatMap((s) => s.permisos.map((p) => ({ ...p, seccion: s.seccion })));
const POR_CLAVE = new Map(PERMISOS.map((p) => [p.clave, p]));
const CLAVES = PERMISOS.map((p) => p.clave);

/** Valor de fabrica de una casilla para un rol, con los interruptores viejos. */
const defectoDe = (permiso, rol, viejos = {}) => {
  const d = permiso.defecto[rol];
  return typeof d === 'function' ? d(viejos) : d;
};

/** El maximo de una casilla (lo que tiene el administrador general). */
const maximoDe = (permiso) => (permiso.tipo === 'bool' ? true : permiso.opciones[permiso.opciones.length - 1]);

/** Valor valido para una casilla, o undefined si no lo es. */
const valorValido = (permiso, valor) => {
  if (permiso.tipo === 'bool') return typeof valor === 'boolean' ? valor : undefined;
  return permiso.opciones.includes(valor) ? valor : undefined;
};

/** Mapa { clave: valor } solo con casillas y valores validos. */
const limpiarMapa = (entrada) => {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return {};
  const salida = {};
  for (const [clave, valor] of Object.entries(entrada)) {
    const permiso = POR_CLAVE.get(clave);
    if (!permiso) continue;
    const limpio = valorValido(permiso, valor);
    if (limpio !== undefined) salida[clave] = limpio;
  }
  return salida;
};

/** Tablas de todas las areas tal como las guarda la configuracion. */
const normalizarPermisosAreas = (entrada, areas, anteriores) => {
  const base = entrada === undefined ? anteriores : entrada;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return {};
  const claves = new Set((areas || []).map((a) => a.clave));
  const salida = {};
  for (const [area, tabla] of Object.entries(base)) {
    if (!claves.has(area) || !tabla || typeof tabla !== 'object') continue;
    const miembro = limpiarMapa(tabla.miembro);
    const admin = limpiarMapa(tabla.admin);
    if (Object.keys(miembro).length || Object.keys(admin).length) salida[area] = { miembro, admin };
  }
  return salida;
};

/** Los valores de fabrica de ambos roles (para el panel). */
const defectos = (viejos = {}) => Object.fromEntries(ROLES.map((rol) => [rol, Object.fromEntries(PERMISOS.map((p) => [p.clave, defectoDe(p, rol, viejos)]))]));

// ── Permisos de finanzas anteriores (por persona, ninguno/ver/editar) ──
// Antes de esta tabla los permisos de finanzas eran por persona con tres
// niveles. Se leen como ajustes de la persona mientras no se guarden los
// nuevos (Usuarios los reescribe en usuarios.permisos al guardar).
const desdeFinanzasAnteriores = (viejos) => {
  if (!viejos || typeof viejos !== 'object') return {};
  const salida = {};
  const nivel = (v) => (['ver', 'editar'].includes(v) ? v : 'ninguno');
  const crud = (base, n) => {
    if (n === 'ninguno') return;
    salida[`${base}.ver`] = true;
    if (n === 'editar') ['crear', 'editar', 'eliminar'].forEach((a) => { salida[`${base}.${a}`] = true; });
  };
  crud('finanzas.ventas', nivel(viejos.ventas));
  const tes = nivel(viejos.tesoreria);
  if (tes !== 'ninguno') salida['finanzas.tesoreria.ver'] = true;
  if (tes === 'editar') salida['finanzas.tesoreria.editar'] = true;
  if (nivel(viejos.informe) !== 'ninguno') salida['finanzas.informe.ver'] = true;
  const cot = nivel(viejos.cotizaciones);
  if (cot !== 'ninguno') salida['finanzas.cotizaciones.ver'] = true;
  if (cot === 'editar') salida['finanzas.cotizaciones.crear'] = true; // corregir, aprobar y eliminar eran del admin general
  CATEGORIAS_GASTO.forEach((c) => crud(`finanzas.gastos.${c}`, nivel(viejos.gastos?.[c])));
  return salida;
};

const AREA_GENERAL = 'ADMINISTRACION';

/** "MARKETING,DESARROLLO" (o ya una lista) -> ['MARKETING', 'DESARROLLO'] sin repetidas. */
const areasDeTexto = (valor) => [...new Set((Array.isArray(valor) ? valor : String(valor || '').split(','))
  .map((a) => String(a ?? '').trim().toUpperCase())
  .filter(Boolean))];
/** Areas de una persona. */
const areasDe = (usuario) => areasDeTexto(usuario?.area);

const esAdminGeneral = (usuario) => usuario?.rol === 'ADMIN' && areasDe(usuario).includes(AREA_GENERAL);
const rolDe = (usuario) => (usuario?.rol === 'ADMIN' ? 'admin' : 'miembro');

/** Ajustes de la persona: los nuevos o, si no hay, los de finanzas anteriores. */
const ajustesDe = (usuario) => {
  if (usuario?.permisos && typeof usuario.permisos === 'object') return limpiarMapa(usuario.permisos);
  return desdeFinanzasAnteriores(usuario?.permisosFinanzas);
};

/** Valor de una casilla en la tabla de un area para un rol (o el de fabrica). */
const valorEnArea = (permiso, area, rol, config) => config?.permisosAreas?.[area]?.[rol]?.[permiso.clave]
  ?? defectoDe(permiso, rol, config?.permisos || {});

/** El mas amplio de varios valores de una casilla. */
const masAmplio = (permiso, valores) => (permiso.tipo === 'bool'
  ? valores.some((v) => v === true)
  : valores.reduce((max, v) => (ALCANCES.indexOf(v) > ALCANCES.indexOf(max) ? v : max), 'ninguno'));

/** Lo que hereda una persona de sus areas y su rol (sin sus ajustes). */
const heredados = (usuario, config) => {
  const rol = rolDe(usuario);
  const areas = areasDe(usuario);
  const lista = areas.length ? areas : [null];
  return Object.fromEntries(PERMISOS.map((p) => [p.clave, masAmplio(p, lista.map((area) => valorEnArea(p, area, rol, config)))]));
};

const cache = new WeakMap();

/**
 * Mapa completo { clave: valor } de una persona. Administrador general: todo
 * al maximo. Configurador y cliente: nada (no entran al CRM). Se recuerda por
 * objeto de usuario (una peticion).
 */
const permisosEfectivos = (usuario, config) => {
  if (!usuario) return Object.fromEntries(PERMISOS.map((p) => [p.clave, p.tipo === 'bool' ? false : 'ninguno']));
  if (cache.has(usuario)) return cache.get(usuario);
  let mapa;
  if (esAdminGeneral(usuario)) mapa = Object.fromEntries(PERMISOS.map((p) => [p.clave, maximoDe(p)]));
  else if (!['ADMIN', 'MIEMBRO'].includes(usuario.rol)) mapa = Object.fromEntries(PERMISOS.map((p) => [p.clave, p.tipo === 'bool' ? false : 'ninguno']));
  else mapa = { ...heredados(usuario, config), ...ajustesDe(usuario) };
  cache.set(usuario, mapa);
  return mapa;
};

const configActual = () => require('../services/configuracion.service').configEnCache();

/** true si la casilla esta concedida (bool true o alcance distinto de ninguno). */
const puede = (usuario, clave) => {
  if (!POR_CLAVE.has(clave)) throw new Error(`Permiso desconocido: ${clave}`);
  const valor = permisosEfectivos(usuario, configActual())[clave];
  return valor === true || (typeof valor === 'string' && valor !== 'ninguno');
};

/** Alcance de una casilla de tipo alcance ('ninguno' | 'propios' | 'area' | 'todos'). */
const alcanceDe = (usuario, clave) => {
  const permiso = POR_CLAVE.get(clave);
  if (!permiso || permiso.tipo !== 'alcance') throw new Error(`No es un permiso de alcance: ${clave}`);
  return permisosEfectivos(usuario, configActual())[clave];
};

/**
 * Areas a las que llega un alcance "area": las de la persona cuya tabla da al
 * menos "area" en esa casilla; si la casilla es un ajuste de la persona, todas
 * sus areas.
 */
const areasDelAlcance = (usuario, clave, config = configActual()) => {
  const permiso = POR_CLAVE.get(clave);
  if (!permiso || permiso.tipo !== 'alcance') throw new Error(`No es un permiso de alcance: ${clave}`);
  const areas = areasDe(usuario);
  if (esAdminGeneral(usuario) || Object.prototype.hasOwnProperty.call(ajustesDe(usuario), clave)) return areas;
  const minimo = ALCANCES.indexOf('area');
  return areas.filter((area) => ALCANCES.indexOf(valorEnArea(permiso, area, rolDe(usuario), config)) >= minimo);
};

/**
 * Para el frontend: { clave: [areas] } de las casillas cuyo alcance es "area",
 * cuando no llega a todas las areas de la persona.
 */
const alcancesPorArea = (usuario, config) => {
  const mapa = permisosEfectivos(usuario, config);
  const todas = areasDe(usuario);
  const salida = {};
  for (const p of PERMISOS) {
    if (p.tipo !== 'alcance' || mapa[p.clave] !== 'area') continue;
    const areas = areasDelAlcance(usuario, p.clave, config);
    if (areas.length < todas.length) salida[p.clave] = areas;
  }
  return salida;
};

/** Lo que se manda al frontend: estructura del catalogo (sin funciones). */
const catalogoPublico = () => CATALOGO.map((s) => ({
  seccion: s.seccion,
  permisos: s.permisos.map((p) => ({ clave: p.clave, tipo: p.tipo, ...(p.opciones ? { opciones: p.opciones } : {}) })),
}));

const sinPermiso = (res) => res.status(403).json({
  error: 'Tu cuenta no tiene permiso para hacer esto. Pídeselo al administrador.',
  codigo: 'SIN_PERMISO',
});

module.exports = {
  ALCANCES,
  CATEGORIAS_GASTO,
  CLAVES,
  POR_CLAVE,
  catalogoPublico,
  defectos,
  limpiarMapa,
  normalizarPermisosAreas,
  desdeFinanzasAnteriores,
  ajustesDe,
  heredados,
  permisosEfectivos,
  puede,
  alcanceDe,
  areasDelAlcance,
  alcancesPorArea,
  AREA_GENERAL,
  areasDeTexto,
  areasDe,
  esAdminGeneral,
  rolDe,
  sinPermiso,
};
