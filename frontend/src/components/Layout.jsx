import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import NotificationCenter from './NotificationCenter';
import GlobalSearch from './GlobalSearch';
import MenuCuenta from './MenuCuenta';
import LogoMarca from './LogoMarca';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { agendaService } from '../services/api';
import { useMisTareas } from '../hooks/useMisTareas';
import { getEstadoProyecto } from '../utils/estadosProyecto';
import {
  BarChart3,
  Building2,
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  FileSignature,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';

const IconMenu = () => <Menu size={24} strokeWidth={2.5} />;

// Menú lateral con el mismo estilo que el panel de configuración (clases
// .crm-* en index.css): agrupado por secciones y con la activa resaltada.
const GRUPOS_MENU = [
  {
    tituloKey: 'mainMenu',
    enlaces: [
      { to: '/dashboard', labelKey: 'home', Icono: LayoutDashboard },
      { to: '/proyectos', labelKey: 'projects', Icono: FolderKanban },
      { to: '/agenda', labelKey: 'agenda', Icono: Calendar, modulo: 'agenda' },
    ],
  },
  {
    tituloKey: 'menuGroupBusiness',
    soloAdmin: true,
    enlaces: [
      { to: '/clientes', labelKey: 'menuClients', Icono: Building2, modulo: 'clientes' },
      { to: '/contratos', labelKey: 'contracts', Icono: FileSignature, modulo: 'contratos' },
    ],
  },
  {
    tituloKey: 'administration',
    soloAdmin: true,
    enlaces: [
      { to: '/reportes', labelKey: 'menuReports', Icono: BarChart3 },
      { to: '/usuarios', labelKey: 'users', Icono: Users },
    ],
  },
];

// Proyectos que caben en la sección "Mis proyectos" del menú del miembro.
const MAX_PROYECTOS_MENU = 5;

const esMac =typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

const Layout = ({ children }) => {
  const { usuario, logout } = useAuth();
  const { moduloActivo, marca, nombreArea } = useConfiguracion();
  const agendaActiva = moduloActivo('agenda');
  const esMiembro = Boolean(usuario) && usuario.rol !== 'ADMIN';
  // Accesos a sus proyectos. El Layout siempre está montado, así que es quien
  // recarga cuando otra pantalla cambia una tarea.
  const { proyectosAbiertos, abiertasPorProyecto } = useMisTareas({ escucharCambios: true });
  const { t } = usePreferences();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Antes se guardaba 'true'/'false' en cada montaje, asi que un 'false' viejo
  // no era una eleccion de la persona. Ahora solo se guarda al pulsar el boton,
  // como '1'/'0'; de lo viejo solo se respeta 'true' (eso si fue a proposito).
  const [collapsed, setCollapsed] = useState(() => {
    const guardado = localStorage.getItem('crm_sidebar_collapsed');
    if (guardado === '1' || guardado === 'true') return true;
    if (guardado === '0') return false;
    return null;
  });
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  // Tablet en horizontal (1024×768, 1112, split-screen hasta 1179): con el
  // menu de 256px el contenido se quedaba en ~700px, el ancho de una tablet en
  // vertical. Ahi el menu sale colapsado por defecto, salvo que la persona ya
  // lo haya expandido o colapsado a mano (eso se guarda y manda).
  const [anchoIntermedio, setAnchoIntermedio] = useState(() => window.innerWidth >= 1024 && window.innerWidth < 1180);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [, setRecordatoriosCount] = useState(0);
  const contenidoRef = useRef(null);
  const lateralRef = useRef(null);
  const botonMenuRef = useRef(null);
  // El colapsado es cosa del escritorio. En movil el menu sale siempre
  // completo: si se habia colapsado en un monitor, en el telefono salia solo
  // con iconos y sin forma de expandirlo (ese boton es lg:flex).
  // `collapsed` es null mientras no haya preferencia guardada.
  const colapsado = isDesktop && (collapsed ?? anchoIntermedio);

  // Al navegar se cierra el menu movil. Se compara con la ruta del render
  // anterior en vez de usar un efecto: un setState dentro de un efecto provoca
  // un segundo render en cascada.
  const [rutaAnterior, setRutaAnterior] = useState(location.pathname);
  if (rutaAnterior !== location.pathname) {
    setRutaAnterior(location.pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    // Al pasar a escritorio se cierra el menu movil: si no, al volver a
    // telefono reaparecia abierto y con el contenido inerte.
    const onResize = () => {
      const escritorio = window.innerWidth >= 1024;
      setIsDesktop(escritorio);
      setAnchoIntermedio(escritorio && window.innerWidth < 1180);
      if (escritorio) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Al cambiar de pagina, volver al inicio del contenido. El scroll no lo lleva
  // window sino el contenedor del <main>, por eso no basta con window.scrollTo.
  useEffect(() => {
    contenidoRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    // Con el módulo de agenda apagado no hay recordatorios que sondear.
    if (!usuario || !agendaActiva) return undefined;

    const checarAgenda = async () => {
      // Con la pestaña oculta no se sondea: nadie va a ver el aviso y solo
      // gasta peticiones. Al volver a la pestaña se consulta en el acto.
      if (document.hidden) return;
      try {
        const [{ recordatorios }, { pendientes }] = await Promise.all([
          agendaService.recordatorios(),
          agendaService.invitacionesPendientes(),
        ]);

        setRecordatoriosCount(recordatorios.length + pendientes.length);

        const yaNotificados = JSON.parse(localStorage.getItem('crm_recordatorios_vistos') || '[]');
        const ahora = new Date();

        recordatorios.forEach((recordatorio) => {
          if (!yaNotificados.includes(recordatorio.id)) {
            const min = Math.round((new Date(recordatorio.fechaInicio) - ahora) / 60000);
            const msg = t('reminderToast', { title: recordatorio.titulo, minutes: min });
            showToast(msg, 'info');

            // Solo si la persona ya concedio el permiso (se pide al abrir la
            // campana de notificaciones, nunca al cargar la pagina).
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`${marca.nombreSistema} - ${t('agenda')}`, { body: msg });
            }

            yaNotificados.push(recordatorio.id);
          }
        });

        localStorage.setItem('crm_recordatorios_vistos', JSON.stringify(yaNotificados));
      } catch (error) {
        console.error('Error al checar agenda:', error);
      }
    };

    checarAgenda();
    const interval = setInterval(checarAgenda, 60000);
    const alCambiarVisibilidad = () => { if (!document.hidden) checarAgenda(); };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [usuario, agendaActiva, marca.nombreSistema, showToast, t]);

  useEffect(() => {
    if (collapsed !== null) localStorage.setItem('crm_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Ctrl+K / Cmd+K abre el buscador desde cualquier pantalla
  useEffect(() => {
    const alPulsarTecla = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setBuscadorAbierto(true);
      }
    };
    window.addEventListener('keydown', alPulsarTecla);
    return () => window.removeEventListener('keydown', alPulsarTecla);
  }, []);

  // Escape cierra el menu movil
  useEffect(() => {
    if (!open) return undefined;
    const alPulsarEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', alPulsarEscape);
    return () => document.removeEventListener('keydown', alPulsarEscape);
  }, [open]);

  // Menu movil abierto: el foco entra en el menu (el resto queda `inert`, asi
  // que Tab no se escapa) y al cerrarlo vuelve al boton que lo abrio.
  const menuMovilAbierto = open && !isDesktop;
  useEffect(() => {
    if (!menuMovilAbierto) return undefined;
    // Ambos nodos viven mientras exista el Layout: se guardan para la limpieza
    const lateral = lateralRef.current;
    const botonMenu = botonMenuRef.current;
    // El primero VISIBLE: el boton de colapsar existe pero es lg:flex (oculto aqui)
    const candidatos = lateral?.querySelectorAll('a[href], button:not([disabled])') || [];
    [...candidatos].find((el) => el.getClientRects().length > 0)?.focus({ preventScroll: true });
    return () => {
      const activo = document.activeElement;
      if (!activo || activo === document.body || lateral?.contains(activo)) {
        botonMenu?.focus({ preventScroll: true });
      }
    };
  }, [menuMovilAbierto]);

  const toggleSidebar = () => {
    // Se parte de lo que se ve (que puede venir del ancho, sin preferencia)
    const siguiente = !colapsado;
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        setCollapsed(siguiente);
      });
      return;
    }

    setCollapsed(siguiente);
  };

  const handleLogout = () => {
    logout();
    showToast(t('sessionClosed'), 'info');
    navigate('/login');
  };

  const subtituloCuenta = [
    t(usuario?.rol === 'ADMIN' ? 'roleAdmin' : 'roleMember'),
    usuario?.area ? nombreArea(usuario.area) : null,
  ].filter(Boolean).join(' · ');

  const opcionesCuenta = useMemo(() => [
    { id: 'perfil', icono: UserRound, etiqueta: t('menuMyProfile'), atajo: 'Ctrl+,', onSelect: () => { setOpen(false); navigate('/perfil'); } },
    { id: 'seguridad', icono: ShieldCheck, etiqueta: t('menuSecurity'), onSelect: () => { setOpen(false); navigate('/perfil#seguridad'); } },
  ], [t, navigate]);

  const abrirBuscador = () => {
    setOpen(false);
    setBuscadorAbierto(true);
  };

  // En movil el menu cerrado queda fuera de pantalla: `inert` lo saca del orden
  // de tabulacion y del lector de pantalla hasta que se abre.
  const menuOculto = !isDesktop && !open;

  return (
    <div className="flex min-h-dvh bg-[var(--color-bg-base)] relative overflow-hidden">
      <aside
        ref={lateralRef}
        inert={menuOculto}
        aria-hidden={menuOculto || undefined}
        className="crm-lateral fixed lg:sticky top-0 h-dvh z-[100] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] transition-[width,min-width,left] duration-300 ease-in-out"
        style={{
          left: isDesktop ? 0 : (open ? 0 : 'calc(-1 * min(84vw, 300px))'),
          width: isDesktop ? (colapsado ? '72px' : '256px') : 'min(84vw, 300px)',
          minWidth: isDesktop ? (colapsado ? '72px' : '256px') : 'min(84vw, 300px)',
        }}
      >
        {/* Cabecera: logo, nombre del panel y botón para colapsar */}
        <div className={colapsado ? 'flex flex-col items-center gap-3 px-3 pb-3 pt-5' : 'px-6 pb-4 pt-5'}>
          <div className={`flex items-center ${colapsado ? 'justify-center' : 'justify-between gap-2'}`}>
            <span style={{ viewTransitionName: 'sidebar-logo' }} className="flex min-w-0">
              {colapsado
                ? <LogoMarca fondo="auto" variante="isotipo" className="h-9 w-9" textoClassName="text-base" />
                : <LogoMarca fondo="auto" className="h-8 w-auto max-w-[150px]" textoClassName="text-lg" />}
            </span>
            {!colapsado && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden lg:flex h-7 w-7 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:-mr-1.5 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text)]"
                aria-label={t('collapseMenu')}
                title={t('collapseMenu')}
              >
                <ChevronsLeft size={16} />
              </button>
            )}
          </div>
          {!colapsado && (
            <p className="mt-2.5 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              {t('internalPanel')}
            </p>
          )}
          {colapsado && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="hidden lg:flex h-7 w-7 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text)]"
              aria-label={t('expandMenu')}
              title={t('expandMenu')}
            >
              <ChevronsRight size={16} />
            </button>
          )}
        </div>

        {/* Buscador global (Ctrl+K). Colapsado queda solo la lupa. */}
        <div className={colapsado ? 'px-3 pb-1' : 'px-3 pb-1'}>
          {colapsado ? (
            <button type="button" onClick={abrirBuscador} title={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} className="crm-nav-item crm-nav-colapsado">
              <Search size={17} />
            </button>
          ) : (
            <button type="button" onClick={abrirBuscador} aria-label={t('searchPlaceholder')} aria-keyshortcuts={esMac ? 'Meta+K' : 'Control+K'} className="crm-buscar">
              <Search size={15} className="shrink-0" />
              <span className="truncate">{t('searchPlaceholder')}</span>
              <kbd>{esMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-3" aria-label={t('mainMenu')}>
          {GRUPOS_MENU.filter((grupo) => !grupo.soloAdmin || usuario?.rol === 'ADMIN').map((grupo) => {
            const enlaces = grupo.enlaces.filter(({ modulo }) => !modulo || moduloActivo(modulo));
            if (!enlaces.length) return null;
            return (
              <div key={grupo.tituloKey}>
                {colapsado
                  ? <div className="mx-auto my-3 h-px w-6 bg-[var(--color-border)]" aria-hidden="true" />
                  : <p className="crm-lateral-grupo">{t(grupo.tituloKey)}</p>}
                <div className="flex flex-col gap-0.5">
                  {enlaces.map(({ to, labelKey, Icono }) => {
                    const label = t(labelKey);
                    return (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={() => setOpen(false)}
                        title={colapsado ? label : undefined}
                        aria-label={colapsado ? label : undefined}
                        className={`crm-nav-item ${colapsado ? 'crm-nav-colapsado crm-nav-riel' : ''}`}
                      >
                        <Icono size={17} strokeWidth={2} />
                        {/* Colapsado, el `title` hace de tooltip con raton; en
                            una tablet no hay hover y el icono quedaba mudo:
                            ahi se pinta el nombre corto bajo el icono (CSS). */}
                        {colapsado
                          ? <span className="crm-nav-rotulo" aria-hidden="true">{label}</span>
                          : <span className="crm-nav-texto">{label}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Accesos directos a los proyectos del miembro, con lo que le queda
              pendiente en cada uno. Colapsado no cabe: para eso está Proyectos. */}
          {esMiembro && !colapsado && proyectosAbiertos.length > 0 && (
            <div>
              <p className="crm-lateral-grupo">{t('menuMyProjects')}</p>
              <div className="flex flex-col gap-0.5">
                {proyectosAbiertos.slice(0, MAX_PROYECTOS_MENU).map((proyecto) => {
                  const pendientes = abiertasPorProyecto[proyecto.id] || 0;
                  return (
                    <NavLink
                      key={proyecto.id}
                      to={`/proyectos/${proyecto.id}`}
                      onClick={() => setOpen(false)}
                      className="crm-nav-item crm-nav-proyecto"
                    >
                      <span className="crm-nav-punto" style={{ background: getEstadoProyecto(proyecto.estado).dot }} aria-hidden="true" />
                      <span className="crm-nav-texto">{proyecto.nombre}</span>
                      {pendientes > 0 && <span className="crm-nav-cifra">{pendientes}</span>}
                    </NavLink>
                  );
                })}
                {proyectosAbiertos.length > MAX_PROYECTOS_MENU && (
                  <NavLink to="/proyectos" end onClick={() => setOpen(false)} className="crm-nav-mas">
                    {t('menuSeeAllProjects', { n: proyectosAbiertos.length })}
                  </NavLink>
                )}
              </div>
            </div>
          )}

          {/* Avisos al final del menú: es una fila más, con su contador. */}
          {isDesktop && (
            <div className="mt-auto pt-4">
              <NotificationCenter enSidebar colapsado={colapsado} />
            </div>
          )}
        </nav>

        {/* Pie: la persona con su menú (perfil, seguridad, tema, idioma, salir) */}
        <div className={`border-t border-[var(--color-border)] ${colapsado ? 'p-2' : 'p-3'}`}>
          <MenuCuenta
            usuario={usuario}
            subtitulo={subtituloCuenta}
            opciones={opcionesCuenta}
            onCerrarSesion={handleLogout}
            colapsado={colapsado}
            plano
          />
        </div>
      </aside>

      {/* Con el menu movil abierto el contenido queda inerte: ni foco ni lector */}
      <main inert={menuMovilAbierto} className="flex-1 min-w-0 flex flex-col h-dvh bg-[var(--color-bg-base)] overflow-hidden">
        {/* Solo en movil: ahi la barra lateral esta oculta tras el boton de
            menu, asi que hace falta un sitio para abrirla y ver los avisos.
            En escritorio ya no hay barra superior; todo vive en el sidebar. */}
        <header className="lg:hidden h-[calc(4rem+env(safe-area-inset-top))] [@media(max-height:500px)]:h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] gap-4 sticky top-0 z-[90]">
          <button
            ref={botonMenuRef}
            type="button"
            onClick={() => setOpen(true)}
            className="p-2 -ml-2 text-[var(--color-text)] hover:bg-[var(--color-surface-3)] rounded-xl transition-colors"
            aria-label={t('openMenu')}
            aria-expanded={open}
          >
            <IconMenu />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={abrirBuscador}
              className="p-2.5 text-[var(--color-text)] hover:bg-[var(--color-surface-3)] rounded-xl transition-colors"
              aria-label={t('searchPlaceholder')}
            >
              <Search size={22} strokeWidth={2.5} />
            </button>
            {!isDesktop && <NotificationCenter />}
          </div>
        </header>

        {/* md: tablet en vertical (768-1023) ya no lleva el margen de telefono.
            Se repiten las zonas seguras en md porque un telefono en horizontal
            (844×390) tambien pasa de 768 y tiene el notch a un lado. */}
        <div ref={contenidoRef} className="flex-1 overflow-y-auto p-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))] [@media(max-height:500px)]:pt-3 lg:p-8 xl:p-12 max-w-[1600px] w-full mx-auto">
          {children}
        </div>
      </main>

      {/* lg:hidden: si se gira la tablet a horizontal con el menu abierto, el
          velo se quedaba tapando el escritorio */}
      <div
        aria-hidden="true"
        className={`
          fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] transition-opacity duration-300 lg:hidden
          ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
        onClick={() => setOpen(false)}
      />

      {/* Se monta solo mientras esta abierto: asi el texto escrito se limpia al
          cerrar sin tener que vigilarlo con un efecto. */}
      {buscadorAbierto && <GlobalSearch open onClose={() => setBuscadorAbierto(false)} />}
    </div>
  );
};

export default Layout;
