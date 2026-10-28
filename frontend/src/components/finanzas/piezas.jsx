// Piezas compartidas por las pantallas de Finanzas (Ventas, Tesorería y
// Gastos): secciones y campos de formulario, cifras de cabecera, paneles y
// estados vacíos. El formato de montos y fechas está en
// hooks/useFormatoFinanzas.js.
import { Link } from 'react-router-dom';
import { CornerDownRight, Inbox, RefreshCcw } from 'lucide-react';
import { Button } from '../ui/button';

export const Seccion = ({ titulo, children, columnas = 2 }) => (
  <fieldset className="mb-6 last:mb-0">
    {titulo && <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{titulo}</legend>}
    <div className={`grid grid-cols-1 gap-x-4 ${columnas === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
  </fieldset>
);

export const Campo = ({ id, label, requerido, ancho = false, ayuda, children }) => (
  <div className={`form-group ${ancho ? 'sm:col-span-2' : ''}`}>
    <label className="form-label" htmlFor={id}>{label}{requerido && <span className="text-[var(--color-error)]"> *</span>}</label>
    {children}
    {ayuda && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{ayuda}</p>}
  </div>
);

/** Aviso de error del formulario (mensaje y lista de detalles del servidor). */
export const AvisoError = ({ error, refError }) => {
  if (!error) return null;
  return (
    <div ref={refError} role="alert" className="alert-error mb-5 flex-col items-start">
      <span>{error.texto}</span>
      {error.detalles?.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm">{error.detalles.map((d) => <li key={d}>{d}</li>)}</ul>
      )}
    </div>
  );
};

/**
 * Cifras de cabecera (dl.cli-cifras). Cada cifra: { clave, etiqueta, valor,
 * alerta: 'warning' | 'error' | 'success', onClick, activo }.
 */
export const Cifras = ({ cifras, className = '' }) => (
  <dl className={`cli-cifras ${className}`}>
    {cifras.map(({ clave, etiqueta, valor, alerta, onClick, activo, sub }) => {
      const contenido = (
        <>
          <dd style={alerta ? { color: `var(--color-${alerta})` } : undefined}>{valor ?? '—'}</dd>
          <dt>{etiqueta}{sub && <span className="block text-[11px] font-normal normal-case tracking-normal text-[var(--color-text-muted)]">{sub}</span>}</dt>
        </>
      );
      return (
        <div key={clave}>
          {onClick
            ? <button type="button" onClick={onClick} aria-pressed={Boolean(activo)} data-activo={activo || undefined}>{contenido}</button>
            : <span>{contenido}</span>}
        </div>
      );
    })}
  </dl>
);

export const Panel = ({ titulo, icono, conteo, extra, children, className = '' }) => (
  <section className={`cli-panel overflow-hidden ${className}`}>
    {(titulo || extra) && (
      <header className="cli-panel-cabecera">
        <h2 className="cli-etiqueta">
          {icono}
          {titulo}
          {conteo !== undefined && conteo !== null && <span className="cli-conteo">{conteo}</span>}
        </h2>
        {extra}
      </header>
    )}
    {children}
  </section>
);

export const Vacio = ({ icono, titulo, texto, accion }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    {icono || <Inbox size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
    <p className="text-[14px] font-medium text-[var(--color-text)]">{titulo}</p>
    {texto && <p className="max-w-sm text-[13px] text-[var(--color-text-muted)]">{texto}</p>}
    {accion && <div className="mt-3">{accion}</div>}
  </div>
);

export const ErrorCarga = ({ texto, reintentar, etiquetaReintentar }) => (
  <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-[var(--color-text-muted)]">
    <span>{texto}</span>
    {reintentar && <Button variant="outline" onClick={reintentar}><RefreshCcw size={15} /> {etiquetaReintentar}</Button>}
  </div>
);

/** Fila etiqueta / valor de una ficha de detalle. */
export const Dato = ({ etiqueta, children, ancho = false }) => (
  <div className={ancho ? 'sm:col-span-2' : ''}>
    <dt className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{etiqueta}</dt>
    <dd className="mt-0.5 text-[13.5px] text-[var(--color-text)]">{children ?? '—'}</dd>
  </div>
);

/**
 * Barra de un presupuesto: lo gastado (lleno) y lo pendiente (tenue) sobre lo
 * presupuestado. Si se pasó, la barra se llena en rojo.
 */
export const BarraPresupuesto = ({ fila, etiqueta }) => {
  const usado = fila.gastado + fila.comprometido;
  const base = Math.max(fila.presupuesto, usado, 0.01);
  const color = fila.remanente < 0 ? 'var(--color-error)' : 'var(--color-primary)';
  const pctGastado = Math.min(100, (fila.gastado / base) * 100);
  const pctPendiente = Math.min(100 - pctGastado, (fila.comprometido / base) * 100);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]" role="img" aria-label={etiqueta}>
      <span style={{ width: `${pctGastado}%`, background: color }} />
      <span style={{ width: `${pctPendiente}%`, background: color, opacity: 0.45 }} />
    </div>
  );
};

/**
 * Tarjeta del presupuesto de una categoría en un mes (Tesorería y Gastos).
 * `fila`: { presupuesto, gastado, comprometido, remanente } del servidor (el
 * remanente viene calculado en centavos: su signo decide si se pasó).
 */
export const TarjetaPresupuesto = ({ fila, titulo, extra, nota, tf, monto, as: Etiqueta = 'li', className = '' }) => {
  const usado = fila.gastado + fila.comprometido;
  const sinPresupuesto = !(fila.presupuesto > 0);
  const pasado = fila.remanente < 0;
  const pct = sinPresupuesto ? null : Math.round((usado / fila.presupuesto) * 100);
  return (
    <Etiqueta className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[14px] font-semibold text-[var(--color-text)]">{titulo}</h3>
        {extra}
      </div>
      {sinPresupuesto && usado === 0 ? (
        <div className="mt-3 text-[15px] font-medium text-[var(--color-text-muted)]">{tf('finSinPresupuesto')}</div>
      ) : (
        <>
          <div className={`mt-3 text-[22px] font-semibold tabular-nums ${pasado ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'}`}>{monto(fila.remanente)}</div>
          <div className="text-[11.5px] uppercase tracking-wider text-[var(--color-text-muted)]">{sinPresupuesto ? tf('finSinPresupuesto') : tf('finRemanente')}</div>
        </>
      )}
      <div className="mt-3">
        <BarraPresupuesto fila={fila} etiqueta={tf('finBarraPresupuesto', { gastado: monto(fila.gastado), pendiente: monto(fila.comprometido), presupuesto: monto(fila.presupuesto) })} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div><dt className="text-[var(--color-text-muted)]">{tf('finPresupuesto')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(fila.presupuesto)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{tf('finGastado')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(fila.gastado)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{tf('finPendientePago')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(fila.comprometido)}</dd></div>
      </dl>
      {pasado && !sinPresupuesto && <p className="mt-2 text-[12px] font-medium text-[var(--color-error)]">{tf('finSePaso', { monto: monto(-fila.remanente) })}</p>}
      {!pasado && pct !== null && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">{tf('finUsadoPct', { pct })}</p>}
      {nota && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">{nota}</p>}
    </Etiqueta>
  );
};

/** Punto de color de una partida (o gris si no tiene). */
export const PuntoPartida = ({ color, size = 8 }) => (
  <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color || 'var(--color-text-muted)' }} />
);

/** Selector de año (botones) para las cabeceras. */
export const SelectorAnio = ({ anio, anios, onCambio, etiqueta }) => (
  <div className="dash-segmento h-10 items-center" role="tablist" aria-label={etiqueta}>
    {anios.map((a) => (
      <button key={a} type="button" role="tab" aria-selected={anio === a} onClick={() => onCambio(a)}>{a}</button>
    ))}
  </div>
);

/**
 * "Desde «Cotizar sillas · Oficina nueva»": de qué tarea o proyecto es copia
 * un archivo de finanzas ("Mandar a finanzas"), con enlace a la tarea. `item`
 * trae origen, origenTareaId y origenProyectoId; sin origen no pinta nada.
 */
export const OrigenArchivo = ({ item, texto }) => {
  if (!item?.origen) return null;
  const ruta = item.origenProyectoId
    ? `/proyectos/${item.origenProyectoId}${item.origenTareaId ? `?tarea=${item.origenTareaId}` : ''}`
    : null;
  const contenido = <>{texto} «{item.origen}»</>;
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
      <CornerDownRight size={12} className="shrink-0" aria-hidden="true" />
      {ruta
        ? <Link to={ruta} className="min-w-0 truncate hover:text-[var(--color-text)] hover:underline" onClick={(e) => e.stopPropagation()}>{contenido}</Link>
        : <span className="min-w-0 truncate">{contenido}</span>}
    </span>
  );
};
