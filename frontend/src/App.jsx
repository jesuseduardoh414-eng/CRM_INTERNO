// App.jsx - Router principal de la aplicacion
// Define todas las rutas y envuelve con el contexto de autenticacion

import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { ConfiguracionProvider, useConfiguracion } from './context/ConfiguracionContext';
import { ToastProvider } from './context/ToastContext';
import RutaProtegida from './components/RutaProtegida';
import Layout from './components/Layout';
import { TooltipProvider } from './components/ui/tooltip';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyAccountPage from './pages/VerifyAccountPage';
import { AuthSkeleton, PageSkeleton } from './components/Skeleton';
import { inicioDe } from './utils/portal';
import { RUTA_INFORME, categoriasVisibles, puedeVerFinanzas, rutaCategoria } from './utils/finanzas';

const lazyRetry = (importer, key) => lazy(async () => {
  const storageKey = `crm_lazy_retry_${key}`;

  try {
    const module = await importer();
    sessionStorage.removeItem(storageKey);
    return module;
  } catch (error) {
    const yaRecargo = sessionStorage.getItem(storageKey) === '1';
    const esChunkStale = error?.name === 'ChunkLoadError'
      || /Failed to fetch dynamically imported module/i.test(error?.message || '')
      || /Importing a module script failed/i.test(error?.message || '');

    if (esChunkStale && !yaRecargo) {
      sessionStorage.setItem(storageKey, '1');
      window.location.reload();
      return new Promise(() => {});
    }

    sessionStorage.removeItem(storageKey);
    throw error;
  }
});

const InvitationPage = lazyRetry(() => import('./pages/InvitationPage'), 'invitation');
const RegisterPage = lazyRetry(() => import('./pages/RegisterPage'), 'register');
const VerifyEmailPage = lazyRetry(() => import('./pages/VerifyEmailPage'), 'verify_email');
const DashboardPage = lazyRetry(() => import('./pages/DashboardPage'), 'dashboard');
const ProyectosPage = lazyRetry(() => import('./pages/ProyectosPage'), 'proyectos');
const ProyectoDetallePage = lazyRetry(() => import('./pages/ProyectoDetallePage'), 'proyecto_detalle');
const UsuariosPage = lazyRetry(() => import('./pages/UsuariosPage'), 'usuarios');
const AgendaPage = lazyRetry(() => import('./pages/AgendaPage'), 'agenda');
const PerfilPage = lazyRetry(() => import('./pages/PerfilPage'), 'perfil');
const ContratosPage = lazyRetry(() => import('./pages/ContratosPage'), 'contratos');
const ClientesPage = lazyRetry(() => import('./pages/ClientesPage'), 'clientes');
const ReportesPage = lazyRetry(() => import('./pages/ReportesPage'), 'reportes');
const VentasPage = lazyRetry(() => import('./pages/VentasPage'), 'ventas');
const TesoreriaPage = lazyRetry(() => import('./pages/TesoreriaPage'), 'tesoreria');
const GastosPage = lazyRetry(() => import('./pages/GastosPage'), 'gastos');
const InformeGastosPage = lazyRetry(() => import('./pages/InformeGastosPage'), 'informe_gastos');
const CotizacionesPage = lazyRetry(() => import('./pages/CotizacionesPage'), 'cotizaciones');
const ConocimientoPage = lazyRetry(() => import('./pages/ConocimientoPage'), 'conocimiento');
const ArticuloPage = lazyRetry(() => import('./pages/ArticuloPage'), 'articulo');
const EditorArticuloPage = lazyRetry(() => import('./pages/EditorArticuloPage'), 'editor_articulo');
const ConfiguracionPage = lazyRetry(() => import('./pages/ConfiguracionPage'), 'configuracion');
const Activar2faPage = lazyRetry(() => import('./pages/Activar2faPage'), 'activar_2fa');
const PortalLayout = lazyRetry(() => import('./components/portal/PortalLayout'), 'portal_layout');
const PortalInicioPage = lazyRetry(() => import('./pages/portal/PortalInicioPage'), 'portal_inicio');
const PortalProyectosPage = lazyRetry(() => import('./pages/portal/PortalProyectosPage'), 'portal_proyectos');
const PortalProyectoPage = lazyRetry(() => import('./pages/portal/PortalProyectoPage'), 'portal_proyecto');
const PortalDocumentosPage = lazyRetry(() => import('./pages/portal/PortalDocumentosPage'), 'portal_documentos');
const PortalReunionesPage = lazyRetry(() => import('./pages/portal/PortalReunionesPage'), 'portal_reuniones');
const PortalContratosPage = lazyRetry(() => import('./pages/portal/PortalContratosPage'), 'portal_contratos');
const PortalCuentaPage = lazyRetry(() => import('./pages/portal/PortalCuentaPage'), 'portal_cuenta');


// Redirige al dashboard si ya hay sesion activa (evita volver al login)
const RutaPublica = ({ children }) => {
  const { usuario, cargando } = useAuth();
  if (cargando) return <AuthSkeleton compact />;
  return usuario ? <Navigate to={inicioDe(usuario)} replace /> : children;
};

const RoutePageFallback = () => <PageSkeleton cards={4} />;

const PublicLazyRoute = ({ children, compact = false }) => (
  <Suspense fallback={<AuthSkeleton compact={compact} />}>
    {children}
  </Suspense>
);

const PrivateLazyRoute = ({ children }) => (
  <Suspense fallback={<RoutePageFallback />}>
    {children}
  </Suspense>
);

// Las cuentas CONFIGURADOR y CLIENTE no usan el CRM: cualquier ruta del CRM
// las manda a su panel.
const SoloEquipo = ({ children }) => {
  const { usuario } = useAuth();
  if (usuario?.rol === 'CONFIGURADOR' || usuario?.rol === 'CLIENTE') return <Navigate to={inicioDe(usuario)} replace />;
  return children;
};

// Wrapper que aplica el Layout a las rutas privadas
const RutaConLayout = ({ children }) => (
  <RutaProtegida>
    <SoloEquipo>
      <Layout>
        <PrivateLazyRoute>{children}</PrivateLazyRoute>
      </Layout>
    </SoloEquipo>
  </RutaProtegida>
);

// Módulo apagado desde el panel de configuración: la ruta no existe.
const RutaModulo = ({ modulo, children }) => {
  const { moduloActivo } = useConfiguracion();
  return moduloActivo(modulo) ? children : <Navigate to="/dashboard" replace />;
};

// /gastos a secas: la primera categoría que la persona puede ver (o el informe).
const InicioGastos = () => {
  const { usuario } = useAuth();
  const categorias = categoriasVisibles(usuario);
  if (categorias.length) return <Navigate to={rutaCategoria(categorias[0])} replace />;
  if (puedeVerFinanzas(usuario, 'informe')) return <Navigate to={RUTA_INFORME} replace />;
  return <Navigate to="/dashboard" replace />;
};

// Panel de configuración: solo la cuenta CONFIGURADOR (tiene su propio marco).
const ConfiguradorOInicio = ({ children }) => {
  const { usuario } = useAuth();
  return usuario?.rol === 'CONFIGURADOR' ? children : <Navigate to={inicioDe(usuario)} replace />;
};

const RutaConfigurador = ({ children }) => (
  <RutaProtegida>
    <ConfiguradorOInicio>
      <PrivateLazyRoute>{children}</PrivateLazyRoute>
    </ConfiguradorOInicio>
  </RutaProtegida>
);

// Portal de clientes: solo cuentas CLIENTE, con su propio marco.
const SoloCliente = ({ children }) => {
  const { usuario } = useAuth();
  return usuario?.rol === 'CLIENTE' ? children : <Navigate to={inicioDe(usuario)} replace />;
};

const RutaPortal = ({ modulo, children }) => (
  <RutaProtegida>
    <SoloCliente>
      <Suspense fallback={<AuthSkeleton />}>
        <PortalLayout>
          <Suspense fallback={<RoutePageFallback />}>
            {modulo ? <RutaModuloPortal modulo={modulo}>{children}</RutaModuloPortal> : children}
          </Suspense>
        </PortalLayout>
      </Suspense>
    </SoloCliente>
  </RutaProtegida>
);

const RutaModuloPortal = ({ modulo, children }) => {
  const { moduloActivo } = useConfiguracion();
  return moduloActivo(modulo) ? children : <Navigate to="/portal" replace />;
};

const InicioSegunCuenta = () => {
  const { usuario } = useAuth();
  return <Navigate to={inicioDe(usuario)} replace />;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<RutaProtegida><InicioSegunCuenta /></RutaProtegida>} />

    <Route path="/login" element={<RutaPublica><LoginPage /></RutaPublica>} />
    <Route path="/invitacion/:token" element={<PublicLazyRoute><InvitationPage /></PublicLazyRoute>} />
    <Route path="/registro" element={<RutaPublica><PublicLazyRoute><RegisterPage /></PublicLazyRoute></RutaPublica>} />
    <Route path="/verificar-correo" element={<RutaPublica><PublicLazyRoute><VerifyEmailPage /></PublicLazyRoute></RutaPublica>} />
    <Route path="/forgot-password" element={<RutaPublica><ForgotPasswordPage /></RutaPublica>} />
    <Route path="/reset-password/:token" element={<RutaPublica><ResetPasswordPage /></RutaPublica>} />
    <Route path="/verify/:token" element={<VerifyAccountPage />} />

    <Route path="/dashboard" element={<RutaConLayout><DashboardPage /></RutaConLayout>} />
    <Route path="/proyectos" element={<RutaConLayout><ProyectosPage /></RutaConLayout>} />
    <Route path="/proyectos/:id" element={<RutaConLayout><ProyectoDetallePage /></RutaConLayout>} />
    <Route path="/usuarios" element={<RutaConLayout><UsuariosPage /></RutaConLayout>} />
    <Route path="/agenda" element={<RutaConLayout><RutaModulo modulo="agenda"><AgendaPage /></RutaModulo></RutaConLayout>} />
    <Route path="/perfil" element={<RutaConLayout><PerfilPage /></RutaConLayout>} />
    <Route path="/contratos" element={<RutaConLayout><RutaModulo modulo="contratos"><ContratosPage /></RutaModulo></RutaConLayout>} />
    <Route path="/clientes" element={<RutaConLayout><RutaModulo modulo="clientes"><ClientesPage /></RutaModulo></RutaConLayout>} />
    <Route path="/clientes/:id" element={<RutaConLayout><RutaModulo modulo="clientes"><ClientesPage /></RutaModulo></RutaConLayout>} />
    <Route path="/reportes" element={<RutaConLayout><ReportesPage /></RutaConLayout>} />
    {/* Finanzas: cada página comprueba el permiso de la persona (usuario.permisos). */}
    <Route path="/ventas" element={<RutaConLayout><RutaModulo modulo="finanzas"><VentasPage /></RutaModulo></RutaConLayout>} />
    <Route path="/tesoreria" element={<RutaConLayout><RutaModulo modulo="finanzas"><TesoreriaPage /></RutaModulo></RutaConLayout>} />
    <Route path="/gastos" element={<RutaConLayout><RutaModulo modulo="finanzas"><InicioGastos /></RutaModulo></RutaConLayout>} />
    <Route path="/gastos/informe" element={<RutaConLayout><RutaModulo modulo="finanzas"><InformeGastosPage /></RutaModulo></RutaConLayout>} />
    <Route path="/gastos/:categoria" element={<RutaConLayout><RutaModulo modulo="finanzas"><GastosPage /></RutaModulo></RutaConLayout>} />
    <Route path="/cotizaciones" element={<RutaConLayout><RutaModulo modulo="finanzas"><CotizacionesPage /></RutaModulo></RutaConLayout>} />
    {/* Base de conocimiento: todos leen; crear y editar es de administradores (lo comprueba la página y el servidor). */}
    <Route path="/conocimiento" element={<RutaConLayout><RutaModulo modulo="conocimiento"><ConocimientoPage /></RutaModulo></RutaConLayout>} />
    <Route path="/conocimiento/nuevo" element={<RutaConLayout><RutaModulo modulo="conocimiento"><EditorArticuloPage /></RutaModulo></RutaConLayout>} />
    <Route path="/conocimiento/:id" element={<RutaConLayout><RutaModulo modulo="conocimiento"><ArticuloPage /></RutaModulo></RutaConLayout>} />
    <Route path="/conocimiento/:id/editar" element={<RutaConLayout><RutaModulo modulo="conocimiento"><EditorArticuloPage /></RutaModulo></RutaConLayout>} />
    <Route path="/configuracion" element={<RutaConfigurador><ConfiguracionPage /></RutaConfigurador>} />

    <Route path="/portal" element={<RutaPortal><PortalInicioPage /></RutaPortal>} />
    <Route path="/portal/proyectos" element={<RutaPortal><PortalProyectosPage /></RutaPortal>} />
    <Route path="/portal/proyectos/:id" element={<RutaPortal><PortalProyectoPage /></RutaPortal>} />
    <Route path="/portal/documentos" element={<RutaPortal><PortalDocumentosPage /></RutaPortal>} />
    <Route path="/portal/reuniones" element={<RutaPortal modulo="agenda"><PortalReunionesPage /></RutaPortal>} />
    <Route path="/portal/contratos" element={<RutaPortal modulo="contratos"><PortalContratosPage /></RutaPortal>} />
    <Route path="/portal/cuenta" element={<RutaPortal><PortalCuentaPage /></RutaPortal>} />
    <Route path="/activar-2fa" element={<RutaProtegida permitirSin2fa><PublicLazyRoute><Activar2faPage /></PublicLazyRoute></RutaProtegida>} />

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const App = () => (
  <BrowserRouter>
    <PreferencesProvider>
      <ConfiguracionProvider>
      {/* Los avisos van por fuera de la sesion: AuthProvider los usa para
          decir "tu sesion expiro" cuando el backend devuelve un 401. */}
      <ToastProvider>
        <AuthProvider>
          {/* Cache compartido de datos. Sin esto cada pantalla volvia a pedir
              todo desde cero al entrar, aunque ya hubieras estado ahi hace un
              momento, y se quedaba en el esqueleto de carga.

              - keepPreviousData: al volver, se pinta al instante lo que ya se
                tenia y la actualizacion llega despues, sin pantalla en blanco.
              - dedupingInterval: dos peticiones iguales seguidas cuentan como
                una sola durante 30 segundos.
              - revalidateOnFocus en false: cambiar de pestaña del navegador no
                dispara una recarga; en un CRM interno molesta mas que ayuda.

              No se define `provider`: se usa la cache global de SWR, que es la
              que AuthContext vacia al cerrar sesion o al expirar. */}
          <SWRConfig
            value={{
              keepPreviousData: true,
              dedupingInterval: 30000,
              revalidateOnFocus: false,
              revalidateIfStale: true,
              errorRetryCount: 2,
            }}
          >
            {/* Requerido por los Tooltip de shadcn/Radix en toda la app */}
            <TooltipProvider delayDuration={200}>
              <AppRoutes />
            </TooltipProvider>
          </SWRConfig>
        </AuthProvider>
      </ToastProvider>
      </ConfiguracionProvider>
    </PreferencesProvider>
  </BrowserRouter>
);

export default App;
