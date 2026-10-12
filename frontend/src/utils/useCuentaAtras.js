import { useCallback, useEffect, useState } from 'react';

/**
 * Cuenta atrás en segundos para botones de "reenviar". `iniciar(n)` la
 * arranca; `restante` llega a 0 cuando se puede volver a pulsar.
 */
const useCuentaAtras = (inicial = 0) => {
  const [restante, setRestante] = useState(inicial);

  useEffect(() => {
    if (restante <= 0) return undefined;
    const id = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [restante]);

  const iniciar = useCallback((segundos) => setRestante(segundos), []);
  return { restante, iniciar };
};

export default useCuentaAtras;
