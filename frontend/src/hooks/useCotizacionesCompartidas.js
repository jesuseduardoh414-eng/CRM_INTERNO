// ¿Ve alguna cotización quien no tiene el permiso de ver cotizaciones? Pasa
// cuando se la compartieron (una restringida con su área, su rol o su
// nombre) o cuando la registró. Lo usan el menú y la página de Cotizaciones.
// Devuelve true/false, o null mientras pregunta.
import useSWR from 'swr';
import { finanzasService } from '../services/api';
import { OPCIONES_SWR_FINANZAS } from '../utils/finanzas';

export const useCotizacionesCompartidas = (preguntar) => {
  const { data, error } = useSWR(
    preguntar ? 'finanzas-cotizaciones-compartidas' : null,
    () => finanzasService.cotizaciones.compartidas(),
    { ...OPCIONES_SWR_FINANZAS, revalidateOnFocus: false },
  );
  if (!preguntar || error) return false;
  return data ? data.total > 0 : null;
};

export default useCotizacionesCompartidas;
