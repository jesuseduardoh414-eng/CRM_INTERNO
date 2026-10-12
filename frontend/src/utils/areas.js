// Áreas de la empresa. Las define el configurador en el panel
// (configuracion.reglas.areas: [{ clave, nombre, color }]). Las cuatro de
// fábrica pueden ir sin nombre: entonces se usa su traducción.

export const AREA_GENERAL = 'ADMINISTRACION';

export const AREAS_FABRICA = [
  { clave: 'DESARROLLO', nombre: null, color: '#2563eb' },
  { clave: 'ADMINISTRACION', nombre: null, color: '#f59e0b' },
  { clave: 'COMUNICACION', nombre: null, color: '#8b5cf6' },
  { clave: 'MARKETING', nombre: null, color: '#db2777' },
];

// Clave de traducción del nombre de fábrica.
export const CLAVE_TRADUCCION_AREA = {
  DESARROLLO: 'areaDesarrollo',
  ADMINISTRACION: 'areaAdministracion',
  COMUNICACION: 'areaComunicacion',
  MARKETING: 'areaMarketing',
};

/** "ATENCION_A_CLIENTES" -> "Atencion a clientes" (último recurso si no hay nombre). */
export const nombreDesdeClave = (clave) => {
  const texto = String(clave || '').replace(/_/g, ' ').toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Fondo suave del color del área (chips, tarjetas). */
export const fondoArea = (color, opacidad = 0.08) => {
  const hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#64748b';
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacidad})`;
};

/** "DESARROLLO,MARKETING" -> ['DESARROLLO', 'MARKETING'] */
export const areasDeTexto = (valor) => String(valor || '').split(',').map((a) => a.trim()).filter(Boolean);
