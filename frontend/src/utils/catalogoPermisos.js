// Ayudas para pintar el catálogo de permisos que manda el servidor
// (GET /configuracion → catalogoPermisos; GET /usuarios/:id/permisos →
// catalogo): [{ seccion, permisos: [{ clave, tipo, opciones? }] }].
// Lo usan la tabla por área del panel y los ajustes por persona en Usuarios.

/**
 * Secciones con sus casillas agrupadas por recurso (la clave sin la acción):
 * en Finanzas cada recurso es un subgrupo (Ventas, Gastos · Nómina...); en el
 * resto el recurso es la propia sección y no lleva subtítulo.
 */
export const agruparCatalogo = (catalogo = []) => catalogo.map(({ seccion, permisos }) => {
  const grupos = [];
  permisos.forEach((permiso) => {
    const partes = permiso.clave.split('.');
    const recurso = partes.slice(0, -1).join('.');
    let grupo = grupos[grupos.length - 1];
    if (!grupo || grupo.recurso !== recurso) {
      grupo = { recurso, conTitulo: recurso !== seccion, permisos: [] };
      grupos.push(grupo);
    }
    grupo.permisos.push({ ...permiso, accion: partes[partes.length - 1] });
  });
  return { seccion, grupos };
});

const texto = (tp, clave) => {
  const valor = tp(clave);
  return valor === clave ? null : valor;
};

/** Nombre de la casilla: el propio o, en finanzas, el de la acción. */
export const etiquetaPermiso = (permiso, tp) => (
  texto(tp, `perm.${permiso.clave}`)
  || (permiso.clave.startsWith('finanzas.gastos.') && texto(tp, `acc.gastos.${permiso.accion}`))
  || texto(tp, `acc.${permiso.accion}`)
  || permiso.clave
);

export const ayudaPermiso = (permiso, tp) => texto(tp, `perm.${permiso.clave}.ayuda`);

/** Subtítulo del recurso (solo finanzas): "Ventas", "Gastos · Nómina"... */
export const etiquetaRecurso = (recurso, tp, tf) => {
  if (recurso.startsWith('finanzas.gastos.')) return `${tp('rec.finanzas.gastos')} · ${tf(`finCat${recurso.split('.')[2]}`)}`;
  return texto(tp, `rec.${recurso}`) || recurso;
};

/** Valor legible: Sí / No, o el nombre del alcance. */
export const textoValor = (permiso, valor, tp) => (
  permiso.tipo === 'bool' ? tp(valor ? 'si' : 'no') : tp(`alc.${valor}`)
);

/** Opciones de un desplegable para la casilla. */
export const opcionesPermiso = (permiso, tp) => (
  permiso.tipo === 'bool'
    ? [{ valor: 'true', etiqueta: tp('si') }, { valor: 'false', etiqueta: tp('no') }]
    : permiso.opciones.map((o) => ({ valor: o, etiqueta: tp(`alc.${o}`) }))
);

/** Para buscar sin importar mayúsculas ni acentos. */
export const normalizarBusqueda = (valor) => String(valor || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();
