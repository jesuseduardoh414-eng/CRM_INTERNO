// Catálogos del directorio de clientes y proveedores. Los valores coinciden
// con los que valida backend/src/controllers/empresas.controller.js.

export const TIPOS_EMPRESA = ['CLIENTE', 'PROVEEDOR', 'AMBOS'];
export const ESTADOS_EMPRESA = ['ACTIVO', 'INACTIVO'];

/** ¿La empresa puede ir en un contrato/proyecto de ese tipo? AMBOS vale para los dos. */
export const empresaEsDeTipo = (empresa, tipo) => empresa?.tipo === tipo || empresa?.tipo === 'AMBOS';

/** Enlace a un sitio web aunque se haya guardado sin protocolo. */
export const urlSitio = (sitio) => (sitio && !/^https?:\/\//i.test(sitio) ? `https://${sitio}` : sitio);

/** Iniciales para el monograma de la ficha (máx. dos letras). */
export const inicialesEmpresa = (nombre = '') => nombre
  .replace(/\b(S\.?A\.?|de|C\.?V\.?|S\.?C\.?|S\.? de R\.?L\.?)\b/gi, '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((p) => p[0].toUpperCase())
  .join('') || '?';
