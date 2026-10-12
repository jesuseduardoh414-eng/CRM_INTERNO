// Devuelve una funcion para los textos de utils/textosPermisos en el idioma
// elegido por el usuario (cae al español si falta la clave).
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosPermisos } from '../utils/textosPermisos';

export const useTextoPermisos = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave) => textosPermisos[language]?.[clave] ?? textosPermisos.es[clave] ?? clave,
    [language],
  );
};

export default useTextoPermisos;
