import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthSkeleton } from './Skeleton';

// `permitirSin2fa`: la propia pantalla de activación no debe redirigir a sí misma.
const RutaProtegida = ({ children, permitirSin2fa = false }) => {
  const { usuario, cargando } = useAuth();
  const location = useLocation();

  if (cargando) {
    return <AuthSkeleton />;
  }

  if (!usuario) {
    // Se recuerda a dónde iba para volver ahí después de iniciar sesión.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // La política exige 2FA y aún no está activa: primero hay que activarla.
  if (usuario.debeActivar2FA && !permitirSin2fa) {
    return <Navigate to="/activar-2fa" replace />;
  }

  return children;
};

export default RutaProtegida;
