// Página de inicio de sesión.
// Paso 1: correo + contraseña (+ "mantener sesión 30 días").
// Paso 2 (solo si la cuenta tiene 2FA): código de la app o de respaldo.
// Los estados especiales que devuelve el backend (correo sin verificar,
// pendiente de aprobación, cuenta bloqueada) se muestran con su propio aviso.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { authService } from '../services/api';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoPassword, CampoTexto, CodigoOtp } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';

const TONO_POR_CODIGO = {
  CUENTA_BLOQUEADA: 'aviso',
  PENDIENTE_APROBACION: 'info',
  CUENTA_INACTIVA: 'aviso',
  PORTAL_DESACTIVADO: 'aviso',
};


const LoginPage = () => {
  const { t } = usePreferences();
  const [autoEnfocar] = useState(enfocarAlCargar);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [form, setForm] = useState({ email: location.state?.email || '', password: '' });
  const [recordar, setRecordar] = useState(false);
  // { tono, texto }. Puede llegar uno de otra pantalla (p. ej. tras restablecer la contraseña).
  const [aviso, setAviso] = useState(() => (location.state?.mensaje ? { tono: 'exito', texto: location.state.mensaje } : null));
  const [cargando, setCargando] = useState(false);
  const [registro, setRegistro] = useState('cerrado');
  const [recordarConfig, setRecordarConfig] = useState({ permitido: true, dias: 30 });

  // Paso 2FA
  const [desafio, setDesafio] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [usarRespaldo, setUsarRespaldo] = useState(false);

  const destino = location.state?.from?.pathname && location.state.from.pathname !== '/login'
    ? `${location.state.from.pathname}${location.state.from.search || ''}`
    : '/dashboard';

  useEffect(() => {
    document.title = `${t('authLogin')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    authService.config()
      .then((config) => {
        if (cancelado) return;
        setRegistro(config.registro);
        setRecordarConfig({ permitido: config.permitirRecordar !== false, dias: config.recordarDias || 30 });
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  const entrar = (data) => {
    login(data);
    // La cuenta de configuración va directo a su panel.
    if (data.usuario?.debeActivar2FA) { navigate('/activar-2fa', { replace: true }); return; }
    // El configurador y el cliente siempre van a su panel; el equipo, a donde iba.
    const rol = data.usuario?.rol;
    navigate(rol === 'CONFIGURADOR' ? '/configuracion' : rol === 'CLIENTE' ? (destino.startsWith('/portal') ? destino : '/portal') : destino, { replace: true });
  };

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (aviso?.tono === 'error') setAviso(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setCargando(true);
    setAviso(null);
    try {
      const data = await authService.login(form.email.trim(), form.password, recordar);
      if (data.requiere2FA) {
        setDesafio(data.desafio);
        setCodigo('');
        setForm((prev) => ({ ...prev, password: '' }));
        return;
      }
      entrar(data);
    } catch (err) {
      if (err.codigo === 'EMAIL_NO_VERIFICADO') {
        navigate('/verificar-correo', { state: { email: err.data?.email || form.email.trim(), reenviar: true } });
        return;
      }
      setAviso({ tono: TONO_POR_CODIGO[err.codigo] || 'error', texto: err.message });
    } finally {
      setCargando(false);
    }
  };

  const verificar2fa = async (valor = codigo) => {
    if (!valor || cargando) return;
    setCargando(true);
    setAviso(null);
    try {
      entrar(await authService.login2fa(desafio, valor));
    } catch (err) {
      if (err.codigo === 'DESAFIO_EXPIRADO') {
        setDesafio(null);
      }
      setAviso({ tono: TONO_POR_CODIGO[err.codigo] || 'error', texto: err.message });
      setCodigo('');
    } finally {
      setCargando(false);
    }
  };

  const volver = () => {
    setDesafio(null);
    setCodigo('');
    setUsarRespaldo(false);
    setAviso(null);
  };

  if (desafio) {
    return (
      <AuthLayout>
        <AuthHeader
          icono={ShieldCheck}
          titulo={t('auth2faTitle')}
          subtitulo={usarRespaldo ? t('auth2faBackupSubtitle') : t('auth2faSubtitle')}
        />
        <form onSubmit={(e) => { e.preventDefault(); verificar2fa(); }} className="space-y-5" noValidate>
          {aviso && <AuthAlert tono={aviso.tono}>{aviso.texto}</AuthAlert>}

          {usarRespaldo ? (
            <CampoTexto
              label={t('authBackupCodeLabel')}
              icono={KeyRound}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={11}
              autoFocus
              required
            />
          ) : (
            <CodigoOtp
              valor={codigo}
              onChange={setCodigo}
              onCompleto={verificar2fa}
              invalido={aviso?.tono === 'error'}
              deshabilitado={cargando}
            />
          )}

          <BotonAuth cargando={cargando} textoCargando={t('authVerifyingShort')} disabled={usarRespaldo ? codigo.length < 10 : codigo.length !== 6}>
            {t('auth2faVerify')}
          </BotonAuth>

          <div className="flex flex-col items-center gap-3 pt-1 text-sm">
            <button type="button" className="auth-link" onClick={() => { setUsarRespaldo((v) => !v); setCodigo(''); setAviso(null); }}>
              {usarRespaldo ? t('auth2faUseApp') : t('auth2faUseBackup')}
            </button>
            <button type="button" className="inline-flex min-h-10 items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={volver}>
              <ArrowLeft size={15} aria-hidden="true" /> {t('authOtherAccount')}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader titulo={t('authWelcomeBack')} subtitulo={t('authLoginSubtitle')} />

      <form onSubmit={handleSubmit} className="space-y-5">
        {aviso && (
          <AuthAlert tono={aviso.tono} className={aviso.tono === 'error' ? 'animate-shake' : ''}>
            {aviso.texto}
            {aviso.tono === 'aviso' && (
              <> <Link to="/forgot-password" state={{ email: form.email }} className="font-semibold underline">{t('authForgotLink')}</Link></>
            )}
          </AuthAlert>
        )}

        <CampoTexto
          name="email"
          type="email"
          label={t('authEmail')}
          icono={Mail}
          autoComplete="username"
          inputMode="email"
          placeholder={t('authEmailPlaceholder')}
          value={form.email}
          onChange={handleChange}
          maxLength={191}
          autoFocus={autoEnfocar && !form.email}
          required
        />

        <CampoPassword
          name="password"
          label={t('authPassword')}
          icono={LockKeyhole}
          autoComplete="current-password"
          value={form.password}
          onChange={handleChange}
          maxLength={200}
          autoFocus={autoEnfocar && Boolean(form.email)}
          required
          extraLabel={(
            <Link to="/forgot-password" state={{ email: form.email }} className="auth-link text-[0.8125rem]">
              {t('authForgotLink')}
            </Link>
          )}
        />

        {recordarConfig.permitido && <label className="auth-check">
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          <span className="text-sm">
            <span className="block font-medium text-[var(--color-text)]">{t('authRememberMe')}</span>
            <span className="block text-xs text-[var(--color-text-muted)]">{t('authRememberHint', { n: recordarConfig.dias })}</span>
          </span>
        </label>}

        <BotonAuth cargando={cargando} textoCargando={t('authLoggingIn')}>
          {t('authLogin')}
        </BotonAuth>
      </form>

      <div className="mt-8 border-t border-[var(--color-border)] pt-6 text-center text-sm text-[var(--color-text-muted)]">
        {registro === 'cerrado' ? (
          <p>{t('authInviteOnly')}</p>
        ) : (
          <p>
            {t('authNoAccount')}{' '}
            <Link to="/registro" className="auth-link">{t('authRequestAccess')}</Link>
          </p>
        )}
      </div>
    </AuthLayout>
  );
};

export default LoginPage;
