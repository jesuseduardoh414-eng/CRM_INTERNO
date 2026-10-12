import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { getEstadoTarea } from '../utils/estadosTarea';

/**
 * Envuelve el `cambiarEstado` de useMisTareas con un aviso que permite
 * deshacer, igual que en el resto del CRM.
 */
export const useCambioConAviso = (cambiarEstado) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  return async (tarea, estado) => {
    const anterior = tarea.estado;
    try {
      await cambiarEstado(tarea, estado);
      showToast(t('miStatusChanged', { estado: t(getEstadoTarea(estado).labelKey) }), 'success', {
        action: { label: t('undo'), onClick: () => cambiarEstado({ ...tarea, estado }, anterior).catch(() => {}) },
      });
    } catch (error) {
      showToast(error.message, 'error');
    }
  };
};
