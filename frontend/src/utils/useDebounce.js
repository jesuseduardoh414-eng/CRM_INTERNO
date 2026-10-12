import { useEffect, useState } from 'react';

/**
 * Retrasa un valor hasta que deja de cambiar durante `espera` ms.
 *
 * Se usa en los buscadores: sin esto, escribir "construccion" dispararia una
 * peticion por cada letra. Con el retardo, sale una sola cuando el usuario para.
 */
export const useDebounce = (valor, espera = 350) => {
  const [retrasado, setRetrasado] = useState(valor);

  useEffect(() => {
    const id = setTimeout(() => setRetrasado(valor), espera);
    return () => clearTimeout(id);
  }, [valor, espera]);

  return retrasado;
};

export default useDebounce;
