/**
 * Selector de hora con lista desplegable, al estilo de Google Calendar. Sustituye
 * a <input type="time">, cuyo reloj lo pinta el navegador y no sigue el estilo
 * del CRM.
 *
 * - SelectorHora: una sola hora (entrada, salida, comida...).
 * - SelectorRangoHoras: inicio y fin encadenados. La lista del fin solo ofrece
 *   horas posteriores al inicio, cada una con su duracion ("10:30 · 1 h 30 min"),
 *   y al mover el inicio se conserva la duracion.
 *
 * Los valores entran y salen como 'HH:MM' (24 h); lo que se ve sigue el idioma
 * ("9:00 a.m." en es-MX, "9:00 AM" en en-US). Se puede escribir la hora: "9",
 * "930", "14:30", "2pm", "2:30 p.m.". Teclado: flechas, Inicio/Fin, Re Pág/Av
 * Pág, Enter para elegir y Escape para cerrar.
 *
 * La lista va en un Popover de Radix SIN portal: dentro de una ventana (Dialog
 * de Radix) un portal queda fuera de la ventana y la rueda del raton no lo
 * desplaza. Se posiciona con `position: fixed`, asi que el scroll de la ventana
 * no lo recorta.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoAgenda } from '../hooks/useTextoAgenda';
import { aMinutosHora, formatoHora, horaDeMinutos, interpretarHora } from '../utils/horas';

const MIN_DIA = 24 * 60;
/** Duracion corta: "15 min", "1 h", "1 h 30 min". */
const useTextoDuracion = () => {
  const tx = useTextoAgenda();
  return useCallback((minutos) => {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    if (h && m) return tx('hora_durHM', { h, m });
    if (h) return tx('hora_durH', { h });
    return tx('hora_durM', { m });
  }, [tx]);
};

/** Horas del dia cada `paso` minutos; si `extra` no cae en la lista, se intercala. */
const horasDelDia = (paso, extra) => {
  const lista = [];
  for (let m = 0; m < MIN_DIA; m += paso) lista.push(m);
  const e = aMinutosHora(extra);
  if (e !== null && !lista.includes(e)) lista.push(e);
  return lista.sort((a, b) => a - b);
};

/**
 * Campo base: <input> de texto con rol de combobox y la lista debajo.
 * `opciones` = [{ valor: 'HH:MM', detalle?: string }]. `validar(minutos)`
 * decide si una hora escrita se acepta (p. ej. el fin despues del inicio).
 */
const CampoHora = ({
  id,
  valor,
  onCambio,
  opciones,
  validar,
  disabled = false,
  placeholder,
  invalido = false,
  'aria-label': ariaLabel,
}) => {
  const { locale } = usePreferences();
  const idLista = useId();
  const [abierto, setAbierto] = useState(false);
  // Texto mientras se escribe; null = se muestra el valor guardado
  const [texto, setTexto] = useState(null);
  const [activo, setActivo] = useState(-1);
  // Tras moverse con flechas, Enter elige la opcion marcada y no lo escrito
  const [navegado, setNavegado] = useState(false);
  const raizRef = useRef(null);
  const listaRef = useRef(null);
  const centrarRef = useRef(false);

  const minutosDe = useCallback((o) => aMinutosHora(o.valor), []);
  // Primera opcion igual o posterior a `minutos` (o la ultima)
  const indiceCercano = useCallback((minutos) => {
    if (minutos === null || !opciones.length) return opciones.length ? 0 : -1;
    const i = opciones.findIndex((o) => minutosDe(o) >= minutos);
    return i === -1 ? opciones.length - 1 : i;
  }, [opciones, minutosDe]);

  const abrir = () => {
    if (disabled || abierto) return;
    setActivo(indiceCercano(aMinutosHora(valor)));
    centrarRef.current = true;
    setAbierto(true);
  };
  const cerrar = () => {
    setAbierto(false);
    setTexto(null);
    setNavegado(false);
  };
  const elegir = (v) => {
    if (v && v !== valor) onCambio(v);
    cerrar();
  };
  const confirmarTexto = () => {
    if (texto === null) { cerrar(); return; }
    const minutos = interpretarHora(texto);
    if (minutos !== null && (!validar || validar(minutos))) elegir(horaDeMinutos(minutos));
    else cerrar();
  };

  // Al salir del campo (clic fuera o Tab): la opcion marcada con flechas o lo escrito
  const alSalir = () => {
    if (abierto && navegado && activo >= 0) elegir(opciones[activo].valor);
    else confirmarTexto();
  };

  // Mantener visible la opcion marcada. Se mueve el scroll de la lista a mano:
  // scrollIntoView tambien desplazaria la ventana que contiene el campo.
  useEffect(() => {
    if (!abierto) return;
    const lista = listaRef.current;
    const el = lista?.querySelector(`[data-indice="${activo}"]`);
    if (!lista || !el || centrarRef.current) return;
    if (el.offsetTop < lista.scrollTop) {
      lista.scrollTop = el.offsetTop - 4;
    } else if (el.offsetTop + el.offsetHeight > lista.scrollTop + lista.clientHeight) {
      lista.scrollTop = el.offsetTop + el.offsetHeight - lista.clientHeight + 4;
    }
  }, [abierto, activo]);

  // Al abrir, la opcion marcada queda centrada. Radix monta la lista despues
  // del primer efecto, asi que se hace en la ref de la lista, ya con sus filas.
  const refLista = useCallback((nodo) => {
    listaRef.current = nodo;
    if (!nodo || !centrarRef.current) return;
    centrarRef.current = false;
    const el = nodo.querySelector('[data-activo="true"]');
    if (el) nodo.scrollTop = el.offsetTop - nodo.clientHeight / 2 + el.offsetHeight / 2;
  }, []);

  const mover = (delta) => {
    if (!abierto) { abrir(); return; }
    setNavegado(true);
    setActivo((i) => Math.min(Math.max((i < 0 ? 0 : i) + delta, 0), opciones.length - 1));
  };

  const alTeclear = (ev) => {
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); mover(1); break;
      case 'ArrowUp': ev.preventDefault(); mover(-1); break;
      case 'PageDown': ev.preventDefault(); mover(4); break;
      case 'PageUp': ev.preventDefault(); mover(-4); break;
      case 'Home':
        if (abierto) { ev.preventDefault(); setNavegado(true); setActivo(0); }
        break;
      case 'End':
        if (abierto) { ev.preventDefault(); setNavegado(true); setActivo(opciones.length - 1); }
        break;
      case 'Enter':
        // Nunca envia el formulario que contiene el campo
        if (!abierto && texto === null) return;
        ev.preventDefault();
        if (abierto && activo >= 0 && (navegado || texto === null)) elegir(opciones[activo].valor);
        else confirmarTexto();
        break;
      case 'Escape':
        if (abierto || texto !== null) {
          ev.preventDefault();
          ev.stopPropagation();
          cerrar();
        }
        break;
      default:
    }
  };

  const alEscribir = (ev) => {
    const nuevo = ev.target.value;
    setTexto(nuevo);
    setNavegado(false);
    if (!abierto) { centrarRef.current = true; setAbierto(true); }
    const minutos = interpretarHora(nuevo);
    if (minutos !== null) {
      setActivo(indiceCercano(minutos));
      return;
    }
    // Sin hora completa: la primera opcion cuyo texto empieza igual
    const buscado = nuevo.trim().toLowerCase();
    const i = opciones.findIndex((o) => formatoHora(o.valor, locale).toLowerCase().startsWith(buscado));
    if (i >= 0) setActivo(i);
  };

  const visible = texto ?? (valor ? formatoHora(valor, locale) : '');

  return (
    <PopoverPrimitive.Root open={abierto} onOpenChange={(v) => { if (!v) alSalir(); }}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={raizRef} className="hr-campo" data-desplegable-abierto={abierto ? 'true' : undefined}>
          <input
            id={id}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="form-input hr-input"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={abierto}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={abierto && activo >= 0 ? `${idLista}-${activo}` : undefined}
            aria-invalid={invalido || undefined}
            value={visible}
            placeholder={placeholder}
            disabled={disabled}
            onChange={alEscribir}
            onKeyDown={alTeclear}
            onFocus={(ev) => ev.target.select()}
            onClick={() => (abierto ? cerrar() : abrir())}
            onBlur={alSalir}
          />
          <ChevronDown size={14} className="hr-flecha" aria-hidden="true" data-abierto={abierto} />
        </div>
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Content
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="hr-panel"
        // El foco se queda en el campo: se escribe y se navega desde ahi
        onOpenAutoFocus={(ev) => ev.preventDefault()}
        onCloseAutoFocus={(ev) => ev.preventDefault()}
        // Escape descarta lo escrito; clic fuera lo confirma (onOpenChange)
        onEscapeKeyDown={(ev) => { ev.preventDefault(); cerrar(); }}
        onInteractOutside={(ev) => {
          if (raizRef.current?.contains(ev.target)) ev.preventDefault();
        }}
      >
        <ul ref={refLista} id={idLista} role="listbox" aria-label={ariaLabel} className="hr-lista">
          {opciones.map((o, i) => (
            <li
              key={o.valor}
              id={`${idLista}-${i}`}
              role="option"
              data-indice={i}
              aria-selected={o.valor === valor}
              data-activo={i === activo}
              className="hr-opcion"
              // mousedown sin foco: el campo no pierde el foco ni se cierra antes del clic
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseMove={() => { if (activo !== i) setActivo(i); }}
              onClick={() => elegir(o.valor)}
            >
              <span>{formatoHora(o.valor, locale)}</span>
              {o.detalle && <span className="hr-detalle">· {o.detalle}</span>}
            </li>
          ))}
        </ul>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
};

/**
 * Una sola hora. `referencia` ('HH:MM', opcional) añade a las horas
 * posteriores la duracion desde ella: en la salida, "6:00 p.m. · 9 h".
 */
const SelectorHora = ({ id, valor, onCambio, paso = 15, referencia, disabled, invalido, placeholder, 'aria-label': ariaLabel }) => {
  const duracion = useTextoDuracion();
  const opciones = useMemo(() => {
    const ref = aMinutosHora(referencia);
    return horasDelDia(paso, valor).map((m) => ({
      valor: horaDeMinutos(m),
      detalle: ref !== null && m > ref ? duracion(m - ref) : null,
    }));
  }, [paso, valor, referencia, duracion]);

  return (
    <CampoHora
      id={id}
      valor={valor}
      onCambio={onCambio}
      opciones={opciones}
      disabled={disabled}
      invalido={invalido}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
};

/**
 * Inicio y fin encadenados. `onCambio({ inicio, fin })`. Con `mismoDia`
 * (lo normal) el fin va despues del inicio y lleva la duracion; si el rango
 * cruza dias, el fin es una hora libre.
 * El campo de inicio usa `id`; el de fin, `${id}-fin`.
 */
export const SelectorRangoHoras = ({
  id,
  inicio,
  fin,
  onCambio,
  mismoDia = true,
  paso = 15,
  disabled = false,
  etiquetaInicio,
  etiquetaFin,
}) => {
  const tx = useTextoAgenda();
  const duracion = useTextoDuracion();
  const iniMin = aMinutosHora(inicio);
  const finMin = aMinutosHora(fin);

  const opcionesInicio = useMemo(
    () => horasDelDia(paso, inicio).map((m) => ({ valor: horaDeMinutos(m) })),
    [paso, inicio],
  );

  const opcionesFin = useMemo(() => {
    if (!mismoDia || iniMin === null) return horasDelDia(paso, fin).map((m) => ({ valor: horaDeMinutos(m) }));
    // Desde el inicio + paso hasta el final del dia, y el 23:59 de cierre
    const lista = [];
    for (let m = iniMin + paso; m < MIN_DIA; m += paso) lista.push(m);
    if (!lista.includes(MIN_DIA - 1)) lista.push(MIN_DIA - 1);
    if (finMin !== null && finMin > iniMin && !lista.includes(finMin)) lista.push(finMin);
    return lista.sort((a, b) => a - b).map((m) => ({ valor: horaDeMinutos(m), detalle: duracion(m - iniMin) }));
  }, [mismoDia, iniMin, finMin, paso, fin, duracion]);

  const cambiarInicio = (nuevo) => {
    if (!mismoDia) { onCambio({ inicio: nuevo, fin }); return; }
    // Se conserva la duracion (1 h si aun no habia una valida)
    const dur = iniMin !== null && finMin !== null && finMin > iniMin ? finMin - iniMin : 60;
    const nuevoFin = Math.min(aMinutosHora(nuevo) + dur, MIN_DIA - 1);
    onCambio({ inicio: nuevo, fin: horaDeMinutos(nuevoFin) });
  };

  const invalido = mismoDia && iniMin !== null && finMin !== null && finMin <= iniMin;

  return (
    <div className="hr-rango">
      <CampoHora
        id={id}
        valor={inicio}
        onCambio={cambiarInicio}
        opciones={opcionesInicio}
        disabled={disabled}
        aria-label={etiquetaInicio || tx('hora_desde')}
      />
      <span className="hr-guion" aria-hidden="true">–</span>
      <CampoHora
        id={`${id}-fin`}
        valor={fin}
        onCambio={(nuevo) => onCambio({ inicio, fin: nuevo })}
        opciones={opcionesFin}
        validar={mismoDia && iniMin !== null ? (m) => m > iniMin : undefined}
        disabled={disabled}
        invalido={invalido}
        aria-label={etiquetaFin || tx('hora_hasta')}
      />
    </div>
  );
};

export default SelectorHora;
