/**
 * Envoltorio de un control de filtro con su etiqueta ENCIMA.
 *
 * Regla general del sistema, pedida por el usuario: nunca poner la etiqueta al
 * lado del control. En una sola linea los filtros se estiran, obligan a leer en
 * horizontal y con tres o cuatro ya no caben.
 *
 * El contenedor usa `items-end` en la fila que lo envuelve, asi todos los
 * controles quedan alineados por abajo aunque alguno no lleve etiqueta.
 */
const CampoFiltro = ({ label, htmlFor, className = '', children }) => (
  <div className={`flex flex-col gap-1.5 ${className}`}>
    {label && (
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-[var(--color-text-dim)] whitespace-nowrap"
      >
        {label}
      </label>
    )}
    {children}
  </div>
);

export default CampoFiltro;
