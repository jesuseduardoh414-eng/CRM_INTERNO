// Conversación de un proyecto entre el cliente y el equipo. La usan el portal
// (lado cliente) y la pestaña "Cliente" del proyecto (lado equipo): cambia qué
// mensajes son "propios" (a la derecha) y cómo se envía.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Loader2, MessagesSquare, Send } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import UserAvatar from '../UserAvatar';
import { Button } from '../ui/button';
import { fechaHora, mismoDia } from '../../utils/portal';
import {
  VacioPortal,
} from './PiezasPortal';

const MAX = 4000;
// Distancia al pie (px) dentro de la cual el usuario está "al día" y la lista
// puede seguir bajando sola.
const UMBRAL_FONDO = 80;

const ConversacionPortal = ({
  mensajes = [],
  ladoCliente,          // true en el portal: "propios" son los del cliente
  onEnviar,             // async (texto) => void; lanza si falla
  placeholder,
  etiquetaOtros,        // texto bajo el nombre de quien no es "propio"
  cabecera,
  vacioAyuda,
  cargando = false,     // primera carga: no se muestra "sin mensajes" todavía
}) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hayNuevos, setHayNuevos] = useState(false);
  const listaRef = useRef(null);
  const areaRef = useRef(null);
  const cercaFondoRef = useRef(true);   // se actualiza al desplazarse
  const acabaDeEnviarRef = useRef(false);
  const ultimoIdRef = useRef(null);     // último mensaje ya pintado

  const bajarAlFondo = () => {
    const lista = listaRef.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
    cercaFondoRef.current = true;
    setHayNuevos(false);
  };

  const alDesplazar = () => {
    const lista = listaRef.current;
    if (!lista) return;
    const cerca = lista.scrollHeight - lista.scrollTop - lista.clientHeight <= UMBRAL_FONDO;
    cercaFondoRef.current = cerca;
    if (cerca) setHayNuevos(false);
  };

  // Solo se baja al último cuando llega un mensaje nuevo de verdad (el
  // refresco de 20 s casi siempre trae la misma lista) y además es la primera
  // carga, el usuario acaba de enviar o ya estaba cerca del pie. Si está
  // leyendo mensajes anteriores no se le mueve la vista: sale el aviso
  // "Nuevos mensajes".
  const ultimoId = mensajes.length ? mensajes[mensajes.length - 1].id : null;
  useLayoutEffect(() => {
    const anterior = ultimoIdRef.current;
    ultimoIdRef.current = ultimoId;
    if (ultimoId == null || ultimoId === anterior) return;
    if (anterior == null || acabaDeEnviarRef.current || cercaFondoRef.current) {
      acabaDeEnviarRef.current = false;
      const lista = listaRef.current;
      if (lista) lista.scrollTop = lista.scrollHeight;
      cercaFondoRef.current = true;
      setHayNuevos(false);
    } else {
      setHayNuevos(true);
    }
  }, [ultimoId]);

  // El cuadro crece con el texto hasta su alto máximo.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [texto]);

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    // Quien llama agrega el mensaje a la lista; al pintarse se baja al pie.
    acabaDeEnviarRef.current = true;
    try {
      await onEnviar(limpio);
      setTexto('');
    } catch {
      // Quien llama ya avisó del error; el texto se conserva para reintentar.
      acabaDeEnviarRef.current = false;
    } finally {
      setEnviando(false);
      areaRef.current?.focus();
    }
  };

  // Enter envía con teclado físico; en pantallas táctiles el teclado del
  // sistema no tiene Mayús+Enter, así que ahí Enter es salto de línea y se
  // envía con el botón.
  const alTeclear = (e) => {
    const tactil = window.matchMedia?.('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !tactil && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  };

  let diaAnterior = null;

  return (
    <div className="ptl-panel ptl-chat">
      {cabecera}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listaRef} onScroll={alDesplazar} className="ptl-chat-mensajes" role="log" aria-live="polite" aria-relevant="additions">
          {cargando && mensajes.length === 0 ? (
            <div className="my-auto flex justify-center text-[var(--color-text-muted)]">
              <Loader2 size={20} className="animate-spin" aria-label={tp('ptlCargando')} />
            </div>
          ) : mensajes.length === 0 ? (
            <div className="my-auto">
              <VacioPortal icono={MessagesSquare} texto={tp('ptlSinMensajes')} ayuda={vacioAyuda || tp('ptlSinMensajesAyuda')} />
            </div>
          ) : mensajes.map((m) => {
            const fecha = new Date(m.creadoEn);
            const nuevoDia = !diaAnterior || !mismoDia(diaAnterior, fecha);
            diaAnterior = fecha;
            const propio = ladoCliente ? m.deCliente : !m.deCliente;
            return (
              <div key={m.id} className="contents">
                {nuevoDia && (
                  <span className="ptl-chat-dia">{fecha.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                )}
                <div className="ptl-burbuja-fila" data-propio={propio}>
                  {!propio && (
                    <UserAvatar nombre={m.autor.nombre} fotoPerfilUrl={m.autor.fotoPerfilUrl} size={30} radius={999} fontSize="0.65rem" />
                  )}
                  <div className="min-w-0">
                    <div className="ptl-burbuja-meta">
                      {propio && ladoCliente ? tp('ptlTu') : m.autor.nombre}
                      {!propio && etiquetaOtros && <> · {etiquetaOtros}</>}
                      {' · '}{fechaHora(m.creadoEn, locale, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="ptl-burbuja">{m.contenido}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Fuera del log para que el lector de pantalla no lo anuncie como mensaje. */}
        {hayNuevos && (
          <button
            type="button"
            onClick={bajarAlFondo}
            className="absolute bottom-3 left-1/2 inline-flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--color-primary)] px-4 text-[13px] font-medium text-[var(--color-on-primary)] shadow-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-40)]"
          >
            {tp('ptlNuevosMensajes')} <ArrowDown size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <form className="ptl-chat-redactar" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={areaRef}
            rows={1}
            value={texto}
            maxLength={MAX}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            placeholder={placeholder || tp('ptlEscribe')}
            aria-label={placeholder || tp('ptlEscribe')}
          />
          <Button type="submit" disabled={!texto.trim() || enviando} className="h-11 min-w-11 shrink-0" aria-label={enviando ? tp('ptlEnviando') : tp('ptlEnviar')}>
            {enviando ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
            <span className="hidden sm:inline">{enviando ? tp('ptlEnviando') : tp('ptlEnviar')}</span>
          </Button>
        </div>
        <p className="ptl-chat-atajo mt-1.5 hidden text-[11.5px] text-[var(--color-text-muted)] sm:block">{tp('ptlEnterEnviar')}</p>
      </form>
    </div>
  );
};

export default ConversacionPortal;
