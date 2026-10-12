// Devuelve una funcion para los textos de utils/textosProyectos en el idioma
// elegido por el usuario (cae al español si falta la clave). Admite
// variables: tp('clave', { n: 3 }) reemplaza {n}.
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { textosProyectos } from '../utils/textosProyectos';

export const useTextoProyectos = () => {
  const { language } = usePreferences();
  return useCallback(
    (clave, vars = {}) => Object.entries(vars).reduce(
      (texto, [k, v]) => texto.replaceAll(`{${k}}`, String(v)),
      textosProyectos[language]?.[clave] ?? textosProyectos.es[clave] ?? clave,
    ),
    [language],
  );
};

export default useTextoProyectos;
