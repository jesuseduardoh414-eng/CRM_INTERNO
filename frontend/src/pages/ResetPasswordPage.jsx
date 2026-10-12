// Restablecer contraseña desde el enlace del correo. Primero se comprueba que
// el enlace siga valido (para no dejar escribir una contraseña en vano);
// al terminar, el backend cierra todas las sesiones de la cuenta.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, LinkIcon, LockKeyhole, ShieldCheck } from 'lucide-react';
import { authService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { evaluarPassword } from '../utils/politicaPassword';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoPassword, MedidorPassword } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';
import { AuthSkeleton } from '../components/Skeleton';

const ResetPasswordPage = () => {
  const { t } = usePreferences();
  const { token } = useParams();
  const navigate = useNavigate();

  const [estado, setEstado] = useState('validando'); // validando | valido | invalido | hecho
  const [cuenta, setCuenta] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null); // { texto, detalles }

  useEffect(() => {
    document.title = `${t('authResetTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    authService.validarReset(token)
      .then((data) => { if (!cancelado) { setCuenta(data.email || ''); setEstado('valido'); } })
      .catch(() => { if (!cancelado) setEstado('invalido'); });
    return () => { cancelado = true; };
  }, [token]);

  const contexto = useMemo(() => ({ email: '' }), []);
  const evaluacion = evaluarPassword(password, contexto);
  const coinciden = confirmar.length > 0 && confirmar === password;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!evaluacion.valida) { setError({ texto: t('authPasswordRequirementsError') }); return; }
    if (!coinciden) { setError({ texto: t('authPasswordsMismatch') }); return; }

    setCargando(true);
    setError(null);
    try {
      await authService.resetPassword(token, password);
      setEstado('hecho');
    } catch (err) {
      if (err.codigo === 'TOKEN_INVALIDO') setEstado('invalido');
      else setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setCargando(false);
    }
  };

  if (estado === 'validando') return <AuthSkeleton />;

  if (estado === 'invalido') {
    return (
      <AuthLayout>
        <AuthHeader icono={LinkIcon} tono="error" titulo={t('authResetInvalidTitle')} subtitulo={t('authResetInvalidText')} />
        <Link to="/forgot-password" className="auth-btn">{t('authRequestNewLink')}</Link>
        <div className="mt-6 text-center">
          <Link to="/login" className="auth-link text-sm">{t('authBackToLogin')}</Link>
        </div>
      </AuthLayout>
    );
  }

  if (estado === 'hecho') {
    return (
      <AuthLayout>
        <AuthHeader icono={CheckCircle2} tono="exito" titulo={t('authResetSuccessTitle')} subtitulo={t('authResetSuccessText')} />
        <button type="button" className="auth-btn" onClick={() => navigate('/login', { replace: true })}>
          {t('authGoToLogin')}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader icono={ShieldCheck} titulo={t('authResetTitle')} subtitulo={t('authResetSubtitle')}>
        {cuenta && (
          <p className="mt-3 inline-flex max-w-full rounded-full bg-[var(--color-surface-3)] px-3 py-1 text-xs font-medium text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
            {t('authResetFor', { email: cuenta })}
          </p>
        )}
      </AuthHeader>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Campo oculto para el gestor de contraseñas: asocia la clave nueva a
            esta cuenta (si no, la guarda sin usuario o pisa otra). */}
        {cuenta && <input type="email" name="username" autoComplete="username" value={cuenta} readOnly hidden />}
        {error && <AuthAlert tono="error" detalles={error.detalles}>{error.texto}</AuthAlert>}

        <div>
          <CampoPassword
            label={t('authNewPassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            maxLength={128}
            describedBy="reset-medidor"
            autoFocus={enfocarAlCargar()}
            required
          />
          <MedidorPassword id="reset-medidor" password={password} contexto={contexto} />
        </div>

        <div>
          <CampoPassword
            label={t('authConfirmPassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            placeholder={t('authRepeatPasswordPlaceholder')}
            value={confirmar}
            onChange={(e) => { setConfirmar(e.target.value); setError(null); }}
            maxLength={128}
            aria-invalid={confirmar.length > 0 && !coinciden}
            required
          />
          {confirmar.length > 0 && (
            <p className={`mt-1.5 text-xs font-medium ${coinciden ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`} aria-live="polite">
              {coinciden ? t('authPwMatch') : t('authPasswordsMismatch')}
            </p>
          )}
        </div>

        <BotonAuth cargando={cargando} textoCargando={t('authUpdating')}>{t('authResetSubmit')}</BotonAuth>
        <p className="text-center text-xs text-[var(--color-text-muted)]">{t('authPwBreachNote')}</p>
      </form>
    </AuthLayout>
  );
};

export default ResetPasswordPage;
