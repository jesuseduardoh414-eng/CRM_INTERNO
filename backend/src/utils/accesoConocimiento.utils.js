// Quien ve cada articulo y cada archivo de la base de conocimiento.
//
// Un articulo es de todo el equipo (restringido = false: lo lee quien tenga
// conocimiento.ver) o solo de quienes esten en su lista de accesos. Un archivo
// sigue a su articulo o tiene su propia lista, que solo puede achicar: para
// ver un archivo hay que ver primero el articulo. Cada fila de la lista es una
// de estas (tabla accesos_conocimiento):
//
//   { usuarioId }    una persona
//   { area }         toda un area
//   { area, rol }    solo los administradores o solo los miembros del area
//   { rol }          los administradores (o los miembros) de todas las areas
//
// Ademas siempre ven: el administrador general (todo), quien escribio el
// articulo (el articulo, no los archivos restringidos que suban otros) y
// quien subio cada archivo (ese archivo). Una lista vacia con restringido =
// true deja el articulo solo para ellos.
//
// Cambiar estas listas es el permiso conocimiento.acceso.
//
// Las cotizaciones usan las mismas filas (tabla accesos_cotizacion, ver
// accesoCotizaciones en finanzas.utils.js): filasDe y normalizarAcceso
// sirven para las dos.
const { esAdminGeneral, rolDe, areasDe } = require('./permisosArea.utils');

const ROLES = ['admin', 'miembro'];
const MAX_FILAS = 300;

/** Filas de una lista de accesos que alcanzan a la persona (en cualquiera de sus areas). */
const filasDe = (usuario) => ({
  OR: [
    { usuarioId: usuario.id },
    { area: { in: areasDe(usuario) }, rol: null },
    { area: { in: areasDe(usuario) }, rol: rolDe(usuario) },
    { area: null, rol: rolDe(usuario) },
  ],
});

/** where de los articulos que la persona puede ver por su acceso (null = todos). */
const accesoArticulos = (usuario) => {
  if (esAdminGeneral(usuario)) return null;
  return { OR: [{ restringido: false }, { autorId: usuario.id }, { accesos: { some: filasDe(usuario) } }] };
};

/** where de los archivos que la persona ve dentro de un articulo que ya ve (null = todos). */
const accesoArchivos = (usuario) => {
  if (esAdminGeneral(usuario)) return null;
  return { OR: [{ restringido: false }, { subidoPorId: usuario.id }, { accesos: { some: filasDe(usuario) } }] };
};

/**
 * Valida lo que manda el formulario: { restringido, reglas: [{ area, rol,
 * usuarioId }] }. Devuelve { restringido, filas, errores } con las filas sin
 * repetidos y listas para guardar. `areas` son las claves configuradas;
 * `existentes(ids)` devuelve cuales de esos ids de persona existen.
 */
const normalizarAcceso = async (entrada, { areas, existentes }) => {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { errores: ['El acceso no es válido'] };
  }
  const restringido = Boolean(entrada.restringido);
  if (!restringido) return { restringido, filas: [], errores: [] };

  const reglas = Array.isArray(entrada.reglas) ? entrada.reglas : [];
  if (reglas.length > MAX_FILAS) return { errores: [`Demasiadas reglas de acceso (máximo ${MAX_FILAS})`] };
  const claves = new Set(areas);
  const errores = [];
  const filas = [];
  const vistas = new Set();
  const agregar = (fila) => {
    const llave = `${fila.usuarioId ?? ''}|${fila.area ?? ''}|${fila.rol ?? ''}`;
    if (vistas.has(llave)) return;
    vistas.add(llave);
    filas.push(fila);
  };

  for (const regla of reglas) {
    if (!regla || typeof regla !== 'object') { errores.push('Hay una regla de acceso no válida'); continue; }
    if (regla.usuarioId !== undefined && regla.usuarioId !== null) {
      const usuarioId = Number(regla.usuarioId);
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) { errores.push('Hay una persona no válida en el acceso'); continue; }
      agregar({ usuarioId, area: null, rol: null });
      continue;
    }
    const area = regla.area ? String(regla.area) : null;
    const rol = regla.rol ? String(regla.rol) : null;
    if (rol && !ROLES.includes(rol)) { errores.push('Hay un rol no válido en el acceso'); continue; }
    if (area && !claves.has(area)) { errores.push(`El área «${area}» ya no existe`); continue; }
    // Sin area ni rol seria "todo el equipo": para eso esta restringido = false.
    if (!area && !rol) { errores.push('Hay una regla de acceso vacía'); continue; }
    agregar({ usuarioId: null, area, rol });
  }

  const ids = filas.filter((f) => f.usuarioId).map((f) => f.usuarioId);
  if (ids.length) {
    const hay = new Set(await existentes(ids));
    if (ids.some((id) => !hay.has(id))) errores.push('Alguna de las personas elegidas ya no existe');
  }
  return { restringido, filas, errores };
};

module.exports = {
  ROLES,
  filasDe,
  accesoArticulos,
  accesoArchivos,
  normalizarAcceso,
};
