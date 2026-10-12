import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';

const esTactil = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Selector de varias opciones que se despliega al pulsarlo.
 *
 * Sustituye a las rejillas de botones donde todas las opciones estaban a la
 * vista: con cuatro areas y una docena de personas, el formulario se iba a tres
 * pantallas de alto. Aqui solo se ve el resumen de lo elegido.
 *
 * El panel se posiciona en `absolute` en vez de usar el Popover de Radix: este
 * componente vive dentro de la ventana modal, que es un Dialog de Radix, y un
 * portal hermano se queda sin recibir clics. El selector de fecha de esta misma
 * pantalla ya resolvia asi lo mismo.
 *
 * Mientras esta abierto marca su raiz con `data-desplegable-abierto="true"`:
 * `Modal` lo mira para que un Escape cierre solo el desplegable y no la ventana.
 */
const SelectorMultiple = ({
  opciones,
  seleccionados,
  onToggle,
  placeholder,
  conBuscador = false,
  disabled = false,
  vacioTexto,
}) => {
  const { t } = usePreferences();
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedor = useRef(null);
  const boton = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsarFuera = (evento) => {
      if (contenedor.current && !contenedor.current.contains(evento.target)) setAbierto(false);
    };
    const alPulsarEscape = (evento) => {
      if (evento.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus(); // el foco vuelve al boton, no se pierde en el panel cerrado
    };

    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alPulsarEscape);
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alPulsarEscape);
    };
  }, [abierto]);

  const elegidas = opciones.filter((o) => seleccionados.includes(o.valor));

  // Como mucho dos nombres y un contador: con mas, el boton crece tanto como la
  // rejilla que vino a sustituir.
  const resumen = elegidas.length === 0
    ? placeholder
    : elegidas.length <= 2
      ? elegidas.map((o) => o.etiqueta).join(', ')
      : `${elegidas[0].etiqueta}, ${elegidas[1].etiqueta} +${elegidas.length - 2}`;

  const termino = busqueda.trim().toLowerCase();
  const visibles = opciones.filter((o) => !termino || String(o.etiqueta).toLowerCase().includes(termino));

  // Se conserva el orden en que llegaron los grupos, no el alfabetico
  const grupos = [];
  visibles.forEach((o) => {
    const clave = o.grupo || '';
    if (!grupos.some((g) => g.clave === clave)) grupos.push({ clave, opciones: [] });
    grupos.find((g) => g.clave === clave).opciones.push(o);
  });

  return (
    <div className="relative" ref={contenedor} data-desplegable-abierto={abierto ? 'true' : undefined}>
      <button
        ref={boton}
        type="button"
        disabled={disabled}
        aria-expanded={abierto}
        aria-haspopup="listbox"
        onClick={() => setAbierto((v) => !v)}
        className="flex min-h-[2.5rem] w-full items-center justify-between gap-3 rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-muted)_30%,var(--color-border))] bg-[var(--color-surface)] px-3 py-1.5 text-left text-sm outline-none transition-colors hover:border-[color:color-mix(in_srgb,var(--color-text-muted)_55%,var(--color-border))] focus-visible:border-[var(--color-primary)] focus-visible:shadow-[0_0_0_3px_var(--color-primary-20)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${elegidas.length ? 'font-medium text-[var(--color-text)]' : 'font-normal text-[var(--color-text-muted)]'}`}>
          {resumen}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {elegidas.length > 0 && (
            <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-px text-[11px] font-semibold tabular-nums text-[var(--color-on-primary)]">
              {elegidas.length}
            </span>
          )}
          <ChevronDown size={16} className={`text-[var(--color-text-muted)] transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>

      {abierto && (
        <div
          className="absolute left-0 right-0 z-[1200] mt-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
          style={{ boxShadow: 'var(--shadow-xl)' }}
        >
          {conBuscador && (
            <div className="relative border-b border-[var(--color-border-light)]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true">
                <Search size={15} />
              </span>
              <input
                type="search"
                // Con el dedo no: el teclado taparia la lista que se acaba de abrir
                autoFocus={!esTactil()}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm font-normal text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
            </div>
          )}

          <div className="max-h-[240px] overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
            {visibles.length === 0 && (
              <p className="px-3 py-6 text-center text-sm font-normal text-[var(--color-text-muted)]">
                {vacioTexto || t('searchNoResults')}
              </p>
            )}

            {grupos.map((grupo) => (
              <div key={grupo.clave}>
                {grupo.clave && (
                  <p className="px-3 pb-1 pt-2 text-xs font-normal text-[var(--color-text-muted)]">{grupo.clave}</p>
                )}
                {grupo.opciones.map((opcion) => {
                  const elegida = seleccionados.includes(opcion.valor);
                  return (
                    <button
                      key={opcion.valor}
                      type="button"
                      role="option"
                      aria-selected={elegida}
                      disabled={opcion.deshabilitada}
                      title={opcion.titulo}
                      onClick={() => onToggle(opcion.valor)}
                      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 [@media(pointer:coarse)]:py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${elegida ? 'bg-[var(--color-primary-10)]' : 'hover:bg-[var(--color-surface-3)]'}`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${elegida ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'border-[var(--color-text-muted)] bg-[var(--color-surface)]'}`}
                        aria-hidden="true"
                      >
                        {elegida && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-normal text-[var(--color-text)]">
                        {opcion.etiqueta}
                      </span>
                      {/* Aviso corto a la derecha, p. ej. que ya esta en otro proyecto */}
                      {opcion.aviso && (
                        <span className="badge-warning shrink-0">
                          {opcion.aviso}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectorMultiple;
