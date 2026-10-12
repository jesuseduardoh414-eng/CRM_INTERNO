import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select';

// Radix no admite '' como valor de un elemento; esta clave hace de "nada
// elegido" por dentro y hacia fuera se sigue entregando ''.
const VACIO = '__vacio__';

/**
 * Desplegable de una sola opcion para formularios, sobre el Select de shadcn.
 * Sustituye al <select> nativo, cuya lista abierta la pinta el navegador y no
 * sigue el estilo del CRM (azul del sistema, sin bordes redondeados).
 *
 * Se usa igual que el nativo: `valor` y `onCambio` trabajan con strings y ''
 * significa sin elegir. Si se pasa `opcionVacia`, aparece como primera opcion
 * para volver a dejarlo vacio; si no, '' solo muestra el `placeholder`.
 * Las opciones pueden llevar `grupo` (como un <optgroup>): las que comparten
 * grupo se listan juntas bajo su titulo, en el orden en que aparece cada grupo.
 */
const SelectorSimple = ({
  id,
  valor,
  onCambio,
  opciones,
  opcionVacia,
  placeholder,
  disabled = false,
  // Clases extra para el disparador (p. ej. 'campo-select-compacto' en filtros)
  className = '',
  'aria-label': ariaLabel,
}) => {
  const actual = valor === '' || valor == null ? (opcionVacia ? VACIO : undefined) : String(valor);

  const item = (o) => (
    <SelectItem key={o.valor} value={String(o.valor)} disabled={o.deshabilitada} className="text-sm font-normal">
      {o.etiqueta}
    </SelectItem>
  );

  // Agrupa solo si alguna opcion trae grupo; si no, lista plana como siempre
  const grupos = opciones.some((o) => o.grupo)
    ? opciones.reduce((acc, o) => {
      const g = o.grupo || '';
      (acc.get(g) || acc.set(g, []).get(g)).push(o);
      return acc;
    }, new Map())
    : null;

  return (
    <Select
      value={actual}
      onValueChange={(v) => onCambio(v === VACIO ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={`campo-select ${className}`.trim()}>
        <SelectValue placeholder={placeholder || opcionVacia} />
      </SelectTrigger>
      {/* Hasta 18rem, pero nunca mas que el hueco que queda en pantalla: con
          max-h-72 a secas la lista se salia por abajo con el teclado abierto */}
      <SelectContent className="z-[1500] max-h-[min(18rem,var(--radix-select-content-available-height))]">
        {opcionVacia && (
          <SelectItem value={VACIO} className="text-sm font-normal text-[var(--color-text-muted)]">{opcionVacia}</SelectItem>
        )}
        {grupos
          ? [...grupos].map(([grupo, lista]) => (
            <SelectGroup key={grupo}>
              {grupo && <SelectLabel className="pl-2 text-xs font-semibold text-[var(--color-text-muted)]">{grupo}</SelectLabel>}
              {lista.map(item)}
            </SelectGroup>
          ))
          : opciones.map(item)}
      </SelectContent>
    </Select>
  );
};

export default SelectorSimple;
