// Enlace de verificación antiguo (/verify/:token). Los registros nuevos usan
// código de 6 dígitos (VerifyEmailPage); esta pantalla se mantiene para los
// enlaces que ya se enviaron.
import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { authService } from '../services/api';
import { AuthSkeleton } from '../components/Skeleton';
import { usePreferences } from '../context/PreferencesContext';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthHeader } from '../components/auth/AuthUI';

const VerifyAccountPage = () => {
  const { t } = usePreferences();
  const { token } = useParams();
  const [estado, setEstado] = useState('verificando');
  const [mensaje, setMensaje] = useState('');
  const navigate = useNavigate();

  // El token se consume en el servidor: solo se puede pedir una vez. En
  // desarrollo StrictMode monta el efecto dos veces, así que la petición se
  // guarda en un ref y se reutiliza.
  const peticion = useRef({ token: null, promesa: null });

  useEffect(() => {
    document.title = `${t('authVerifiedTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    if (peticion.current.token !== token) {
      peticion.current = { token, promesa: authService.verifyAccount(token) };
    }
    peticion.current.promesa
      .then((data) => { if (!cancelado) { setEstado('exito'); setMensaje(data.mensaje); } })
      .catch((error) => { if (!cancelado) { setEstado('error'); setMensaje(error.message); } });
    return () => { cancelado = true; };
  }, [token]);

  useEffect(() => {
    if (estado !== 'exito') return undefined;
    const temporizador = setTimeout(() => navigate('/login'), 3000);
    return () => clearTimeout(temporizador);
  }, [estado, navigate]);

  if (estado === 'verificando') return <AuthSkeleton />;

  const exito = estado === 'exito';
  return (
    <AuthLayout>
      <div role="status" aria-live="polite">
        <AuthHeader
          icono={exito ? CheckCircle2 : XCircle}
          tono={exito ? 'exito' : 'error'}
          titulo={exito ? t('authVerifiedTitle') : t('authVerifyErrorTitle')}
          subtitulo={exito ? `${mensaje} ${t('authRedirecting')}` : mensaje}
        />
      </div>
      <Link to="/login" className="auth-btn">{t('authGoToLogin')}</Link>
    </AuthLayout>
  );
};

export default VerifyAccountPage;
