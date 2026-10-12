// Devuelve una función para los textos de utils/textosPortal en el idioma
// elegido (cae al español si falta la clave). Admite variables:
// tp('ptlHola', { nombre: 'Ana' }).
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosPortal } from '../utils/textosPortal';

export const useTextoPortal = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v ?? '')),
      textosPortal[language]?.[clave] ?? textosPortal.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoPortal;
