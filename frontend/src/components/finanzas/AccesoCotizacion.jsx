// Quién ve una cotización: el selector de la base de conocimiento
// (components/conocimiento/SelectorAcceso.jsx) con los textos y la regla de
// las cotizaciones. Sin restringir la ven quienes tienen el permiso de ver
// cotizaciones; restringida, solo quienes se elijan, tengan o no ese permiso
// (en el servidor: accesoCotizaciones en utils/finanzas.utils.js). Siempre la
// ven el administrador general y quien la registró. Cambiarlo es el permiso
// finanzas.cotizaciones.acceso.
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { finanzasService } from '../../services/api';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import SelectorAcceso, { ResumenAcceso } from '../conocimiento/SelectorAcceso';
import ModalAcceso from '../conocimiento/ModalAcceso';
import { alcanza } from '../../utils/accesoConocimiento';
import { esAdminGeneral } from '../../utils/permisos';
import { OPCIONES_SWR_FINANZAS } from '../../utils/finanzas';

// Textos del selector que cambian en cotizaciones (los demás son los de la base).
const TEXTOS = {
  accQuienVe: 'finCotAccQuienVe',
  accTodoEquipo: 'finCotAccTodos',
  accTodoEquipoAyuda: 'finCotAccTodosAyuda',
  accSoloElegidosAyuda: 'finCotAccSoloElegidosAyuda',
  accLoVenTodos: 'finCotAccLoVenTodos',
  accLoVeran: 'finCotAccLoVeran',
  accLoVeranUno: 'finCotAccLoVeranUno',
  accMotivoAutor: 'finCotAccMotivoAutor',
  accMotivoEquipo: 'finCotAccMotivoEquipo',
  accTuFuera: 'finCotAccTuFuera',
  accNadieMas: 'finCotAccNadieMas',
  accPrevisionNota: 'finCotAccPrevisionNota',
};

/**
 * Motivo por el que la persona ve la cotización: 'general' | 'autor' |
 * 'equipo' (tiene el permiso de ver cotizaciones) | 'regla', o null.
 * conPermiso: Set con los ids de quienes tienen ese permiso.
 */
const motivoCotizacion = (acceso, usuario, { creadorId, conPermiso }) => {
  if (esAdminGeneral(usuario)) return 'general';
  if (creadorId && usuario.id === creadorId) return 'autor';
  if (!acceso.restringido) return conPermiso.has(usuario.id) ? 'equipo' : null;
  return acceso.reglas.some((r) => alcanza(r, usuario)) ? 'regla' : null;
};

const useTextosAcceso = () => {
  const tf = useTextoFinanzas();
  return useCallback((clave, vars) => (TEXTOS[clave] ? tf(TEXTOS[clave], vars) : undefined), [tf]);
};

/** Textos y regla para el selector; creadorId: quien la registró (o la registrará). */
const useAccesoCotizacion = (creadorId) => {
  const textos = useTextosAcceso();
  // Quiénes la ven sin restringir (solo lo pide quien gestiona el acceso).
  const { data } = useSWR('finanzas-cotizaciones-con-permiso', () => finanzasService.cotizaciones.conPermiso(), OPCIONES_SWR_FINANZAS);
  const conPermiso = useMemo(() => new Set(data?.ids || []), [data]);
  const motivo = useCallback((valor, u) => motivoCotizacion(valor, u, { creadorId, conPermiso }), [creadorId, conPermiso]);
  return { textos, motivo };
};

/**
 * Resumen de solo lectura: "Todos los que ven cotizaciones" o las reglas, y
 * cuántas personas la ven con la lista de quiénes y por qué.
 */
export const ResumenAccesoCotizacion = ({ acceso, creadorId }) => {
  const props = useAccesoCotizacion(creadorId);
  return <ResumenAcceso acceso={acceso} {...props} />;
};

/** Props de SelectorAcceso (valor, onCambio...) más creadorId. */
export const SelectorAccesoCotizacion = ({ creadorId, ...props }) => {
  const acceso = useAccesoCotizacion(creadorId);
  return <SelectorAcceso {...props} {...acceso} />;
};

const ContenidoModal = ({ creadorId, ...props }) => {
  const acceso = useAccesoCotizacion(creadorId);
  return <ModalAcceso abierto {...props} {...acceso} />;
};

/** Props de ModalAcceso (abierto, titulo, inicial, onCerrar, onGuardar) más creadorId. */
export const ModalAccesoCotizacion = ({ abierto, ...props }) => (abierto ? <ContenidoModal {...props} /> : null);
