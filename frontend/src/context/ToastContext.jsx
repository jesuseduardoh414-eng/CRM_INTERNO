// Sistema de Toasts globales
// Provee: showToast(message, type, { duration, action }) desde cualquier componente

import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { usePreferences } from './PreferencesContext';

const ToastContext = createContext(null);

// 5 segundos: con 3 no daba tiempo a leer un aviso de dos lineas ni a pulsar
// "Deshacer".
const DURACION_POR_DEFECTO = 5000;

// Colores del sistema de badges (index.css): se adaptan solos al modo oscuro.
const TIPOS = {
  success: { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', Icon: CheckCircle2 },
  error:   { bg: 'var(--badge-danger-bg)',  color: 'var(--badge-danger-fg)',  Icon: XCircle },
  info:    { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    Icon: Info },
};

export const ToastProvider = ({ children }) => {
  const { t } = usePreferences();
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /**
   * @param {string} message
   * @param {'success'|'error'|'info'} [type]
   * @param {number|{ duration?: number, action?: { label: string, onClick: () => void } }} [opciones]
   *   Un numero se toma como duracion (compatibilidad con las llamadas viejas).
   *   `action` pinta un boton dentro del aviso, p. ej. "Deshacer".
   */
  const showToast = useCallback((message, type = 'success', opciones) => {
    const { duration = DURACION_POR_DEFECTO, action = null } = typeof opciones === 'number'
      ? { duration: opciones }
      : (opciones || {});

    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type, action }]);
    if (duration > 0) {
      timersRef.current.set(id, setTimeout(() => dismissToast(id), duration));
    }
    return id;
  }, [dismissToast]);

  // Memorizado: antes el valor era un objeto nuevo en cada render del
  // proveedor, y cada aviso volvia a renderizar todas las pantallas (y perdia
  // lo que se estuviera escribiendo en un formulario).
  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Contenedor fijo de toasts. role="status" + aria-live para que un
          lector de pantalla anuncie el aviso sin robar el foco. */}
      <div
        role="status"
        aria-live="polite"
        data-toasts=""
        style={{
          // Con una ventana de Radix abierta el body queda con
          // pointer-events: none; los avisos deben seguir pulsables.
          pointerEvents: 'auto',
          // Zonas seguras: con viewport-fit=cover el aviso no queda bajo la
          // barra de inicio del iPhone ni bajo la muesca en horizontal.
          position: 'fixed',
          bottom: 'calc(1rem + env(safe-area-inset-bottom))',
          right: 'calc(1rem + env(safe-area-inset-right))',
          zIndex: 9999, display: 'flex', flexDirection: 'column',
          gap: '0.75rem', maxWidth: 'min(420px, calc(100vw - 2rem))',
        }}
      >
        {toasts.map((toast) => {
          const conf = TIPOS[toast.type] || TIPOS.info;
          const { Icon } = conf;
          return (
            <div
              key={toast.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.85rem 0.85rem 0.85rem 1.1rem',
                background: conf.bg,
                border: `1px solid color-mix(in srgb, ${conf.color} 25%, transparent)`,
                borderRadius: '1rem',
                color: conf.color,
                fontSize: '0.9rem', fontWeight: 500,
                boxShadow: 'var(--shadow-lg)',
                animation: 'toastIn 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                minWidth: 'min(280px, calc(100vw - 2rem))',
              }}
            >
              <span style={{
                width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                background: 'color-mix(in srgb, currentColor 14%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={15} strokeWidth={2.5} />
              </span>

              <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>

              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action.onClick?.();
                    dismissToast(toast.id);
                  }}
                  style={{
                    background: 'color-mix(in srgb, currentColor 12%, transparent)',
                    border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
                    color: 'inherit', cursor: 'pointer',
                    minHeight: '32px', padding: '0 0.75rem', borderRadius: '0.6rem',
                    fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap',
                  }}
                >
                  {toast.action.label}
                </button>
              )}

              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                // Sin tooltip a proposito: los avisos se cierran solos y una etiqueta
                // flotante encima estorbaria. Basta el nombre accesible.
                aria-label={t('close')}
                style={{
                  background: 'transparent', border: 'none', color: 'inherit',
                  cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, flexShrink: 0, opacity: 0.75,
                }}
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(20px) scale(0.95); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- el hook y el proveedor van juntos a proposito; Vite recarga el archivo completo y no hay otros componentes aqui
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
};
