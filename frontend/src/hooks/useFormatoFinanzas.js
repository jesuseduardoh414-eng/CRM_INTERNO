// Montos y fechas de Finanzas con el idioma del usuario.
import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { formatearFechaCorta, formatearMonto } from '../utils/finanzas';

export const useFormatoFinanzas = () => {
  const { locale } = usePreferences();
  const monto = useCallback((valor, moneda = 'MXN') => formatearMonto(valor ?? 0, moneda, locale) || '—', [locale]);
  const fecha = useCallback((texto) => formatearFechaCorta(texto, locale) || '—', [locale]);
  const fechaHora = useCallback((iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—'), [locale]);
  return { monto, fecha, fechaHora, locale };
};

export default useFormatoFinanzas;
