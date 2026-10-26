import { useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { es, enUS } from 'date-fns/locale';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** 'YYYY-MM-DD' -> Date al mediodia, para que ningun huso mueva el dia. */
const aFecha = (clave) => {
  if (!clave) return undefined;
  const [anio, mes, dia] = clave.split('-').map(Number);
  return new Date(anio, mes - 1, dia, 12, 0, 0, 0);
};

const aClave = (fecha) => {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Un solo calendario para elegir inicio y fin (a la vista o plegable).
 *
 * Antes eran dos selectores separados mas una lista aparte con la agenda de
 * cada responsable. Aqui la ocupacion se ve sobre el propio calendario: los
 * dias en que alguien ya tiene otro proyecto, tareas o reuniones salen en
 * ambar, pero se pueden elegir, porque cargarle mas trabajo es decision del
 * admin. Antes algunos salian tachados y no dejaban guardar.
 */
const SelectorRangoFechas = ({
  desde,
  hasta,
  onChange,
  // Map 'YYYY-MM-DD' -> lo que ocupa a alguien ese dia
  ocupadas,
  // La leyenda solo tiene sentido cuando se esta repartiendo trabajo; al usarlo
  // como filtro de busqueda no hay dias ocupados que explicar.
  conLeyenda = true,
  // Sin recuadro propio, para cuando ya vive dentro de otro panel con borde y
  // encajarlo tal cual daria una caja dentro de otra caja.
  sinMarco = false,
  // Arranca plegado y se abre al pulsarlo. Se usa donde el calendario es un
  // campo mas de un formulario largo (la ventana de tarea) y tenerlo siempre
  // desplegado alejaria demasiado el resto de campos. Con leyenda, esta va
  // dentro de la ventanita junto al calendario.
  plegable = false,
  // Para que un <label htmlFor> del formulario apunte al boton que abre el
  // calendario (solo aplica en modo plegable, que es donde hay boton).
  id,
}) => {
  const { t, language } = usePreferences();
  const [abierto, setAbierto] = useState(false);

  const rango = { from: aFecha(desde), to: aFecha(hasta) };

  const avisos = useMemo(
    () => [...(ocupadas || new Map()).keys()].map(aFecha).filter(Boolean),
    [ocupadas],
  );

  const alSeleccionar = (nuevo) => {
    onChange({
      desde: nuevo?.from ? aClave(nuevo.from) : '',
      // Un solo dia deja el fin vacio: el proyecto no tiene fecha de cierre aun
      hasta: nuevo?.to && nuevo.to !== nuevo.from ? aClave(nuevo.to) : '',
    });
  };

  const formatoCorto = { day: '2-digit', month: 'short' };
  const idioma = language === 'en' ? enUS : es;
  const resumen = rango.from
    ? rango.to
      ? `${rango.from.toLocaleDateString(language, formatoCorto)} – ${rango.to.toLocaleDateString(language, formatoCorto)}`
      : `${rango.from.toLocaleDateString(language, formatoCorto)} – ${t('projectDateNoEnd')}`
    : t('projectPickRange');

  const leyenda = conLeyenda && (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      <span className="flex items-center gap-1.5 text-xs font-normal text-[var(--color-text-muted)]">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent-warning)]" />
        {t('projectDayBusyProject')}
      </span>
    </div>
  );

  return (
    <div className={sinMarco || plegable ? '' : 'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-base)] p-3'}>
      {/* Plegable: el calendario sale en un Popover de shadcn, flotando sobre el
          resto en vez de empujarlo. Radix lo saca por un portal, asi que no lo
          recorta el desplazamiento del formulario que lo contiene. */}
      {plegable ? (
        <Popover open={abierto} onOpenChange={setAbierto}>
          <div className="flex items-center gap-2">
            <PopoverTrigger asChild>
              <button
                id={id}
                type="button"
                aria-expanded={abierto}
                className="flex min-h-[2.5rem] min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-muted)_30%,var(--color-border))] bg-[var(--color-surface)] px-3 py-1.5 text-left outline-none transition-colors hover:border-[color:color-mix(in_srgb,var(--color-text-muted)_55%,var(--color-border))] focus-visible:border-[var(--color-primary)] focus-visible:shadow-[0_0_0_3px_var(--color-primary-20)]"
              >
                <CalendarDays size={15} className="shrink-0 text-[var(--color-text-muted)]" />
                <span className={`flex-1 truncate text-sm ${rango.from ? 'font-medium text-[var(--color-text)]' : 'font-normal text-[var(--color-text-muted)]'}`}>
                  {resumen}
                </span>
                <ChevronDown size={15} className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${abierto ? 'rotate-180' : ''}`} />
              </button>
            </PopoverTrigger>

            {(desde || hasta) && (
              <button
                type="button"
                onClick={() => onChange({ desde: '', hasta: '' })}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
              >
                <X size={13} /> {t('clear')}
              </button>
            )}
          </div>

          <PopoverContent align="start" collisionPadding={8} className="z-[1500] w-auto max-w-[calc(100vw-1rem)] p-3">
            <DayPicker
              className="calendario-crm"
              mode="range"
              selected={rango}
              onSelect={alSeleccionar}
              locale={idioma}
              defaultMonth={rango.from}
              numberOfMonths={1}
              modifiers={{ ocupado: avisos }}
              modifiersClassNames={{ ocupado: 'rdp-ocupado' }}
            />
            {leyenda}
          </PopoverContent>
        </Popover>
      ) : (
      <>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className={`text-sm ${rango.from ? 'font-medium text-[var(--color-text)]' : 'font-normal text-[var(--color-text-muted)]'}`}>
          {resumen}
        </span>
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => onChange({ desde: '', hasta: '' })}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
          >
            <X size={13} /> {t('clear')}
          </button>
        )}
      </div>

      <div className={`flex justify-center py-2 ${sinMarco ? '' : 'rounded-md bg-[var(--color-surface)]'}`}>
        <DayPicker
          // Clase propia para que los estilos del CRM ganen a los de la
          // libreria: su hoja se carga despues que index.css y, a igualdad de
          // especificidad, mandaba la ultima.
          className="calendario-crm"
          mode="range"
          selected={rango}
          onSelect={alSeleccionar}
          locale={idioma}
          // Abre en el mes del inicio elegido; sin fechas, en el mes actual
          defaultMonth={rango.from}
          numberOfMonths={1}
          modifiers={{ ocupado: avisos }}
          modifiersClassNames={{ ocupado: 'rdp-ocupado' }}
        />
      </div>

      {leyenda}
      </>
      )}
    </div>
  );
};

export default SelectorRangoFechas;
