// Piezas comunes de las pantallas de autenticación: encabezado, avisos,
// campos (con icono, ver/ocultar contraseña y aviso de Bloq Mayús), botón con
// estado de carga, indicador de pasos, medidor de contraseña y código de 6
// dígitos. Estilos en src/auth.css.
import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Circle, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { evaluarPassword } from '../../utils/politicaPassword';

export const AuthHeader = ({ icono: Icono, tono, titulo, subtitulo, children }) => (
  <div className="mb-8">
    {Icono && (
      <span className="auth-hero-icon" data-tono={tono} aria-hidden="true">
        <Icono size={24} strokeWidth={2} />
      </span>
    )}
    <h1 className="auth-title">{titulo}</h1>
    {subtitulo && <p className="auth-subtitle">{subtitulo}</p>}
    {children}
  </div>
);

const ICONOS_AVISO = { error: AlertCircle, exito: CheckCircle2, aviso: AlertTriangle, info: Info };

export const AuthAlert = ({ tono = 'error', children, detalles = [], className = '' }) => {
  if (!children) return null;
  const Icono = ICONOS_AVISO[tono] || Info;
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} data-tono={tono} className={`auth-alert ${className}`}>
      <Icono size={17} aria-hidden="true" />
      <div className="min-w-0">
        <div>{children}</div>
        {detalles.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[0.8rem] opacity-90">
            {detalles.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
};

export const CampoTexto = ({ id, label, icono: Icono, extraLabel, className = '', ...props }) => {
  const idGenerado = useId();
  const idCampo = id || idGenerado;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="auth-label" htmlFor={idCampo}>{label}</label>
        {extraLabel}
      </div>
      <div className="auth-field">
        {Icono && <Icono size={18} className="auth-field-icon" aria-hidden="true" />}
        <input id={idCampo} className={`auth-input ${Icono ? 'con-icono' : ''}`} {...props} />
      </div>
    </div>
  );
};

/** Campo de contraseña con ver/ocultar y aviso de Bloq Mayús activado. */
export const CampoPassword = ({ id, label, icono: Icono, extraLabel, className = '', describedBy, ...props }) => {
  const { t } = usePreferences();
  const idGenerado = useId();
  const idCampo = id || idGenerado;
  const idMayus = `${idCampo}-mayus`;
  const [visible, setVisible] = useState(false);
  const [mayus, setMayus] = useState(false);

  const revisarMayus = (event) => {
    if (typeof event.getModifierState === 'function') setMayus(event.getModifierState('CapsLock'));
  };

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="auth-label" htmlFor={idCampo}>{label}</label>
        {extraLabel}
      </div>
      <div className="auth-field">
        {Icono && <Icono size={18} className="auth-field-icon" aria-hidden="true" />}
        <input
          id={idCampo}
          type={visible ? 'text' : 'password'}
          className={`auth-input con-accion ${Icono ? 'con-icono' : ''}`}
          onKeyUp={revisarMayus}
          onKeyDown={revisarMayus}
          onBlur={() => setMayus(false)}
          aria-describedby={[describedBy, mayus ? idMayus : null].filter(Boolean).join(' ') || undefined}
          autoCapitalize="none"
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          className="auth-field-action"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-pressed={visible}
          title={visible ? t('hidePassword') : t('showPassword')}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {mayus && (
        <p id={idMayus} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-warning)]" role="status">
          <AlertTriangle size={13} aria-hidden="true" /> {t('authCapsLock')}
        </p>
      )}
    </div>
  );
};

export const BotonAuth = ({ cargando, textoCargando, children, variante = 'primario', className = '', type = 'submit', ...props }) => (
  <button
    type={type}
    className={`auth-btn ${variante === 'secundario' ? 'auth-btn-secundario' : ''} ${className}`}
    disabled={cargando || props.disabled}
    aria-busy={cargando || undefined}
    {...props}
  >
    {cargando ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
    {cargando ? textoCargando : children}
  </button>
);

/** Indicador de pasos del registro. `actual` es el índice (0, 1, 2). */
export const PasosRegistro = ({ actual, pasos }) => {
  const { t } = usePreferences();
  return (
    <ol className="auth-steps" aria-label={t('authStepsLabel')}>
      {pasos.map((texto, i) => {
        const estado = i < actual ? 'hecho' : i === actual ? 'actual' : 'pendiente';
        return (
          <li key={texto} className="contents">
            {i > 0 && <span className="auth-step-line" aria-hidden="true" />}
            <span className="auth-step" data-estado={estado} aria-current={estado === 'actual' ? 'step' : undefined}>
              <span className="auth-step-dot">{estado === 'hecho' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
              <span className="auth-step-texto">{texto}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const COLOR_NIVEL = ['var(--color-border)', 'var(--color-error)', 'var(--color-warning)', 'var(--color-accent-success)', 'var(--color-accent-success)'];
const TEXTO_NIVEL = ['authStrengthEmpty', 'authStrengthWeak', 'authStrengthOk', 'authStrengthStrong', 'authStrengthExcellent'];

/** Barra de seguridad + lista de requisitos, en vivo mientras se escribe. */
export const MedidorPassword = ({ password, contexto, id }) => {
  const { t } = usePreferences();
  const { reglas, nivel } = evaluarPassword(password, contexto);

  return (
    <div id={id} className="mt-3 space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="auth-meter flex-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} style={{ background: i <= nivel ? COLOR_NIVEL[nivel] : undefined }} />
          ))}
        </div>
        <span className="shrink-0 whitespace-nowrap text-right text-xs font-medium text-[var(--color-text-muted)]" aria-live="polite">
          {t(TEXTO_NIVEL[nivel])}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {reglas.map((regla) => (
          <li key={regla.clave} className="auth-req" data-ok={regla.ok}>
            {regla.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
            <span>{t(regla.textoKey, regla.vars)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Código de 6 dígitos en casillas separadas. Acepta pegar el código entero,
 * avanza y retrocede solo, y llama a `onCompleto` al llenar la última.
 */

export const CodigoOtp = ({ valor, onChange, onCompleto, invalido = false, deshabilitado = false, autoFocus = true }) => {
  const { t } = usePreferences();
  const refs = useRef([]);
  const digitos = Array.from({ length: 6 }, (_, i) => valor[i] || '');
  // El valor recien escrito, antes de que React vuelva a pintar. Al pasar el
  // foco a la casilla siguiente su onFocus todavia ve el `valor` anterior: con
  // el viejo, el primer digito mandaba el foco de vuelta a la primera casilla y
  // el siguiente lo reemplazaba ("234" quedaba "34").
  const actual = useRef(valor);
  useEffect(() => { actual.current = valor; }, [valor]);
  const cambiar = (nuevo) => {
    actual.current = nuevo;
    onChange(nuevo);
  };

  const fijar = (nuevo) => {
    const limpio = nuevo.replace(/\D/g, '').slice(0, 6);
    cambiar(limpio);
    if (limpio.length === 6) onCompleto?.(limpio);
    return limpio;
  };

  // Tras un codigo erroneo la pagina vacia el valor y, mientras verificaba,
  // las casillas estaban deshabilitadas (el foco se perdio): se vuelve a la
  // primera para teclear otra vez sin tener que tocarla.
  useEffect(() => {
    if (autoFocus && !deshabilitado && !valor) refs.current[0]?.focus();
  }, [autoFocus, deshabilitado, valor]);

  const alEscribir = (indice, event) => {
    const entrada = event.target.value.replace(/\D/g, '');
    if (!entrada) {
      // Teclados de Android: el borrado no siempre llega como keydown
      // 'Backspace' (llega 'Unidentified'), solo como cambio a vacio.
      if (event.target.value === '' && digitos[indice]) {
        const arreglo = [...digitos];
        arreglo[indice] = '';
        cambiar(arreglo.join('').slice(0, 6));
      }
      return;
    }
    if (entrada.length > 1) {
      // Autocompletado del sistema (iOS/Android) o pegado dentro de una casilla.
      const limpio = fijar(entrada);
      refs.current[Math.min(limpio.length, 5)]?.focus();
      return;
    }
    const arreglo = [...digitos];
    arreglo[indice] = entrada;
    const limpio = fijar(arreglo.join(''));
    if (indice < 5 && limpio.length > indice) refs.current[indice + 1]?.focus();
  };

  const alTeclear = (indice, event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const arreglo = [...digitos];
      if (arreglo[indice]) {
        arreglo[indice] = '';
      } else if (indice > 0) {
        arreglo[indice - 1] = '';
        refs.current[indice - 1]?.focus();
      }
      cambiar(arreglo.join('').slice(0, 6));
    } else if (event.key === 'ArrowLeft' && indice > 0) {
      refs.current[indice - 1]?.focus();
    } else if (event.key === 'ArrowRight' && indice < 5) {
      refs.current[indice + 1]?.focus();
    }
  };

  const alPegar = (event) => {
    event.preventDefault();
    const limpio = fijar(event.clipboardData.getData('text'));
    refs.current[Math.min(limpio.length, 5)]?.focus();
  };

  return (
    <div className="auth-otp" role="group" aria-label={t('authCodeLabel')} aria-invalid={invalido || undefined}>
      {digitos.map((digito, i) => (
        <span key={i} className="contents">
          {i === 3 && <span className="auth-otp-sep" aria-hidden="true" />}
          <input
            ref={(el) => { refs.current[i] = el; }}
            className="auth-otp-cell"
            data-lleno={Boolean(digito)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={i === 0 ? 6 : 1}
            value={digito}
            disabled={deshabilitado}
            autoFocus={autoFocus && i === 0}
            aria-label={t('authCodeDigit', { n: i + 1 })}
            onChange={(e) => alEscribir(i, e)}
            onKeyDown={(e) => alTeclear(i, e)}
            onPaste={alPegar}
            onFocus={(e) => {
              // El valor no admite huecos: tocar una casilla mas alla de la
              // primera vacia lleva a esa, para que el digito caiga donde se ve.
              const largo = actual.current.length;
              if (i > largo) { refs.current[largo]?.focus(); return; }
              e.target.select();
            }}
          />
        </span>
      ))}
    </div>
  );
};
