// Paginacion y filtros de texto reutilizables.
//
// REGLA IMPORTANTE: si la peticion no manda `page` ni `limit`, la respuesta sale
// completa, exactamente como antes. El CRM ya desplegado sigue funcionando sin
// cambios; las pantallas van adoptando la paginacion cuando les toque.
const { esPostgres } = require('../lib/baseDatos');

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

const aEntero = (valor) => {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) ? n : null;
};

const parsearPaginacion = (query = {}, opciones = {}) => {
  const porDefecto = opciones.limitePorDefecto ?? LIMITE_POR_DEFECTO;
  const maximo = opciones.limiteMaximo ?? LIMITE_MAXIMO;

  const pidioPaginar = query.page !== undefined || query.limit !== undefined;
  if (!pidioPaginar) return { activa: false };

  const page = Math.max(1, aEntero(query.page) ?? 1);
  const limit = Math.min(maximo, Math.max(1, aEntero(query.limit) ?? porDefecto));

  return { activa: true, page, limit, saltar: (page - 1) * limit };
};

/**
 * Corta la lista ya ordenada. Se pagina en memoria a proposito: el orden de
 * proyectos y tareas depende de valores calculados despues de la consulta
 * (progreso, rango de estado), asi que cortar en la base daria paginas mal
 * armadas. Los filtros si bajan a la consulta, que es lo que reduce el volumen.
 */
const paginar = (items, paginacion) => {
  if (!paginacion?.activa) return { items, meta: null };

  const total = items.length;
  const { page, limit, saltar } = paginacion;

  return {
    items: items.slice(saltar, saltar + limit),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: saltar + limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Filtro `contains` que no distingue mayusculas en las dos bases. En MySQL ya
 * lo hace el cotejamiento (utf8mb4_unicode_ci) y Prisma no admite `mode` ahi;
 * en Postgres la comparacion es exacta y hace falta `mode: 'insensitive'`
 * (ILIKE). Usar esto en vez de `{ contains }` a pelo en cualquier busqueda.
 */
const contiene = (texto) => (esPostgres()
  ? { contains: texto, mode: 'insensitive' }
  : { contains: texto });

/** Filtro `contains` sobre varios campos (busqueda libre). */
const construirBusqueda = (texto, campos) => {
  const q = String(texto || '').trim();
  if (!q) return null;
  return { OR: campos.map((campo) => ({ [campo]: contiene(q) })) };
};

/** Une condiciones ignorando las nulas, para no ensuciar el `where`. */
const combinarWhere = (...condiciones) => {
  const validas = condiciones.filter(Boolean);
  if (validas.length === 0) return undefined;
  if (validas.length === 1) return validas[0];
  return { AND: validas };
};

module.exports = {
  LIMITE_POR_DEFECTO,
  LIMITE_MAXIMO,
  parsearPaginacion,
  paginar,
  contiene,
  construirBusqueda,
  combinarWhere,
};
