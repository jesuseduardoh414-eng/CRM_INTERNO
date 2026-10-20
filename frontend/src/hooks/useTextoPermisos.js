// Devuelve una funcion para los textos de utils/textosPermisos en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite
// variables: tp('permAjustes', { n: 3 }) reemplaza {n}.
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosPermisos } from '../utils/textosPermisos';

export const useTextoPermisos = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars) => {
      const texto = textosPermisos[language]?.[clave] ?? textosPermisos.es[clave] ?? clave;
      return vars ? texto.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : texto;
    },
    [language],
  );
};

export default useTextoPermisos;
