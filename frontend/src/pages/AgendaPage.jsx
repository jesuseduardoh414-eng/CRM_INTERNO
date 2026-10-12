import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  MoreVertical,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { agendaService, tareasService } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoAgenda } from '../hooks/useTextoAgenda';
import { areasDeTexto } from '../utils/areas';
import Modal from '../components/Modal';
import Tooltip from '../components/Tooltip';
import SelectorSimple from '../components/SelectorSimple';
import ModalEvento from '../components/ModalEvento';
import ModalConfiguracionAgenda from '../components/ModalConfiguracionAgenda';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import VistaMes from '../components/agenda/VistaMes';
import VistaHoras from '../components/agenda/VistaHoras';
import VistaAgenda from '../components/agenda/VistaAgenda';
import VistaEquipo from '../components/agenda/VistaEquipo';
import PanelDia from '../components/agenda/PanelDia';
import {
  COLORES_TIPO,
  TIPOS_EMPRESA_NO_LABORALES,
  TIPOS_PERSONALES_AUSENTE,
  agendaItemPerteneceAProyecto,
  agruparPorClave,
  aFechaComparacion,
  capitalizar,
  diaEmpresaAplica,
  diaSemanaLaboral,
  diasDesde,
  esEventoRecurrente,
  fechaDesdeParametro,
  finDelDia,
  getDateKey,
  getDayDiff,
  getProyectoIdAgenda,
  getProyectoNombreAgenda,
  getTipoAgenda,
  inicioDeSemana,
  inicioDelDia,
  itemAgendaOcurreEnFecha,
  normalizarConfigLaboral,
  normalizarNombreProyecto,
  sumarDias,
  tituloLimpio,
} from '../components/agenda/agendaComun';

// ── Google Identity: se carga UNA vez para toda la agenda ────────────────────
// La ventana de ajustes recibe el estado y las acciones por props; antes tenia
// su propia copia de este cargador y el script podia insertarse dos veces.
let googleScriptPromise = null;

const cargarGoogleIdentityScript = () => {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      googleScriptPromise = null;
      const error = new Error('google-script');
      error.code = 'google-script';
      reject(error);
    };
    document.head.appendChild(script);
  });

  return googleScriptPromise;
};

// Vistas de la agenda. "Equipo" solo la ven los administradores.
const VISTAS = [
  { id: 'MES', clave: 'pag_vistaMes' },
  { id: 'SEMANA', clave: 'pag_vistaSemana' },
  { id: 'DIA', clave: 'pag_vistaDia' },
  { id: 'AGENDA', clave: 'pag_vistaAgenda' },
  { id: 'EQUIPO', clave: 'pag_vistaEquipo', soloAdmin: true },
];

// La vista de lista abarca 30 días desde la fecha elegida.
const DIAS_LISTA = 30;

// Filtros: cada chip enciende o apaga un tipo. "Días especiales" oculta las
// marcas de festivos y días personales (no los elementos).
const FILTROS = [
  { id: 'reunion', clave: 'pag_fReuniones', color: COLORES_TIPO.reunion },
  { id: 'evento', clave: 'pag_fEventos', color: COLORES_TIPO.evento },
  { id: 'tarea', clave: 'pag_fTareas', color: COLORES_TIPO.tarea },
  { id: 'proyecto', clave: 'pag_fProyectos', color: COLORES_TIPO.proyecto },
  { id: 'dias', clave: 'pag_fDias', color: 'var(--badge-danger-fg)' },
];

const GOOGLE_VACIO = { configured: false, connected: false, estado: 'no_configurado', caducada: false, email: null, clientId: null, scope: '' };

/**
 * Estado de Google Calendar tal y como lo manda el servidor:
 * `estado` es 'conectado' | 'desconectado' | 'no_configurado'. Si sale
 * 'desconectado' pero aun hay un correo guardado es que la conexion caduco
 * (el servidor borro los tokens tras un `invalid_grant`): hay que reconectar.
 */
const normalizarGoogle = (res) => {
  const configured = !!res?.configured;
  const connected = !!res?.connected;
  const estado = res?.estado || (!configured ? 'no_configurado' : connected ? 'conectado' : 'desconectado');
  return {
    configured,
    connected,
    estado,
    caducada: estado === 'desconectado' && !!res?.email,
    email: res?.email || null,
    clientId: res?.clientId || null,
    scope: res?.scope || '',
  };
};

/**
 * Días que abarca cada vista. El mes incluye los días de los meses vecinos
 * que completan sus semanas (la rejilla los enseña atenuados).
 */
const getDiasVista = (date, vista) => {
  if (vista === 'DIA') return [new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)];
  if (vista === 'SEMANA' || vista === 'EQUIPO') return diasDesde(inicioDeSemana(date), 7);
  if (vista === 'AGENDA') return diasDesde(date, DIAS_LISTA);
  const primero = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const ultimo = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  const inicio = inicioDeSemana(primero);
  const semanas = Math.ceil((getDayDiff(inicio, ultimo) + 1) / 7);
  return diasDesde(inicio, semanas * 7);
};

/** Meses (mes 1-12, año) que toca una lista de días: los días personales se piden por mes. */
const mesesDe = (dias) => {
  const vistos = new Map();
  dias.forEach((d) => vistos.set(`${d.getFullYear()}-${d.getMonth()}`, { mes: d.getMonth() + 1, anio: d.getFullYear() }));
  return [...vistos.values()];
};

const getTaskNumericId = (taskLike) => {
  const rawId = String(taskLike?.id || '');
  const match = rawId.match(/tarea-(\d+)/i);
  if (match) return Number(match[1]);
  const numeric = Number(rawId);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Id que entiende el servidor. Una ocurrencia de un evento recurrente llega
 * con id "<uuid>_YYYY-MM-DD"; lo correcto es mandar el id base de la serie.
 */
const getEventNumericId = (eventLike) => {
  const rawId = eventLike?.esOcurrencia
    ? eventLike?.eventoBaseId
    : (eventLike?.eventoBaseId || String(eventLike?.id || '').split('_')[0]);
  return rawId ? String(rawId) : null;
};

const moverFechaComoDia = (value, days) => {
  const date = sumarDias(value, days);
  return date ? getDateKey(date) : null;
};

const moverFechaHora = (value, days) => {
  const date = sumarDias(value, days);
  return date ? date.toISOString() : null;
};

const moverFechaTodoElDiaIso = (value, days, endOfDay = false) => {
  const date = sumarDias(value, days);
  if (!date) return null;
  date.setHours(endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date.toISOString();
};

const getAgendaItemStableKey = (item) => `${item?.tipo || 'evento'}-${item?.esOcurrencia ? item?.eventoBaseId : item?.id}-${item?.fechaInicio || ''}`;

const moverItemAgendaLocal = (item, dias) => ({
  ...item,
  fechaInicio: item.tipo === 'tarea'
    ? moverFechaComoDia(item.fechaInicio, dias)
    : item.todoElDia
      ? moverFechaTodoElDiaIso(item.fechaInicio, dias)
      : moverFechaHora(item.fechaInicio, dias),
  fechaFin: item.fechaFin
    ? (item.tipo === 'tarea'
      ? moverFechaComoDia(item.fechaFin, dias)
      : item.todoElDia
        ? moverFechaTodoElDiaIso(item.fechaFin, dias, true)
        : moverFechaHora(item.fechaFin, dias))
    : null,
});

/** Etiqueta traducida del tipo de un elemento de agenda (en vez del codigo crudo). */
const etiquetaTipoVista = (t, tipoVista) => {
  if (tipoVista === 'tarea') return t('agendaTypeTask');
  if (tipoVista === 'proyecto') return t('agendaTypeProject');
  if (tipoVista === 'reunion') return t('eventTypeMeeting');
  return t('eventTypeEvent');
};

// ── Ventanas pequenas de la agenda ───────────────────────────────────────────

/**
 * Confirmacion sencilla sobre `Modal`. Sustituye a `window.confirm`, que no
 * respeta el tema ni el idioma y bloquea el navegador.
 */
const ModalConfirmacion = ({ titulo, mensaje, confirmarLabel, danger = false, onConfirm, onClose }) => {
  const { t } = usePreferences();

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="460px"
      title={titulo}
      footer={(
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          {/* En acciones destructivas el foco inicial va en Cancelar: un Enter accidental no debe borrar. */}
          <Button type="button" variant="outline" onClick={onClose} autoFocus={danger}>{t('cancel')}</Button>
          <Button type="button" variant={danger ? 'destructive' : 'default'} onClick={onConfirm} autoFocus={!danger}>
            {confirmarLabel || t('confirm')}
          </Button>
        </div>
      )}
    >
      <p style={{ margin: 0, color: 'var(--color-text-dim)', lineHeight: 1.55, fontSize: '0.95rem' }}>{mensaje}</p>
    </Modal>
  );
};

/** Pide cuantos dias mover un elemento. Sustituye a `window.prompt`. */
const ModalMoverDias = ({ etiqueta, ocupado = false, onConfirm, onClose }) => {
  const { t } = usePreferences();
  const [valor, setValor] = useState('3');
  const [error, setError] = useState('');

  const confirmar = (ev) => {
    ev?.preventDefault();
    const dias = Number(valor);
    if (!Number.isInteger(dias) || dias === 0 || Math.abs(dias) > 366) {
      setError(t('agendaMoveDaysInvalid'));
      return;
    }
    onConfirm(dias);
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="420px"
      title={t('agendaMoveDaysTitle', { item: etiqueta })}
      footer={(
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="outline" onClick={onClose} disabled={ocupado}>{t('cancel')}</Button>
          <Button type="submit" form="form-mover-dias" disabled={ocupado}>{ocupado ? t('saving') : t('agendaMoveConfirmButton')}</Button>
        </div>
      )}
    >
      <form id="form-mover-dias" onSubmit={confirmar} className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="mover-dias-input">{t('agendaMoveDaysLabel')}</label>
        <input
          id="mover-dias-input"
          className="form-input"
          type="number"
          inputMode="numeric"
          step="1"
          min="-366"
          max="366"
          value={valor}
          autoFocus
          onChange={(ev) => { setValor(ev.target.value); setError(''); }}
        />
        {error && <div className="alert-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
};

// ── Pagina ───────────────────────────────────────────────────────────────────

const AgendaPage = () => {
  const { t, locale } = usePreferences();
  const ta = useTextoAgenda();
  const { showToast } = useToast();
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const fechaParam = searchParams.get('fecha');
  const [currentDate, setCurrentDate] = useState(() => fechaDesdeParametro(fechaParam) || new Date());
  const [fechaParamAplicada, setFechaParamAplicada] = useState(fechaParam);

  const esAdmin = usuario?.rol === 'ADMIN';
  const [view, setView] = useState('MES');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  // La semana necesita ~90px por dia para leer los bloques. Desde 768px (iPad
  // en vertical: ~720px utiles, o 1024 con el menu expandido: ~700px) caben las
  // siete columnas; por debajo se ensena el dia y el selector no la ofrece.
  const [semanaCabe, setSemanaCabe] = useState(() => window.innerWidth >= 768);
  // Si alguien deja de ser admin con la vista de equipo abierta, vuelve al mes.
  const vistaEfectiva = !semanaCabe && view === 'SEMANA' ? 'DIA' : (view === 'EQUIPO' && !esAdmin ? 'MES' : view);
  const vistasDisponibles = VISTAS.filter((vista) => (!vista.soloAdmin || esAdmin) && !(!semanaCabe && vista.id === 'SEMANA'));

  const [eventos, setEventos] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [configLaboral, setConfigLaboral] = useState(() => normalizarConfigLaboral(null));
  const [diasEspeciales, setDiasEspeciales] = useState([]);
  const [diasEmpresa, setDiasEmpresa] = useState([]);
  const [googleCalendar, setGoogleCalendar] = useState(GOOGLE_VACIO);
  // Con el modulo de Google Calendar apagado no se pide su estado ni se
  // ofrece conectar (el backend responderia con error).
  const { moduloActivo, config: configSistema } = useConfiguracion();
  const googleActivo = moduloActivo('googleCalendar');
  // Client ID de OAuth: lo registra un administrador/configurador en el panel
  // de configuracion. El estado de Google del servidor tambien lo trae; la
  // variable de entorno queda como respaldo de instalaciones antiguas.
  const googleClientId = configSistema?.google?.clientId || googleCalendar.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const [googleLoading, setGoogleLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Ajustes de la agenda: null = cerrados; si no, la pestaña con la que abren.
  const [ajustesTab, setAjustesTab] = useState(null);
  const [showInvitaciones, setShowInvitaciones] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [prefillData, setPrefillData] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const [tiposOcultos, setTiposOcultos] = useState([]);
  const [agendaProjectFilter, setAgendaProjectFilter] = useState('todos');
  // Día abierto en el panel lateral del mes (clave 'YYYY-MM-DD'); arranca en hoy.
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => getDateKey(fechaDesdeParametro(fechaParam) || new Date()));
  // Mover "elegir cantidad": { item } o { bloque: fecha } para el bloque de tareas.
  const [moverPersonalizado, setMoverPersonalizado] = useState(null);
  const [moviendo, setMoviendo] = useState(false);

  // Carga de datos: cada peticion lleva un numero; si al volver ya hay otra
  // mas nueva (el usuario pulso "siguiente" dos veces seguidas), se ignora.
  // `versionDatos` fuerza una recarga del mismo periodo (tras guardar, mover
  // o borrar) sin tener que llamar a nada desde dentro de un efecto.
  const solicitudRef = useRef(0);
  const diasVista = useMemo(() => getDiasVista(currentDate, vistaEfectiva), [currentDate, vistaEfectiva]);
  const claveDesde = getDateKey(diasVista[0]);
  const claveHasta = getDateKey(diasVista[diasVista.length - 1]);
  const claveConsulta = `${vistaEfectiva}-${claveDesde}-${claveHasta}`;
  const [claveCargada, setClaveCargada] = useState(null);
  const [versionDatos, setVersionDatos] = useState(0);
  const recargarDatos = useCallback(() => setVersionDatos((version) => version + 1), []);
  const cargando = claveCargada !== claveConsulta;
  // Fallo al cargar los elementos del periodo: { clave, mensaje, reintentando }.
  // Solo cuenta si es del periodo que se esta viendo.
  const [errorCarga, setErrorCarga] = useState(null);
  const errorVisible = errorCarga && errorCarga.clave === claveConsulta && !cargando ? errorCarga : null;
  const reintentarCarga = () => {
    setErrorCarga((previo) => (previo ? { ...previo, reintentando: true } : previo));
    recargarDatos();
  };

  // Si cambia `?fecha=` estando ya en la pagina (p. ej. desde una notificacion)
  // se salta a esa fecha. Se ajusta durante el render, como recomienda React
  // para estado derivado, en vez de en un efecto.
  if (fechaParam !== fechaParamAplicada) {
    setFechaParamAplicada(fechaParam);
    const destino = fechaDesdeParametro(fechaParam);
    if (destino) {
      setCurrentDate(destino);
      setDiaSeleccionado(getDateKey(destino));
    }
  }

  // ── Días de la empresa y personales: estado de cada día ───────────────────
  const areasUsuario = useMemo(() => {
    const areas = areasDeTexto(usuario?.area);
    return areas.length ? areas : null;
  }, [usuario?.area]);
  const diasEmpresaPorClave = useMemo(() => agruparPorClave(diasEmpresa), [diasEmpresa]);
  const diasPersonalesPorClave = useMemo(() => agruparPorClave(diasEspeciales), [diasEspeciales]);

  /**
   * Estado de un día para el usuario: días de la empresa y personales, si la
   * empresa cierra (festivo, cierre, puente...), si está ausente (vacaciones,
   * permiso...) y si es laborable según su horario.
   */
  const estadoDe = useCallback((fecha) => {
    const clave = getDateKey(fecha);
    const empresa = diasEmpresaPorClave.get(clave) || [];
    const personal = diasPersonalesPorClave.get(clave) || [];
    const cierreEmpresa = empresa.find((dia) => TIPOS_EMPRESA_NO_LABORALES.includes(dia.tipo) && diaEmpresaAplica(dia, areasUsuario)) || null;
    // Una ausencia de unas horas (permiso de 10 a 12) no quita el día laboral
    const ausente = personal.find((dia) => TIPOS_PERSONALES_AUSENTE.includes(dia.tipo) && !dia.horaInicio) || null;
    const laboralPorHorario = (configLaboral.diasLaborales || []).includes(diaSemanaLaboral(fecha));
    return { clave, empresa, personal, cierreEmpresa, ausente, laboralPorHorario, esLaboral: laboralPorHorario && !cierreEmpresa && !ausente };
  }, [areasUsuario, configLaboral, diasEmpresaPorClave, diasPersonalesPorClave]);

  const esLaborable = useCallback((fecha) => estadoDe(fecha).esLaboral, [estadoDe]);

  // ── Filtros ───────────────────────────────────────────────────────────────
  // El administrador ve todos los proyectos en su panel; aquí no se le pintan
  // como bloques para no llenar el calendario.
  const ocultarBloquesProyecto = esAdmin;
  const agendaProjectOptions = useMemo(() => {
    const projects = new Map();

    eventos.forEach((evento) => {
      const tipo = getTipoAgenda(evento);
      if (tipo !== 'proyecto' && tipo !== 'tarea' && !evento?.proyecto?.id) return;

      const id = getProyectoIdAgenda(evento);
      const nombre = getProyectoNombreAgenda(evento);
      const key = normalizarNombreProyecto(nombre);
      if (!key || !nombre) return;

      const existente = projects.get(key);
      if (!existente) {
        projects.set(key, { id: key, key, nombre, ids: id ? [id] : [] });
      } else if (id && !existente.ids.includes(id)) {
        projects.set(key, { ...existente, ids: [...existente.ids, id] });
      }
    });

    return [...projects.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [eventos]);

  // Si el proyecto elegido ya no esta (cambio de mes), se muestra "todos" sin
  // necesidad de un efecto que corrija el estado.
  const proyectoFiltroActivo = agendaProjectFilter !== 'todos' && agendaProjectOptions.some((project) => project.id === agendaProjectFilter)
    ? agendaProjectFilter
    : 'todos';
  const selectedAgendaProject = useMemo(
    () => agendaProjectOptions.find((project) => project.id === proyectoFiltroActivo) || null,
    [proyectoFiltroActivo, agendaProjectOptions]
  );

  // Base de los conteos: todo lo cargado con el filtro de proyecto aplicado.
  const eventosBase = useMemo(
    () => eventos.filter((evento) => {
      if (ocultarBloquesProyecto && getTipoAgenda(evento) === 'proyecto') return false;
      if (proyectoFiltroActivo !== 'todos') return agendaItemPerteneceAProyecto(evento, selectedAgendaProject);
      return true;
    }),
    [eventos, ocultarBloquesProyecto, proyectoFiltroActivo, selectedAgendaProject]
  );

  const eventosVisibles = useMemo(
    () => eventosBase.filter((evento) => !tiposOcultos.includes(getTipoAgenda(evento))),
    [eventosBase, tiposOcultos]
  );
  const mostrarDias = !tiposOcultos.includes('dias');

  const conteos = useMemo(() => {
    const cuenta = { reunion: 0, evento: 0, tarea: 0, proyecto: 0, dias: 0 };
    eventosBase.forEach((evento) => { cuenta[getTipoAgenda(evento)] += 1; });
    const enRango = (dia) => dia.fecha && String(dia.fecha).slice(0, 10) >= claveDesde && String(dia.fecha).slice(0, 10) <= claveHasta;
    cuenta.dias = diasEmpresa.filter(enRango).length + diasEspeciales.filter(enRango).length;
    return cuenta;
  }, [claveDesde, claveHasta, diasEmpresa, diasEspeciales, eventosBase]);

  const filtrosVisibles = FILTROS.filter((filtro) => !(filtro.id === 'proyecto' && ocultarBloquesProyecto));
  const alternarFiltro = (id) => setTiposOcultos((previos) => (
    previos.includes(id) ? previos.filter((tipo) => tipo !== id) : [...previos, id]
  ));

  /** Id de proyecto de una tarea: las tareas solo traen el nombre, se busca en los bloques. */
  const proyectoIdPorNombre = useMemo(() => {
    const mapa = new Map();
    eventos.forEach((evento) => {
      const id = getProyectoIdAgenda(evento);
      const nombre = normalizarNombreProyecto(getProyectoNombreAgenda(evento));
      if (id && nombre) mapa.set(nombre, id);
    });
    return mapa;
  }, [eventos]);

  // ── Efectos ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 1024);
      setSemanaCabe(window.innerWidth >= 768);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Configuracion laboral y estado de Google: una sola vez al entrar.
  useEffect(() => {
    let activo = true;
    (async () => {
      const [resConfig, resGoogle] = await Promise.allSettled([
        agendaService.getConfigLaboral(),
        googleActivo ? agendaService.getGoogleCalendarStatus() : Promise.reject(new Error('google-off')),
      ]);
      if (!activo) return;
      if (resConfig.status === 'fulfilled') setConfigLaboral(normalizarConfigLaboral(resConfig.value.config));
      else showToast(resConfig.reason?.message || t('agendaConfigLoadError'), 'error');
      // Google falla en silencio: el boton queda deshabilitado y la agenda sigue.
      if (resGoogle.status === 'fulfilled') setGoogleCalendar(normalizarGoogle(resGoogle.value));
    })();
    return () => { activo = false; };
  }, [showToast, t, googleActivo]);

  useEffect(() => {
    const solicitud = ++solicitudRef.current;
    const inicio = inicioDelDia(diasVista[0]);
    const fin = finDelDia(diasVista[diasVista.length - 1]);

    (async () => {
      const [resEventos, resInvitaciones, resDias, resEmpresa] = await Promise.allSettled([
        agendaService.listar(inicio.toISOString(), fin.toISOString()),
        agendaService.invitacionesPendientes(),
        // Los días personales se piden por mes: el rango puede tocar dos o tres.
        Promise.all(mesesDe(diasVista).map(({ mes, anio }) => agendaService.listarDiasEspeciales(mes, anio))),
        agendaService.diasEmpresa(claveDesde, claveHasta),
      ]);

      // Llego una peticion mas nueva mientras esta esperaba: no se pinta.
      if (solicitud !== solicitudRef.current) return;

      // Si fallan los elementos no se dejan los del periodo anterior como si
      // fueran de este: se vacia la lista y se ensena el error en el calendario.
      if (resEventos.status === 'fulfilled') {
        setEventos(resEventos.value?.eventos || []);
        setErrorCarga(null);
      } else {
        setEventos([]);
        setErrorCarga({ clave: claveConsulta, mensaje: resEventos.reason?.message || '', reintentando: false });
      }
      if (resInvitaciones.status === 'fulfilled') {
        setInvitaciones(resInvitaciones.value?.invitaciones || resInvitaciones.value?.pendientes || []);
      }
      // Los dias (festivos, vacaciones) tampoco se arrastran de otro periodo.
      if (resDias.status === 'fulfilled') {
        const vistos = new Set();
        setDiasEspeciales(resDias.value.flatMap((res) => res?.dias || []).filter((dia) => !vistos.has(dia.id) && vistos.add(dia.id)));
      } else {
        setDiasEspeciales([]);
      }
      setDiasEmpresa(resEmpresa.status === 'fulfilled' ? resEmpresa.value?.dias || [] : []);

      // El fallo de los elementos ya se ve dentro del calendario; el resto
      // (invitaciones, dias) se avisa con un toast.
      const fallo = [resInvitaciones, resDias, resEmpresa].find((resultado) => resultado.status === 'rejected');
      if (fallo) showToast(fallo.reason?.message || t('agendaLoadError'), 'error');

      setClaveCargada(claveConsulta);
    })();
  }, [claveConsulta, claveDesde, claveHasta, diasVista, versionDatos, showToast, t]);

  useEffect(() => {
    let timeoutId = null;
    const handleScheduleChanged = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        recargarDatos();
      }, 150);
    };

    window.addEventListener('crm:schedule-changed', handleScheduleChanged);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('crm:schedule-changed', handleScheduleChanged);
    };
  }, [recargarDatos]);

  // El cajón de invitaciones se cierra con Escape, como el resto de ventanas.
  useEffect(() => {
    if (!showInvitaciones) return undefined;
    const alTeclear = (ev) => { if (ev.key === 'Escape') setShowInvitaciones(false); };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [showInvitaciones]);

  // `?evento=` abre ese evento en cuanto aparece en la lista cargada. Se deriva
  // del parametro y de la lista, sin copiarlo a estado: al cerrar la ventana se
  // quita el parametro y la ventana desaparece sola.
  const eventoParam = searchParams.get('evento');
  const eventoDesdeParam = useMemo(
    () => (eventoParam ? eventos.find((evento) => evento.id === eventoParam || evento.eventoBaseId === eventoParam) || null : null),
    [eventoParam, eventos]
  );
  const modalEventoVisible = modalOpen || !!eventoDesdeParam;
  const eventoAbierto = modalOpen ? selectedEvent : eventoDesdeParam;

  const cerrarModalEvento = useCallback(() => {
    setModalOpen(false);
    setSelectedEvent(null);
    setPrefillData(null);

    if (searchParams.get('evento') || searchParams.get('fecha')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('evento');
      nextParams.delete('fecha');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /** Abre una confirmacion y resuelve true/false segun lo que elija el usuario. */
  const pedirConfirmacion = useCallback((opciones) => new Promise((resolve) => {
    setConfirmacion({ ...opciones, resolve });
  }), []);

  const cerrarConfirmacion = (resultado) => {
    confirmacion?.resolve(resultado);
    setConfirmacion(null);
  };

  // Navegacion: el mes salta al dia 1 (sumar un mes al 31 se salia de mes).
  const desplazar = (sentido) => {
    const d = currentDate;
    if (vistaEfectiva === 'MES') setCurrentDate(new Date(d.getFullYear(), d.getMonth() + sentido, 1, 12));
    else if (vistaEfectiva === 'SEMANA' || vistaEfectiva === 'EQUIPO') setCurrentDate(sumarDias(d, 7 * sentido));
    else if (vistaEfectiva === 'AGENDA') setCurrentDate(sumarDias(d, DIAS_LISTA * sentido));
    else setCurrentDate(sumarDias(d, sentido));
  };
  const irAHoy = () => {
    setCurrentDate(new Date());
    setDiaSeleccionado(getDateKey(new Date()));
  };
  const hoyKey = getDateKey(new Date());
  const hoyEnVista = vistaEfectiva === 'AGENDA' ? claveDesde === hoyKey : hoyKey >= claveDesde && hoyKey <= claveHasta
    && (vistaEfectiva !== 'MES' || currentDate.getMonth() === new Date().getMonth());

  const handleResponder = async (eventoId, respuesta) => {
    try {
      await agendaService.responderInvitacion(eventoId, respuesta);
      showToast(respuesta === 'aceptado' ? t('agendaInvitationAccepted') : t('agendaInvitationRejected'));
      recargarDatos();
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleEliminar = useCallback(async (evento) => {
    const id = getEventNumericId(evento);
    if (!id) return;

    const recurrente = esEventoRecurrente(evento);
    const ok = await pedirConfirmacion({
      titulo: t('agendaDeleteEvent'),
      mensaje: recurrente ? t('agendaDeleteSeriesConfirm') : t('agendaDeleteEventConfirm'),
      confirmarLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;

    try {
      await agendaService.eliminar(id);
      showToast(t('agendaEventDeleted'));
      cerrarModalEvento();
      recargarDatos();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }, [cerrarModalEvento, pedirConfirmacion, recargarDatos, showToast, t]);

  const handleSelectFechaEvento = useCallback((datosFecha) => {
    setSelectedEvent(null);
    setPrefillData(datosFecha);
    setModalOpen(true);
  }, []);

  // "Nuevo evento" propone hoy a la hora tipica; antes abria sin fecha.
  const abrirNuevoEvento = useCallback(() => handleSelectFechaEvento({ fechaInicio: new Date(), sinHora: true }), [handleSelectFechaEvento]);
  const nuevoEnFecha = useCallback((fecha) => handleSelectFechaEvento({ fechaInicio: fecha, sinHora: true }), [handleSelectFechaEvento]);

  const abrirEvento = useCallback((evento) => {
    if (evento.esLectura) {
      showToast(evento.titulo, 'info');
      return;
    }
    setSelectedEvent(evento);
    setPrefillData(null);
    setModalOpen(true);
  }, [showToast]);

  /** Tareas y proyectos llevan a su proyecto; los eventos abren su ventana. */
  const abrirItem = useCallback((item) => {
    const tipo = getTipoAgenda(item);
    if (tipo === 'tarea' || tipo === 'proyecto') {
      const id = getProyectoIdAgenda(item) || proyectoIdPorNombre.get(normalizarNombreProyecto(getProyectoNombreAgenda(item)));
      if (id) navigate(`/proyectos/${id}`);
      else showToast(tituloLimpio(item), 'info');
      return;
    }
    abrirEvento(item);
  }, [abrirEvento, navigate, proyectoIdPorNombre, showToast]);

  const verDia = useCallback((fecha) => {
    setCurrentDate(fecha);
    setDiaSeleccionado(getDateKey(fecha));
    setView('DIA');
  }, []);

  // Por debajo de 1280px el panel del día va DEBAJO de la rejilla del mes: al
  // tocar un día se acerca lo justo para que se vea (si ya se ve, no se mueve).
  const panelDiaRef = useRef(null);
  const seleccionarDiaMes = useCallback((clave) => {
    setDiaSeleccionado(clave);
    if (window.innerWidth >= 1280) return;
    window.requestAnimationFrame(() => {
      panelDiaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const moverTareaAgenda = useCallback(async (tarea, dias) => {
    const taskId = getTaskNumericId(tarea);
    if (!taskId) return;

    await tareasService.editar(taskId, {
      fechaInicio: moverFechaComoDia(tarea.fechaInicio, dias),
      venceEn: moverFechaComoDia(tarea.fechaFin || tarea.fechaInicio, dias),
    });
  }, []);

  // Solo eventos sueltos: una ocurrencia de una serie no se mueve desde aqui
  // (enviar su fecha como inicio de la serie la reescribiria entera).
  const moverEventoAgenda = useCallback(async (evento, dias) => {
    const eventId = getEventNumericId(evento);
    if (!eventId) return;

    await agendaService.editar(eventId, {
      fecha_inicio: evento.todoElDia ? moverFechaTodoElDiaIso(evento.fechaInicio, dias) : moverFechaHora(evento.fechaInicio, dias),
      fecha_fin: evento.fechaFin
        ? (evento.todoElDia ? moverFechaTodoElDiaIso(evento.fechaFin, dias, true) : moverFechaHora(evento.fechaFin, dias))
        : null,
      todo_el_dia: !!evento.todoElDia,
    });
  }, []);

  // Bloque de tareas: las del dia base y las de los dias consecutivos con
  // tareas (hasta 120 dias). Se usa para mover el bloque entero.
  const obtenerBloqueTareasDesdeFecha = useCallback((fechaBase) => {
    const tareasAgenda = eventos.filter((evento) => evento.tipo === 'tarea');
    const tareasAMover = new Map();
    let cursor = aFechaComparacion(fechaBase);

    for (let i = 0; i < 120 && cursor; i += 1) {
      const tareasDelDia = tareasAgenda.filter((tarea) => itemAgendaOcurreEnFecha(tarea, cursor, esLaborable));
      if (tareasDelDia.length === 0) break;

      tareasDelDia.forEach((tarea) => {
        const taskId = getTaskNumericId(tarea);
        if (!taskId) return;
        tareasAMover.set(taskId, tarea);
      });

      cursor = sumarDias(cursor, 1);
    }

    return [...tareasAMover.values()];
  }, [esLaborable, eventos]);

  /**
   * Mueve en pantalla al instante, manda cada cambio al servidor y, pase lo
   * que pase, recarga: si una parte fallo, la agenda tiene que ensenar lo que
   * de verdad quedo guardado, no "deshacer" solo en pantalla.
   */
  const aplicarMovimientoAgenda = useCallback(async ({ claves, dias, operaciones, mensajeExito, mensajeError }) => {
    setEventos((previos) => previos.map((evento) => (
      claves.has(getAgendaItemStableKey(evento)) ? moverItemAgendaLocal(evento, dias) : evento
    )));

    const resultados = await Promise.allSettled(operaciones.map((operacion) => operacion()));
    const fallidas = resultados.filter((resultado) => resultado.status === 'rejected');

    recargarDatos();

    if (fallidas.length === 0) {
      showToast(mensajeExito);
      return true;
    }
    if (fallidas.length === resultados.length) {
      showToast(fallidas[0].reason?.message || mensajeError, 'error');
    } else {
      showToast(t('agendaMovePartial', { failed: fallidas.length, total: resultados.length }), 'error');
    }
    return false;
  }, [recargarDatos, showToast, t]);

  const handleMoverBloqueTareasDelta = useCallback(async (fechaBase, diasAMover) => {
    const dias = Number(diasAMover);
    if (!fechaBase || !Number.isInteger(dias) || dias === 0) return false;

    const tareasAMover = obtenerBloqueTareasDesdeFecha(fechaBase);
    if (tareasAMover.length === 0) {
      showToast(t('agendaTaskMoveNone'), 'info');
      return false;
    }

    const taskLabel = tareasAMover.length === 1 ? t('projectTaskSingular') : t('projectTaskPlural');
    const destino = sumarDias(fechaBase, dias);
    const ok = await pedirConfirmacion({
      titulo: t('agendaMoveTasksTitle'),
      mensaje: t('agendaMoveTasksConfirm', {
        count: tareasAMover.length,
        taskLabel,
        date: destino ? destino.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
      }),
      confirmarLabel: t('agendaMoveConfirmButton'),
    });
    if (!ok) return false;

    return aplicarMovimientoAgenda({
      claves: new Set(tareasAMover.map(getAgendaItemStableKey)),
      dias,
      operaciones: tareasAMover.map((tarea) => () => moverTareaAgenda(tarea, dias)),
      mensajeExito: t('agendaTaskMoveSuccess', {
        count: tareasAMover.length,
        taskLabel,
        days: Math.abs(dias),
        dayLabel: Math.abs(dias) === 1 ? t('taskDaySingular') : t('taskDayPlural'),
      }),
      mensajeError: t('agendaTaskMoveError'),
    });
  }, [aplicarMovimientoAgenda, locale, moverTareaAgenda, obtenerBloqueTareasDesdeFecha, pedirConfirmacion, showToast, t]);

  // Mover un elemento suelto (arrastre en el mes o menú del panel del día).
  const handleMoverItemAgenda = useCallback(async (item, diasAMover) => {
    const dias = Number(diasAMover);
    const tipo = getTipoAgenda(item);
    if (!item || !Number.isInteger(dias) || dias === 0 || tipo === 'proyecto') return false;

    if (tipo !== 'tarea' && esEventoRecurrente(item)) {
      showToast(t('agendaRecurringMoveUnsupported'), 'info');
      return false;
    }

    return aplicarMovimientoAgenda({
      claves: new Set([getAgendaItemStableKey(item)]),
      dias,
      operaciones: [() => (tipo === 'tarea' ? moverTareaAgenda(item, dias) : moverEventoAgenda(item, dias))],
      mensajeExito: t('agendaItemMovedDays', {
        item: etiquetaTipoVista(t, tipo),
        days: Math.abs(dias),
        dayLabel: Math.abs(dias) === 1 ? t('taskDaySingular') : t('taskDayPlural'),
      }),
      mensajeError: t('agendaElementMoveError'),
    });
  }, [aplicarMovimientoAgenda, moverEventoAgenda, moverTareaAgenda, showToast, t]);

  const confirmarMoverPersonalizado = async (dias) => {
    if (!moverPersonalizado || moviendo) return;
    setMoviendo(true);
    const movido = moverPersonalizado.bloque
      ? await handleMoverBloqueTareasDelta(moverPersonalizado.bloque, dias)
      : await handleMoverItemAgenda(moverPersonalizado.item, dias);
    setMoviendo(false);
    if (movido) setMoverPersonalizado(null);
  };

  const handleConnectGoogle = async () => {
    // Sin credenciales no hay nada que hacer aqui: las pone quien administra
    // el sistema en el panel de configuracion.
    if (!googleClientId || !googleCalendar.configured) {
      showToast(ta('mod_googleSinCredenciales'), 'error');
      return;
    }

    setGoogleLoading(true);
    try {
      const google = await cargarGoogleIdentityScript();
      await new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initCodeClient({
          client_id: googleClientId,
          scope: googleCalendar.scope,
          ux_mode: 'popup',
          callback: async (response) => {
            if (!response?.code) {
              reject(new Error(t('agendaGoogleNoCode')));
              return;
            }

            try {
              const res = await agendaService.connectGoogleCalendar(response.code);
              setGoogleCalendar((prev) => ({
                ...prev,
                connected: true,
                estado: 'conectado',
                caducada: false,
                email: res.email || prev.email,
              }));
              showToast(t('agendaGoogleConnected'));
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          error_callback: () => reject(new Error(t('agendaGoogleAuthFailed'))),
        });

        client.requestCode();
      });
    } catch (error) {
      const mensaje = error?.code === 'google-script' ? t('agendaGoogleScriptError') : (error?.message || t('agendaGoogleConnectError'));
      showToast(mensaje, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  // El botón de Google de la cabecera conecta; si ya hay conexión abre su
  // pestaña de ajustes. Antes un solo toque la desconectaba sin preguntar.
  const handleBotonGoogle = () => {
    if (googleCalendar.connected) setAjustesTab('GOOGLE');
    else void handleConnectGoogle();
  };

  const handleDisconnectGoogle = async () => {
    setGoogleLoading(true);
    try {
      await agendaService.disconnectGoogleCalendar();
      setGoogleCalendar((prev) => ({
        ...prev,
        connected: false,
        estado: 'desconectado',
        caducada: false,
        email: null,
      }));
      showToast(t('agendaGoogleDisconnected'));
    } catch (error) {
      showToast(error.message || t('agendaGoogleDisconnectError'), 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  if (cargando && !claveCargada) return <AgendaSkeleton />;

  // Ya conectado, el botón solo abre los ajustes: no depende de las credenciales.
  const googleBloqueado = googleLoading || (!googleCalendar.connected && !googleCalendar.configured);
  const googleTitulo = googleCalendar.connected
    ? t('agendaGoogleConnectedWith', { email: googleCalendar.email || 'Google Calendar' })
    : !googleCalendar.configured
      ? ta('mod_googleSinCredenciales')
      : googleCalendar.caducada
        ? t('agendaGoogleExpired')
        : t('agendaGoogleConnectTitle');
  const googleEtiqueta = googleLoading
    ? (googleCalendar.connected ? t('projectsDisconnecting') : t('projectsConnecting'))
    : googleCalendar.connected
      ? t('projectsConnectedGoogle')
      : googleCalendar.caducada
        ? t('agendaGoogleReconnect')
        : t('projectsConnectGoogle');

  // Una ocurrencia se edita por el id base de la serie; `esOcurrencia` se
  // conserva para que la ventana sepa que es una serie.
  const eventoParaEditar = eventoAbierto?.esOcurrencia
    ? { ...eventoAbierto, id: eventoAbierto.eventoBaseId }
    : eventoAbierto;

  // Título del periodo: mes, rango de la semana/lista o el día completo.
  const formatoRango = () => {
    const a = diasVista[0];
    const b = diasVista[diasVista.length - 1];
    const mismoAnio = a.getFullYear() === b.getFullYear();
    const desde = a.toLocaleDateString(locale, mismoAnio ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    const hasta = b.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return ta('pag_rango', { desde, hasta });
  };
  const titulo = vistaEfectiva === 'MES'
    ? capitalizar(currentDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' }))
    : vistaEfectiva === 'DIA'
      // En el móvil el día va abreviado ("Mié, 7 oct 2026") para que quepa sin cortarse
      ? capitalizar(currentDate.toLocaleDateString(locale, { weekday: isMobile ? 'short' : 'long', day: 'numeric', month: 'short', year: 'numeric' }))
      : formatoRango();

  // Panel lateral del mes: solo si el día elegido está en la rejilla visible.
  const diaPanel = vistaEfectiva === 'MES' && diaSeleccionado && diaSeleccionado >= claveDesde && diaSeleccionado <= claveHasta
    ? diasVista.find((dia) => getDateKey(dia) === diaSeleccionado)
    : null;
  const itemsDelDia = (fecha) => eventosVisibles.filter((item) => itemAgendaOcurreEnFecha(item, fecha, esLaborable));
  const totalVisible = conteos.reunion + conteos.evento + conteos.tarea + (ocultarBloquesProyecto ? 0 : conteos.proyecto);

  const propsPanel = {
    mostrarDias,
    currentUserId: usuario?.id,
    onNuevo: nuevoEnFecha,
    onAbrir: abrirItem,
    onEliminar: handleEliminar,
    onMover: handleMoverItemAgenda,
    onMoverPersonalizado: (item) => setMoverPersonalizado({ item }),
    onMoverBloque: (fecha) => setMoverPersonalizado({ bloque: fecha }),
  };

  return (
    <div className="page-container ag-pagina">
      {/* Cabecera en dos filas: el periodo arriba y debajo la barra
          `‹ Hoy ›  Mes | Semana | Día …  + Nuevo`. En pantallas estrechas las
          acciones suben junto al título y Google, invitaciones y ajustes se
          recogen en el menú "⋮" (siguen ahí, solo cambian de sitio). */}
      <header className="ag-cabecera">
        <div className="ag-cab-titulo">
          <p className="ag-eyebrow">
            {ta('pag_eyebrow', { hoy: capitalizar(new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })) })}
          </p>
          <h1 className="ag-titulo" title={titulo}>{titulo}</h1>
        </div>

        <div className="ag-cab-barra">
          <div className="ag-nav">
            <Tooltip label={t('previous')}>
              <button type="button" className="dash-icono" onClick={() => desplazar(-1)}><ChevronLeft size={17} /></button>
            </Tooltip>
            <button type="button" className="ag-hoy" onClick={irAHoy} disabled={hoyEnVista}>{t('agendaToday')}</button>
            <Tooltip label={t('next')}>
              <button type="button" className="dash-icono" onClick={() => desplazar(1)}><ChevronRight size={17} /></button>
            </Tooltip>
          </div>

          <div role="tablist" aria-label={ta('pag_vistasAria')} className="dash-segmento ag-vistas">
            {vistasDisponibles.map((vista) => (
              <button key={vista.id} type="button" role="tab" aria-selected={vistaEfectiva === vista.id} onClick={() => setView(vista.id)}>
                {ta(vista.clave)}
              </button>
            ))}
          </div>
        </div>

        <div className="ag-acciones">
          {/* Acciones secundarias sueltas: solo con espacio de sobra */}
          {googleActivo && (
            <button
              type="button"
              className="ag-boton ag-boton-google ag-solo-ancho"
              data-estado={googleCalendar.connected ? 'ok' : googleCalendar.caducada ? 'aviso' : undefined}
              onClick={handleBotonGoogle}
              disabled={googleBloqueado}
              title={googleTitulo}
              aria-label={googleTitulo}
            >
              <Globe size={15} />
              <span className="ag-boton-texto">{googleEtiqueta}</span>
            </button>
          )}

          <Tooltip label={t('agendaInvitations')}>
            <button type="button" className="ag-boton ag-boton-icono ag-solo-ancho" onClick={() => setShowInvitaciones(!showInvitaciones)} aria-expanded={showInvitaciones}>
              <Mail size={15} />
              {invitaciones.length > 0 && <span className="ag-contador">{invitaciones.length}</span>}
            </button>
          </Tooltip>

          <Tooltip label={t('agendaSettingsTitle')}>
            <button type="button" className="ag-boton ag-boton-icono ag-solo-ancho" onClick={() => setAjustesTab('HORARIO')}>
              <Settings size={15} />
            </button>
          </Tooltip>

          {/* Pantallas estrechas: las mismas tres acciones en un menú. El
              contador de invitaciones pendientes se ve también en el "⋮". */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ag-boton ag-boton-icono ag-solo-estrecho"
                aria-label={invitaciones.length > 0 ? `${ta('pag_masAcciones')} · ${ta('pag_invitacionesN', { n: invitaciones.length })}` : ta('pag_masAcciones')}
                title={ta('pag_masAcciones')}
              >
                <MoreVertical size={16} />
                {invitaciones.length > 0 && <span className="ag-contador">{invitaciones.length}</span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[1500] min-w-[220px]">
              {googleActivo && (
                <DropdownMenuItem className="ag-menu-item gap-2 font-medium" disabled={googleBloqueado} onSelect={handleBotonGoogle}>
                  <Globe size={15} aria-hidden="true" />
                  <span className="min-w-0 truncate">{googleEtiqueta}</span>
                  {(googleCalendar.connected || googleCalendar.caducada) && (
                    <span className="ag-menu-estado" data-estado={googleCalendar.connected ? 'ok' : 'aviso'} aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="ag-menu-item gap-2 font-medium" onSelect={() => setShowInvitaciones(true)}>
                <Mail size={15} aria-hidden="true" />
                <span>{ta('pag_invitacionesN', { n: invitaciones.length })}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="ag-menu-item gap-2 font-medium" onSelect={() => setAjustesTab('HORARIO')}>
                <Settings size={15} aria-hidden="true" />
                <span>{t('agendaSettingsTitle')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button className="ag-nuevo h-9 rounded-[8px] px-3.5" onClick={abrirNuevoEvento} aria-label={ta('pag_nuevo')}>
            <Plus size={15} /> <span className="ag-boton-texto">{ta('pag_nuevo')}</span>
          </Button>
        </div>
      </header>

      {/* Filtros como chips con su cuenta; en la vista de equipo no aplican */}
      {vistaEfectiva !== 'EQUIPO' && (
        <div className="ag-filtros">
          <div role="group" aria-label={ta('pag_filtrosAria')} className="ag-chips">
            <button type="button" className="ag-chip" aria-pressed={tiposOcultos.length === 0} onClick={() => setTiposOcultos([])}>
              {ta('pag_fTodo')} <span className="ag-chip-n">{totalVisible}</span>
            </button>
            {filtrosVisibles.map((filtro) => (
              <button
                key={filtro.id}
                type="button"
                className="ag-chip"
                aria-pressed={!tiposOcultos.includes(filtro.id)}
                style={{ '--ag-color': filtro.color }}
                onClick={() => alternarFiltro(filtro.id)}
              >
                <i aria-hidden="true" />
                {ta(filtro.clave)} <span className="ag-chip-n">{conteos[filtro.id]}</span>
              </button>
            ))}
          </div>
          {agendaProjectOptions.length > 0 && (
            <SelectorSimple
              className="campo-select-compacto w-auto max-w-[15rem]"
              valor={proyectoFiltroActivo}
              onCambio={setAgendaProjectFilter}
              aria-label={ta('pag_proyectoAria')}
              opciones={[
                { valor: 'todos', etiqueta: ta('pag_todosProyectos') },
                ...agendaProjectOptions.map((project) => ({ valor: project.id, etiqueta: project.nombre })),
              ]}
            />
          )}
        </div>
      )}

      {/* Fondo del cajón: tocar fuera lo cierra (en el móvil ocupa toda la pantalla) */}
      {showInvitaciones && <div className="ag-invitaciones-fondo" aria-hidden="true" onClick={() => setShowInvitaciones(false)} />}
      {showInvitaciones && (
        <div role="dialog" aria-label={t('agendaInvitations')} className="ag-invitaciones">
          <header>
            <h2>{t('agendaInvitations')} <span>{invitaciones.length}</span></h2>
            <Tooltip label={t('close')}><button type="button" onClick={() => setShowInvitaciones(false)} className="dash-icono"><X size={16} /></button></Tooltip>
          </header>
          <div className="ag-invitaciones-lista">
            {invitaciones.length === 0 ? (
              <p className="ag-panel-vacio">{t('notificationsEmpty')}</p>
            ) : (
              invitaciones.map((inv) => (
                <article key={inv.id} className="ag-invitacion">
                  <b>{inv.evento.titulo}</b>
                  <span>{t('agendaOrganizer')} {inv.evento.creador?.nombre}</span>
                  <span>{capitalizar(new Date(inv.evento.fechaInicio).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
                  <div>
                    <Button size="sm" className="h-9 flex-1 rounded-[7px]" onClick={() => handleResponder(inv.evento.id, 'aceptado')}>{t('agendaAcceptInvitation')}</Button>
                    <Button size="sm" variant="outline" className="h-9 flex-1 rounded-[7px]" onClick={() => handleResponder(inv.evento.id, 'rechazado')}>{t('agendaRejectInvitation')}</Button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}

      {/* Al cambiar de periodo, lo de antes se atenua y no responde hasta que
          llegan los datos nuevos: no debe parecer el periodo actual. */}
      <section className="dash-panel ag-panel" aria-busy={cargando} data-obsoleto={cargando && vistaEfectiva !== 'EQUIPO'}>
        {cargando && <div className="ag-cargando" aria-hidden="true" />}

        {errorVisible && vistaEfectiva !== 'EQUIPO' && (
          <div className="ag-error" role="alert">
            <span className="ag-error-icono" aria-hidden="true"><AlertTriangle size={20} /></span>
            <p>{ta('pag_errorTitulo')}</p>
            <span>{ta('pag_errorSub')}</span>
            {errorVisible.mensaje && <small>{errorVisible.mensaje}</small>}
            <button type="button" className="ag-boton" onClick={reintentarCarga} disabled={errorVisible.reintentando}>
              <RefreshCw size={15} className={errorVisible.reintentando ? 'animate-spin' : undefined} aria-hidden="true" />
              {errorVisible.reintentando ? ta('pag_reintentando') : ta('pag_reintentar')}
            </button>
          </div>
        )}

        {!errorVisible && vistaEfectiva === 'MES' && (
          <div className="ag-mes-layout" data-panel={!!diaPanel}>
            <VistaMes
              fecha={currentDate}
              items={eventosVisibles}
              estadoDe={estadoDe}
              esLaborable={esLaborable}
              mostrarDias={mostrarDias}
              diaSeleccionado={diaPanel ? diaSeleccionado : null}
              onSeleccionarDia={seleccionarDiaMes}
              onNuevo={nuevoEnFecha}
              onAbrir={abrirItem}
              onMoverItem={handleMoverItemAgenda}
            />
            {diaPanel && (
              <PanelDia
                ref={panelDiaRef}
                fecha={diaPanel}
                items={itemsDelDia(diaPanel)}
                estado={estadoDe(diaPanel)}
                onCerrar={() => setDiaSeleccionado(null)}
                {...propsPanel}
              />
            )}
          </div>
        )}

        {!errorVisible && vistaEfectiva === 'SEMANA' && (
          <VistaHoras
            dias={diasVista}
            items={eventosVisibles}
            configLaboral={configLaboral}
            estadoDe={estadoDe}
            esLaborable={esLaborable}
            mostrarDias={mostrarDias}
            currentUserId={usuario?.id}
            onAbrir={abrirItem}
            onNuevo={handleSelectFechaEvento}
            onVerDia={verDia}
          />
        )}

        {!errorVisible && vistaEfectiva === 'DIA' && (
          <div className="ag-dia-layout">
            <VistaHoras
              dias={diasVista}
              items={eventosVisibles}
              configLaboral={configLaboral}
              estadoDe={estadoDe}
              esLaborable={esLaborable}
              mostrarDias={mostrarDias}
              currentUserId={usuario?.id}
              onAbrir={abrirItem}
              onNuevo={handleSelectFechaEvento}
            />
            <PanelDia fecha={diasVista[0]} items={itemsDelDia(diasVista[0])} estado={estadoDe(diasVista[0])} {...propsPanel} />
          </div>
        )}

        {!errorVisible && vistaEfectiva === 'AGENDA' && (
          <VistaAgenda
            dias={diasVista}
            items={eventosVisibles}
            estadoDe={estadoDe}
            esLaborable={esLaborable}
            mostrarDias={mostrarDias}
            currentUserId={usuario?.id}
            onAbrir={abrirItem}
            onNuevo={nuevoEnFecha}
          />
        )}

        {vistaEfectiva === 'EQUIPO' && <VistaEquipo fecha={currentDate} />}

        {/* Leyenda: qué significa cada color y marca */}
        <footer className="ag-leyenda" hidden={!!errorVisible && vistaEfectiva !== 'EQUIPO'}>
          {vistaEfectiva !== 'EQUIPO' && (
            <>
              <span><i className="ag-ley-punto" style={{ background: COLORES_TIPO.reunion }} /> {ta('pag_leyReunion')}</span>
              <span><i className="ag-ley-punto" style={{ background: COLORES_TIPO.evento }} /> {ta('pag_leyEvento')}</span>
              <span><CheckSquare size={12} style={{ color: COLORES_TIPO.tarea }} aria-hidden="true" /> {ta('pag_leyTarea')}</span>
              {!ocultarBloquesProyecto && <span><i className="ag-ley-barra" /> {ta('pag_leyProyecto')}</span>}
            </>
          )}
          <span><i className="ag-ley-caja" data-tipo="empresa" /> {ta('pag_leyEmpresa')}</span>
          <span><i className="ag-ley-caja" data-tipo="personal" /> {ta('pag_leyPersonal')}</span>
          <span><i className="ag-ley-caja" data-tipo="nolaboral" /> {ta('pag_leyNoLaboral')}</span>
          {(vistaEfectiva === 'SEMANA' || vistaEfectiva === 'DIA') && <span><i className="ag-ley-caja" data-tipo="comida" /> {ta('pag_leyComida')}</span>}
        </footer>
      </section>

      {modalEventoVisible && (
        <ModalEvento
          key={eventoParaEditar?.id || 'nuevo'}
          evento={eventoParaEditar}
          prefill={modalOpen ? prefillData : null}
          onClose={cerrarModalEvento}
          onSave={() => {
            cerrarModalEvento();
            recargarDatos();
          }}
          onDelete={handleEliminar}
        />
      )}

      {ajustesTab && (
        <ModalConfiguracionAgenda
          tabInicial={ajustesTab}
          onClose={() => setAjustesTab(null)}
          showToast={showToast}
          configInicial={configLaboral}
          googleCalendar={googleCalendar}
          googleLoading={googleLoading}
          onConnectGoogle={handleConnectGoogle}
          onDisconnectGoogle={handleDisconnectGoogle}
          googleActivo={googleActivo}
          onConfigGuardada={(config) => setConfigLaboral(normalizarConfigLaboral(config))}
          onDiasEspecialesCambiados={recargarDatos}
        />
      )}

      {moverPersonalizado && (
        <ModalMoverDias
          etiqueta={moverPersonalizado.bloque ? t('agendaTasks').toLowerCase() : etiquetaTipoVista(t, getTipoAgenda(moverPersonalizado.item)).toLowerCase()}
          ocupado={moviendo}
          onConfirm={(dias) => { void confirmarMoverPersonalizado(dias); }}
          onClose={() => setMoverPersonalizado(null)}
        />
      )}

      {confirmacion && (
        <ModalConfirmacion
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          confirmarLabel={confirmacion.confirmarLabel}
          danger={confirmacion.danger}
          onConfirm={() => cerrarConfirmacion(true)}
          onClose={() => cerrarConfirmacion(false)}
        />
      )}
    </div>
  );
};

/** Esqueleto con la forma de la cabecera y la rejilla del mes. */
const AgendaSkeleton = () => (
  <div className="page-container ag-pagina animate-pulse" aria-hidden="true">
    <div className="ag-cabecera">
      <div className="ag-cab-titulo">
        <div style={{ width: '9rem', height: '0.7rem', borderRadius: 4, background: 'var(--color-surface-3)' }} />
        <div style={{ width: '14rem', maxWidth: '100%', height: '1.6rem', borderRadius: 6, background: 'var(--color-border)', marginTop: '0.5rem' }} />
      </div>
      <div className="ag-cab-barra">
        <div style={{ width: '22rem', maxWidth: '100%', height: '2.25rem', borderRadius: 8, background: 'var(--color-surface-3)' }} />
      </div>
    </div>
    <div style={{ width: '28rem', maxWidth: '100%', height: '1.9rem', borderRadius: 999, background: 'var(--color-surface-3)', marginBottom: '0.85rem' }} />
    <div className="dash-panel" style={{ height: '34rem' }} />
  </div>
);

export default AgendaPage;
