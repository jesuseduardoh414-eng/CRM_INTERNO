// Contexto global de autenticación
// Provee: usuario actual, funciones de login/logout y estado de carga
// Nota: hook y provider en el mismo archivo es compatible con Vite Fast Refresh

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { mutate as mutateGlobal } from 'swr';
import { authService, guardarTokens, borrarTokens, hayTokens, REFRESH_STORAGE_KEY } from '../services/api';
import { useToast } from './ToastContext';
import { usePreferences } from './PreferencesContext';

const AuthContext = createContext(null);

// Preferencias del dispositivo, no datos de la persona: se conservan al salir.
// Todo lo demas con prefijo crm_ (token, recordatorios ya avisados, reintentos
// de carga...) se borra para que el siguiente usuario del mismo navegador no
// herede nada del anterior.
const CLAVES_DE_DISPOSITIVO = new Set(['crm_theme', 'crm_language', 'crm_sidebar_collapsed', 'crm_marca_config', 'crm_marca_css']);

const limpiarAlmacenamientoLocal = () => {
  [localStorage, sessionStorage].forEach((almacen) => {
    const aBorrar = [];
    for (let i = 0; i < almacen.length; i += 1) {
      const clave = almacen.key(i);
      if (clave && clave.startsWith('crm_') && !CLAVES_DE_DISPOSITIVO.has(clave)) aBorrar.push(clave);
    }
    aBorrar.forEach((clave) => almacen.removeItem(clave));
  });
};

// Vacia la cache de SWR sin volver a pedir nada: las pantallas de la sesion
// anterior ya no estan montadas y lo cacheado pertenece a otra persona.
const limpiarCacheSWR = () => mutateGlobal(() => true, undefined, { revalidate: false });

const esSesionInvalida = (error) => error?.status === 401 || error?.status === 403;

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario]   = useState(null);
  const [cargando, setCargando] = useState(true); // Verifica token al iniciar
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = usePreferences();
  // Varias peticiones pueden fallar con 401 a la vez: se avisa una sola vez.
  const sesionCerradaRef = useRef(false);

  // Al montar, verificar si hay un token guardado y validarlo
  useEffect(() => {
    const verificarSesion = async () => {
      // Sin el par completo (sesiones antiguas de un solo token) no hay
      // forma de renovar: se empieza de cero.
      if (!hayTokens()) {
        borrarTokens();
        setCargando(false);
        return;
      }
      try {
        const data = await authService.me();
        setUsuario(data.usuario);
      } catch (error) {
        // Solo se cierra la sesion si el servidor la rechazo. Un fallo de red o
        // un arranque en frio del backend no significan que el token no valga:
        // antes eso te sacaba de la app por un parpadeo de conexion.
        if (esSesionInvalida(error)) borrarTokens();
      } finally {
        setCargando(false);
      }
    };

    verificarSesion();
  }, []);

  // api.js avisa cuando cualquier peticion recibe un 401 con token guardado:
  // el token expiro o la cuenta fue desactivada. Se limpia todo y se va al login.
  useEffect(() => {
    const alInvalidarse = (event) => {
      if (sesionCerradaRef.current) return;
      sesionCerradaRef.current = true;

      borrarTokens();
      limpiarAlmacenamientoLocal();
      limpiarCacheSWR();
      setUsuario(null);

      const mensaje = String(event.detail?.mensaje || '');
      const cuentaDesactivada = /no est[aá] activa|desactiv|inactiv|ya no existe/i.test(mensaje);
      showToast(cuentaDesactivada ? t('accountDeactivated') : t('sessionExpired'), 'info');
      navigate('/login', { replace: true });
    };

    window.addEventListener('crm:sesion-invalida', alInvalidarse);
    return () => window.removeEventListener('crm:sesion-invalida', alInvalidarse);
  }, [navigate, showToast, t]);

  // El servidor exige 2FA (403 REQUIERE_2FA): se marca y las rutas llevan a activarla.
  useEffect(() => {
    const alExigir2fa = () => setUsuario((prev) => (prev ? { ...prev, debeActivar2FA: true } : prev));
    window.addEventListener('crm:requiere-2fa', alExigir2fa);
    return () => window.removeEventListener('crm:requiere-2fa', alExigir2fa);
  }, []);

  // Cerrar sesion en una pestaña la cierra en todas: el evento `storage` solo
  // llega a las OTRAS pestañas cuando cambia localStorage.
  useEffect(() => {
    const alCambiarAlmacen = (event) => {
      if (event.key !== REFRESH_STORAGE_KEY || event.newValue) return;
      limpiarCacheSWR();
      setUsuario(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('storage', alCambiarAlmacen);
    return () => window.removeEventListener('storage', alCambiarAlmacen);
  }, [navigate]);

  // Guardar tokens y actualizar estado del usuario. Recibe la respuesta tal
  // cual del backend: { token, refreshToken, usuario }.
  const login = useCallback((datos) => {
    sesionCerradaRef.current = false;
    limpiarCacheSWR();
    guardarTokens(datos);
    setUsuario(datos.usuario);
  }, []);

  // Revocar la sesion en el servidor y borrar tokens, cache y rastro local.
  // La revocacion no se espera: salir debe ser instantaneo aunque no haya red.
  const logout = useCallback(() => {
    authService.logout();
    borrarTokens();
    limpiarAlmacenamientoLocal();
    limpiarCacheSWR();
    setUsuario(null);
  }, []);

  const updateUsuario = useCallback((datosUsuario) => {
    setUsuario((prev) => (prev ? { ...prev, ...datosUsuario } : datosUsuario));
  }, []);

  const refreshUsuario = useCallback(async () => {
    const data = await authService.me();
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const value = useMemo(
    () => ({ usuario, cargando, login, logout, updateUsuario, refreshUsuario }),
    [usuario, cargando, login, logout, updateUsuario, refreshUsuario],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Hook personalizado para consumir el contexto fácilmente
// eslint-disable-next-line react-refresh/only-export-components -- el hook y el proveedor van juntos a proposito; Vite recarga el archivo completo y no hay otros componentes aqui
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};
