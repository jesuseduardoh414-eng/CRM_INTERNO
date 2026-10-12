// Sección "Seguridad de la cuenta" del perfil:
//  - resumen (2FA, último acceso, último cambio de contraseña),
//  - cambiar contraseña (cierra las demás sesiones),
//  - verificación en dos pasos: activar con QR, códigos de respaldo, desactivar,
//  - sesiones abiertas por dispositivo, con cierre individual o de todas las demás,
//  - bitácora de eventos de seguridad.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import {
  Activity, AlertTriangle, CheckCircle2, Copy, Download, KeyRound, LockKeyhole, LogIn, LogOut,
  Monitor, ShieldAlert, ShieldCheck, ShieldOff, Smartphone, XCircle,
} from 'lucide-react';
import { authService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePreferences } from '../context/PreferencesContext';
import { evaluarPassword } from '../utils/politicaPassword';
import Modal from './Modal';
import { useConfirmacion } from './ConfirmDialog';
import { AuthAlert, BotonAuth, CampoPassword, CampoTexto, CodigoOtp, MedidorPassword } from './auth/AuthUI';

const TARJETA = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 shadow-[0_1px_2px_rgb(15_23_42/0.05)]';

// Eventos que conviene resaltar como sospechosos en la bitácora.
const EVENTOS_ALERTA = new Set(['login_fallido', 'login_bloqueado', 'cuenta_bloqueada', '2fa_fallido', 'sesion_reutilizada']);
const ICONO_EVENTO = {
  login_ok: LogIn,
  logout: LogOut,
  logout_todas: LogOut,
  sesion_revocada: LogOut,
  password_cambiada: KeyRound,
  password_restablecida: KeyRound,
  recuperacion_solicitada: KeyRound,
  '2fa_activado': ShieldCheck,
  '2fa_desactivado': ShieldOff,
  codigos_respaldo_regenerados: ShieldCheck,
  codigo_respaldo_usado: ShieldCheck,
};

/** Navegador y sistema a partir del User-Agent (aproximado, solo para mostrar). */
const describirDispositivo = (ua = '') => {
  const texto = String(ua);
  const navegador = /Edg\//.test(texto) ? 'Edge'
    : /OPR\/|Opera/.test(texto) ? 'Opera'
      : /Firefox\//.test(texto) ? 'Firefox'
        : /Chrome\//.test(texto) ? 'Chrome'
          : /Safari\//.test(texto) ? 'Safari'
            : null;
  const sistema = /Windows/.test(texto) ? 'Windows'
    : /iPhone|iPad/.test(texto) ? 'iOS'
      : /Android/.test(texto) ? 'Android'
        : /Mac OS X|Macintosh/.test(texto) ? 'macOS'
          : /Linux/.test(texto) ? 'Linux'
            : null;
  const movil = /Mobile|Android|iPhone|iPad/.test(texto);
  return { navegador, sistema, movil };
};

const descargarTexto = (nombre, contenido) => {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};

// ── Lista de códigos de respaldo (se muestra una sola vez) ───────────────
const CodigosRespaldo = ({ codigos, onListo }) => {
  const { t } = usePreferences();
  const [copiado, setCopiado] = useState(false);
  const texto = codigos.join('\n');

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin permiso de portapapeles: queda la descarga */ }
  };

  return (
    <div className="space-y-5">
      <AuthAlert tono="aviso">{t('sec2faBackupText')}</AuthAlert>
      <ul className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-3)] p-4 font-mono text-sm tracking-wider text-[var(--color-text)]">
        {codigos.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <BotonAuth type="button" variante="secundario" onClick={copiar}>
          {copiado ? <CheckCircle2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copiado ? t('sec2faCopied') : t('sec2faCopy')}
        </BotonAuth>
        <BotonAuth type="button" variante="secundario" onClick={() => descargarTexto('codigos-respaldo.txt', `${t('appName')} — códigos de respaldo\n\n${texto}\n`)}>
          <Download size={16} aria-hidden="true" /> {t('sec2faDownload')}
        </BotonAuth>
      </div>
      <BotonAuth type="button" onClick={onListo}>{t('sec2faSavedDone')}</BotonAuth>
    </div>
  );
};

// ── Asistente para activar 2FA: contraseña -> QR + código -> códigos ─────
export const ModalActivar2fa = ({ open, onClose, onActivado }) => {
  const { t } = usePreferences();
  const [paso, setPaso] = useState('password');
  const [password, setPassword] = useState('');
  const [config, setConfig] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [codigos, setCodigos] = useState([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cerrar = () => {
    if (paso === 'codigos') onActivado();
    setPaso('password'); setPassword(''); setConfig(null); setCodigo(''); setCodigos([]); setError('');
    onClose();
  };

  const pedirQr = async (e) => {
    e.preventDefault();
    setCargando(true); setError('');
    try {
      setConfig(await authService.configurar2fa(password));
      setPassword('');
      setPaso('qr');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  const activar = async (valor = codigo) => {
    if (valor.length !== 6 || cargando) return;
    setCargando(true); setError('');
    try {
      const data = await authService.activar2fa(valor);
      setCodigos(data.codigosRespaldo);
      setPaso('codigos');
    } catch (err) {
      setError(err.message);
      setCodigo('');
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} maxWidth="480px" title={paso === 'codigos' ? t('sec2faBackupTitle') : t('sec2faTitle')}>
      {paso === 'password' && (
        <form onSubmit={pedirQr} className="space-y-5">
          <p className="text-sm text-[var(--color-text-muted)]">{t('sec2faStepPassword')}</p>
          {error && <AuthAlert>{error}</AuthAlert>}
          <CampoPassword label={t('perfilCurrentPassword')} icono={LockKeyhole} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
          <BotonAuth cargando={cargando} textoCargando={t('authVerifyingShort')} disabled={!password}>{t('secContinue')}</BotonAuth>
        </form>
      )}

      {paso === 'qr' && config && (
        <form onSubmit={(e) => { e.preventDefault(); activar(); }} className="space-y-5">
          <p className="text-sm text-[var(--color-text-muted)]">{t('sec2faStepScan')}</p>
          <div className="flex justify-center">
            <img src={config.qr} alt="QR" width={200} height={200} className="h-auto max-w-full rounded-2xl border border-[var(--color-border)] bg-white p-2" />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{t('sec2faManual')}</p>
            <code className="block select-all break-all rounded-xl bg-[var(--color-surface-3)] px-3 py-2 text-center font-mono text-sm tracking-widest text-[var(--color-text)]">
              {config.secreto.match(/.{1,4}/g).join(' ')}
            </code>
          </div>
          {error && <AuthAlert>{error}</AuthAlert>}
          <div>
            <span className="auth-label">{t('sec2faEnterCode')}</span>
            <CodigoOtp valor={codigo} onChange={setCodigo} onCompleto={activar} invalido={Boolean(error)} deshabilitado={cargando} autoFocus={false} />
          </div>
          <BotonAuth cargando={cargando} textoCargando={t('authVerifyingShort')} disabled={codigo.length !== 6}>{t('sec2faEnable')}</BotonAuth>
        </form>
      )}

      {paso === 'codigos' && <CodigosRespaldo codigos={codigos} onListo={cerrar} />}
    </Modal>
  );
};

// ── Desactivar 2FA o regenerar códigos (ambos piden confirmación) ────────
const ModalGestion2fa = ({ open, modo, onClose, onHecho }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigos, setCodigos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const desactivar = modo === 'desactivar';

  const cerrar = () => {
    if (codigos) onHecho();
    setPassword(''); setCodigo(''); setCodigos(null); setError('');
    onClose();
  };

  const enviar = async (e) => {
    e.preventDefault();
    setCargando(true); setError('');
    try {
      if (desactivar) {
        await authService.desactivar2fa(password, codigo.trim());
        showToast(t('sec2faDisabled'), 'success');
        setPassword(''); setCodigo('');
        onHecho();
        onClose();
      } else {
        const data = await authService.regenerarCodigos(password);
        setCodigos(data.codigosRespaldo);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} maxWidth="480px" title={desactivar ? t('sec2faDisable') : t('sec2faRegenerate')}>
      {codigos ? (
        <CodigosRespaldo codigos={codigos} onListo={cerrar} />
      ) : (
        <form onSubmit={enviar} className="space-y-5">
          <p className="text-sm text-[var(--color-text-muted)]">{desactivar ? t('sec2faDisableText') : t('sec2faStepPassword')}</p>
          {error && <AuthAlert>{error}</AuthAlert>}
          <CampoPassword label={t('perfilCurrentPassword')} icono={LockKeyhole} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
          {desactivar && (
            <CampoTexto label={t('sec2faCodeOrBackup')} icono={ShieldCheck} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={11} required />
          )}
          <BotonAuth cargando={cargando} textoCargando={t('authVerifyingShort')} disabled={!password || (desactivar && !codigo.trim())}>
            {desactivar ? t('sec2faDisable') : t('sec2faRegenerate')}
          </BotonAuth>
        </form>
      )}
    </Modal>
  );
};

// ── Cambiar contraseña ───────────────────────────────────────────────────
export const CambiarPassword = ({ usuario, onCambiada = () => {} }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [form, setForm] = useState({ actual: '', nueva: '', confirmar: '' });
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const contexto = useMemo(() => ({ email: usuario?.email, nombre: usuario?.nombre }), [usuario]);
  const evaluacion = evaluarPassword(form.nueva, contexto);
  const coinciden = form.confirmar.length > 0 && form.confirmar === form.nueva;

  const cambiar = (e) => { setForm((p) => ({ ...p, [e.target.name]: e.target.value })); setError(null); };

  const enviar = async (e) => {
    e.preventDefault();
    if (!evaluacion.valida) { setError({ texto: t('authPasswordRequirementsError') }); return; }
    if (!coinciden) { setError({ texto: t('authPasswordsMismatch') }); return; }
    setCargando(true); setError(null);
    try {
      const data = await authService.cambiarPassword(form.actual, form.nueva);
      setForm({ actual: '', nueva: '', confirmar: '' });
      showToast(data.sesionesCerradas > 0 ? t('secPasswordUpdatedOthers', { n: data.sesionesCerradas }) : t('secPasswordUpdated'), 'success');
      onCambiada();
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setCargando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="pf-panel flex flex-col" noValidate>
      <div className="pf-panel-cabecera">
        <span className="pf-panel-icono" aria-hidden="true"><KeyRound size={18} /></span>
        <div>
          <h2 className="pf-panel-titulo">{t('secChangePassword')}</h2>
          <p className="pf-panel-ayuda">{t('secChangePasswordHint')}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      {error && <AuthAlert detalles={error.detalles}>{error.texto}</AuthAlert>}
      {/* Campo oculto con el correo: los gestores de contraseñas lo usan para guardar la nueva. */}
      <input type="email" name="username" autoComplete="username" value={usuario?.email || ''} readOnly hidden />
      <CampoPassword name="actual" label={t('perfilCurrentPassword')} icono={LockKeyhole} autoComplete="current-password" value={form.actual} onChange={cambiar} maxLength={200} required />
      <div>
        <CampoPassword name="nueva" label={t('authNewPassword')} icono={LockKeyhole} autoComplete="new-password" value={form.nueva} onChange={cambiar} maxLength={128} describedBy="seg-medidor" required />
        {form.nueva && <MedidorPassword id="seg-medidor" password={form.nueva} contexto={contexto} />}
      </div>
      <CampoPassword
        name="confirmar"
        label={t('authConfirmPassword')}
        icono={LockKeyhole}
        autoComplete="new-password"
        value={form.confirmar}
        onChange={cambiar}
        maxLength={128}
        aria-invalid={form.confirmar.length > 0 && !coinciden}
        required
      />
      <div className="mt-auto pt-2">
        <BotonAuth cargando={cargando} textoCargando={t('authUpdating')} disabled={!form.actual || !form.nueva || !form.confirmar}>
          {t('secUpdatePassword')}
        </BotonAuth>
      </div>
      </div>
    </form>
  );
};

// ── Sección completa ─────────────────────────────────────────────────────
const pedirDatosSeguridad = async () => {
  const [resumen, sesiones, eventos] = await Promise.all([authService.seguridad(), authService.sesiones(), authService.eventos(25)]);
  return { resumen, sesiones, eventos };
};

const SeguridadCuenta = () => {
  const { t, language } = usePreferences();
  const { logout, updateUsuario } = useAuth();
  const { showToast } = useToast();
  const [datos, setDatos] = useState({ resumen: null, sesiones: [], eventos: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState(null); // 'activar' | 'desactivar' | 'regenerar'

  const localeFechas = language === 'en' ? enUS : es;
  const hace = (fecha) => (fecha ? formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: localeFechas }) : t('secNever'));

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedirDatosSeguridad());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let cancelado = false;
    pedirDatosSeguridad()
      .then((nuevos) => { if (!cancelado) { setDatos(nuevos); setError(false); } })
      .catch(() => { if (!cancelado) setError(true); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, []);

  const alCambiar2fa = async () => {
    await cargar();
    try { updateUsuario({ dosFactoresActivo: !datos.resumen?.dosFactoresActivo }); } catch { /* solo informativo */ }
  };

  // Sesión que se está cerrando: bloquea los botones mientras tanto, para que
  // un doble toque no mande dos peticiones (la segunda daba error).
  const [cerrandoId, setCerrandoId] = useState(null);
  const { confirmar, dialogo } = useConfirmacion();

  const cerrarSesion = async (sesion) => {
    // Cerrar la sesion actual saca al usuario del CRM: se pregunta antes.
    if (sesion.actual) {
      const ok = await confirmar({
        titulo: t('secCloseCurrentTitle'),
        descripcion: t('secCloseCurrentText'),
        textoConfirmar: t('secCloseSession'),
        peligro: true,
      });
      if (!ok) return;
    }
    setCerrandoId(sesion.id);
    try {
      await authService.cerrarSesion(sesion.id);
      if (sesion.actual) { logout(); return; }
      showToast(t('secSessionClosed'), 'success');
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCerrandoId(null);
    }
  };

  const cerrarOtras = async () => {
    setCerrandoId('otras');
    try {
      const data = await authService.cerrarOtrasSesiones();
      showToast(data.mensaje, 'success');
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCerrandoId(null);
    }
  };

  const { resumen, sesiones, eventos } = datos;
  const activo2fa = Boolean(resumen?.dosFactoresActivo);
  const otras = sesiones.filter((s) => !s.actual);

  return (
    <section id="seguridad" className="space-y-6" aria-labelledby="seguridad-titulo">
      <div className={`${TARJETA} relative overflow-hidden`}>
        {/* En fila solo desde xl: a 1024px, con el menu lateral, el texto y
            las tres cifras se estrujaban uno contra otro. */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: activo2fa ? 'var(--badge-success-bg)' : 'var(--badge-warning-bg)', color: activo2fa ? 'var(--badge-success-fg)' : 'var(--badge-warning-fg)' }}
              aria-hidden="true"
            >
              {activo2fa ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
            </span>
            <div>
              <h2 id="seguridad-titulo" className="text-xl font-semibold text-[var(--color-text)]">{t('secTitle')}</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('secIntro')}</p>
            </div>
          </div>
          {resumen && (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[
                { k: t('sec2faTitle'), v: activo2fa ? t('sec2faOn') : t('sec2faOff') },
                { k: t('secLastLogin'), v: hace(resumen.ultimoLoginEn) },
                { k: t('secPasswordChanged'), v: hace(resumen.passwordCambiadoEn) },
              ].map(({ k, v }) => (
                <div key={k} className="rounded-2xl bg-[var(--color-surface-3)] px-4 py-2.5">
                  <dt className="text-xs text-[var(--color-text-muted)]">{k}</dt>
                  <dd className="mt-0.5 font-medium text-[var(--color-text)]">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {error && <AuthAlert className="mt-5">{t('secLoadError')}</AuthAlert>}
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className={`${TARJETA} flex flex-col`}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"><ShieldCheck size={18} aria-hidden="true" /> {t('sec2faTitle')}</h3>
            <span className={activo2fa ? 'badge-success' : 'badge-neutral'}>{activo2fa ? t('sec2faOn') : t('sec2faOff')}</span>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{activo2fa ? t('sec2faOnText') : t('sec2faOffText')}</p>

          {activo2fa && resumen && (
            <p className={`mt-4 flex items-center gap-2 text-sm font-medium ${resumen.codigosRespaldoRestantes <= 3 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-dim)]'}`}>
              {resumen.codigosRespaldoRestantes <= 3 && <AlertTriangle size={15} aria-hidden="true" />}
              {t('sec2faBackupLeft', { n: resumen.codigosRespaldoRestantes })}
            </p>
          )}

          <div className="mt-auto flex flex-col gap-3 pt-6 sm:flex-row sm:[&>button]:w-auto">
            {activo2fa ? (
              <>
                <BotonAuth type="button" variante="secundario" onClick={() => setModal('regenerar')}>{t('sec2faRegenerate')}</BotonAuth>
                <BotonAuth type="button" variante="secundario" onClick={() => setModal('desactivar')}>
                  <ShieldOff size={16} aria-hidden="true" /> {t('sec2faDisable')}
                </BotonAuth>
              </>
            ) : (
              <BotonAuth type="button" onClick={() => setModal('activar')} disabled={cargando}>
                <ShieldCheck size={16} aria-hidden="true" /> {t('sec2faEnable')}
              </BotonAuth>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className={TARJETA}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"><Monitor size={18} aria-hidden="true" /> {t('secSessionsTitle')}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('secSessionsHint')}</p>
            </div>
            {otras.length > 0 && (
              <button type="button" className="auth-link min-h-10 text-sm disabled:opacity-50" onClick={cerrarOtras} disabled={cerrandoId !== null}>{t('secCloseOthers')}</button>
            )}
          </div>

          <ul className="mt-5 space-y-3">
            {sesiones.map((sesion) => {
              const { navegador, sistema, movil } = describirDispositivo(sesion.userAgent);
              const Icono = movil ? Smartphone : Monitor;
              const nombre = [navegador, sistema].filter(Boolean).join(' · ') || t('secUnknownDevice');
              return (
                // flex-wrap: en 360px el botón baja a su propia línea en vez de
                // dejar el nombre del dispositivo en una columna de tres letras.
                <li key={sesion.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-3 sm:px-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-text-muted)]" aria-hidden="true">
                    <Icono size={18} />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                      {nombre}
                      {sesion.actual && <span className="badge-success">{t('secThisDevice')}</span>}
                      {sesion.recordar && <span className="badge-neutral">{t('secRemembered')}</span>}
                    </p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {sesion.ip || '—'} · {t('secLastActive', { when: hace(sesion.ultimoUso) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cerrarSesion(sesion)}
                    disabled={cerrandoId !== null}
                    aria-busy={cerrandoId === sesion.id}
                    className="ml-auto min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold text-[var(--color-error)] transition-colors hover:bg-[var(--badge-danger-bg)] disabled:opacity-50"
                  >
                    {t('secCloseSession')}
                  </button>
                </li>
              );
            })}
          </ul>
          {!cargando && otras.length === 0 && (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('secNoOtherSessions')}</p>
          )}
        </div>

        <div className={TARJETA}>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"><Activity size={18} aria-hidden="true" /> {t('secActivityTitle')}</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('secActivityHint')}</p>

          {!cargando && eventos.length === 0 && <p className="mt-5 text-sm text-[var(--color-text-muted)]">{t('secNoActivity')}</p>}
          <ol className="mt-5 max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {eventos.map((evento) => {
              const alerta = EVENTOS_ALERTA.has(evento.tipo);
              const Icono = alerta ? XCircle : ICONO_EVENTO[evento.tipo] || CheckCircle2;
              const { navegador, sistema } = describirDispositivo(evento.userAgent);
              return (
                <li key={evento.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-[var(--color-surface-3)]">
                  <Icono size={16} className={`mt-0.5 shrink-0 ${alerta ? 'text-[var(--color-error)]' : 'text-[var(--color-text-muted)]'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${alerta ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'}`}>
                      {t(`secEvt_${evento.tipo}`)}
                    </p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {[hace(evento.creadoEn), [navegador, sistema].filter(Boolean).join(' · '), evento.ip].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <ModalActivar2fa open={modal === 'activar'} onClose={() => setModal(null)} onActivado={alCambiar2fa} />
      <ModalGestion2fa
        open={modal === 'desactivar' || modal === 'regenerar'}
        modo={modal}
        onClose={() => setModal(null)}
        onHecho={modal === 'desactivar' ? alCambiar2fa : cargar}
      />
      {dialogo}
    </section>
  );
};

export default SeguridadCuenta;
