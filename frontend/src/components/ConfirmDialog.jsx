import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { usePreferences } from '../context/PreferencesContext';

/**
 * Ventana de confirmacion sobre el `Modal` del sistema.
 *
 * Sustituye a `window.confirm`: ese dialogo del navegador no respeta el tema,
 * no se puede traducir el titulo de los botones y en algunos navegadores se
 * bloquea tras un par de usos.
 *
 *   <ConfirmDialog
 *     open={abierto}
 *     titulo={t('taskDeleteConfirm')}
 *     descripcion={tarea.titulo}
 *     textoConfirmar={t('delete')}
 *     peligro
 *     onConfirmar={borrar}
 *     onCancelar={() => setAbierto(false)}
 *   />
 *
 * `onConfirmar` puede ser asincrono: mientras resuelve, los botones se bloquean.
 */
const ConfirmDialog = ({
  open,
  titulo,
  descripcion,
  textoConfirmar,
  textoCancelar,
  peligro = false,
  onConfirmar,
  onCancelar,
}) => {
  const { t } = usePreferences();
  const [procesando, setProcesando] = useState(false);

  const confirmar = async () => {
    setProcesando(true);
    try {
      await onConfirmar?.();
    } finally {
      setProcesando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!procesando) onCancelar?.(); }}
      maxWidth="440px"
      compacto
      title={(
        <span className="flex items-center gap-3">
          {peligro && (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-fg)' }}
            >
              <AlertTriangle size={20} />
            </span>
          )}
          <span className="text-lg">{titulo || t('confirm')}</span>
        </span>
      )}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancelar}
            disabled={procesando}
            // En acciones destructivas el foco inicial va en Cancelar: un Enter
            // accidental al abrir el dialogo no debe borrar nada.
            autoFocus={peligro}
            className="rounded-xl px-5 py-3 text-sm font-medium text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {textoCancelar || t('cancel')}
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={procesando}
            autoFocus={!peligro}
            className="rounded-xl px-5 py-3 text-sm font-medium transition-all disabled:opacity-50"
            style={peligro
              ? { background: 'var(--color-error)', color: 'var(--color-on-primary)' }
              : { background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
          >
            {procesando ? t('saving') : (textoConfirmar || t('confirm'))}
          </button>
        </div>
      )}
    >
      {descripcion && (
        <p className="break-words text-sm leading-relaxed text-[var(--color-text-dim)]">{descripcion}</p>
      )}
    </Modal>
  );
};

/**
 * Atajo para pedir una confirmacion desde un manejador y esperar la respuesta:
 *
 *   const { confirmar, dialogo } = useConfirmacion();
 *   const borrar = async () => {
 *     const ok = await confirmar({ titulo: '...', peligro: true });
 *     if (!ok) return;
 *     ...
 *   };
 *   return (<>{...}{dialogo}</>);
 */
// eslint-disable-next-line react-refresh/only-export-components -- el hook vive junto al dialogo que renderiza; separarlo obligaria a importar dos archivos para una sola cosa
export const useConfirmacion = () => {
  const [pendiente, setPendiente] = useState(null);

  const confirmar = useCallback((opciones = {}) => new Promise((resolve) => {
    // Si ya habia una confirmacion abierta, se resuelve como "cancelada" para
    // que su `await` no quede colgado (doble clic rapido en dos "Eliminar").
    setPendiente((previa) => {
      previa?.resolve(false);
      return { ...opciones, resolve };
    });
  }), []);

  const cerrar = (resultado) => {
    pendiente?.resolve(resultado);
    setPendiente(null);
  };

  const dialogo = (
    <ConfirmDialog
      open={Boolean(pendiente)}
      titulo={pendiente?.titulo}
      descripcion={pendiente?.descripcion}
      textoConfirmar={pendiente?.textoConfirmar}
      textoCancelar={pendiente?.textoCancelar}
      peligro={Boolean(pendiente?.peligro)}
      onConfirmar={() => cerrar(true)}
      onCancelar={() => cerrar(false)}
    />
  );

  return { confirmar, dialogo };
};

export default ConfirmDialog;
