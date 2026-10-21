// Piezas compartidas de la base de conocimiento: el tope de subida, las
// personas del CRM para elegir quién ve qué y el texto de cada regla de
// acceso ("Marketing · solo administradores").
import useSWR from 'swr';
import { usuariosService } from '../services/api';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoConocimiento } from './useTextoConocimiento';

/** Tope de subida en MB: el mismo de los adjuntos del CRM (panel de configuración). */
export const useLimiteArchivo = () => {
  const { config } = useConfiguracion();
  const mb = Number(config?.subidas?.adjuntosMaxMB) > 0 ? Number(config.subidas.adjuntosMaxMB) : 4;
  return { mb, bytes: mb * 1024 * 1024 };
};

/** Personas activas del CRM (las mismas que se eligen en un proyecto). */
export const usePersonas = () => {
  const { data } = useSWR('catalogo-personas', () => usuariosService.listarParaProyectos(), { revalidateOnFocus: false });
  return data?.usuarios || [];
};

/** Texto de una regla: "Marketing · toda el área", "Marketing · solo administradores", "Ana López"... */
export const useDescribirRegla = () => {
  const tc = useTextoConocimiento();
  const { nombreArea } = useConfiguracion();
  const personas = usePersonas();
  return (r) => {
    if (r.usuarioId) return r.nombre || personas.find((p) => p.id === r.usuarioId)?.nombre || tc('accPersonaDesconocida', { id: r.usuarioId });
    if (!r.area) return tc(r.rol === 'admin' ? 'accReglaAdminsTodas' : 'accReglaMiembrosTodas');
    if (!r.rol) return tc('accReglaArea', { area: nombreArea(r.area) });
    return tc(r.rol === 'admin' ? 'accReglaAdminsDe' : 'accReglaMiembrosDe', { area: nombreArea(r.area) });
  };
};
