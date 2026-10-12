import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, SlidersHorizontal, X } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import SelectorRangoFechas from './SelectorRangoFechas';
import CampoFiltro from './CampoFiltro';
import SelectorSimple from './SelectorSimple';
import { PRIORIDADES_TAREA } from '../utils/estadosTarea';
import { claveDiaLocal, fechaDesdeClave } from '../utils/fechasLocales';

/** Date -> 'YYYY-MM-DD' en hora local, para no cruzar husos. */
const aClave = (fecha) => (fecha ? claveDiaLocal(fecha) : '');

/** 'YYYY-MM-DD' -> Date a mediodia local. */
const aFecha = (clave) => fechaDesdeClave(clave);

/**
 * Los tres filtros de tareas detras de un solo boton.
 *
 * Antes vivian en un contenedor fijo que ocupaba una franja completa de la
 * pantalla aunque no se estuvieran usando. El boton lleva un contador con
 * cuantos filtros hay puestos, para que no se olvide uno activo.
 *
 * El calendario va dentro del panel, no en una ventana aparte: abrir una
 * ventana modal para elegir una fecha de filtro era demasiado.
 *
 * En telefono (< sm) el panel sale como hoja desde abajo, a todo el ancho y con
 * su propio scroll: anclado al boton (290px hacia la izquierda) se salia de la
 * pantalla cuando la barra envolvia el boton al principio de una fila, y el
 * calendario, que en escritorio sale a la izquierda del panel, quedaba fuera.
 * Ahi el calendario se despliega dentro del panel.
 */
const FiltrosTareas = ({
  fecha,
  onFechaChange,
  prioridad,
  onPrioridadChange,
  // Por defecto, el catalogo compartido (utils/estadosTarea)
  prioridades = PRIORIDADES_TAREA,
  responsable,
  onResponsableChange,
  responsables,
}) => {
  const { t, language } = usePreferences();
  const [abierto, setAbierto] = useState(false);
  // El calendario arranca plegado, salvo que ya haya una fecha filtrando
  const [fechaAbierta, setFechaAbierta] = useState(Boolean(fecha?.from || fecha?.to));
  const contenedor = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsarFuera = (evento) => {
      // La lista de los desplegables se pinta en un portal fuera del panel:
      // elegir una opcion no cuenta como pulsar fuera.
      if (evento.target.closest?.('[data-radix-popper-content-wrapper]')) return;
      if (contenedor.current && !contenedor.current.contains(evento.target)) setAbierto(false);
    };
    // Con un desplegable abierto, Escape solo cierra ese desplegable
    const alPulsarEscape = (evento) => {
      if (evento.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper]')) return;
      setAbierto(false);
    };

    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alPulsarEscape);
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alPulsarEscape);
    };
  }, [abierto]);

  const activos = [
    Boolean(fecha?.from || fecha?.to),
    prioridad !== 'todas',
    responsable !== 'todos',
  ].filter(Boolean).length;

  const limpiar = () => {
    onFechaChange({ from: null, to: null });
    onPrioridadChange('todas');
    onResponsableChange('todos');
  };

  const formatoCorto = { day: '2-digit', month: 'short' };
  const resumenFecha = fecha?.from
    ? fecha.to
      ? `${fecha.from.toLocaleDateString(language, formatoCorto)} – ${fecha.to.toLocaleDateString(language, formatoCorto)}`
      : fecha.from.toLocaleDateString(language, formatoCorto)
    : t('projectAnyDate');

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        // Mismo alto y borde que la busqueda y "Seleccionar" (clase det-control)
        className="det-control det-boton"
        data-activo={activos > 0 || undefined}
      >
        <SlidersHorizontal size={15} />
        {t('projectTaskFilters')}
        {activos > 0 && (
          <span className="min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px]" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{activos}</span>
        )}
      </button>

      {/* Velo solo en telefono (o en horizontal, con menos de 500px de alto:
          ahi el panel desplegable y su calendario no caben), detras de la
          hoja inferior: tocarlo la cierra */}
      {abierto && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[1199] bg-slate-900/40 [@media(min-width:640px)_and_(min-height:501px)]:hidden"
          onClick={() => setAbierto(false)}
        />
      )}

      {abierto && (
        <div className="det-filtros fixed inset-x-0 bottom-0 z-[1200] max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_16px_40px_-16px_rgb(15_23_42_/_0.35)] [@media(min-width:640px)_and_(min-height:501px)]:absolute [@media(min-width:640px)_and_(min-height:501px)]:inset-x-auto [@media(min-width:640px)_and_(min-height:501px)]:bottom-auto [@media(min-width:640px)_and_(min-height:501px)]:right-0 [@media(min-width:640px)_and_(min-height:501px)]:mt-1.5 [@media(min-width:640px)_and_(min-height:501px)]:max-h-none [@media(min-width:640px)_and_(min-height:501px)]:w-[290px] [@media(min-width:640px)_and_(min-height:501px)]:overflow-visible [@media(min-width:640px)_and_(min-height:501px)]:rounded-[10px] [@media(min-width:640px)_and_(min-height:501px)]:p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-[var(--color-text)]">{t('projectTaskFilters')}</span>
            <div className="flex items-center gap-1">
              {activos > 0 && (
                <button
                  type="button"
                  onClick={limpiar}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] [@media(pointer:coarse)]:py-2.5"
                >
                  <X size={13} /> {t('clear')}
                </button>
              )}
              {/* Cerrar, solo en la hoja del telefono (en escritorio basta con pulsar fuera) */}
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label={t('close')}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] [@media(min-width:640px)_and_(min-height:501px)]:hidden"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Los dos desplegables van primero por ser los de uso diario. La
              fecha queda al final y plegada: el calendario mide mas que los
              otros dos filtros juntos y dejaba el panel larguisimo. */}
          <div className="space-y-3">
            <CampoFiltro label={t('projectPriority')} htmlFor="filtro-tareas-prioridad">
              <SelectorSimple
                id="filtro-tareas-prioridad"
                className="campo-select-compacto"
                valor={prioridad}
                onCambio={onPrioridadChange}
                opciones={[
                  { valor: 'todas', etiqueta: t('projectAllPriorities') },
                  ...prioridades.map((p) => ({ valor: p.value, etiqueta: t(p.labelKey) })),
                ]}
              />
            </CampoFiltro>

            <CampoFiltro label={t('projectResponsible')} htmlFor="filtro-tareas-responsable">
              <SelectorSimple
                id="filtro-tareas-responsable"
                className="campo-select-compacto"
                valor={responsable}
                onCambio={onResponsableChange}
                opciones={[
                  { valor: 'todos', etiqueta: t('projectAllResponsibles') },
                  { valor: 'sin_asignar', etiqueta: t('projectUnassigned') },
                  ...responsables.map((r) => ({ valor: String(r.id), etiqueta: r.nombre })),
                ]}
              />
            </CampoFiltro>

            {/* El calendario no crece dentro del panel sino que sale a su
                izquierda, apoyado en el borde de abajo. Desplegandolo hacia
                abajo el panel se salia de la pantalla, porque el boton de
                filtros vive en la parte alta de la pagina. */}
            <div className="relative border-t border-[var(--color-border)] pt-3">
              <button
                type="button"
                onClick={() => setFechaAbierta((v) => !v)}
                aria-expanded={fechaAbierta}
                className="flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left [@media(pointer:coarse)]:py-2.5"
              >
                <span className="text-[13px] font-medium text-[var(--color-text-dim)]">{t('projectDate')}</span>
                <span className="flex items-center gap-1.5 text-[13px] font-normal text-[var(--color-text-muted)]">
                  {resumenFecha}
                  <ChevronLeft size={15} className={`transition-transform ${fechaAbierta ? '-rotate-180' : ''}`} />
                </span>
              </button>

              {fechaAbierta && (
                <div className="mt-3 [@media(min-width:640px)_and_(min-height:501px)]:absolute [@media(min-width:640px)_and_(min-height:501px)]:bottom-0 [@media(min-width:640px)_and_(min-height:501px)]:right-full [@media(min-width:640px)_and_(min-height:501px)]:mr-3 [@media(min-width:640px)_and_(min-height:501px)]:mt-0 [@media(min-width:640px)_and_(min-height:501px)]:w-[330px] [@media(min-width:640px)_and_(min-height:501px)]:rounded-[10px] [@media(min-width:640px)_and_(min-height:501px)]:border [@media(min-width:640px)_and_(min-height:501px)]:border-[var(--color-border)] [@media(min-width:640px)_and_(min-height:501px)]:bg-[var(--color-surface)] [@media(min-width:640px)_and_(min-height:501px)]:p-3 [@media(min-width:640px)_and_(min-height:501px)]:shadow-[0_16px_40px_-16px_rgb(15_23_42_/_0.35)]">
                  <SelectorRangoFechas
                    sinMarco
                    conLeyenda={false}
                    desde={aClave(fecha?.from)}
                    hasta={aClave(fecha?.to)}
                    onChange={({ desde, hasta }) => onFechaChange({ from: aFecha(desde), to: aFecha(hasta) })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltrosTareas;
