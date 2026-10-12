// Marco del portal de clientes: el mismo menú lateral que el CRM interno
// (clases .crm-* en index.css), con las secciones del portal. En escritorio
// se puede colapsar; en móvil se abre como cajón desde la barra superior.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { CalendarDays, ChevronsLeft, ChevronsRight, FileSignature, FolderKanban, FolderOpen, Home, LockKeyhole, Menu, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import LogoMarca from '../LogoMarca';
import MenuCuenta from '../MenuCuenta';
import NotificationCenter from '../NotificationCenter';
import { VacioPortal } from './PiezasPortal';
import { CLAVE_RESUMEN } from '../../utils/portal';
import '../../portal.css';

const ANCHO_LATERAL = '256px';
const ANCHO_COLAPSADO = '72px';
const ANCHO_CAJON = 'min(84vw, 300px)';

const PortalLayout = ({ children }) => {
  const { usuario, logout } = useAuth();
  const { moduloActivo } = useConfiguracion();
  const { t } = usePreferences();
  const tp = useTextoPortal();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Misma preferencia que el menú del CRM: solo se guarda al pulsar el botón.
  const [collapsed, setCollapsed] = useState(() => {
    const guardado = localStorage.getItem('crm_sidebar_collapsed');
    if (guardado === '1' || guardado === 'true') return true;
    if (guardado === '0') return false;
    return null;
  });
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [anchoIntermedio, setAnchoIntermedio] = useState(() => window.innerWidth >= 1024 && window.innerWidth < 1180);
  const contenidoRef = useRef(null);
  const lateralRef = useRef(null);
  const botonMenuRef = useRef(null);
  const colapsado = isDesktop && (collapsed ?? anchoIntermedio);

  // Al navegar se cierra el cajón móvil (sin efecto, para no renderizar dos veces)
  const [rutaAnterior, setRutaAnterior] = useState(location.pathname);
  if (rutaAnterior !== location.pathname) {
    setRutaAnterior(location.pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    const onResize = () => {
      const escritorio = window.innerWidth >= 1024;
      setIsDesktop(escritorio);
      setAnchoIntermedio(escritorio && window.innerWidth < 1180);
      if (escritorio) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // El scroll lo lleva el contenedor del <main>, no window.
  useEffect(() => {
    contenidoRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    if (collapsed !== null) localStorage.setItem('crm_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (!open) return undefined;
    const alPulsarEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', alPulsarEscape);
    return () => document.removeEventListener('keydown', alPulsarEscape);
  }, [open]);

  // Cajón abierto: el foco entra en él y al cerrarlo vuelve al botón de menú.
  const menuMovilAbierto = open && !isDesktop;
  useEffect(() => {
    if (!menuMovilAbierto) return undefined;
    const lateral = lateralRef.current;
    const botonMenu = botonMenuRef.current;
    const candidatos = lateral?.querySelectorAll('a[href], button:not([disabled])') || [];
    [...candidatos].find((el) => el.getClientRects().length > 0)?.focus({ preventScroll: true });
    return () => {
      const activo = document.activeElement;
      if (!activo || activo === document.body || lateral?.contains(activo)) {
        botonMenu?.focus({ preventScroll: true });
      }
    };
  }, [menuMovilAbierto]);

  // El resumen da el nombre de la empresa al marco y a la pantalla de inicio.
  const { data, error } = useSWR(CLAVE_RESUMEN, portalService.resumen);
  const empresa = data?.empresa?.nombre;
  const suspendido = error?.codigo === 'PORTAL_SUSPENDIDO' || error?.codigo === 'MODULO_DESACTIVADO';

  const secciones = useMemo(() => [
    { to: '/portal', end: true, label: tp('ptlMenuInicio'), Icono: Home },
    { to: '/portal/proyectos', label: tp('ptlMenuProyectos'), Icono: FolderKanban },
    { to: '/portal/documentos', label: tp('ptlMenuDocumentos'), Icono: FolderOpen },
    moduloActivo('agenda') && { to: '/portal/reuniones', label: tp('ptlMenuReuniones'), Icono: CalendarDays },
    moduloActivo('contratos') && { to: '/portal/contratos', label: tp('ptlMenuContratos'), Icono: FileSignature },
  ].filter(Boolean), [tp, moduloActivo]);

  const opcionesCuenta = useMemo(() => [
    { id: 'cuenta', icono: UserRound, etiqueta: tp('ptlMenuCuenta'), atajo: 'Ctrl+,', onSelect: () => { setOpen(false); navigate('/portal/cuenta'); } },
  ], [tp, navigate]);

  const toggleSidebar = () => {
    const siguiente = !colapsado;
    if (document.startViewTransition) {
      document.startViewTransition(() => setCollapsed(siguiente));
      return;
    }
    setCollapsed(siguiente);
  };

  const cerrarSesion = () => {
    logout();
    showToast(t('sessionClosed'), 'info');
    navigate('/login');
  };

  const menuOculto = !isDesktop && !open;
  const botonColapsar = 'hidden lg:flex h-7 w-7 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text)]';

  return (
    <div className="ptl flex min-h-dvh relative overflow-hidden">
      <a href="#ptl-contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-[var(--color-surface)] focus:px-3 focus:py-2">
        {tp('ptlSaltar')}
      </a>

      <aside
        ref={lateralRef}
        inert={menuOculto}
        aria-hidden={menuOculto || undefined}
        className="crm-lateral fixed lg:sticky top-0 h-dvh z-[100] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] transition-[width,min-width,left] duration-300 ease-in-out"
        style={{
          left: isDesktop ? 0 : (open ? 0 : `calc(-1 * ${ANCHO_CAJON})`),
          width: isDesktop ? (colapsado ? ANCHO_COLAPSADO : ANCHO_LATERAL) : ANCHO_CAJON,
          minWidth: isDesktop ? (colapsado ? ANCHO_COLAPSADO : ANCHO_LATERAL) : ANCHO_CAJON,
        }}
      >
        {/* Cabecera: logo, nombre del portal y botón para colapsar */}
        <div className={colapsado ? 'flex flex-col items-center gap-3 px-3 pb-3 pt-5' : 'px-6 pb-4 pt-5'}>
          <div className={`flex items-center ${colapsado ? 'justify-center' : 'justify-between gap-2'}`}>
            <NavLink to="/portal" style={{ viewTransitionName: 'sidebar-logo' }} className="flex min-w-0" aria-label={tp('ptlMenuInicio')}>
              {colapsado
                ? <LogoMarca fondo="auto" variante="isotipo" className="h-9 w-9" textoClassName="text-base" />
                : <LogoMarca fondo="auto" className="h-8 w-auto max-w-[150px]" textoClassName="text-lg" />}
            </NavLink>
            {!colapsado && (
              <button type="button" onClick={toggleSidebar} className={`${botonColapsar} [@media(pointer:coarse)]:-mr-1.5`} aria-label={t('collapseMenu')} title={t('collapseMenu')}>
                <ChevronsLeft size={16} />
              </button>
            )}
          </div>
          {!colapsado && (
            <p className="mt-2.5 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              {tp('ptlPortal')}
            </p>
          )}
          {colapsado && (
            <button type="button" onClick={toggleSidebar} className={botonColapsar} aria-label={t('expandMenu')} title={t('expandMenu')}>
              <ChevronsRight size={16} />
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-3" aria-label={tp('ptlMenuPrincipal')}>
          {!suspendido && (
            <div>
              {colapsado
                ? <div className="mx-auto my-3 h-px w-6 bg-[var(--color-border)]" aria-hidden="true" />
                : <p className="crm-lateral-grupo">{empresa || tp('ptlPortal')}</p>}
              <div className="flex flex-col gap-0.5">
                {secciones.map(({ to, end, label, Icono }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setOpen(false)}
                    title={colapsado ? label : undefined}
                    aria-label={colapsado ? label : undefined}
                    className={`crm-nav-item ${colapsado ? 'crm-nav-colapsado crm-nav-riel' : ''}`}
                  >
                    <Icono size={17} strokeWidth={2} />
                    {colapsado
                      ? <span className="crm-nav-rotulo" aria-hidden="true">{label}</span>
                      : <span className="crm-nav-texto">{label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {/* Avisos al final del menú, como en el CRM */}
          {isDesktop && !suspendido && (
            <div className="mt-auto pt-4">
              <NotificationCenter enSidebar colapsado={colapsado} />
            </div>
          )}
        </nav>

        {/* Pie: la persona con su menú (cuenta, tema, idioma, salir) */}
        <div className={`border-t border-[var(--color-border)] ${colapsado ? 'p-2' : 'p-3'}`}>
          <MenuCuenta
            usuario={usuario}
            subtitulo={empresa || tp('ptlPortal')}
            opciones={opcionesCuenta}
            onCerrarSesion={cerrarSesion}
            colapsado={colapsado}
            plano
          />
        </div>
      </aside>

      <main inert={menuMovilAbierto} className="flex-1 min-w-0 flex flex-col h-dvh bg-[var(--color-bg-base)] overflow-hidden">
        {/* Solo en móvil: botón para abrir el cajón y los avisos */}
        <header className="lg:hidden h-[calc(4rem+env(safe-area-inset-top))] [@media(max-height:500px)]:h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] gap-4 sticky top-0 z-[90]">
          <button
            ref={botonMenuRef}
            type="button"
            onClick={() => setOpen(true)}
            className="p-2 -ml-2 text-[var(--color-text)] hover:bg-[var(--color-surface-3)] rounded-xl transition-colors"
            aria-label={t('openMenu')}
            aria-expanded={open}
          >
            <Menu size={24} strokeWidth={2.5} />
          </button>
          <LogoMarca fondo="auto" className="h-7 w-auto max-w-[120px]" textoClassName="text-base" />
          {!isDesktop && !suspendido ? <NotificationCenter /> : <span className="w-10" aria-hidden="true" />}
        </header>

        <div ref={contenidoRef} className="flex-1 overflow-y-auto flex flex-col">
          <div id="ptl-contenido" className="ptl-contenido">
            {suspendido ? (
              <div className="ptl-panel mx-auto mt-10 max-w-md">
                <VacioPortal icono={LockKeyhole} texto={tp('ptlSuspendido')} ayuda={tp('ptlSuspendidoTexto')} />
              </div>
            ) : children}
          </div>

          <footer className="ptl-pie">
            {empresa && <p>{tp('ptlPie', { empresa })}</p>}
            <p className="mt-1">{tp('ptlPieAyuda')}</p>
          </footer>
        </div>
      </main>

      <div
        aria-hidden="true"
        className={`fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] transition-opacity duration-300 lg:hidden ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setOpen(false)}
      />
    </div>
  );
};

export default PortalLayout;
