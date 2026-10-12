// Activación de una cuenta invitada por un administrador: se muestra para
// quién es la invitación y la persona solo elige su contraseña. Al terminar
// entra directamente (el backend abre la sesión).
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Briefcase, Building2, LinkIcon, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { authService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { evaluarPassword } from '../utils/politicaPassword';
import { AuthSkeleton } from '../components/Skeleton';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoPassword, CampoTexto, MedidorPassword } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';

const InvitationPage = () => {
  const { t } = usePreferences();
  const { nombreArea } = useConfiguracion();
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [loading, setLoading] = useState(true);
  const [invalida, setInvalida] = useState(false);
  const [invitacion, setInvitacion] = useState(null);
  const [form, setForm] = useState({ password: '', confirmar_password: '' });
  const [error, setError] = useState(null); // { texto, detalles }
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = `${t('authInviteTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    authService.verificarInvitacion(token)
      .then((data) => { if (!cancelado) setInvitacion(data); })
      // El motivo del servidor (caducada, ya usada, portal retirado) se muestra tal cual.
      .catch((err) => { if (!cancelado) setInvalida(err?.message || true); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [token]);

  const contexto = useMemo(() => ({ email: invitacion?.email, nombre: invitacion?.nombre }), [invitacion]);
  const evaluacion = evaluarPassword(form.password, contexto);
  const coinciden = form.confirmar_password.length > 0 && form.confirmar_password === form.password;

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!evaluacion.valida) { setError({ texto: t('authPasswordRequirementsError') }); return; }
    if (!coinciden) { setError({ texto: t('authPasswordsMismatch') }); return; }

    setSubmitting(true);
    setError(null);
    try {
      const data = await authService.aceptarInvitacion(token, form);
      login(data);
      navigate(data?.usuario?.rol === 'CLIENTE' ? '/portal' : '/dashboard', { replace: true });
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
      setSubmitting(false);
    }
  };

  if (loading) return <AuthSkeleton />;

  if (invalida) {
    return (
      <AuthLayout>
        <AuthHeader icono={LinkIcon} tono="error" titulo={t('authInviteInvalidTitle')} subtitulo={typeof invalida === 'string' ? invalida : t('authInviteInvalidText')} />
        <Link to="/login" className="auth-btn">{t('authGoToLogin')}</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader icono={Sparkles} titulo={t('authInviteTitle')} subtitulo={t('authInviteSubtitle')} />

      <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{t('authInviteFor')}</p>
        <p className="mt-0.5 break-words text-lg font-semibold text-[var(--color-text)]">{invitacion?.nombre}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AuthAlert tono="error" detalles={error.detalles}>{error.texto}</AuthAlert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoTexto label={t('authEmail')} icono={Mail} value={invitacion?.email || ''} readOnly tabIndex={-1} autoComplete="username" />
          {/* Invitación al portal de clientes: en vez del área, su empresa */}
          <CampoTexto
            label={invitacion?.esCliente ? t('authCompany') : t('authArea')}
            icono={invitacion?.esCliente ? Building2 : Briefcase}
            value={invitacion?.esCliente ? (invitacion.empresa || '') : (invitacion?.area ? nombreArea(invitacion.area) : '')}
            readOnly
            tabIndex={-1}
          />
        </div>

        <div>
          <CampoPassword
            name="password"
            label={t('authCreatePassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            maxLength={128}
            describedBy="inv-medidor"
            autoFocus={enfocarAlCargar()}
            required
          />
          <MedidorPassword id="inv-medidor" password={form.password} contexto={contexto} />
        </div>

        <div>
          <CampoPassword
            name="confirmar_password"
            label={t('authConfirmPassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            placeholder={t('authRepeatPasswordPlaceholder')}
            value={form.confirmar_password}
            onChange={handleChange}
            maxLength={128}
            aria-invalid={form.confirmar_password.length > 0 && !coinciden}
            required
          />
          {form.confirmar_password.length > 0 && (
            <p className={`mt-1.5 text-xs font-medium ${coinciden ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`} aria-live="polite">
              {coinciden ? t('authPwMatch') : t('authPasswordsMismatch')}
            </p>
          )}
        </div>

        <BotonAuth cargando={submitting} textoCargando={t('authActivating')}>{t('authActivate')}</BotonAuth>
        <p className="text-center text-xs text-[var(--color-text-muted)]">{t('authTerms')}</p>
      </form>
    </AuthLayout>
  );
};

export default InvitationPage;
