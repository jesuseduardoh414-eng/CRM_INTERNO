// "¿Olvidaste tu contraseña?": pide el correo y envía un enlace de un solo uso
// (30 min). La respuesta es la misma exista o no la cuenta.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, KeyRound, Mail, MailCheck } from 'lucide-react';
import { authService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import useCuentaAtras from '../utils/useCuentaAtras';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoTexto } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';

const ForgotPasswordPage = () => {
  const { t } = usePreferences();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const { restante, iniciar } = useCuentaAtras();

  useEffect(() => {
    document.title = `${t('authForgotTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  const enviar = async (e) => {
    e?.preventDefault();
    if (restante > 0) return;
    setEnviando(true);
    setError('');
    try {
      await authService.forgotPassword(email.trim());
      setEnviado(true);
      iniciar(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const volver = (
    <Link to="/login" state={{ email }} className="mt-8 inline-flex min-h-10 items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <ArrowLeft size={15} aria-hidden="true" /> {t('authBackToLogin')}
    </Link>
  );

  if (enviado) {
    return (
      <AuthLayout>
        <AuthHeader icono={MailCheck} tono="exito" titulo={t('authForgotSentTitle')} subtitulo={t('authForgotSentText', { email: email.trim() })} />
        {error && <AuthAlert tono="error" className="mb-5">{error}</AuthAlert>}
        <BotonAuth type="button" variante="secundario" cargando={enviando} textoCargando={t('authSending')} disabled={restante > 0} onClick={enviar}>
          {restante > 0 ? t('authResendIn', { s: restante }) : t('authForgotResend')}
        </BotonAuth>
        <p className="mt-4 text-center text-xs text-[var(--color-text-muted)]">{t('authCheckSpam')}</p>
        {volver}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader icono={KeyRound} titulo={t('authForgotTitle')} subtitulo={t('authForgotSubtitle')} />
      <form onSubmit={enviar} className="space-y-5">
        {error && <AuthAlert tono="error">{error}</AuthAlert>}
        <CampoTexto
          type="email"
          label={t('authEmail')}
          icono={Mail}
          autoComplete="email"
          inputMode="email"
          placeholder={t('authEmailPlaceholder')}
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          maxLength={191}
          autoFocus={enfocarAlCargar()}
          required
        />
        <BotonAuth cargando={enviando} textoCargando={t('authSending')}>{t('authSendResetLink')}</BotonAuth>
        <p className="text-center text-xs text-[var(--color-text-muted)]">{t('authForgotHint')}</p>
      </form>
      {volver}
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
