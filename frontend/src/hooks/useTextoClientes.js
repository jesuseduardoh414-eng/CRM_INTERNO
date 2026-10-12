// Devuelve una funcion para los textos de utils/textosClientes en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite variables:
// tc('cliEliminarConfirm', { nombre: 'Acme' }).
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosClientes } from '../utils/textosClientes';

export const useTextoClientes = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v ?? '')),
      textosClientes[language]?.[clave] ?? textosClientes.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoClientes;
