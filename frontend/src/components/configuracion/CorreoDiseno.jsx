// Pestañas "Diseño" y "Textos" de Correo y avisos, y la vista previa real de
// los correos. La vista previa la arma el servidor con el borrador sin
// guardar (es el mismo HTML que se envía), así lo que se ve es lo que llega.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, Image as IconoImagen, Loader2, Monitor, PaintBucket, RotateCcw, Send,
  Smartphone, Square, SquareDashed, Type, TriangleAlert,
} from 'lucide-react';
import { configuracionService } from '../../services/api';
import SelectorSimple from '../SelectorSimple';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { Campo, CampoColor, CampoImagen, Fila, Interruptor } from './PiezasConfiguracion';
import { OpcionesTarjeta } from './SeccionesSistema';

// ── Diseño ───────────────────────────────────────────────────────────────

const Chips = ({ etiqueta, valor, opciones, onChange }) => (
  <div>
    <p className="cfg-label">{etiqueta}</p>
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(({ valor: v, texto, icono: Icono }) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} onClick={() => onChange(v)} className={`cfg-chip ${valor === v ? 'cfg-chip-activo' : ''}`}>
          {Icono && <Icono size={13} aria-hidden="true" />} {texto}
        </button>
      ))}
    </div>
  </div>
);

export const DisenoCorreo = ({ diseno, colores, nombreSistema, cambiar, urlLogoCorreo, kbLogo, onSubir, onQuitar }) => {
  const { t } = usePreferences();
  const set = (campo) => (valor) => cambiar('disenoCorreo', campo, valor);

  return (
    <>
      <Fila titulo={t('emdHeader')} descripcion={t('emdHeaderHint')}>
        <OpcionesTarjeta
          nombre={t('emdHeader')}
          valor={diseno.cabecera}
          onChange={set('cabecera')}
          opciones={[
            { valor: 'color', icono: PaintBucket, titulo: t('emdHeaderColor'), texto: t('emdHeaderColorHint') },
            { valor: 'blanco', icono: Square, titulo: t('emdHeaderWhite'), texto: t('emdHeaderWhiteHint') },
            { valor: 'franja', icono: SquareDashed, titulo: t('emdHeaderStripe'), texto: t('emdHeaderStripeHint') },
          ]}
        />
        <div className="mt-5">
          <Chips
            etiqueta={t('emdAlign')}
            valor={diseno.alineacion}
            onChange={set('alineacion')}
            opciones={[
              { valor: 'izquierda', texto: t('emdAlignLeft'), icono: AlignLeft },
              { valor: 'centro', texto: t('emdAlignCenter'), icono: AlignCenter },
            ]}
          />
        </div>
      </Fila>

      <Fila titulo={t('emdLogo')} descripcion={t('emdLogoHint')}>
        <OpcionesTarjeta
          nombre={t('emdLogo')}
          valor={diseno.logo}
          onChange={set('logo')}
          columnas={2}
          opciones={[
            { valor: 'auto', icono: IconoImagen, titulo: t('emdLogoImage'), texto: t('emdLogoImageHint') },
            { valor: 'texto', icono: Type, titulo: t('emdLogoText'), texto: t('emdLogoTextHint', { nombre: nombreSistema }) },
          ]}
        />
        {diseno.logo === 'auto' && (
          <div className="mt-5 space-y-5">
            <div className="cfg-lista">
              <CampoImagen
                clave="logoCorreo"
                etiqueta={t('emdLogoFile')}
                ayuda={t('emdLogoFileHint')}
                url={urlLogoCorreo}
                maxKb={kbLogo}
                aceptar="image/png,image/jpeg"
                fondoOscuro={diseno.cabecera === 'color'}
                onSubir={onSubir}
                onQuitar={onQuitar}
              />
            </div>
            <Campo etiqueta={t('emdLogoHeight', { px: diseno.logoAltura })} htmlFor="emd-altura">
              <input id="emd-altura" type="range" min={20} max={80} step={2} value={diseno.logoAltura} onChange={(e) => set('logoAltura')(Number(e.target.value))} className="w-full max-w-sm accent-[var(--color-primary)]" />
            </Campo>
          </div>
        )}
      </Fila>

      <Fila titulo={t('emdShape')} descripcion={t('emdShapeHint')}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Chips
            etiqueta={t('emdCorners')}
            valor={diseno.esquinas}
            onChange={set('esquinas')}
            opciones={[
              { valor: 'redondeadas', texto: t('emdCornersRound') },
              { valor: 'rectas', texto: t('emdCornersSquare') },
            ]}
          />
          <Chips
            etiqueta={t('emdButton')}
            valor={diseno.boton}
            onChange={set('boton')}
            opciones={[
              { valor: 'redondeado', texto: t('emdButtonRound') },
              { valor: 'recto', texto: t('emdButtonSquare') },
              { valor: 'pildora', texto: t('emdButtonPill') },
            ]}
          />
        </div>
      </Fila>

      <Fila titulo={t('emdColors')} descripcion={t('emdColorsHint')}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Campo etiqueta={t('emdBackground')} ayuda={t('emdBackgroundHint')} htmlFor="emd-fondo">
            <CampoColor id="emd-fondo" valor={diseno.colorFondo} onChange={set('colorFondo')} fondoContraste="#ffffff" />
          </Campo>
          <div>
            <Interruptor
              id="emd-boton-marca"
              activo={!diseno.colorBoton}
              onChange={(v) => set('colorBoton')(v ? null : colores.primario)}
              etiqueta={t('emdButtonBrand')}
              ayuda={t('emdButtonBrandHint')}
            />
            {diseno.colorBoton && (
              <div className="mt-3">
                <CampoColor id="emd-color-boton" valor={diseno.colorBoton} onChange={set('colorBoton')} />
              </div>
            )}
          </div>
        </div>
      </Fila>

      <Fila titulo={t('emdFooter')} descripcion={t('emdFooterHint')}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Campo etiqueta={t('emdFooterText')} ayuda={t('emdFooterTextHint', { sistema: '{sistema}', empresa: '{empresa}' })} htmlFor="emd-pie" className="sm:col-span-2">
            <input id="emd-pie" className="cfg-input" maxLength={200} placeholder={`Correo automático de ${nombreSistema}. No respondas a este mensaje.`} value={diseno.pieTexto || ''} onChange={(e) => set('pieTexto')(e.target.value)} />
          </Campo>
          <Campo etiqueta={t('emdAddress')} htmlFor="emd-direccion" className="sm:col-span-2">
            <input id="emd-direccion" className="cfg-input" maxLength={160} placeholder={t('emdAddressPlaceholder')} value={diseno.direccion || ''} onChange={(e) => set('direccion')(e.target.value)} />
          </Campo>
          <Campo etiqueta={t('emdPhone')} htmlFor="emd-telefono">
            <input id="emd-telefono" type="tel" inputMode="tel" className="cfg-input" maxLength={40} placeholder="+52 55 1234 5678" value={diseno.telefono || ''} onChange={(e) => set('telefono')(e.target.value)} />
          </Campo>
          <Campo etiqueta={t('emdWebsite')} htmlFor="emd-sitio">
            <input id="emd-sitio" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="cfg-input" maxLength={200} placeholder="www.tuempresa.com" value={diseno.sitioWeb || ''} onChange={(e) => set('sitioWeb')(e.target.value)} />
          </Campo>
          <Campo etiqueta={t('emdLegal')} ayuda={t('emdLegalHint')} htmlFor="emd-legal" className="sm:col-span-2">
            <textarea id="emd-legal" rows={3} className="cfg-input" maxLength={600} placeholder={t('emdLegalPlaceholder')} value={diseno.textoLegal || ''} onChange={(e) => set('textoLegal')(e.target.value)} />
          </Campo>
        </div>
      </Fila>
    </>
  );
};

// ── Textos ───────────────────────────────────────────────────────────────

const CAMPOS = {
  asunto: { max: 150, filas: 0 },
  titulo: { max: 150, filas: 0 },
  cuerpo: { max: 2000, filas: 7 },
  boton: { max: 40, filas: 0 },
  nota: { max: 500, filas: 3 },
};

/** Lista de plantillas agrupada (Cuenta, Seguridad, Sistema). */
export const SelectorPlantilla = ({ id, plantillas, valor, onChange, personalizadas, className = '' }) => {
  const { t } = usePreferences();
  // Cada opcion lleva su grupo y SelectorSimple las lista bajo su titulo
  const opciones = useMemo(() => plantillas.map((p) => ({
    valor: p.id,
    etiqueta: `${p.nombre}${personalizadas?.[p.id] ? ` · ${t('emdCustomShort')}` : ''}`,
    grupo: p.grupo,
  })), [plantillas, personalizadas, t]);
  return <SelectorSimple id={id} valor={valor} onCambio={onChange} opciones={opciones} className={className} />;
};

export const TextosCorreo = ({ plantillas, plantillaId, onPlantilla, textos, onCambiar }) => {
  const { t } = usePreferences();
  const plantilla = plantillas.find((p) => p.id === plantillaId);
  const refs = useRef({});
  const ultimoCampo = useRef('cuerpo');
  const propios = textos[plantillaId] || {};
  const grupos = useMemo(() => plantillas.reduce((acc, p) => {
    (acc[p.grupo] = acc[p.grupo] || []).push(p);
    return acc;
  }, {}), [plantillas]);

  if (!plantilla) return null;

  // Texto que se muestra en el campo: el propio si existe; si no, el original.
  const valorDe = (campo) => (campo in propios ? propios[campo] : (plantilla.fabrica[campo] || ''));

  const cambiarCampo = (campo, valor) => {
    const siguiente = { ...propios, [campo]: valor };
    // Igual al original = no hace falta guardarlo. Vacío se guarda en el
    // borrador mientras escribes; al guardar, vacío vuelve al original.
    if (valor === (plantilla.fabrica[campo] || '')) delete siguiente[campo];
    const todos = { ...textos, [plantillaId]: siguiente };
    if (!Object.keys(siguiente).length) delete todos[plantillaId];
    onCambiar(todos);
  };

  const restaurar = () => {
    const todos = { ...textos };
    delete todos[plantillaId];
    onCambiar(todos);
  };

  // Inserta {variable} donde está el cursor del último campo enfocado.
  const insertarVariable = (clave) => {
    const campo = plantilla.campos.includes(ultimoCampo.current) ? ultimoCampo.current : 'cuerpo';
    const el = refs.current[campo];
    const actual = valorDe(campo);
    const inicio = el?.selectionStart ?? actual.length;
    const fin = el?.selectionEnd ?? actual.length;
    const token = `{${clave}}`;
    cambiarCampo(campo, actual.slice(0, inicio) + token + actual.slice(fin));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + token.length, inicio + token.length);
    });
  };

  const personalizada = Object.keys(propios).length > 0;

  return (
    <>
      <Fila titulo={t('emdTemplate')} descripcion={t('emdTemplateHint')}>
        <div className="space-y-4">
          {Object.entries(grupos).map(([grupo, lista]) => (
            <div key={grupo}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{grupo}</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="listbox" aria-label={grupo}>
                {lista.map((p) => {
                  const elegida = p.id === plantillaId;
                  const propia = Boolean(textos[p.id]);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={elegida}
                      onClick={() => onPlantilla(p.id)}
                      className={`flex items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors ${elegida ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)] font-semibold text-[var(--color-text)] shadow-[0_0_0_1px_var(--color-primary)]' : 'border-[var(--cfg-linea)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-3)]'}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                      {propia && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" title={t('emdCustom')} aria-label={t('emdCustom')} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Fila>

      <Fila
        titulo={plantilla.nombre}
        descripcion={plantilla.descripcion}
        extra={personalizada
          ? (
            <button type="button" className="cfg-btn cfg-btn-texto" onClick={restaurar}>
              <RotateCcw size={13} /> {t('emdRestore')}
            </button>
          )
          : <span className="cfg-ayuda !mt-0">{t('emdFactory')}</span>}
      >
        <div className="mb-5 rounded-[8px] bg-[var(--color-surface-3)] p-3">
          <p className="text-[12.5px] font-medium text-[var(--color-text)]">{t('emdVariables')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plantilla.variables.map((v) => (
              <button key={v.clave} type="button" className="cfg-chip !h-7 !px-2 font-mono !text-[12px]" title={v.descripcion} onMouseDown={(e) => e.preventDefault()} onClick={() => insertarVariable(v.clave)}>
                {`{${v.clave}}`}
              </button>
            ))}
          </div>
          <p className="cfg-ayuda !mt-2">{t('emdFormatHint')}</p>
        </div>

        <div className="space-y-5">
          {plantilla.campos.map((campo) => {
            const { max, filas } = CAMPOS[campo];
            const valor = valorDe(campo);
            const editado = campo in propios;
            const comun = {
              id: `emd-${campo}`,
              ref: (el) => { refs.current[campo] = el; },
              className: 'cfg-input',
              maxLength: max,
              value: valor,
              placeholder: plantilla.fabrica[campo] || '',
              onFocus: () => { ultimoCampo.current = campo; },
              onChange: (e) => cambiarCampo(campo, e.target.value),
            };
            return (
              <Campo
                key={campo}
                etiqueta={(
                  <span className="flex items-center gap-2">
                    {t(`emdField_${campo}`)}
                    {editado && <span className="cfg-sello" data-nivel="AAA">{t('emdCustom')}</span>}
                  </span>
                )}
                htmlFor={`emd-${campo}`}
                ayuda={(
                  <span className="flex items-center justify-between gap-3">
                    <span>{editado && !valor.trim() ? t('emdEmptyField') : ''}</span>
                    <span className="flex items-center gap-3">
                      {editado && (
                        <button type="button" className="auth-link text-[12px]" onClick={() => cambiarCampo(campo, plantilla.fabrica[campo] || '')}>
                          {t('emdUseOriginal')}
                        </button>
                      )}
                      <span className="tabular-nums">{valor.length}/{max}</span>
                    </span>
                  </span>
                )}
              >
                {filas ? <textarea rows={filas} {...comun} /> : <input {...comun} />}
              </Campo>
            );
          })}
        </div>
      </Fila>
    </>
  );
};

// ── Vista previa ─────────────────────────────────────────────────────────

export const VistaCorreo = ({ borrador, plantillas, plantillaId, onPlantilla, emailPorDefecto, cambiosSinGuardar }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [vista, setVista] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [movil, setMovil] = useState(false);
  const [alto, setAlto] = useState(640);
  const [destino, setDestino] = useState(emailPorDefecto || '');
  const [enviando, setEnviando] = useState(false);
  const iframe = useRef(null);

  // Solo lo que cambia el correo; así escribir en otras secciones no recarga.
  const datos = useMemo(() => ({
    marca: borrador.marca,
    colores: borrador.colores,
    disenoCorreo: borrador.disenoCorreo,
    textosCorreo: borrador.textosCorreo,
  }), [borrador.marca, borrador.colores, borrador.disenoCorreo, borrador.textosCorreo]);

  useEffect(() => {
    const control = new AbortController();
    const temporizador = setTimeout(async () => {
      setCargando(true);
      try {
        const r = await configuracionService.vistaPreviaCorreo(plantillaId, datos, control.signal);
        setVista(r);
        setError('');
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!control.signal.aborted) setCargando(false);
      }
    }, 300);
    return () => { clearTimeout(temporizador); control.abort(); };
  }, [plantillaId, datos]);

  const ajustarAlto = () => {
    const doc = iframe.current?.contentDocument;
    if (doc?.body) setAlto(Math.min(Math.max(doc.body.scrollHeight + 8, 360), 1400));
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await configuracionService.correoPrueba(destino, plantillaId);
      showToast(r.mensaje, r.simulado ? 'info' : 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const remitente = borrador.reglas.remitenteCorreo || borrador.marca.nombreSistema;
  const sinLogo = vista && !vista.logo && borrador.disenoCorreo.logo === 'auto';

  return (
    <section className="cfg-bloque !p-0 overflow-hidden" aria-label={t('emdPreview')}>
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--cfg-linea)] px-4 py-3">
        <SelectorPlantilla plantillas={plantillas} valor={plantillaId} onChange={onPlantilla} personalizadas={borrador.textosCorreo} className="!h-8 !min-h-0 !py-0 min-w-0 flex-1 !text-[12.5px]" />
        <div className="cfg-segmento">
          <button type="button" aria-pressed={!movil} onClick={() => setMovil(false)} aria-label={t('emdDesktop')} title={t('emdDesktop')}><Monitor size={13} /></button>
          <button type="button" aria-pressed={movil} onClick={() => setMovil(true)} aria-label={t('emdMobile')} title={t('emdMobile')}><Smartphone size={13} /></button>
        </div>
        {cargando && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" aria-label={t('loading')} />}
      </header>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[var(--cfg-linea)] px-4 py-3 text-[12.5px]">
        <dt className="text-[var(--color-text-muted)]">{t('emdFrom')}</dt>
        <dd className="truncate font-medium text-[var(--color-text)]">{remitente}</dd>
        <dt className="text-[var(--color-text-muted)]">{t('emdSubject')}</dt>
        <dd className="truncate font-semibold text-[var(--color-text)]" title={vista?.asunto}>{vista?.asunto || '…'}</dd>
      </dl>

      <div className="flex justify-center bg-[var(--color-surface-3)] p-3">
        {error ? (
          <p className="flex items-center gap-2 py-16 text-[13px] text-[var(--color-error)]"><TriangleAlert size={15} /> {error}</p>
        ) : (
          <iframe
            ref={iframe}
            title={t('emdPreview')}
            srcDoc={vista?.html || ''}
            sandbox="allow-same-origin"
            onLoad={ajustarAlto}
            className="max-w-full rounded-[6px] border border-[var(--cfg-linea)] bg-white transition-[width] duration-200"
            style={{ width: movil ? 375 : '100%', height: alto }}
          />
        )}
      </div>

      {sinLogo && (
        <p className="flex items-start gap-2 border-t border-[var(--cfg-linea)] px-4 py-2.5 text-[12px] text-[var(--color-text-dim)]">
          <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--color-warning)]" /> {t('emdNoLogo')}
        </p>
      )}

      <div className="border-t border-[var(--cfg-linea)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input type="email" aria-label={t('mailTestTo')} className="cfg-input !h-9 min-w-[12rem] flex-1" value={destino} onChange={(e) => setDestino(e.target.value)} />
          <button type="button" className="cfg-btn h-9" onClick={enviar} disabled={enviando || !destino || cambiosSinGuardar}>
            {enviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t('emdSendThis')}
          </button>
        </div>
        <p className="cfg-ayuda">{cambiosSinGuardar ? <span className="text-[var(--color-warning)]">{t('emdSaveFirst')}</span> : t('emdSendHint')}</p>
      </div>
    </section>
  );
};
