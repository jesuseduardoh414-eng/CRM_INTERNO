// Verificación de correo con código de 6 dígitos (después del registro, o
// cuando alguien intenta entrar sin haber verificado).
// El correo llega por `state` desde el registro/login, o por ?email=.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, MailCheck, PartyPopper } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { authService } from '../services/api';
import useCuentaAtras from '../utils/useCuentaAtras';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoTexto, CodigoOtp, PasosRegistro } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';

const VerifyEmailPage = () => {
  const { t } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { login } = useAuth();

  const emailInicial = location.state?.email || params.get('email') || '';
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState(null); // { tono, texto }
  const [verificando, setVerificando] = useState(false);
  const [pendiente, setPendiente] = useState(false);
  const { restante, iniciar } = useCuentaAtras(location.state?.recienRegistrado ? 60 : 0);
  const reenvioAutomatico = useRef(false);

  useEffect(() => {
    document.title = `${t('authVerifyEmailTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  const reenviar = async () => {
    if (!email || restante > 0) return;
    setAviso(null);
    try {
      const data = await authService.reenviarCodigo(email.trim());
      iniciar(data.esperaSegundos || 60);
      setAviso({ tono: 'info', texto: t('authCodeResent') });
    } catch (err) {
      setAviso({ tono: 'error', texto: err.message });
    }
  };

  // Viniendo del login con el correo sin verificar, el código anterior pudo
  // caducar: se pide uno nuevo una sola vez al entrar.
  useEffect(() => {
    if (!location.state?.reenviar || reenvioAutomatico.current || !emailInicial) return;
    reenvioAutomatico.current = true;
    authService.reenviarCodigo(emailInicial)
      .then((data) => iniciar(data.esperaSegundos || 60))
      .catch(() => {});
  }, [location.state, emailInicial, iniciar]);

  const verificar = async (valor = codigo) => {
    if (verificando || valor.length !== 6 || !email.trim()) return;
    setVerificando(true);
    setAviso(null);
    try {
      const data = await authService.verificarEmail(email.trim(), valor);
      if (data.token) {
        login(data);
        navigate('/dashboard', { replace: true });
        return;
      }
      setPendiente(true);
    } catch (err) {
      setAviso({ tono: 'error', texto: err.message });
      setCodigo('');
    } finally {
      setVerificando(false);
    }
  };

  if (pendiente) {
    return (
      <AuthLayout>
        <PasosRegistro actual={2} pasos={[t('authStepData'), t('authStepVerify'), t('authStepApproval')]} />
        <AuthHeader icono={PartyPopper} tono="exito" titulo={t('authPendingTitle')} subtitulo={t('authPendingText')} />
        <Link to="/login" className="auth-btn">{t('authGoToLogin')}</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <PasosRegistro actual={1} pasos={[t('authStepData'), t('authStepVerify'), t('authStepApproval')]} />
      <AuthHeader
        icono={MailCheck}
        titulo={t('authVerifyEmailTitle')}
        subtitulo={emailInicial ? t('authVerifyEmailSubtitle', { email: emailInicial }) : t('authVerifyEmailNoEmail')}
      />

      <form onSubmit={(e) => { e.preventDefault(); verificar(); }} className="space-y-5" noValidate>
        {aviso && <AuthAlert tono={aviso.tono}>{aviso.texto}</AuthAlert>}

        {!emailInicial && (
          <CampoTexto
            type="email"
            label={t('authEmail')}
            icono={Mail}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('authEmailPlaceholder')}
            required
          />
        )}

        <div>
          <span className="auth-label">{t('authCodeLabel')}</span>
          <CodigoOtp
            valor={codigo}
            onChange={setCodigo}
            onCompleto={verificar}
            invalido={aviso?.tono === 'error'}
            deshabilitado={verificando}
            autoFocus={Boolean(emailInicial) && enfocarAlCargar()}
          />
        </div>

        <BotonAuth cargando={verificando} textoCargando={t('authVerifyingShort')} disabled={codigo.length !== 6 || !email.trim()}>
          {t('authVerifyEmailSubmit')}
        </BotonAuth>

        <div className="flex flex-col items-center gap-2 text-sm">
          <button type="button" className="auth-link" onClick={reenviar} disabled={restante > 0 || !email.trim()}>
            {restante > 0 ? t('authResendIn', { s: restante }) : t('authResendCode')}
          </button>
          <p className="text-xs text-[var(--color-text-muted)]">{t('authCheckSpam')}</p>
        </div>
      </form>

      <div className="mt-8 flex flex-col items-center gap-2 border-t border-[var(--color-border)] pt-6 text-sm">
        <Link to="/registro" className="-my-2.5 py-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">{t('authWrongEmail')}</Link>
        <Link to="/login" className="auth-link">{t('authBackToLogin')}</Link>
      </div>
    </AuthLayout>
  );
};

export default VerifyEmailPage;
