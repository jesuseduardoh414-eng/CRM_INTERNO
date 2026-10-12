// Devuelve una funcion para los textos de utils/textosAgenda en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite
// variables: ta('clave', { n: 3 }) reemplaza {n}.
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosAgenda } from '../utils/textosAgenda';

export const useTextoAgenda = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v)),
      textosAgenda[language]?.[clave] ?? textosAgenda.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoAgenda;
