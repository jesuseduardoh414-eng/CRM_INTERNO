// Página de detalle de un Proyecto
// Cabecera, avance y cifras de tareas en texto plano, y las tareas en
// Lista | Kanban | Gantt, o el historial de actividad del proyecto.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { proyectosService, tareasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoPermisos } from '../hooks/useTextoPermisos';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import Modal from '../components/Modal';
import Tooltip from '../components/Tooltip';
import ActionMenu from '../components/ActionMenu';
import UserAvatar from '../components/UserAvatar';
import SelectorMultiple from '../components/SelectorMultiple';
import SelectorSimple from '../components/SelectorSimple';
import SelectorRangoFechas from '../components/SelectorRangoFechas';
import FiltrosTareas from '../components/FiltrosTareas';
import KanbanView from '../components/KanbanView';
import GanttView  from '../components/GanttView';
import ProjectActivityLog from '../components/ProjectActivityLog';
import PanelClienteProyecto from '../components/portal/PanelClienteProyecto';
import { useTextoPortal } from '../hooks/useTextoPortal';
import { PageSkeleton } from '../components/Skeleton';
import ModalImportar from '../components/ModalImportar';
import TaskAttachments from '../components/TaskAttachments';
import TaskComments from '../components/TaskComments';
import { useConfirmacion } from '../components/ConfirmDialog';
import { sortTareas, sortTareasLista } from '../utils/sorters';
import { getEstadoProyecto, estaListoParaRevision } from '../utils/estadosProyecto';
import { areasDeTexto } from '../utils/areas';
import {
  ESTADOS_TAREA,
  PRIORIDADES_TAREA,
  getEstadoTarea,
  getPrioridadTarea,
  siguienteEstadoTarea,
  asignadosDeTarea,
  puedeGestionarTarea,
} from '../utils/estadosTarea';
import { claveDiaLocal, claveDesdeISO, estaPorVencer } from '../utils/fechasLocales';
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  Save,
  FileJson,
  FileSpreadsheet,
  List,
  LayoutGrid,
  CalendarRange,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Search,
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CheckSquare,
  CircleDashed,
  Eye,
  History,
  MessagesSquare,
  ListChecks,
  PlayCircle,
  X
} from 'lucide-react';

// ── Configuraciones ─────────────────────────────────────────────────────────
// Estados y prioridades salen del catalogo compartido (utils/estadosTarea):
// antes cada vista tenia su propia tabla con nombres y colores distintos.

// 10 por pagina, lo mismo que mostraba el antiguo "Ver mas tareas" por tanda.
const TAREAS_POR_PAGINA = 10;

// Icono de cada estado, el mismo del panel de inicio (ActividadEquipo)
const ICONOS_ESTADO = {
  PENDIENTE: CircleDashed,
  EN_PROGRESO: PlayCircle,
  HECHO: CheckCircle2,
};

const getLocale = () => document.documentElement.lang === 'en' ? 'en-US' : 'es-MX';
const formatFecha = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(getLocale(), { day: '2-digit', month: 'short' });
};
const formatFechaLarga = (iso) => (
  iso ? new Date(iso).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : null
);

const getDateAtNoon = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(12, 0, 0, 0);
  return date;
};

const inicioDiaLocal = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const esFechaVencida = (value) => (
  Boolean(value) && inicioDiaLocal(value) < inicioDiaLocal(new Date())
);

const getHoyMediodiaIso = () => {
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  return hoy.toISOString();
};

const getVenceEnOptimista = (tarea, nuevoEstado) => {
  if (!tarea?.venceEn) return tarea?.venceEn;
  if (nuevoEstado === 'HECHO') return getHoyMediodiaIso();
  return esFechaVencida(tarea.venceEn)
    ? getHoyMediodiaIso()
    : tarea.venceEn;
};

const tareaCoincideConRango = (tarea, rango) => {
  if (!rango?.from && !rango?.to) return true;

  const fechaInicio = getDateAtNoon(tarea.fechaInicio);
  const fechaFin = getDateAtNoon(tarea.venceEn || tarea.fechaInicio);

  if (!fechaInicio && !fechaFin) return false;

  const inicio = fechaInicio || fechaFin;
  const fin = fechaFin || fechaInicio;
  const from = getDateAtNoon(rango.from);
  const to = getDateAtNoon(rango.to || rango.from);

  if (from && fin < from) return false;
  if (to && inicio > to) return false;

  return true;
};

const getTaskAssignees = asignadosDeTarea;

const isTaskAssignedToUser = (tarea, usuarioId) => (
  getTaskAssignees(tarea).some((asignado) => asignado.id === usuarioId)
);

const getTaskAssigneeNames = (tarea, fallback) => {
  const nombres = getTaskAssignees(tarea).map((asignado) => asignado.nombre).filter(Boolean);
  return nombres.length > 0 ? nombres.join(', ') : fallback;
};

/** Vencida y "por vencer" con la misma regla en la lista, las cifras y el filtro. */
const tareaVencida = (tarea) => tarea.estado !== 'HECHO' && esFechaVencida(tarea.venceEn);
const tareaPorVencer = (tarea, dias) => (
  tarea.estado !== 'HECHO' && !esFechaVencida(tarea.venceEn) && estaPorVencer(tarea.venceEn, dias)
);

// Cifras de la franja de arriba. Cada una filtra la lista al pulsarla.
const CIFRAS_TAREAS = [
  { clave: 'PENDIENTE', textoKey: 'det_porHacer', icono: CircleDashed, color: 'var(--color-text-muted)' },
  { clave: 'EN_PROGRESO', textoKey: 'det_enProgreso', icono: PlayCircle, color: 'var(--color-accent-blue)' },
  { clave: 'HECHO', textoKey: 'det_hechas', icono: CheckCircle2, color: 'var(--color-success)' },
  { clave: 'VENCIDAS', textoKey: 'det_vencidas', icono: AlertTriangle, color: 'var(--color-error)' },
  { clave: 'POR_VENCER', textoKey: 'det_porVencer', icono: CalendarClock, color: 'var(--color-warning)' },
];

const tareaCoincideConCifra = (tarea, cifra, dias) => {
  if (!cifra) return true;
  if (cifra === 'VENCIDAS') return tareaVencida(tarea);
  if (cifra === 'POR_VENCER') return tareaPorVencer(tarea, dias);
  return tarea.estado === cifra;
};

/**
 * Etiqueta de campo de formulario. Marca los opcionales, para no tener que
 * adivinar cuales hacen falta de verdad para guardar; los obligatorios llevan
 * un asterisco en rojo.
 */
const EtiquetaCampo = ({ texto, opcional = false, obligatorio = false, htmlFor }) => {
  const { t } = usePreferences();
  return (
    <label htmlFor={htmlFor} className="form-label flex items-baseline gap-1">
      {texto}
      {obligatorio && <span className="text-[var(--color-error)]" aria-hidden="true">*</span>}
      {opcional && (
        <span className="text-[12px] font-normal text-[var(--color-text-muted)]">
          · {t('fieldOptional')}
        </span>
      )}
    </label>
  );
};

/** Hasta tres caras de los responsables y un "+n" con el resto. */
const AvataresResponsables = ({ asignados, vacio }) => {
  if (!asignados.length) {
    return <span className="text-[12px] text-[var(--color-text-muted)]">{vacio}</span>;
  }
  const visibles = asignados.slice(0, 3);
  const resto = asignados.length - visibles.length;
  return (
    <span className="det-avatares" title={asignados.map((a) => a.nombre).filter(Boolean).join(', ')}>
      {visibles.map((asignado) => (
        <UserAvatar
          key={asignado.id}
          usuario={asignado}
          size={24}
          radius={999}
          fontSize="0.6rem"
          color="var(--color-text-dim)"
          background="var(--color-surface-3)"
          borderColor="var(--color-surface)"
        />
      ))}
      {resto > 0 && <span className="det-avatar-mas">+{resto}</span>}
    </span>
  );
};

// ── Fila de tarea (vista de lista) ───────────────────────────────────────────
// Antes cada tarea era una tarjeta grande con sombra; ahora es una fila de la
// tabla, con el icono de estado como boton para avanzar.
const TareaFila = ({
  tarea,
  usuarioActual,
  onClick,
  onEliminar,
  onCambiarEstado,
  // Si el backend va a rechazar la accion (no eres admin del proyecto, ni
  // creador, ni responsable), no se ofrece.
  gestionable = true,
  // Borrar pide ademas el permiso "borrar tareas" de la instalacion.
  borrable = gestionable,
  seleccionable = false,
  seleccionada = false,
  onAlternarSeleccion,
}) => {
  const { t } = usePreferences();
  const tp = useTextoPermisos();
  const tx = useTextoProyectos();
  const { reglasTareas } = useConfiguracion();
  const prio = getPrioridadTarea(tarea.prioridad);
  const estado = getEstadoTarea(tarea.estado);
  const IconoEstado = ICONOS_ESTADO[estado.value] || CircleDashed;
  const sigEstado = siguienteEstadoTarea(tarea.estado);
  const hecha = tarea.estado === 'HECHO';
  const vencido = tareaVencida(tarea);
  // Aviso suave antes de vencer; los dias los fija la configuracion (0 = apagado).
  const porVencer = tareaPorVencer(tarea, reglasTareas.diasPorVencer);
  const acciones = [
    gestionable && {
      label: hecha ? t('taskReopen') : t('taskAdvanceStatus'),
      icon: hecha ? <RotateCcw size={15} /> : <ArrowRight size={15} />,
      onSelect: () => onCambiarEstado(tarea.id, sigEstado),
    },
    gestionable && borrable && { separator: true },
    borrable && { label: t('delete'), icon: <Trash2 size={15} />, onSelect: () => onEliminar(tarea), danger: true },
  ].filter(Boolean);
  const asignados = getTaskAssignees(tarea);
  const creadorEsUsuarioActual = tarea.creador?.id === usuarioActual?.id
    || (!tarea.creador?.id && (asignados.length === 0 || isTaskAssignedToUser(tarea, usuarioActual?.id)));
  // Si la tarea la creaste tu, no se dice nada: ya lo sabes. Solo interesa
  // saber quien la asigno cuando fue otra persona.
  const asignadorLabel = creadorEsUsuarioActual
    ? null
    : `${t('taskAssignedBy')} ${tarea.creador?.nombre || t('taskCreatedBySystem')}`;
  const detalle = [tarea.descripcion, asignadorLabel].filter(Boolean).join(' · ');
  const tonoFecha = vencido ? 'vencida' : porVencer ? 'por-vencer' : hecha ? 'hecha' : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => (seleccionable ? onAlternarSeleccion?.(tarea.id) : onClick(tarea))}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (seleccionable) onAlternarSeleccion?.(tarea.id);
        else onClick(tarea);
      }}
      className="det-fila"
      data-seleccionada={seleccionada || undefined}
    >
      {/* En modo seleccion la casilla sustituye al icono de estado: manda el
          estar marcada o no, y dos indicadores juntos se estorban. */}
      {seleccionable ? (
        <span className="det-fila-estado">
          <input
            type="checkbox"
            checked={seleccionada}
            onChange={() => onAlternarSeleccion?.(tarea.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={tarea.titulo}
            className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
          />
        </span>
      ) : gestionable ? (
        <Tooltip label={hecha ? t('taskReopen') : t('taskAdvanceStatus')}>
          <button
            type="button"
            className="det-fila-estado det-estado-boton"
            onClick={(e) => { e.stopPropagation(); onCambiarEstado(tarea.id, sigEstado); }}
            style={{ color: estado.color }}
          >
            <IconoEstado size={17} />
          </button>
        </Tooltip>
      ) : (
        <span className="det-fila-estado" style={{ color: estado.color }} title={t(estado.labelKey)}>
          <IconoEstado size={17} aria-hidden="true" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] font-medium leading-snug ${hecha ? 'det-hecha' : 'text-[var(--color-text)]'}`}>
          {tarea.numeroActividad ? <span className="mr-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">#{tarea.numeroActividad}</span> : null}
          {tarea.titulo}
        </span>
        {detalle && (
          <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{detalle}</span>
        )}
      </span>

      <span className="det-fila-prioridad">
        <span className="det-chip" style={{ background: prio.bg, color: prio.fg }}>{t(prio.labelKey)}</span>
      </span>

      <span className="det-fila-responsables">
        <AvataresResponsables asignados={asignados} vacio={tx('det_sinAsignar')} />
        <span className="sr-only">{getTaskAssigneeNames(tarea, t('taskUnassigned'))}</span>
      </span>

      <span className="det-fila-fecha">
        {tarea.venceEn ? (
          <span className="det-vence" data-tono={tonoFecha} title={porVencer ? tp('tareaPorVencer') : vencido ? t('taskOverdue') : undefined}>
            {vencido ? <AlertTriangle size={11} /> : <CalendarClock size={11} />}
            {formatFecha(tarea.venceEn)}
            {porVencer && <span className="det-vence-aviso">{tp('tareaPorVencer')}</span>}
          </span>
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">{tx('det_sinFecha')}</span>
        )}
      </span>

      {/* En modo seleccion se esconde: la accion la manda la barra de arriba,
          y dejar aqui un "Eliminar" que borra solo esta despista. */}
      <span className="det-fila-menu">
        {!seleccionable && (
          <ActionMenu
            size={15}
            items={acciones.length ? acciones : [
              { label: t('viewDetail'), icon: <Eye size={15} />, onSelect: () => onClick(tarea) },
            ]}
          />
        )}
      </span>
    </div>
  );
};

// ── Cambio de vista (segmento, como en el inicio) ───────────────────────────
const ToggleVista = ({ vista, onChange, t, etiqueta }) => (
  <div role="tablist" aria-label={etiqueta} className="dash-segmento det-segmento">
    {[
      { k: 'lista',  l: t('projectList'), i: List },
      { k: 'kanban', l: t('projectKanban'), i: LayoutGrid },
      { k: 'gantt',  l: t('projectGantt'), i: CalendarRange }
    ].map(v => (
      <button
        key={v.k}
        type="button"
        role="tab"
        aria-selected={vista === v.k}
        // En el movil solo se ve el icono: el nombre va en la etiqueta
        aria-label={v.l}
        onClick={() => onChange(v.k)}
      >
        <v.i size={14} /> <span className="hidden sm:inline">{v.l}</span>
      </button>
    ))}
  </div>
);

// ── Main Page Component ─────────────────────────────────────────────────────
const ProyectoDetallePage = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tx = useTextoProyectos();
  const { showToast } = useToast();
  const { confirmar, dialogo: dialogoConfirmacion } = useConfirmacion();
  // Modulos y permisos de la instalacion: lo que el backend rechazaria
  // (403/404) no se ofrece.
  const { moduloActivo, puede, reglasTareas, colorArea, nombreArea } = useConfiguracion();
  const puedeCrearTareas = puede(usuario, 'crearTareas');
  const puedeEditarTareas = puede(usuario, 'editarTareas');
  const puedeBorrarTareas = puede(usuario, 'borrarTareas');
  const adjuntosActivos = moduloActivo('adjuntos');
  const portalActivo = moduloActivo('clientes') && moduloActivo('portalClientes');
  const puedeSubirAdjuntos = adjuntosActivos && puede(usuario, 'subirAdjuntos');
  const diasPorVencer = reglasTareas.diasPorVencer;

  const [proyecto, setProyecto] = useState(null);
  const [tareas, setTareas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  // Id del proyecto cuyos datos estan en pantalla. "Cargando" se deriva de
  // compararlo con el de la url, en vez de un setState sincrono en el efecto.
  const [cargadoId, setCargadoId] = useState(null);
  const cargando = cargadoId !== id;
  const [modal, setModal] = useState(false);
  const [modalImportar, setModalImportar] = useState(false);
  const [modalExportar, setModalExportar] = useState(false);
  const [modalPlantilla, setModalPlantilla] = useState(false);
  const [tareaEditando, setTareaEditando] = useState(null);
  // "tareas" (lista / kanban / gantt), "actividad" (historial del proyecto) o
  // "cliente" (conversación del portal de clientes). ?vista=cliente abre esa.
  const vistaUrl = searchParams.get('vista');
  const [seccion, setSeccion] = useState(vistaUrl === 'cliente' ? 'cliente' : 'tareas');
  // Al llegar desde un aviso estando ya en el proyecto, cambia la pestaña sin
  // un efecto (comparando con la URL del render anterior).
  const [vistaUrlAnterior, setVistaUrlAnterior] = useState(vistaUrl);
  if (vistaUrl !== vistaUrlAnterior) {
    setVistaUrlAnterior(vistaUrl);
    if (vistaUrl === 'cliente') setSeccion('cliente');
  }
  const tpo = useTextoPortal();
  const [vista, setVista] = useState('lista');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  // Renombrado desde setPaginaLista en el render para dejar claro que la pagina
  // es solo de la vista de lista; el Kanban y el gantt tienen la suya.

  const [filtroPrioridad, setFiltroPrioridad] = useState('todas');
  const [filtroResponsable, setFiltroResponsable] = useState('todos');
  const [filtroFecha, setFiltroFecha] = useState({ from: null, to: null });
  // Filtro rapido desde las cifras de arriba (por hacer, vencidas...). null = todas.
  const [filtroCifra, setFiltroCifra] = useState(null);

  // Borrado en bloque. El modo se activa a mano para que el uso normal —abrir
  // una tarea al pulsarla— no cambie sin querer.
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionadas, setSeleccionadas] = useState(() => new Set());
  // Lo que el Kanban esta mostrando de verdad (tiene su propio filtro de dia).
  // "Seleccionar todas" usa esta lista en esa vista, no la general.
  const [tareasVisiblesKanban, setTareasVisiblesKanban] = useState(null);

  // Al cambiar rapido de proyecto, la respuesta del anterior podia llegar
  // despues y pisar la del actual. La bandera `vigente` se apaga al limpiar el
  // efecto, asi que lo que llegue tarde se descarta.
  useEffect(() => {
    let vigente = true;
    const cargar = async () => {
      try {
        const respuesta = await tareasService.listar(id);
        if (!vigente) return;
        setProyecto(respuesta.proyecto);
        setTareas(sortTareas(respuesta.tareas));
        setUsuarios(respuesta.proyecto?.miembros || []);
      } catch (err) {
        if (!vigente) return;
        // Si el proyecto nuevo falla (403/404), no dejar en pantalla el anterior
        // bajo la URL equivocada.
        setProyecto(null);
        setTareas([]);
        setUsuarios([]);
        showToast(err.message, 'error');
      } finally {
        if (vigente) setCargadoId(id);
      }
    };
    cargar();
    return () => { vigente = false; };
  }, [id, showToast]);

  // ?tarea=ID (desde una notificacion) abre esa tarea. Se compara con el ultimo
  // id atendido en el propio render en vez de usar un efecto: asi no hay un
  // segundo render en cascada y la misma tarea se puede volver a abrir si la
  // url vuelve a traerla.
  const tareaIdParam = searchParams.get('tarea');
  const [tareaParamAtendida, setTareaParamAtendida] = useState(null);
  if (!tareaIdParam && tareaParamAtendida !== null) {
    setTareaParamAtendida(null);
  } else if (tareaIdParam && tareaIdParam !== tareaParamAtendida && tareas.length) {
    const tareaObjetivo = tareas.find((item) => String(item.id) === tareaIdParam);
    if (tareaObjetivo) {
      setTareaParamAtendida(tareaIdParam);
      setTareaEditando(tareaObjetivo);
      setModal(true);
    }
  }

  const cerrarModalTarea = useCallback(() => {
    setModal(false);
    setTareaEditando(null);

    if (searchParams.get('tarea')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('tarea');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const stats = useMemo(() => {
    const hechas = tareas.filter(t => t.estado === 'HECHO').length;
    const prog = tareas.filter(t => t.estado === 'EN_PROGRESO').length;
    const pendientes = tareas.filter(t => t.estado === 'PENDIENTE').length;
    const vencidas = tareas.filter(tareaVencida).length;
    const porVencer = tareas.filter((t) => tareaPorVencer(t, diasPorVencer)).length;
    const total = tareas.length;
    const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;

    const tareasMiembro = tareas.filter((t) => isTaskAssignedToUser(t, usuario?.id));
    const hechasMiembro = tareasMiembro.filter(t => t.estado === 'HECHO').length;
    const pctMiembro = tareasMiembro.length > 0 ? Math.round((hechasMiembro / tareasMiembro.length) * 100) : 0;

    return {
      total,
      hechas,
      progreso: prog,
      pendientes,
      vencidas,
      porVencer,
      pct,
      totalMiembro: tareasMiembro.length,
      hechasMiembro,
      pctMiembro,
    };
  }, [tareas, usuario?.id, diasPorVencer]);

  const progresoGeneral = stats.pct;
  const estadoProyecto = getEstadoProyecto(proyecto?.estado);
  // El progreso se calcula aqui, asi que se arma el objeto que espera el helper
  const listoParaRevision = usuario?.rol === 'ADMIN' && estaListoParaRevision({
    estado: proyecto?.estado,
    progresoGeneral: stats.pct,
    _count: { tareas: stats.total },
  });
  const progresoMiembro = stats.pctMiembro;
  const totalGeneral = stats.total;
  const totalMiembro = stats.totalMiembro;

  // "Mi progreso" depende del rol:
  //  - Admin: solo si tiene tareas suyas aqui. Entra a supervisar proyectos que
  //    no trabaja, y ahi un 0% no significa nada.
  //  - Miembro: siempre, porque solo ve proyectos en los que participa y el 0%
  //    si le dice algo ("estoy dentro y no he tomado nada").
  const mostrarMiProgreso = usuario?.rol === 'ADMIN'
    ? totalMiembro > 0
    : Boolean(usuario?.id);

  const valorCifra = {
    PENDIENTE: stats.pendientes,
    EN_PROGRESO: stats.progreso,
    HECHO: stats.hechas,
    VENCIDAS: stats.vencidas,
    POR_VENCER: stats.porVencer,
  };
  const cifraActiva = CIFRAS_TAREAS.find((c) => c.clave === filtroCifra) || null;

  const tareasFiltradas = useMemo(() => {
    if (!busqueda) return tareas;
    const b = busqueda.toLowerCase();
    return tareas.filter(t =>
      t.titulo?.toLowerCase().includes(b) ||
      t.descripcion?.toLowerCase().includes(b)
    );
  }, [tareas, busqueda]);

  const responsablesFiltro = useMemo(() => {
    const mapa = new Map();
    tareas.forEach((tarea) => {
      getTaskAssignees(tarea).forEach((asignado) => {
        mapa.set(String(asignado.id), asignado);
      });
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [tareas]);

  const tareasFiltradasAvanzadas = useMemo(() => (
    tareasFiltradas.filter((tarea) => {
      if (filtroPrioridad !== 'todas' && tarea.prioridad !== filtroPrioridad) return false;

      if (filtroResponsable !== 'todos') {
        if (filtroResponsable === 'sin_asignar') {
          if (getTaskAssignees(tarea).length > 0) return false;
        } else if (!getTaskAssignees(tarea).some((asignado) => String(asignado.id) === filtroResponsable)) {
          return false;
        }
      }

      if (!tareaCoincideConRango(tarea, filtroFecha)) return false;

      if (!tareaCoincideConCifra(tarea, filtroCifra, diasPorVencer)) return false;

      return true;
    })
  ), [filtroFecha, filtroPrioridad, filtroResponsable, filtroCifra, diasPorVencer, tareasFiltradas]);

  const tareasListaFiltradas = useMemo(() => sortTareasLista(tareasFiltradasAvanzadas), [tareasFiltradasAvanzadas]);

  // Se recorta en vez de reiniciar con un efecto: al filtrar, el total baja y
  // esto deja la pagina en rango por si solo, sin renders extra.
  const totalPaginasLista = Math.max(1, Math.ceil(tareasListaFiltradas.length / TAREAS_POR_PAGINA));
  const paginaLista = Math.min(pagina, totalPaginasLista);
  const tareasDeLaPagina = tareasListaFiltradas.slice(
    (paginaLista - 1) * TAREAS_POR_PAGINA,
    paginaLista * TAREAS_POR_PAGINA,
  );

  // Replica de la regla del backend: admin del proyecto, creador o responsable,
  // y ademas el permiso de editar (o borrar) tareas de la configuracion.
  const puedeGestionar = useCallback(
    (tarea) => puedeEditarTareas && puedeGestionarTarea(tarea, usuario, proyecto),
    [usuario, proyecto, puedeEditarTareas],
  );
  const puedeBorrar = useCallback(
    (tarea) => puedeBorrarTareas && puedeGestionarTarea(tarea, usuario, proyecto),
    [usuario, proyecto, puedeBorrarTareas],
  );

  // Guardar como plantilla: admin, o miembro con permiso que crea o participa
  // en el proyecto (misma regla que el backend).
  const esParteDelProyecto = Boolean(usuario?.id) && (
    (proyecto?.creadorId ?? proyecto?.creador?.id) === usuario.id
    || (proyecto?.miembros || []).some((m) => m.id === usuario.id)
  );
  const puedeGuardarPlantilla = moduloActivo('plantillas') && (
    usuario?.rol === 'ADMIN' || (puede(usuario, 'guardarPlantillas') && esParteDelProyecto)
  );
  const puedeImportar = moduloActivo('importar') && puedeCrearTareas;
  const mostrarDocsProyecto = vista === 'lista' && adjuntosActivos;

  /** Pide confirmacion y borra. Devuelve true solo si se borro de verdad. */
  const handleEliminar = async (tarea) => {
    const ok = await confirmar({
      titulo: t('taskDeleteConfirm', { name: tarea.titulo }),
      descripcion: tarea.titulo,
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return false;
    try {
      await tareasService.eliminar(tarea.id);
      setTareas(prev => prev.filter(x => x.id !== tarea.id));
      showToast(t('taskDeleted'));
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    }
  };

  // ── Seleccion multiple ────────────────────────────────────────────────────
  // "Todas" abarca lo filtrado y no solo la pagina a la vista: si acabas de
  // filtrar para limpiar un grupo, esperas que entre todo el grupo. En el
  // Kanban manda lo que el tablero muestra (tiene su propio filtro de dia):
  // antes se seleccionaban tambien las tareas que el filtro escondia y se
  // borraban sin verlas.
  const seleccionActiva = modoSeleccion && vista !== 'gantt';
  const tareasSeleccionables = vista === 'kanban' && tareasVisiblesKanban
    ? tareasVisiblesKanban
    : tareasFiltradasAvanzadas;

  const salirDeSeleccion = useCallback(() => {
    setModoSeleccion(false);
    setSeleccionadas(new Set());
  }, []);

  // Al pasar al gantt se descarta la seleccion: ahi las tareas no muestran
  // casilla, y al volver quedarian marcadas tareas que no se vieron elegir y
  // que el borrado en lote podria eliminar sin darse cuenta.
  const cambiarVista = useCallback((nuevaVista) => {
    if (nuevaVista === 'gantt') salirDeSeleccion();
    setVista(nuevaVista);
  }, [salirDeSeleccion]);

  const alternarSeleccion = useCallback((tareaId) => {
    setSeleccionadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(tareaId)) siguiente.delete(tareaId);
      else siguiente.add(tareaId);
      return siguiente;
    });
  }, []);

  // Solo cuentan las marcadas que siguen a la vista. Si despues de marcar se
  // busca o se filtra, las que quedan escondidas no se borran: antes el contador
  // las seguia sumando y "Eliminar" se las llevaba sin verlas.
  const idsSeleccionables = useMemo(
    () => new Set(tareasSeleccionables.map((tarea) => tarea.id)),
    [tareasSeleccionables],
  );
  const seleccionVisible = useMemo(
    () => [...seleccionadas].filter((tareaId) => idsSeleccionables.has(tareaId)),
    [seleccionadas, idsSeleccionables],
  );

  const handleEliminarSeleccionadas = async () => {
    const ids = seleccionVisible;
    if (!ids.length) return;
    const ok = await confirmar({
      titulo: t('taskDeleteManyConfirm', { count: ids.length }),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;

    try {
      const respuesta = await tareasService.eliminarVarias(ids);
      // Se quitan solo las que el servidor confirma: si alguna se omitio por
      // permisos, tiene que seguir en pantalla.
      const borradas = new Set(respuesta.ids || ids);
      setTareas((prev) => prev.filter((x) => !borradas.has(x.id)));
      salirDeSeleccion();
      showToast(respuesta.omitidas
        ? t('taskDeletedManyPartial', { count: respuesta.eliminadas, omitidas: respuesta.omitidas })
        : t('taskDeletedMany', { count: respuesta.eliminadas }));
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCambiarEstado = async (id, est) => {
    const tareaAnterior = tareas.find(x => x.id === id);
    if (!tareaAnterior || tareaAnterior.estado === est) return;

    const completadoEnOptimista = est === 'HECHO'
      ? new Date().toISOString()
      : null;

    const tareaOptimista = {
      ...tareaAnterior,
      estado: est,
      completadoEn: completadoEnOptimista,
      venceEn: getVenceEnOptimista(tareaAnterior, est),
    };

    setTareas(prev => sortTareas(prev.map(x => x.id === id ? tareaOptimista : x)));

    if (tareaEditando?.id === id) {
      setTareaEditando(prev => prev ? { ...prev, estado: est, completadoEn: completadoEnOptimista, venceEn: getVenceEnOptimista(prev, est) } : prev);
    }

    try {
      const { tarea } = await tareasService.actualizarEstado(id, est);
      const tareaConfirmada = {
        ...tareaAnterior,
        ...tarea,
        estado: est,
        completadoEn: est === 'HECHO'
          ? (tarea.completadoEn || completadoEnOptimista)
          : null,
        venceEn: getVenceEnOptimista(tarea, est),
      };

      setTareas(prev => sortTareas(prev.map(x => x.id === id ? tareaConfirmada : x)));
      if (tareaEditando?.id === id) {
        setTareaEditando(tareaConfirmada);
      }
    } catch (err) {
      setTareas(prev => sortTareas(prev.map(x => x.id === id ? tareaAnterior : x)));
      if (tareaEditando?.id === id) {
        setTareaEditando(tareaAnterior);
      }
      showToast(err.message, 'error');
    }
  };

  const handleGuardarTarea = useCallback(({ tarea, creada = false } = {}) => {
    if (!tarea) {
      cerrarModalTarea();
      return;
    }

    setTareas((prev) => {
      const existe = prev.some((item) => item.id === tarea.id);
      const siguientes = existe
        ? prev.map((item) => (item.id === tarea.id ? { ...item, ...tarea } : item))
        : [tarea, ...prev];

      return sortTareas(siguientes);
    });

    setTareaEditando((prev) => (prev?.id === tarea.id ? { ...prev, ...tarea } : prev));
    cerrarModalTarea();
    showToast(creada ? t('taskCreated') : t('taskUpdated'));
  }, [cerrarModalTarea, showToast, t]);

  const handleSincronizarTarea = useCallback((tareaId, cambios = {}) => {
    if (!tareaId || !cambios || Object.keys(cambios).length === 0) return;

    setTareas((prev) => sortTareas(
      prev.map((tarea) => (tarea.id === tareaId ? { ...tarea, ...cambios } : tarea))
    ));
    setTareaEditando((prev) => (prev?.id === tareaId ? { ...prev, ...cambios } : prev));
  }, []);

  const handleImportado = useCallback((resultado = {}) => {
    const tareasImportadas = Array.isArray(resultado.tareas) ? resultado.tareas : [];

    if (tareasImportadas.length > 0) {
      setTareas((prev) => {
        const existentes = new Set(prev.map((tarea) => tarea.id));
        const nuevas = tareasImportadas.filter((tarea) => !existentes.has(tarea.id));
        return sortTareas([...prev, ...nuevas]);
      });
    }

    // Si alguna fila no se pudo guardar, la ventana se queda abierta para que
    // se vea cuales y por que. Antes se cerraba en cuanto habia una creada y
    // ese aviso no llegaba a verse nunca.
    const conErrores = Array.isArray(resultado.errores) && resultado.errores.length > 0;
    if (!conErrores) setModalImportar(false);
    showToast(
      t('taskImportSuccess', { count: resultado.creadas || tareasImportadas.length || 0 }),
      conErrores ? 'info' : 'success',
    );
  }, [showToast, t]);

  // La descarga ya va con la cabecera Authorization (fetch + blob), asi que un
  // fallo del servidor llega aqui como error y no como una pagina en blanco.
  const handleExportar = async (tipo) => {
    try {
      setModalExportar(false);
      showToast(t('taskExportStarted', { type: tipo.toUpperCase() }), 'info');
      await tareasService.exportarProyecto(id, tipo);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleGuardarPlantilla = async ({ nombre, descripcion }) => {
    try {
      await proyectosService.guardarComoPlantilla(id, { nombre, descripcion });
      showToast(t('taskTemplateSaved'));
      setModalPlantilla(false);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Terminar / reactivar / archivar desde el detalle, igual que en la tarjeta
  const handleCambiarEstadoProyecto = async (nuevoEstado) => {
    const anterior = proyecto?.estado;
    setProyecto((prev) => (prev ? { ...prev, estado: nuevoEstado } : prev));
    try {
      const formData = new FormData();
      formData.append('estado', nuevoEstado);
      await proyectosService.editar(id, formData);
      showToast(t(getEstadoProyecto(nuevoEstado).labelKey));
    } catch (err) {
      setProyecto((prev) => (prev ? { ...prev, estado: anterior } : prev));
      showToast(err.message, 'error');
    }
  };

  if (cargando) return <PageSkeleton cards={4} />;

  // Si la carga fallo (403/404 o sin conexion) no hay proyecto: antes se
  // pintaba la cabecera vacia con "Nueva tarea" y el menu de acciones, que
  // fallaban todos al pulsarlos.
  if (!proyecto) {
    return (
      <div className="mx-auto max-w-7xl">
        <Link to="/proyectos" className="cli-volver">
          <ArrowLeft size={15} aria-hidden="true" /> {t('projects')}
        </Link>
        <div className="proy-vacio mt-4">
          <AlertTriangle size={26} className="text-[var(--color-text-muted)]" aria-hidden="true" />
          <p className="mt-2 text-[14px] font-medium text-[var(--color-text)]">{tx('det_noDisponible')}</p>
          <p className="mt-0.5 max-w-sm text-[13px] text-[var(--color-text-muted)]">{tx('det_noDisponibleSub')}</p>
        </div>
      </div>
    );
  }

  const esAdmin = usuario?.rol === 'ADMIN';
  const areasProyecto = areasDeTexto(proyecto?.area);
  // El cliente solo se enlaza con el directorio activo; la ficha es de admin.
  const clienteProyecto = moduloActivo('clientes') ? proyecto?.cliente : null;
  const fechaInicioProyecto = formatFechaLarga(proyecto?.fechaInicio);
  const fechaFinProyecto = formatFechaLarga(proyecto?.fechaFin);
  const abrirTarea = (x) => { setTareaEditando(x); setModal(true); };
  const desdeLista = (paginaLista - 1) * TAREAS_POR_PAGINA + 1;
  const hastaLista = Math.min(paginaLista * TAREAS_POR_PAGINA, tareasListaFiltradas.length);

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/proyectos" className="cli-volver">
        <ArrowLeft size={15} aria-hidden="true" /> {t('projects')}
      </Link>

      {/* Cabecera: nombre, estado y datos del proyecto en una linea; las
          acciones a la derecha. Antes el titulo media 48px. */}
      <header className="mb-6 mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-[var(--color-text)] [overflow-wrap:anywhere] md:text-[26px]">
            {proyecto?.nombre}
          </h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[var(--color-text-muted)]">
            <span className="det-estado" style={{ color: estadoProyecto.color, background: estadoProyecto.bg }}>
              <span className="det-estado-punto" style={{ background: estadoProyecto.dot || estadoProyecto.color }} aria-hidden="true" />
              {t(estadoProyecto.labelKey)}
            </span>
            {/* Mismo aviso que en la tarjeta: 100% de tareas pero sin visto bueno */}
            {listoParaRevision && (
              <span className="det-estado" style={{ color: 'var(--badge-warning-fg)', background: 'var(--badge-warning-bg)' }}>
                <BadgeCheck size={12} aria-hidden="true" /> {t('projectReadyForReview')}
              </span>
            )}
            {clienteProyecto && (
              esAdmin ? (
                <Link to={`/clientes/${clienteProyecto.id}`} className="det-meta det-meta-enlace" title={tx('det_cliente')}>
                  <Building2 size={13} aria-hidden="true" /> <span className="truncate">{clienteProyecto.nombre}</span>
                </Link>
              ) : (
                <span className="det-meta" title={tx('det_cliente')}>
                  <Building2 size={13} aria-hidden="true" /> <span className="truncate">{clienteProyecto.nombre}</span>
                </span>
              )
            )}
            {areasProyecto.map((a) => (
              <span key={a} className="det-meta">
                <span className="h-1.5 w-1.5 rounded-sm" style={{ background: colorArea(a) }} aria-hidden="true" />
                {nombreArea(a)}
              </span>
            ))}
            {fechaInicioProyecto && (
              <span className="det-meta tabular-nums">
                <CalendarDays size={13} aria-hidden="true" />
                {fechaInicioProyecto} – {fechaFinProyecto || tx('det_sinFechaFin')}
              </span>
            )}
          </div>

          {proyecto?.descripcion && (
            <p className="mt-2.5 max-w-3xl text-[14px] leading-relaxed text-[var(--color-text-dim)]">{proyecto.descripcion}</p>
          )}
        </div>

        {/* Importar y exportar viven en el menu: sacarlos como iconos sueltos
            dejaba tres botones seguidos y se veia recargado. Sus iconos son
            flechas que indican la direccion (entra / sale). */}
        <div className="flex w-full shrink-0 items-center justify-end gap-2 md:w-auto">
          {puedeCrearTareas && (
            <button
              type="button"
              onClick={() => { setTareaEditando(null); setModal(true); }}
              className="btn-primary h-10 flex-1 justify-center !py-0 text-[13.5px] md:h-9 md:flex-none"
            >
              <Plus size={16} /> {t('projectNewTask')}
            </button>
          )}

          <ActionMenu
            size={16}
            className="h-10 w-10 shrink-0 border border-[var(--color-border)] bg-[var(--color-surface)] md:h-9 md:w-9"
            items={[
              puedeImportar && { label: t('projectImport'), icon: <ArrowDownToLine size={15} />, onSelect: () => setModalImportar(true) },
              { label: t('projectExport'), icon: <ArrowUpFromLine size={15} />, onSelect: () => setModalExportar(true) },
              puedeGuardarPlantilla && { separator: true },
              puedeGuardarPlantilla && { label: t('projectSaveTemplate'), icon: <Save size={15} />, onSelect: () => setModalPlantilla(true) },
              esAdmin && { separator: true },
              esAdmin && estadoProyecto.value !== 'TERMINADO' && estadoProyecto.value !== 'ARCHIVADO' && {
                label: t('projectMarkFinished'),
                icon: <BadgeCheck size={15} />,
                onSelect: () => handleCambiarEstadoProyecto('TERMINADO'),
              },
              esAdmin && estadoProyecto.value !== 'ACTIVO' && {
                label: t('projectReactivate'),
                icon: <RotateCcw size={15} />,
                onSelect: () => handleCambiarEstadoProyecto('ACTIVO'),
              },
              esAdmin && (estadoProyecto.value === 'ARCHIVADO'
                ? { label: t('projectUnarchive'), icon: <ArchiveRestore size={15} />, onSelect: () => handleCambiarEstadoProyecto('ACTIVO') }
                : { label: t('projectArchive'), icon: <Archive size={15} />, onSelect: () => handleCambiarEstadoProyecto('ARCHIVADO') }),
            ]}
          />
        </div>
      </header>

      {/* Avance y cifras en texto plano, en una sola franja, como en el inicio.
          Cada cifra filtra las tareas al pulsarla.

          "Mi progreso" solo sale si de verdad tienes tareas aqui. A un admin que
          entra a supervisar le salia un 0% que no significaba nada. */}
      <dl className="det-cifras mb-6">
        <div className="det-cifra-avance">
          <dt>{tx('det_avance')}</dt>
          <dd>
            <strong>{progresoGeneral}%</strong>
            <span>{tx('det_avanceSub', { hechas: stats.hechas, total: totalGeneral })}</span>
          </dd>
          <span className="dash-barra det-barra" aria-hidden="true">
            <span style={{ width: `${progresoGeneral}%`, background: 'var(--color-primary)' }} />
          </span>
          {mostrarMiProgreso && (
            <span className="det-mi-avance">
              <span className="dash-barra" aria-hidden="true">
                <span style={{ width: `${progresoMiembro}%`, background: 'var(--color-success)' }} />
              </span>
              {tx('det_miAvance', { hechas: stats.hechasMiembro, total: totalMiembro, pct: progresoMiembro })}
            </span>
          )}
        </div>
        {CIFRAS_TAREAS.map((cifra) => {
          const valor = valorCifra[cifra.clave];
          const activa = filtroCifra === cifra.clave;
          const sub = cifra.clave === 'POR_VENCER'
            ? (diasPorVencer > 0 ? tx('det_porVencerSub', { n: diasPorVencer }) : tx('det_porVencerApagado'))
            : null;
          return (
            <div key={cifra.clave}>
              <button
                type="button"
                onClick={() => { setFiltroCifra(activa ? null : cifra.clave); setSeccion('tareas'); }}
                aria-pressed={activa}
                title={tx('det_filtrarCifra')}
                data-activo={activa || undefined}
              >
                <dt><cifra.icono size={14} style={{ color: cifra.color }} /> {tx(cifra.textoKey)}</dt>
                <dd>
                  <strong style={valor && (cifra.clave === 'VENCIDAS' || cifra.clave === 'POR_VENCER') ? { color: cifra.color } : undefined}>{valor}</strong>
                  {sub && <span>{sub}</span>}
                </dd>
              </button>
            </div>
          );
        })}
      </dl>

      {/* Tareas o historial de actividad del proyecto. El historial ya existia
          en el backend (GET /proyectos/:id/logs) pero no se mostraba. */}
      <div className="det-pestanas-fila">
        <div role="tablist" aria-label={tx('det_secciones')} className="dash-pestanas">
          <button type="button" role="tab" aria-selected={seccion === 'tareas'} onClick={() => setSeccion('tareas')}>
            <ListChecks size={15} /> {t('projectTasksTab')}
            <span className="det-pestana-conteo">{totalGeneral}</span>
          </button>
          <button type="button" role="tab" aria-selected={seccion === 'actividad'} onClick={() => setSeccion('actividad')}>
            <History size={15} /> {t('projectActivityTab')}
          </button>
          {portalActivo && (
            <button type="button" role="tab" aria-selected={seccion === 'cliente'} onClick={() => setSeccion('cliente')}>
              <MessagesSquare size={15} /> {tpo('ptlTabCliente')}
            </button>
          )}
        </div>
      </div>

      {seccion === 'actividad' && <ProjectActivityLog proyectoId={id} />}
      {seccion === 'cliente' && portalActivo && <PanelClienteProyecto proyectoId={id} />}

      {seccion === 'tareas' && (
      <>
      {/* Barra de herramientas: vista y busqueda a un lado; cuantas se ven,
          seleccionar y filtros al otro. Todo a 36px de alto. */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <ToggleVista vista={vista} onChange={cambiarVista} t={t} etiqueta={tx('det_vistas')} />

        <div className="relative min-w-[180px] flex-1 sm:max-w-[300px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            placeholder={t('projectTaskSearch')}
            aria-label={t('projectTaskSearch')}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="det-control w-full pl-9 pr-3"
          />
        </div>

        {cifraActiva && (
          <button type="button" className="det-filtro-chip" onClick={() => setFiltroCifra(null)} title={tx('det_quitarFiltro')}>
            {tx('det_filtroActivo', { nombre: tx(cifraActiva.textoKey).toLowerCase() })}
            <X size={13} aria-hidden="true" />
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-[var(--color-text-muted)] tabular-nums">
            {t('projectShowing')} {tareasFiltradasAvanzadas.length} {tareasFiltradasAvanzadas.length === 1 ? t('projectTaskSingular') : t('projectTaskPlural')}
          </span>

          {/* El gantt se queda fuera: ahi las tareas son barras de tiempo y
              marcarlas una a una no aporta nada. */}
          {vista !== 'gantt' && puedeBorrarTareas && (
            <button
              type="button"
              onClick={() => (modoSeleccion ? salirDeSeleccion() : setModoSeleccion(true))}
              aria-pressed={modoSeleccion}
              className="det-control det-boton"
            >
              <CheckSquare size={15} />
              {modoSeleccion ? t('cancel') : t('taskSelect')}
            </button>
          )}

          {/* Los tres filtros, antes en una franja fija, ahora tras este boton */}
          <FiltrosTareas
            fecha={filtroFecha}
            onFechaChange={(rango) => setFiltroFecha(rango || { from: null, to: null })}
            prioridad={filtroPrioridad}
            onPrioridadChange={setFiltroPrioridad}
            prioridades={PRIORIDADES_TAREA}
            responsable={filtroResponsable}
            onResponsableChange={setFiltroResponsable}
            responsables={responsablesFiltro}
          />
        </div>
      </div>

      {/* Barra de la seleccion. Va pegada arriba al desplazar para que el boton
          de eliminar siga a mano con una lista larga. */}
      {seleccionActiva && (
        <div className="det-seleccion">
          <span className="text-[13.5px] font-semibold text-[var(--color-text)] tabular-nums">
            {t('taskSelectedCount', { count: seleccionVisible.length })}
          </span>
          <span className="h-4 w-px bg-[var(--color-border)]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setSeleccionadas(new Set(tareasSeleccionables.map((tarea) => tarea.id)))}
            disabled={!tareasSeleccionables.length}
            className="det-texto-boton"
          >
            {t('taskSelectAll')}
          </button>
          <button
            type="button"
            onClick={() => setSeleccionadas(new Set())}
            disabled={!seleccionVisible.length}
            className="det-texto-boton"
          >
            {t('taskSelectNone')}
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleEliminarSeleccionadas}
              disabled={!seleccionVisible.length}
              className="det-boton-peligro"
            >
              <Trash2 size={14} />
              {t('delete')}
            </button>
            <Tooltip label={t('cancel')}>
              <button type="button" onClick={salirDeSeleccion} className="dash-icono" aria-label={t('cancel')}>
                <X size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Documentos del proyecto a la derecha, solo junto a la lista. El Kanban
          y el gantt necesitan todo el ancho: con la columna al lado, las tres
          columnas del tablero y las barras del gantt quedaban estrujadas. */}
      <div className={`grid gap-5 ${mostrarDocsProyecto ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
      <div className="min-w-0">
        {vista === 'lista' && (
          // Sin tope de alto ni scroll propio: con 10 tareas por pagina la
          // lista ya no crece sin fin, y dos desplazamientos anidados (el de
          // la lista y el de la pagina) se estorbaban entre si.
          <section className="det-panel">
            {tareasListaFiltradas.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
                  <Search size={18} />
                </span>
                <p className="text-[13.5px] text-[var(--color-text-muted)]">{t('projectNoTasksFound')}</p>
                {cifraActiva && (
                  <button type="button" className="cli-enlace" onClick={() => setFiltroCifra(null)}>{tx('det_quitarFiltro')}</button>
                )}
              </div>
            ) : (
              <>
                <div className="det-lista-cabecera" aria-hidden="true">
                  <span className="det-fila-estado" />
                  <span className="flex-1">{tx('det_colTarea')}</span>
                  <span className="det-fila-prioridad">{tx('det_colPrioridad')}</span>
                  <span className="det-fila-responsables">{tx('det_colResponsables')}</span>
                  <span className="det-fila-fecha">{tx('det_colVence')}</span>
                  <span className="det-fila-menu" />
                </div>
                <div>
                  {tareasDeLaPagina.map(tarea => (
                    <TareaFila
                      key={tarea.id}
                      tarea={tarea}
                      usuarioActual={usuario}
                      onClick={abrirTarea}
                      onEliminar={handleEliminar}
                      onCambiarEstado={handleCambiarEstado}
                      gestionable={puedeGestionar(tarea)}
                      borrable={puedeBorrar(tarea)}
                      seleccionable={seleccionActiva}
                      seleccionada={seleccionadas.has(tarea.id)}
                      onAlternarSeleccion={alternarSeleccion}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Paginacion en vez del antiguo "Ver mas tareas": con ese boton la
                lista solo crecia y no habia forma de volver atras ni de saber
                por donde ibas. */}
            {totalPaginasLista > 1 && (
              <div className="det-pie">
                <span className="tabular-nums">
                  {tx('det_rango', { desde: desdeLista, hasta: hastaLista, total: tareasListaFiltradas.length })}
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip label={t('previous')}>
                    <button
                      type="button"
                      onClick={() => setPagina((n) => Math.max(1, n - 1))}
                      disabled={paginaLista === 1}
                      className="dash-icono"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </Tooltip>
                  <span className="min-w-[48px] text-center text-[12.5px] font-medium tabular-nums text-[var(--color-text)]">
                    {paginaLista} / {totalPaginasLista}
                  </span>
                  <Tooltip label={t('next')}>
                    <button
                      type="button"
                      onClick={() => setPagina((n) => Math.min(totalPaginasLista, n + 1))}
                      disabled={paginaLista === totalPaginasLista}
                      className="dash-icono"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}
        {vista === 'kanban' && (
          <KanbanView
            tareas={tareasFiltradasAvanzadas}
            onClick={abrirTarea}
            onEliminar={handleEliminar}
            onCambiarEstado={handleCambiarEstado}
            onEditar={abrirTarea}
            puedeGestionar={puedeGestionar}
            puedeBorrar={puedeBorrar}
            onTareasVisiblesChange={setTareasVisiblesKanban}
            seleccionable={seleccionActiva}
            seleccionadas={seleccionadas}
            onAlternarSeleccion={alternarSeleccion}
          />
        )}
        {vista === 'gantt' && <GanttView proyecto={proyecto} tareas={tareasFiltradasAvanzadas} onSeleccionarTarea={abrirTarea} />}
      </div>

        {mostrarDocsProyecto && (
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <TaskAttachments
            compacto
            tareaId={proyecto?.id}
            type="proyectos"
            title={t('projectFieldDocuments')}
            ayuda={t('projectDocsHint')}
            uploadLabel={t('projectAddFiles')}
            showUploader={puedeSubirAdjuntos}
            compartirCliente={portalActivo && esAdmin && Boolean(clienteProyecto)}
          />
        </aside>
        )}
      </div>
      </>
      )}

      {/* Modales */}
      {modal && (
        <ModalTarea
          tarea={tareaEditando}
          proyectoId={id}
          usuarioActual={usuario}
          usuarios={usuarios}
          gestionable={!tareaEditando || puedeGestionar(tareaEditando)}
          borrable={Boolean(tareaEditando) && puedeBorrar(tareaEditando)}
          adjuntosActivos={adjuntosActivos}
          puedeSubirAdjuntos={puedeSubirAdjuntos}
          comentariosActivos={moduloActivo('comentarios')}
          onClose={cerrarModalTarea}
          onGuardar={handleGuardarTarea}
          onTareaMutada={handleSincronizarTarea}
          onEliminar={handleEliminar}
        />
      )}
      {dialogoConfirmacion}
      {modalImportar && puedeImportar && (
        <ModalImportar
          proyectoId={id}
          usuarios={usuarios}
          usuarioActual={usuario}
          onClose={() => setModalImportar(false)}
          onImportado={handleImportado}
        />
      )}
      {modalExportar && (
        <ModalExportarProyecto
          proyecto={proyecto}
          onClose={() => setModalExportar(false)}
          onExportar={handleExportar}
        />
      )}
      {modalPlantilla && puedeGuardarPlantilla && (
        <ModalGuardarPlantilla
          proyecto={proyecto}
          onClose={() => setModalPlantilla(false)}
          onGuardar={handleGuardarPlantilla}
        />
      )}
    </div>
  );
};

// ── Modal de Tarea ───────────────────────────────────────────────────────────
const ModalTarea = ({
  tarea, proyectoId, usuarioActual, usuarios, gestionable = true, borrable = gestionable,
  adjuntosActivos = true, puedeSubirAdjuntos = true, comentariosActivos = true,
  onClose, onGuardar, onTareaMutada, onEliminar,
}) => {
  const { t } = usePreferences();
  const tp = useTextoPermisos();
  const tx = useTextoProyectos();
  const { showToast } = useToast();
  const { reglasTareas } = useConfiguracion();
  // Reglas de alta (solo al crear): el backend asigna al creador si nadie se
  // elige, la opcion esta activa y el creador es miembro del proyecto.
  const exigirFecha = !tarea && reglasTareas.exigirFechaLimite;
  const seAsignaAlCreador = reglasTareas.asignarAlCreador
    && usuarios.some((u) => u.id === usuarioActual?.id);
  const exigirResponsable = !tarea && reglasTareas.exigirResponsable && !seAsignaAlCreador;
  const creadorEsUsuarioActual = tarea?.creador?.id === usuarioActual?.id
    || (!tarea?.creador?.id && (getTaskAssignees(tarea).length === 0 || isTaskAssignedToUser(tarea, usuarioActual?.id)));
  const [form, setForm] = useState({
    titulo: tarea?.titulo || '',
    descripcion: tarea?.descripcion || '',
    numeroActividad: tarea?.numeroActividad || '',
    asignadoIds: getTaskAssignees(tarea).map((asignado) => asignado.id),
    prioridad: tarea?.prioridad || reglasTareas.prioridadDefecto || 'MEDIA',
    estado: tarea?.estado || reglasTareas.estadoInicial || 'PENDIENTE',
    // Hoy en hora local: toISOString() daba el dia en UTC, que de noche en
    // Mexico ya es mañana.
    fechaInicio: tarea?.fechaInicio ? claveDesdeISO(tarea.fechaInicio) : claveDiaLocal(),
    venceEn: tarea?.venceEn ? claveDesdeISO(tarea.venceEn) : ''
  });
  const [cargando, setCargando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [errorTitulo, setErrorTitulo] = useState('');
  const [errorResponsable, setErrorResponsable] = useState('');
  const [errorFecha, setErrorFecha] = useState('');
  const tareaId = tarea?.id;

  const sincronizarTarea = useCallback((cambios = {}) => {
    if (!tareaId) return;
    onTareaMutada?.(tareaId, cambios);
  }, [onTareaMutada, tareaId]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!gestionable) return;
    // El `required` del campo no actua: el boton de guardar vive en el pie de
    // la ventana, fuera del <form>, asi que la validacion va aqui.
    const faltaTitulo = !form.titulo.trim();
    const faltaResponsable = exigirResponsable && form.asignadoIds.length === 0;
    const faltaFecha = exigirFecha && !form.venceEn;
    setErrorTitulo(faltaTitulo ? t('taskTitleRequired') : '');
    setErrorResponsable(faltaResponsable ? tp('tareaResponsableObligatorio') : '');
    setErrorFecha(faltaFecha ? tp('tareaFechaLimiteObligatoria') : '');
    if (faltaTitulo || faltaResponsable || faltaFecha) return;
    setCargando(true);
    try {
      if (tarea) {
        const response = await tareasService.editar(tarea.id, { ...form, titulo: form.titulo.trim() });
        onGuardar({ tarea: response.tarea, creada: false });
      } else {
        const fd = new FormData();
        Object.entries(form).forEach(([k,v]) => {
          if (k === 'asignadoIds') {
            fd.append(k, JSON.stringify(v));
            return;
          }
          fd.append(k, k === 'titulo' ? v.trim() : v);
        });
        archivos.forEach((file) => fd.append('archivos', file));
        const response = await tareasService.crear(proyectoId, fd);
        onGuardar({ tarea: response.tarea, creada: true });
      }
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCargando(false); }
  };

  // Solo se cierra si de verdad se borro: antes se cerraba aunque se cancelara
  // la confirmacion y la tarea seguia ahi.
  const handleEliminar = async () => {
    setEliminando(true);
    try {
      const borrada = await onEliminar(tarea);
      if (borrada) onClose();
    } finally {
      setEliminando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="640px"
      title={tarea ? t('taskEditTitle') : t('taskNewTitle')}
      footer={(
        // Eliminar se aparta a la izquierda; cancelar y guardar, a la derecha.
        <div className="flex flex-wrap items-center gap-2">
          {tarea && borrable && (
            <button
              type="button"
              onClick={handleEliminar}
              disabled={eliminando}
              className="det-texto-boton det-texto-peligro"
            >
              <Trash2 size={14} /> {t('delete')}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="det-control det-boton">
              {gestionable ? t('cancel') : t('close')}
            </button>
            {gestionable && (
              <button type="button" onClick={handleSubmit} className="btn-primary h-9 !py-0 text-[13.5px]" disabled={cargando}>
                {cargando ? t('saving') : t('save')}
              </button>
            )}
          </div>
        </div>
      )}
    >
          {/* Sin permiso (ni admin del proyecto, ni creador, ni responsable) la
              tarea se ve pero no se edita: el backend rechazaria el guardado. */}
          {!gestionable && (
            <div className="alert-info mb-4 text-[13px]">
              {t('taskNoPermissionHint')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="det-form space-y-4">
            <fieldset disabled={!gestionable} className="space-y-4 border-0 p-0 m-0 min-w-0">
            {/* ── Lo necesario para dar de alta la tarea ─────────────────── */}
            <div className="space-y-1.5">
              <EtiquetaCampo texto={t('taskTitle')} obligatorio htmlFor="tarea-titulo" />
              <input
                id="tarea-titulo"
                className="form-input"
                value={form.titulo}
                onChange={e => { setForm({...form, titulo: e.target.value}); if (errorTitulo) setErrorTitulo(''); }}
                required
                aria-invalid={Boolean(errorTitulo)}
                aria-describedby={errorTitulo ? 'tarea-titulo-error' : undefined}
                placeholder={t('taskTitlePlaceholder')}
                style={errorTitulo ? { borderColor: 'var(--color-error)' } : undefined}
              />
              {errorTitulo && (
                <p id="tarea-titulo-error" className="text-[12.5px] font-medium" style={{ color: 'var(--color-error)' }}>
                  {errorTitulo}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <EtiquetaCampo texto={t('taskAssignedTo')} obligatorio={exigirResponsable} />
              {/* Antes eran todos los nombres del equipo como botones a la
                  vista; con un equipo grande el bloque medía media ventana. */}
              <SelectorMultiple
                conBuscador
                placeholder={t('taskUnassigned')}
                seleccionados={form.asignadoIds}
                onToggle={(id) => {
                  setErrorResponsable('');
                  setForm((prev) => ({
                    ...prev,
                    asignadoIds: prev.asignadoIds.includes(id)
                      ? prev.asignadoIds.filter((asignadoId) => asignadoId !== id)
                      : [...prev.asignadoIds, id],
                  }));
                }}
                opciones={usuarios.map((u) => ({ valor: u.id, etiqueta: u.nombre }))}
              />
              {errorResponsable && (
                <p className="text-[12.5px] font-medium" style={{ color: 'var(--color-error)' }}>{errorResponsable}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <EtiquetaCampo texto={t('taskStatus')} htmlFor="tarea-estado" />
                <SelectorSimple
                  id="tarea-estado"
                  valor={form.estado}
                  onCambio={estado => setForm(prev => ({ ...prev, estado }))}
                  opciones={ESTADOS_TAREA.map(e => ({ valor: e.value, etiqueta: t(e.labelKey) }))}
                  disabled={!gestionable}
                />
              </div>

              <div className="space-y-1.5">
                <EtiquetaCampo texto={t('taskPriority')} htmlFor="tarea-prioridad" />
                <SelectorSimple
                  id="tarea-prioridad"
                  valor={form.prioridad}
                  onCambio={prioridad => setForm(prev => ({ ...prev, prioridad }))}
                  opciones={PRIORIDADES_TAREA.map(p => ({ valor: p.value, etiqueta: t(p.labelKey) }))}
                  disabled={!gestionable}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <EtiquetaCampo texto={t('taskDuration')} obligatorio={exigirFecha} />
              {/* Calendario en linea. Antes abria una ventana sobre la ventana
                  de la tarea: se veia encimado y los desplegables nativos del
                  formulario (prioridad, estado) se dibujaban por encima. */}
              <SelectorRangoFechas
                plegable
                conLeyenda={false}
                desde={form.fechaInicio}
                hasta={form.venceEn}
                onChange={({ desde, hasta }) => { setErrorFecha(''); setForm({ ...form, fechaInicio: desde, venceEn: hasta }); }}
              />
              {errorFecha && (
                <p className="text-[12.5px] font-medium" style={{ color: 'var(--color-error)' }}>{errorFecha}</p>
              )}
            </div>

            {/* Igual que en la lista: solo se dice quien asigno si fue otro */}
            {!creadorEsUsuarioActual && tarea?.creador?.nombre && (
              <p className="text-[12.5px] text-[var(--color-text-muted)]">
                {t('taskAssignedBy')} <span className="font-medium text-[var(--color-text-dim)]">{tarea.creador.nombre}</span>
              </p>
            )}

            {/* ── Lo opcional, al final ─────────────────────────────────────
                Antes la descripcion y el numero de actividad iban entre el
                titulo y los responsables, asi que para llegar a lo que de
                verdad hace falta habia que pasar por encima de ellos. */}
            <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
              <p className="det-etiqueta">{tx('det_opcional')}</p>
              <div className="space-y-1.5">
                <EtiquetaCampo texto={t('taskDescription')} htmlFor="tarea-descripcion" />
                <textarea
                  id="tarea-descripcion"
                  className="form-input resize-none"
                  rows="3"
                  value={form.descripcion}
                  onChange={e => setForm({...form, descripcion: e.target.value})}
                  placeholder={t('taskDescriptionPlaceholder')}
                />
              </div>

              <div className="space-y-1.5 sm:max-w-[220px]">
                <EtiquetaCampo texto={t('taskActivityNumber')} htmlFor="tarea-numero" />
                <input
                  id="tarea-numero"
                  type="number"
                  min="1"
                  className="form-input"
                  value={form.numeroActividad}
                  onChange={e => setForm({ ...form, numeroActividad: e.target.value })}
                  placeholder={t('taskActivityPlaceholder')}
                />
              </div>
            </div>
            </fieldset>

            {/* Sin el modulo de adjuntos el bloque entero desaparece */}
            {adjuntosActivos && (
            <div className="border-t border-[var(--color-border)] pt-4">
              {/* Fuera del fieldset: los adjuntos tienen sus propios permisos */}
              <TaskAttachments
                tareaId={tarea?.id}
                type="tareas"
                title={`${t('taskSupportDocuments')} · ${t('fieldOptional')}`}
                pendingFiles={archivos}
                onPendingFilesChange={setArchivos}
                onAttachmentsChange={(adjuntos) => sincronizarTarea({ adjuntos })}
                showUploader={gestionable && puedeSubirAdjuntos}
                showExisting={Boolean(tarea?.id)}
                uploadLabel={tarea ? t('taskAddFiles') : t('taskSelectFiles')}
              />
            </div>
            )}
          </form>

          {tarea?.id && comentariosActivos && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <TaskComments
                tareaId={tarea.id}
                type="tareas"
                onCommentsChange={(comentarios) => sincronizarTarea({ comentarios })}
              />
            </div>
          )}
    </Modal>
  );
};

const ModalExportarProyecto = ({ proyecto, onClose, onExportar }) => {
  const { t } = usePreferences();
  return (
  <Modal
    open
    onClose={onClose}
    maxWidth="420px"
    title={t('taskExportTitle')}
    subtitle={proyecto?.nombre}
    footer={(
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="det-control det-boton">
          {t('close')}
        </button>
      </div>
    )}
  >
      <div className="det-panel overflow-hidden">
        {[
          { tipo: 'excel', nombre: 'Excel', ext: '.xlsx', icono: <FileSpreadsheet size={17} style={{ color: 'var(--color-success)' }} /> },
          { tipo: 'json', nombre: 'JSON', ext: '.json', icono: <FileJson size={17} style={{ color: 'var(--color-text-muted)' }} /> },
        ].map((opcion) => (
          <button
            key={opcion.tipo}
            type="button"
            onClick={() => onExportar(opcion.tipo)}
            className="cli-fila w-full text-left first:border-t-0"
          >
            {opcion.icono}
            <span className="flex-1 text-[13.5px] font-medium text-[var(--color-text)]">{opcion.nombre}</span>
            <span className="text-[12px] text-[var(--color-text-muted)]">{opcion.ext}</span>
          </button>
        ))}
      </div>
  </Modal>
  );
};

const ModalGuardarPlantilla = ({ proyecto, onClose, onGuardar }) => {
  const { t } = usePreferences();
  const [form, setForm] = useState({
    nombre: t('taskTemplateDefaultName', { project: proyecto?.nombre || t('projects') }),
    descripcion: proyecto?.descripcion || '',
  });
  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await onGuardar(form);
    } finally {
      setGuardando(false);
    }
  };

  // Los botones van en el pie de la ventana, enlazados al formulario por su id
  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="480px"
      title={t('projectSaveTemplate')}
      subtitle={proyecto?.nombre}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="det-control det-boton">
            {t('cancel')}
          </button>
          <button type="submit" form="form-guardar-plantilla" disabled={guardando} className="btn-primary h-9 !py-0 text-[13.5px]">
            {guardando ? t('saving') : t('save')}
          </button>
        </div>
      )}
    >
        <form id="form-guardar-plantilla" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <EtiquetaCampo texto={t('fieldName')} obligatorio htmlFor="plantilla-nombre" />
            <input
              id="plantilla-nombre"
              className="form-input"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <EtiquetaCampo texto={t('taskDescription')} opcional htmlFor="plantilla-descripcion" />
            <textarea
              id="plantilla-descripcion"
              className="form-input resize-none"
              rows="3"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>
        </form>
    </Modal>
  );
};

export default ProyectoDetallePage;
