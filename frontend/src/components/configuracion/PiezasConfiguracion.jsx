// Piezas del panel de configuración: fila de ajustes (enlazada con la vista
// previa), campo, interruptor, color con contraste, imagen de marca con
// arrastrar y soltar, la paleta generada, el botón de copiar y las piezas de
// las guías paso a paso (Google Cloud, Gmail). Estilos en src/configuracion.css.
import { useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Info, Loader2, UploadCloud } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { ajustarContraste, contraste, generarVariables } from '../../utils/temaMarca';

/**
 * Bloque de ajustes: tarjeta con título y explicación arriba y los controles
 * debajo, a todo el ancho. `zona` enlaza el bloque con la vista previa: al
 * pasar el ratón o enfocar un campo dentro, la página resalta esa zona.
 */
export const Fila = ({ titulo, descripcion, extra, zona, activa, children }) => (
  <section className="cfg-bloque" data-zona={zona} data-activa={activa || undefined}>
    <header className="cfg-bloque-cabecera">
      <div className="min-w-0">
        <h2 className="cfg-bloque-titulo">{titulo}</h2>
        {descripcion && <p className="cfg-bloque-texto">{descripcion}</p>}
      </div>
      {extra && <div className="shrink-0 pt-0.5">{extra}</div>}
    </header>
    <div className="cfg-bloque-cuerpo">{children}</div>
  </section>
);

/** `zona` opcional: un campo puede apuntar a una zona más concreta que su fila. */
export const Campo = ({ etiqueta, ayuda, htmlFor, zona, children, className = '' }) => (
  <div className={className} data-zona={zona}>
    {etiqueta && <label className="cfg-label" htmlFor={htmlFor}>{etiqueta}</label>}
    {children}
    {ayuda && <p className="cfg-ayuda">{ayuda}</p>}
  </div>
);

/** Copia `texto` al portapapeles y lo confirma un momento en el propio botón. */
export const BotonCopiar = ({ texto }) => {
  const { t } = usePreferences();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="cfg-btn shrink-0"
      onClick={async () => { await navigator.clipboard?.writeText(texto).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 1800); }}
    >
      {copiado ? <CheckCircle2 size={14} /> : <Copy size={14} />} {copiado ? t('admCopied') : t('admCopy')}
    </button>
  );
};

export const Interruptor =({ activo, onChange, etiqueta, ayuda, id, zona }) => (
  <div className="flex items-start justify-between gap-6" data-zona={zona}>
    {(etiqueta || ayuda) && (
      <div className="min-w-0">
        {etiqueta && <label htmlFor={id} className="block cursor-pointer text-[13.5px] font-medium text-[var(--color-text)]">{etiqueta}</label>}
        {ayuda && <p className="cfg-ayuda !mt-0.5">{ayuda}</p>}
      </div>
    )}
    <button id={id} type="button" role="switch" aria-checked={activo} aria-label={etiqueta || undefined} onClick={() => onChange(!activo)} className="cfg-switch mt-0.5" />
  </div>
);

const REGEX_HEX = /^#[0-9a-f]{6}$/i;

/** Color: muestra nativa dentro del campo + #RRGGBB, con aviso de contraste. */
export const CampoColor = ({ id, valor, onChange, fondoContraste = '#ffffff' }) => {
  const { t } = usePreferences();
  const [texto, setTexto] = useState(valor);
  const [ultimoValor, setUltimoValor] = useState(valor);
  if (valor !== ultimoValor) {
    setUltimoValor(valor);
    setTexto(valor);
  }
  const valido = REGEX_HEX.test(texto);
  const ratio = contraste(valor, fondoContraste);
  const ajustado = ajustarContraste(valor, fondoContraste, 4.5);

  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="relative block h-9 w-12 shrink-0 cursor-pointer overflow-hidden rounded-[6px] border border-[var(--cfg-linea)] shadow-[inset_0_0_0_2px_var(--color-surface)]" style={{ background: valor }}>
          <span className="sr-only">{t('cfgPickColor')}</span>
          <input type="color" value={valor} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <input
          id={id}
          className="cfg-input max-w-[9.5rem] font-mono uppercase tracking-wide"
          value={texto}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valido}
          onChange={(e) => {
            const nuevo = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setTexto(nuevo);
            if (REGEX_HEX.test(nuevo)) onChange(nuevo.toLowerCase());
          }}
        />
      </div>
      {!valido ? (
        <p className="cfg-ayuda !text-[var(--color-error)]">{t('cfgInvalidHex')}</p>
      ) : ratio >= 4.5 ? (
        <p className="cfg-ayuda flex items-center gap-1.5"><CheckCircle2 size={13} className="text-[var(--color-success)]" /> {t('cfgContrastOk', { ratio: ratio.toFixed(1) })}</p>
      ) : (
        <p className="cfg-ayuda flex items-center gap-1.5">
          <Info size={13} />
          <span className="inline-block h-3 w-3 rounded-[2px]" style={{ background: ajustado }} />
          {t('cfgContrastAdjusted', { ratio: contraste(ajustado, fondoContraste).toFixed(1) })}
        </p>
      )}
    </div>
  );
};

const nivel = (ratio) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'bajo');

/**
 * Paleta generada a partir de primario + acento: cada pieza del CRM con su
 * color real y el contraste del texto que lleva encima.
 */
export const PaletaGenerada = ({ colores }) => {
  const { t } = usePreferences();
  const { claro, oscuro } = generarVariables(colores);
  const muestras = [
    { nombre: t('cfgSwSidebar'), fondo: claro['--color-sidebar'], texto: '#ffffff' },
    { nombre: t('cfgSwButton'), fondo: claro['--color-primary'], texto: claro['--color-on-primary'] },
    { nombre: t('cfgSwAccent'), fondo: claro['--color-gold'], texto: claro['--color-on-gold'] },
    { nombre: t('cfgSwBadge'), fondo: claro['--badge-info-bg'], texto: claro['--badge-info-fg'] },
    { nombre: t('cfgSwDarkBg'), fondo: oscuro['--color-bg-base'], texto: oscuro['--color-text'] },
    { nombre: t('cfgSwDarkSurface'), fondo: oscuro['--color-surface'], texto: oscuro['--color-text-muted'] },
    { nombre: t('cfgSwDarkButton'), fondo: oscuro['--color-primary'], texto: oscuro['--color-on-primary'] },
    { nombre: t('cfgSwDarkLink'), fondo: oscuro['--color-surface'], texto: oscuro['--color-primary'] },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {muestras.map(({ nombre, fondo, texto }) => {
        const ratio = contraste(fondo, texto);
        return (
          <div key={nombre} className="cfg-muestra border border-[var(--cfg-linea)]" style={{ background: fondo, color: texto }} title={`${fondo.toUpperCase()} / ${texto.toUpperCase()}`}>
            <span className="font-semibold">{nombre}</span>
            <span className="flex items-center justify-between gap-1">
              <span className="font-mono text-[9.5px] opacity-80">{fondo.toUpperCase()}</span>
              <span className="cfg-sello" data-nivel={nivel(ratio)}>{nivel(ratio) === 'bajo' ? ratio.toFixed(1) : nivel(ratio)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Imagen de marca: miniaturas sobre fondo claro y oscuro, subir con clic o
 * arrastrando el archivo encima de la fila.
 */
export const CampoImagen = ({ clave, etiqueta, ayuda, url, fabrica, maxKb, aceptar, dosFondos = false, fondoOscuro = false, zona, onSubir, onQuitar }) => {
  const { t } = usePreferences();
  const input = useRef(null);
  const [ocupado, setOcupado] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  const ejecutar = async (accion) => {
    setOcupado(true);
    try { await accion(); } finally { setOcupado(false); }
  };

  const vista = url || fabrica;
  // Isotipo y favicon son cuadrados: miniaturas cuadradas y pequeñas.
  const miniatura = (oscuro) => (
    <div className={`cfg-miniatura ${dosFondos ? '!h-14 !w-14' : ''}`} data-oscuro={oscuro || undefined}>
      {vista
        ? <img src={vista} alt="" className={clave === 'fondoLogin' ? 'h-full w-full rounded-[2px] object-cover' : 'max-h-full max-w-full object-contain'} />
        : <span className="text-[11px] text-[var(--color-text-muted)]">{t('cfgNoImage')}</span>}
    </div>
  );

  return (
    <div
      className="cfg-soltar -mx-2 flex flex-wrap items-center gap-4 px-2 sm:flex-nowrap"
      data-arrastrando={arrastrando || undefined}
      data-zona={zona}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        const archivo = e.dataTransfer.files?.[0];
        if (archivo) ejecutar(() => onSubir(clave, archivo));
      }}
    >
      <div className="flex shrink-0 gap-1.5">
        {dosFondos ? <>{miniatura(false)}{miniatura(true)}</> : miniatura(fondoOscuro)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-[var(--color-text)]">
          {etiqueta}
          {url
            ? <span className="cfg-sello" data-nivel="AAA">{t('cfgCustom')}</span>
            : fabrica && <span className="text-[11px] font-normal text-[var(--color-text-muted)]">· {t('cfgDefaultImage')}</span>}
        </p>
        <p className="cfg-ayuda !mt-0.5">{arrastrando ? t('cfgDropNow') : `${ayuda} · ${t('cfgMaxSize', { kb: maxKb })}`}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {url && (
          <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" disabled={ocupado} onClick={() => ejecutar(() => onQuitar(clave))}>
            {t('cfgRemove')}
          </button>
        )}
        <button type="button" className="cfg-btn" disabled={ocupado} onClick={() => input.current?.click()}>
          {ocupado ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
          {url ? t('cfgReplace') : t('cfgUpload')}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={aceptar}
        className="sr-only"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          e.target.value = '';
          if (archivo) ejecutar(() => onSubir(clave, archivo));
        }}
      />
    </div>
  );
};

// ── Guías paso a paso ────────────────────────────────────────────────────

/** Un valor para copiar tal cual en la pantalla de otro servicio. */
export const Valor = ({ etiqueta, valor }) => (
  <div className="mt-2">
    {etiqueta && <p className="cfg-label !mb-1 text-[12px]">{etiqueta}</p>}
    <div className="flex gap-2">
      <input readOnly value={valor} aria-label={etiqueta} className="cfg-input font-mono text-[12.5px]" onFocus={(e) => e.target.select()} />
      <BotonCopiar texto={valor} />
    </div>
  </div>
);

export const Enlace = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="cfg-btn shrink-0 !h-8 text-[12.5px]">
    {children} <ExternalLink size={12} />
  </a>
);

export const Paso = ({ numero, hecho, titulo, enlaces = [], children }) => (
  <li className="flex gap-3 py-4 first:pt-1">
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold tabular-nums ${hecho
        ? 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]'
        : 'bg-[var(--color-primary-10)] text-[var(--color-primary)]'}`}
      aria-hidden="true"
    >
      {hecho ? <CheckCircle2 size={15} /> : numero}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-[var(--color-text)]">{titulo}</p>
        {enlaces.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {enlaces.map((e) => <Enlace key={e.href} href={e.href}>{e.texto}</Enlace>)}
          </div>
        )}
      </div>
      <div className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-[var(--color-text-dim)]">{children}</div>
    </div>
  </li>
);

/** Texto con **negritas** marcadas así en los textos traducidos. */
export const Rico = ({ texto, como: Etiqueta = 'p' }) => (
  <Etiqueta>
    {String(texto).split(/(\*\*[^*]+\*\*)/g).map((parte, i) => (
      parte.startsWith('**') && parte.endsWith('**')
        ? <strong key={i} className="font-semibold text-[var(--color-text)]">{parte.slice(2, -2)}</strong>
        : <span key={i}>{parte}</span>
    ))}
  </Etiqueta>
);

/** Sub-pasos (a, b, c…) de una misma pantalla. */
export const SubPasos = ({ textos }) => (
  <ol className="list-[lower-alpha] space-y-1.5 pl-5 marker:font-semibold marker:text-[var(--color-text)]">
    {textos.map((texto) => <Rico key={texto} como="li" texto={texto} />)}
  </ol>
);
