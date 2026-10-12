// Devuelve una funcion para los textos de utils/textosReportes en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite
// variables: tr('clave', { n: 3 }) reemplaza {n}.
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosReportes } from '../utils/textosReportes';

export const useTextoReportes = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v)),
      textosReportes[language]?.[clave] ?? textosReportes.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoReportes;
