import { useCallback } from 'react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import { capitalizar, clavesItem, formatHora, formatHoraCorta, getDateKey, getTipoAgenda, sumarDias } from './agendaComun';

/**
 * Texto de la columna de hora de una fila: la hora, "Todo el día", o para
 * tareas y proyectos si ese día empiezan, terminan o siguen en curso.
 * Devuelve { texto, sub }: `sub` es la hora de fin, en una segunda línea.
 * Con `corta` la hora sale en 24 h sin ceros ("9:00"), para columnas estrechas.
 */
export const useEtiquetaHora = () => {
  const { t, locale } = usePreferences();
  const ta = useTextoAgenda();
  return useCallback((item, clave, corta = false) => {
    const tipo = getTipoAgenda(item);
    const { inicio, fin } = clavesItem(item);
    if (tipo === 'tarea') return { texto: clave === fin ? ta('pag_vence') : clave === inicio ? ta('pag_inicia') : ta('pag_enCurso') };
    if (tipo === 'proyecto') return { texto: clave === inicio ? ta('pag_inicia') : clave === fin ? ta('pag_termina') : ta('pag_enCurso') };
    if (item.todoElDia) return { texto: t('agendaAllDay') };
    if (clave && inicio !== clave) return { texto: ta('pag_enCurso') };
    return {
      texto: (corta ? formatHoraCorta : formatHora)(item.fechaInicio, locale),
      sub: item.fechaFin ? (corta ? formatHoraCorta : formatHora)(item.fechaFin, locale) : null,
    };
  }, [locale, t, ta]);
};

/** "Hoy" / "Mañana" / "Ayer" o el día de la semana. */
export const useNombreDia = () => {
  const { locale } = usePreferences();
  const ta = useTextoAgenda();
  return useCallback((fecha) => {
    const clave = getDateKey(fecha);
    const hoy = new Date();
    if (clave === getDateKey(hoy)) return ta('pag_hoy');
    if (clave === getDateKey(sumarDias(hoy, 1))) return ta('pag_manana');
    if (clave === getDateKey(sumarDias(hoy, -1))) return ta('pag_ayer');
    return capitalizar(fecha.toLocaleDateString(locale, { weekday: 'long' }));
  }, [locale, ta]);
};

export default useEtiquetaHora;
