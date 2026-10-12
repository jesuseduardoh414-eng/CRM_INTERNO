import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';

/**
 * Base comun para todas las ventanas emergentes del CRM.
 *
 * Resuelve de una sola vez:
 *  - El scroll queda DENTRO de la tarjeta (antes se desplazaba la tarjeta completa
 *    y la barra se salia por la esquina redondeada).
 *  - Encabezado y pie fijos: no se van con el scroll.
 *  - Cierra con Esc y haciendo clic fuera (lo trae Radix).
 *  - Bloquea el scroll del fondo y atrapa el foco mientras esta abierta.
 *
 * ⚠️ DOS DETALLES QUE NO HAY QUE CAMBIAR:
 *
 * 1. La tarjeta se centra con `inset-0 + m-auto`, NO con `translate`.
 *    Un `transform` en la tarjeta la convertiria en el contenedor de referencia
 *    de sus hijos `position: fixed` (el selector de hora de ModalEvento, el
 *    calendario de RangeDatePicker), y el `overflow-hidden` los recortaria.
 *
 * 2. Las animaciones son solo de opacidad (`fade`), sin `zoom` ni `slide`,
 *    por la misma razon: esas usan `transform`.
 *
 * En telefono (< sm) la ventana ocupa la pantalla entera: cabecera con la X
 * arriba, cuerpo con scroll y pie fijo abajo, respetando las zonas seguras del
 * iPhone. Se mide en `dvh` (100vh incluye la barra del navegador y el pie
 * quedaba fuera) y con el teclado abierto en Android el viewport se encoge
 * (interactive-widget en index.html), asi que el pie sigue a la vista.
 * `compacto` mantiene la tarjeta centrada tambien en telefono: para avisos
 * cortos (ConfirmDialog), donde una pantalla completa sobra.
 * El ancho y el alto propios (`maxWidth`, `height`) solo aplican desde sm.
 *
 * Teléfono en horizontal (844×390, 740×360): pasa de 640px de ancho, pero con
 * menos de 500px de alto una tarjeta al 90dvh dejaba ~150px de cuerpo entre
 * cabecera y pie. Por eso la tarjeta exige ancho >= 640 Y alto > 500; por
 * debajo sigue a pantalla completa (respetando el notch a los lados) y la
 * cabecera y el pie se aprietan. `compacto` sigue siendo tarjeta siempre.
 */
const Modal = ({
  open,
  onClose,
  title,
  subtitle,
  subHeader,      // fila fija bajo el titulo (p. ej. pestañas)
  headerExtra,
  footer,
  maxWidth = '760px',
  // Alto fijo opcional. Sin el, la tarjeta crece con su contenido; con el, se
  // queda quieta aunque el contenido cambie (p. ej. un formulario por pasos,
  // donde cada paso tiene distinto largo y la ventana daba saltos).
  height,
  bodyClassName = '',
  compacto = false,
  children,
}) => {
  const { t } = usePreferences();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(abierto) => { if (!abierto) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[1400] bg-slate-900/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />

        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Radix escucha Escape en el documento en fase de captura, o sea ANTES
          // que los desplegables propios (SelectorMultiple, FiltrosTareas...), que
          // lo escuchan en burbuja. Sin esto, un Escape para cerrar el desplegable
          // cerraba también la ventana entera. Los desplegables propios marcan su
          // raíz con `data-desplegable-abierto="true"` mientras están abiertos; si
          // el foco está dentro de uno, la ventana se queda. (Los Popover/Select de
          // Radix no lo necesitan: ya se apilan como capas y solo cierra la de arriba.)
          onEscapeKeyDown={(event) => {
            const origen = event.target;
            if (origen instanceof Element && origen.closest('[data-desplegable-abierto="true"]')) {
              event.preventDefault();
            }
          }}
          // Los avisos (toasts) viven fuera de la ventana: tocar "Deshacer" o su
          // X no debe contar como clic fuera y cerrarla.
          onInteractOutside={(event) => {
            const origen = event.target;
            if (origen instanceof Element && origen.closest('[data-toasts]')) event.preventDefault();
          }}
          style={{ '--modal-ancho': maxWidth, '--modal-alto': height }}
          className={`fixed inset-0 z-[1401] flex flex-col overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_60px_-20px_rgb(15_23_42_/_0.45)] focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 ${compacto
            ? `m-auto h-fit max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[var(--modal-ancho)] rounded-[14px] border sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] ${height ? 'sm:h-[var(--modal-alto)]' : 'sm:h-fit'}`
            : `h-dvh w-full pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] [@media(min-width:640px)_and_(min-height:501px)]:m-auto [@media(min-width:640px)_and_(min-height:501px)]:max-h-[90dvh] [@media(min-width:640px)_and_(min-height:501px)]:w-[calc(100%-2rem)] [@media(min-width:640px)_and_(min-height:501px)]:max-w-[var(--modal-ancho)] [@media(min-width:640px)_and_(min-height:501px)]:rounded-[14px] [@media(min-width:640px)_and_(min-height:501px)]:border [@media(min-width:640px)_and_(min-height:501px)]:px-0 ${height ? '[@media(min-width:640px)_and_(min-height:501px)]:h-[var(--modal-alto)]' : '[@media(min-width:640px)_and_(min-height:501px)]:h-fit'}`}`}
        >
          {/* Encabezado fijo */}
          <div className={`shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] ${compacto ? '' : 'pt-[env(safe-area-inset-top)] [@media(min-width:640px)_and_(min-height:501px)]:pt-0'}`}>
            <div className="flex items-start justify-between gap-3 px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4 [@media(max-height:500px)]:py-2.5">
              <div className="min-w-0">
                <DialogPrimitive.Title className="break-words text-[18px] font-semibold tracking-tight text-[var(--color-text)]">
                  {title}
                </DialogPrimitive.Title>
                {subtitle && (
                  <p className="mt-0.5 text-[13px] text-[var(--color-text-muted)]">{subtitle}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {headerExtra}
                <DialogPrimitive.Close
                  aria-label={t('close')}
                  title={t('close')}
                  // 36px (40px con el dedo): con p-1.5 quedaba en 30px
                  className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                >
                  <X size={18} />
                </DialogPrimitive.Close>
              </div>
            </div>

            {subHeader}
          </div>

          {/* Cuerpo: lo unico que se desplaza */}
          <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 [@media(max-height:500px)]:py-3 ${footer || compacto ? '' : 'pb-[max(1rem,env(safe-area-inset-bottom))]'} ${bodyClassName}`}>
            {children}
          </div>

          {/* Pie fijo (opcional) */}
          {footer && (
            <div className={`shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3 sm:px-6 sm:py-3.5 [@media(max-height:500px)]:py-2 ${compacto ? '' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`}>
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default Modal;
