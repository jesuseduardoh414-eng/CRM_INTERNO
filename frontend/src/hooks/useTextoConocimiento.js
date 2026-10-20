// Devuelve una funcion para los textos de utils/textosConocimiento en el
// idioma elegido (cae al español si falta la clave). Admite variables:
// tc('conEliminarConfirm', { titulo: 'Alta de clientes' }).
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosConocimiento } from '../utils/textosConocimiento';

export const useTextoConocimiento = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v ?? '')),
      textosConocimiento[language]?.[clave] ?? textosConocimiento.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoConocimiento;
