// Devuelve una funcion para los textos de utils/textosFinanzas en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite variables:
// tf('finPagoCreado', { folio: 'PAG-2026-0001' }).
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosFinanzas } from '../utils/textosFinanzas';

export const useTextoFinanzas = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v ?? '')),
      textosFinanzas[language]?.[clave] ?? textosFinanzas.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoFinanzas;
