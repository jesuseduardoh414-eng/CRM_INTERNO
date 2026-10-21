// Acceso a los artículos y archivos de la base de conocimiento. Las mismas
// reglas que backend/src/utils/accesoConocimiento.utils.js, aquí solo para
// mostrar quién lo verá antes de guardar: quien decide es el servidor.
//
// Un acceso es { restringido, reglas: [{ area, rol, usuarioId }] }. Cada regla
// es una persona (usuarioId), toda un área (area), solo administradores o solo
// miembros de un área (area + rol) o de todas las áreas (rol sin area).
import { esAdminGeneral } from './permisos';

export const ACCESO_ABIERTO = { restringido: false, reglas: [] };

export const rolDe = (usuario) => (usuario?.rol === 'ADMIN' ? 'admin' : 'miembro');

/**
 * El acceso tal como lo manda el servidor ({ restringido, accesos }) →
 * { restringido, reglas }. El nombre de la persona viaja solo para mostrarlo
 * (también si ya no está activa); el servidor lo ignora.
 */
export const accesoDe = (item) => ({
  restringido: Boolean(item?.restringido),
  reglas: (item?.accesos || []).map(({ area, rol, usuarioId, usuario }) => ({
    area: area || null, rol: rol || null, usuarioId: usuarioId || null, ...(usuario?.nombre ? { nombre: usuario.nombre } : {}),
  })),
});

/** ¿La regla alcanza a la persona? */
export const alcanza = (regla, usuario) => {
  if (regla.usuarioId) return regla.usuarioId === usuario.id;
  return (!regla.area || regla.area === usuario.area) && (!regla.rol || regla.rol === rolDe(usuario));
};

/**
 * Motivo por el que la persona ve un artículo (o null si no lo ve):
 * 'general' | 'autor' | 'equipo' | 'regla'.
 */
export const motivoArticulo = (acceso, usuario, autorId) => {
  if (esAdminGeneral(usuario)) return 'general';
  if (autorId && usuario.id === autorId) return 'autor';
  if (!acceso.restringido) return 'equipo';
  return acceso.reglas.some((r) => alcanza(r, usuario)) ? 'regla' : null;
};

/**
 * Motivo por el que la persona ve un archivo: primero tiene que ver su
 * artículo. 'general' | 'subio' | 'articulo' | 'regla' o null.
 */
export const motivoArchivo = (acceso, usuario, { accesoArticulo, autorId, subidoPorId }) => {
  if (esAdminGeneral(usuario)) return 'general';
  if (!motivoArticulo(accesoArticulo, usuario, autorId)) return null;
  if (subidoPorId && usuario.id === subidoPorId) return 'subio';
  if (!acceso.restringido) return 'articulo';
  return acceso.reglas.some((r) => alcanza(r, usuario)) ? 'regla' : null;
};

/** Clave estable de una regla (para quitar o comparar). */
export const claveRegla = (r) => `${r.usuarioId || ''}|${r.area || ''}|${r.rol || ''}`;
