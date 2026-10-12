// Piezas compartidas por las pantallas del portal de clientes.
import { RefreshCcw } from 'lucide-react';
import { Button } from '../ui/button';
import '../../portal.css';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { getEstadoProyecto } from '../../utils/estadosProyecto';

/** Cabecera de página: título, subtítulo y acciones opcionales. */
export const CabeceraPortal = ({ titulo, subtitulo, children }) => (
  <header className="ptl-cabecera flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <h1 className="ptl-titulo">{titulo}</h1>
      {subtitulo && <p className="ptl-subtitulo">{subtitulo}</p>}
    </div>
    {children}
  </header>
);

export const PanelPortal = ({ titulo, accion, children, className = '' }) => (
  <section className={`ptl-panel ${className}`}>
    {titulo && (
      <header className="ptl-panel-cabecera">
        <h2 className="ptl-panel-titulo">{titulo}</h2>
        {accion}
      </header>
    )}
    {children}
  </section>
);

export const VacioPortal = ({ icono: Icono, texto, ayuda }) => (
  <div className="ptl-vacio">
    {Icono && <span className="ptl-vacio-icono" aria-hidden="true"><Icono size={20} /></span>}
    <p>{texto}</p>
    {ayuda && <small>{ayuda}</small>}
  </div>
);

export const ErrorPortal = ({ error, onReintentar }) => {
  const tp = useTextoPortal();
  return (
    <div className="ptl-panel flex flex-col items-center gap-3 p-10 text-center">
      <p className="text-sm text-[var(--color-text-dim)]">{error?.message || tp('ptlErrorCarga')}</p>
      {onReintentar && (
        <Button variant="outline" onClick={onReintentar}><RefreshCcw size={15} /> {tp('ptlReintentar')}</Button>
      )}
    </div>
  );
};

export const BarraAvance = ({ valor, etiqueta }) => (
  <div className="ptl-avance">
    <div
      className="ptl-avance-barra"
      role="progressbar"
      aria-valuenow={valor}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={etiqueta}
    >
      <span style={{ width: `${valor}%` }} />
    </div>
    <span className="ptl-avance-cifra">{valor}%</span>
  </div>
);

export const AnilloAvance = ({ valor, etiqueta }) => {
  const radio = 48;
  const circ = 2 * Math.PI * radio;
  return (
    <div className="ptl-anillo" role="img" aria-label={`${etiqueta}: ${valor}%`}>
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
        <circle className="ptl-anillo-fondo" cx="56" cy="56" r={radio} fill="none" strokeWidth="9" />
        <circle
          className="ptl-anillo-valor"
          cx="56" cy="56" r={radio} fill="none" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - valor / 100)}
        />
      </svg>
      <div className="ptl-anillo-texto" aria-hidden="true">
        <strong>{valor}%</strong>
        <span>{etiqueta}</span>
      </div>
    </div>
  );
};

export const EstadoProyectoPortal = ({ estado }) => {
  const tp = useTextoPortal();
  const meta = getEstadoProyecto(estado);
  return (
    <span className="ptl-estado">
      <i style={{ background: meta.dot }} aria-hidden="true" />
      {tp(`ptlEstado${meta.value || estado}`)}
    </span>
  );
};

/** Bloque de calendario: mes arriba, día grande abajo. */
export const BloqueFecha = ({ valor, locale }) => {
  const fecha = new Date(valor);
  return (
    <span className="ptl-fecha" aria-hidden="true">
      <small>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(fecha).replace('.', '')}</small>
      <strong>{fecha.getDate()}</strong>
    </span>
  );
};
