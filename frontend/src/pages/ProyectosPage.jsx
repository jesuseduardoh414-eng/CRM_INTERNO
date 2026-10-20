// Página de Proyectos: cabecera, cifras en texto plano, filtros y la lista en
// tarjetas o en tabla. El admin tiene además la pestaña "Mi Equipo".
import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { areasDeTexto } from '../utils/areas';
import { alcanzaProyecto, esAdminGeneral, puede } from '../utils/permisos';
import { agendaService, empresasService, proyectosService, usuariosService } from '../services/api';
import { useTextoClientes } from '../hooks/useTextoClientes';
import { PageSkeleton } from '../components/Skeleton';
import Modal from '../components/Modal';
import Tooltip from '../components/Tooltip';
import ActionMenu from '../components/ActionMenu';
import CampoFiltro from '../components/CampoFiltro';
import PanelMiembros from '../components/PanelMiembros';
import { useProyectosTodos } from '../hooks/useProyectosTodos';
import SelectorMultiple from '../components/SelectorMultiple';
import SelectorSimple from '../components/SelectorSimple';
import SelectorRangoFechas from '../components/SelectorRangoFechas';
import TaskAttachments from '../components/TaskAttachments';
import UserAvatar from '../components/UserAvatar';
import { sortProyectos } from '../utils/sorters';
import { useDebounce } from '../utils/useDebounce';
import { claveDiaLocal, claveDesdeISO, fechaDesdeClave } from '../utils/fechasLocales';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  ESTADOS_PROYECTO,
  getEstadoProyecto,
  normalizarEstadoProyecto,
  estaListoParaRevision,
} from '../utils/estadosProyecto';
import {
  Plus,
  Building2,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Archive,
  ArchiveRestore,
  BadgeCheck,
  RotateCcw,
  Search,
  X,
  CalendarDays,
  ListChecks,
  LayoutGrid,
  Rows3,
  AlertTriangle,
  Gauge,
  CircleDot,
  Users,
  Check,
} from 'lucide-react';

// 9 = tres filas completas en la rejilla de tres columnas del escritorio.
const PROYECTOS_POR_PAGINA = 9;

// Las areas son las configuradas (useConfiguracion().areas); un proyecto
// guarda una o varias separadas por coma ("DESARROLLO,VENTAS").
const getAreasProyecto = areasDeTexto;

const esAdminUsuario = (usuario) => usuario?.rol?.toString().toUpperCase() === 'ADMIN';

// Las fechas de calendario van como clave 'YYYY-MM-DD' en hora local
// (utils/fechasLocales): el viejo toISOString().slice(0, 10) daba el dia en
// UTC, que de noche en Mexico ya es "mañana".
const monthRangeFor = (value) => {
  const base = (value && fechaDesdeClave(value)) || new Date();
  return {
    start: new Date(base.getFullYear(), base.getMonth(), 1, 12),
    end: new Date(base.getFullYear(), base.getMonth() + 1, 0, 12),
  };
};

const expandBlockedDates = (conflictos) => {
  const blocked = new Map();
  conflictos.forEach(conflicto => {
    const start = new Date(conflicto.fechaInicio);
    const end = conflicto.fechaFin ? new Date(conflicto.fechaFin) : new Date(start);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
    const maxDays = 370;
    let count = 0;
    while (cursor <= last && count < maxDays) {
      const key = claveDiaLocal(cursor);
      if (!blocked.has(key)) blocked.set(key, []);
      blocked.get(key).push(conflicto);
      cursor.setDate(cursor.getDate() + 1);
      count += 1;
    }
  });
  return blocked;
};

const esBloqueoReal = (conflicto) => conflicto.tipo !== 'proyecto';

/** Clientes del directorio para el modal y el filtro (solo admin con el modulo activo). */
const useClientesCatalogo = (activo) => {
  const { data } = useSWR(activo ? ['empresas-catalogo', 'CLIENTE'] : null, () => empresasService.catalogo('CLIENTE'));
  return data?.empresas || [];
};

// ── Piezas de la lista ──────────────────────────────────────────────────────

/** Vista guardada (tarjetas o tabla). localStorage puede fallar en privado. */
const CLAVE_VISTA_LISTA = 'crm_proyectos_vista';
const leerVistaGuardada = () => {
  try { return localStorage.getItem(CLAVE_VISTA_LISTA) === 'lista' ? 'lista' : 'tarjetas'; }
  catch { return 'tarjetas'; }
};

const progresoDe = (proyecto) => proyecto.progresoGeneral ?? proyecto.progreso ?? 0;

/**
 * Vencido: la fecha de fin ya pasó y el proyecto sigue abierto sin llegar al
 * 100%. Los terminados y archivados nunca cuentan, aunque su fecha sea vieja.
 */
const estaVencido = (proyecto, hoy) => {
  const estado = normalizarEstadoProyecto(proyecto.estado);
  if (estado === 'TERMINADO' || estado === 'ARCHIVADO') return false;
  const fin = claveDesdeISO(proyecto.fechaFin);
  return Boolean(fin) && fin < hoy && progresoDe(proyecto) < 100;
};

/** "12 oct" o, si no es de este año, "12 oct 2025". */
const fechaCorta = (iso, locale) => {
  const fecha = iso ? fechaDesdeClave(claveDesdeISO(iso)) : null;
  if (!fecha) return null;
  const otroAnio = fecha.getFullYear() !== new Date().getFullYear();
  return fecha.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(otroAnio && { year: 'numeric' }) });
};

// Acciones del menu de 3 puntos, iguales en la tarjeta y en la fila.
const itemsMenuProyecto = (proyecto, t, onEditar, onCambiarEstado) => {
  const estado = getEstadoProyecto(proyecto.estado);
  return [
    { label: t('edit'), icon: <Pencil size={15} />, onSelect: () => onEditar(proyecto) },
    estado.value !== 'TERMINADO' && estado.value !== 'ARCHIVADO' && {
      label: t('projectMarkFinished'),
      icon: <BadgeCheck size={15} />,
      onSelect: () => onCambiarEstado(proyecto, 'TERMINADO'),
    },
    estado.value !== 'ACTIVO' && {
      label: t('projectReactivate'),
      icon: <RotateCcw size={15} />,
      onSelect: () => onCambiarEstado(proyecto, 'ACTIVO'),
    },
    { separator: true },
    // Sin "Eliminar" por decision del usuario (P3/P9): un proyecto que
    // sobra se archiva, y asi conserva sus tareas y documentos.
    estado.value === 'ARCHIVADO'
      ? { label: t('projectUnarchive'), icon: <ArchiveRestore size={15} />, onSelect: () => onCambiarEstado(proyecto, 'ACTIVO') }
      : { label: t('projectArchive'), icon: <Archive size={15} />, onSelect: () => onCambiarEstado(proyecto, 'ARCHIVADO') },
  ];
};

/** Estado en texto con un punto de color, sin píldora (como el tipo de empresa). */
const EstadoProyecto = ({ estado }) => {
  const { t } = usePreferences();
  const conf = getEstadoProyecto(estado);
  return (
    <span className="proy-estado" style={{ '--proy-punto': conf.dot }}>{t(conf.labelKey)}</span>
  );
};

/** Avisos que piden atención: listo para revisión (admin) y vencido. */
const AvisosProyecto = ({ listo, vencido }) => {
  const { t } = usePreferences();
  const tp = useTextoProyectos();
  return (
    <>
      {/* Aviso al admin: todas las tareas estan hechas pero nadie ha dado el
          visto bueno todavia. No se marca solo a proposito. */}
      {listo && <span className="proy-aviso badge-warning"><BadgeCheck size={12} /> {t('projectReadyForReview')}</span>}
      {vencido && <span className="proy-aviso badge-danger"><AlertTriangle size={12} /> {tp('lista_vencido')}</span>}
    </>
  );
};

/** Áreas del proyecto con el color de cada una. */
const AreasProyecto = ({ area }) => {
  const { t } = usePreferences();
  const { nombreArea, colorArea } = useConfiguracion();
  const lista = getAreasProyecto(area);
  if (!lista.length) return <span className="proy-area">{t('areaGeneral')}</span>;
  return lista.map((clave) => (
    <span key={clave} className="proy-area" style={{ '--proy-punto': colorArea(clave) }}>{nombreArea(clave)}</span>
  ));
};

/** Barra fina de avance con su porcentaje. */
const BarraAvance = ({ valor, color = 'var(--color-primary)' }) => (
  <span className="flex min-w-0 items-center gap-2.5">
    <span className="proy-barra"><span style={{ width: `${valor}%`, background: valor >= 100 ? 'var(--color-success)' : color }} /></span>
    <span className="w-9 shrink-0 text-right text-[12px] font-semibold tabular-nums text-[var(--color-text)]">{valor}%</span>
  </span>
);

/** Fotos del equipo apiladas; a partir de `max` se resume en "+N". */
const AvataresEquipo = ({ miembros = [], max = 4 }) => {
  const tp = useTextoProyectos();
  if (!miembros.length) return <span className="text-[12px] text-[var(--color-text-muted)]">{tp('lista_sinEquipo')}</span>;
  const visibles = miembros.slice(0, max);
  const resto = miembros.length - visibles.length;
  return (
    <span className="proy-avatares">
      {visibles.map((m) => (
        <UserAvatar key={m.id} usuario={m} size={24} radius={999} fontSize="10px" />
      ))}
      {resto > 0 && (
        <span className="proy-avatar-mas" title={miembros.slice(max).map((m) => m.nombre).join(', ')}>
          {tp('lista_masMiembros', { n: resto })}
        </span>
      )}
    </span>
  );
};

const tareasDe = (proyecto) => ({
  total: proyecto.totalTareas ?? proyecto._count?.tareas ?? 0,
  hechas: proyecto.tareasHechas ?? 0,
});

// ── Tarjeta de Proyecto ─────────────────────────────────────────────────────
const ProyectoCard = ({ proyecto, hoy, onEditar, onCambiarEstado, onVerDetalle, esAdmin, puedeEditar, mostrarCliente }) => {
  const { t, locale } = usePreferences();
  const tp = useTextoProyectos();
  const listoParaRevision = esAdmin && estaListoParaRevision(proyecto);
  const vencido = estaVencido(proyecto, hoy);
  const progresoGeneral = progresoDe(proyecto);
  const progresoMiembro = proyecto.progresoMiembro;
  const tareas = tareasDe(proyecto);
  const fin = fechaCorta(proyecto.fechaFin, locale);

  return (
    <article
      onClick={onVerDetalle}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onVerDetalle(); }}
      role="link"
      tabIndex={0}
      aria-label={proyecto.nombre}
      className="proy-tarjeta"
    >
      <div className="flex min-h-[24px] items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <EstadoProyecto estado={proyecto.estado} />
          <AvisosProyecto listo={listoParaRevision} vencido={vencido} />
        </div>
        {/* La tarjeta entera ya lleva al proyecto; los 3 puntos son para quien
            puede editarlo ("proyectos.editar"). */}
        {puedeEditar(proyecto) && (
          <ActionMenu
            size={16}
            className="-mr-1.5 -mt-1 shrink-0"
            items={itemsMenuProyecto(proyecto, t, onEditar, onCambiarEstado)}
          />
        )}
      </div>

      <h3 className="mt-2 truncate text-[16px] font-semibold tracking-tight text-[var(--color-text)]" title={proyecto.nombre}>
        {proyecto.nombre}
      </h3>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--color-text-muted)]">
        {mostrarCliente && proyecto.cliente && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Building2 size={13} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{proyecto.cliente.nombreComercial || proyecto.cliente.nombre}</span>
          </span>
        )}
        <AreasProyecto area={proyecto.area} />
      </div>

      <p className="mt-2.5 line-clamp-2 min-h-[38px] text-[13px] leading-[1.45] text-[var(--color-text-dim)]">
        {proyecto.descripcion || t('projectDefaultDescription')}
      </p>

      {/* mt-auto: con descripciones de distinto largo, las barras quedan
          alineadas entre las tarjetas de una misma fila. */}
      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-medium text-[var(--color-text-muted)]">
          <span>{t('projectGeneralProgress')}</span>
          {progresoMiembro !== null && progresoMiembro !== undefined && (
            <span>{tp('lista_miAvance')} <strong className="font-semibold tabular-nums text-[var(--color-success)]">{progresoMiembro}%</strong></span>
          )}
        </div>
        <BarraAvance valor={progresoGeneral} />
      </div>

      <footer className="proy-tarjeta-pie">
        <span className={`inline-flex items-center gap-1.5 ${vencido ? 'font-medium text-[var(--color-error)]' : ''}`}>
          <CalendarDays size={13} aria-hidden="true" />
          {fin ? tp(vencido ? 'lista_vencio' : 'lista_vence', { fecha: fin }) : tp('lista_sinFechaFin')}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <ListChecks size={13} aria-hidden="true" />
          {tareas.total ? tp('lista_tareas', tareas) : tp('lista_sinTareas')}
        </span>
        <span className="ml-auto"><AvataresEquipo miembros={proyecto.miembros} max={3} /></span>
      </footer>
    </article>
  );
};

// ── Tabla de Proyectos (vista "Lista") ──────────────────────────────────────
const TablaProyectos = ({ proyectos, hoy, esAdmin, puedeEditar, mostrarCliente, onEditar, onCambiarEstado, onVerDetalle }) => {
  const { t, locale } = usePreferences();
  const tp = useTextoProyectos();
  const conMenu = proyectos.some(puedeEditar);
  return (
    <div className="overflow-x-auto">
      <table className="cli-tabla proy-tabla">
        <thead>
          <tr>
            <th>{tp('lista_colProyecto')}</th>
            <th>{tp('lista_colAreas')}</th>
            <th>{tp('lista_colEstado')}</th>
            <th>{tp('lista_colAvance')}</th>
            <th className="text-right">{tp('lista_colTareas')}</th>
            <th>{tp('lista_colFechas')}</th>
            <th>{tp('lista_colEquipo')}</th>
            {conMenu && <th aria-label={t('moreOptions')} />}
          </tr>
        </thead>
        <tbody>
          {proyectos.map((p) => {
            const vencido = estaVencido(p, hoy);
            const tareas = tareasDe(p);
            const inicio = fechaCorta(p.fechaInicio, locale);
            const fin = fechaCorta(p.fechaFin, locale);
            return (
              <tr key={p.id} onClick={() => onVerDetalle(p)}>
                <td className="max-w-[300px]">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-[13.5px] font-medium text-[var(--color-text)] hover:underline"
                    onClick={(e) => { e.stopPropagation(); onVerDetalle(p); }}
                  >
                    {p.nombre}
                  </button>
                  {mostrarCliente && p.cliente && (
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
                      <Building2 size={12} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">{p.cliente.nombreComercial || p.cliente.nombre}</span>
                    </div>
                  )}
                </td>
                <td>
                  <div className="flex max-w-[200px] flex-wrap gap-x-2.5 gap-y-0.5 text-[12.5px] text-[var(--color-text-dim)]">
                    <AreasProyecto area={p.area} />
                  </div>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <EstadoProyecto estado={p.estado} />
                    {(vencido || (esAdmin && estaListoParaRevision(p))) && (
                      <span className="flex flex-wrap gap-1"><AvisosProyecto listo={esAdmin && estaListoParaRevision(p)} vencido={vencido} /></span>
                    )}
                  </div>
                </td>
                <td className="w-[170px] min-w-[150px]"><BarraAvance valor={progresoDe(p)} /></td>
                <td className="whitespace-nowrap text-right tabular-nums">
                  {tareas.total
                    ? <>{tareas.hechas}<span className="text-[var(--color-text-muted)]"> / {tareas.total}</span></>
                    : <span className="text-[var(--color-text-muted)]">0</span>}
                </td>
                <td className="whitespace-nowrap text-[12.5px] tabular-nums text-[var(--color-text-dim)]">
                  {/* Sin fecha de fin se muestra solo el inicio */}
                  {inicio || '—'}
                  {fin && (
                    <>
                      <span className="text-[var(--color-text-muted)]"> – </span>
                      <span className={vencido ? 'font-medium text-[var(--color-error)]' : ''}>{fin}</span>
                    </>
                  )}
                </td>
                <td><AvataresEquipo miembros={p.miembros} /></td>
                {conMenu && (
                  <td className="w-10 text-right">
                    {puedeEditar(p) && <ActionMenu size={16} items={itemsMenuProyecto(p, t, onEditar, onCambiarEstado)} />}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── Modal de Proyecto ────────────────────────────────────────────────────────

/**
 * Pasos del alta de proyecto. Se separo asi a peticion del usuario: el
 * formulario completo eran ocho bloques de corrido y no se sabia por donde
 * empezar. Lo opcional queda al final para poder guardar sin tocarlo.
 */
const PASOS_PROYECTO = [
  { id: 1, labelKey: 'projectStepBasics' },
  { id: 2, labelKey: 'projectStepTeam' },
  { id: 3, labelKey: 'projectStepOptional' },
];

const ModalProyecto = ({ proyecto, onClose, onGuardar }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const { usuario: usuarioActual } = useAuth();
  const { areas, nombreArea } = useConfiguracion();
  const clavesAreas = areas.map((a) => a.clave);
  // Fuera del administrador general, cada quien crea y mueve proyectos solo
  // dentro de su área (el servidor lo vuelve a revisar).
  const esAdminArea = !esAdminGeneral(usuarioActual);
  // Proyecto nuevo: de entrada el area de quien lo crea (o la primera configurada).
  const areasIniciales = proyecto?.area
    ? getAreasProyecto(proyecto.area)
    : [usuarioActual?.area || clavesAreas[0]].filter(Boolean);
  const [form, setForm] = useState({
    nombre: proyecto?.nombre || '',
    descripcion: proyecto?.descripcion || '',
    estado: proyecto?.estado || 'ACTIVO',
    areas: areasIniciales,
    fechaInicio: proyecto?.fechaInicio ? claveDesdeISO(proyecto.fechaInicio) : claveDiaLocal(),
    fechaFin: proyecto?.fechaFin ? claveDesdeISO(proyecto.fechaFin) : '',
    // Se conservan TODOS los miembros, incluido quien edita. Antes se filtraba
    // al usuario actual y el backend solo volvia a añadir al creador: si un
    // admin que era miembro (pero no creador) editaba, se quedaba fuera.
    miembrosIds: proyecto?.miembros?.map(m => m.id) || [],
    plantillaId: '',
    clienteId: String(proyecto?.cliente?.id ?? proyecto?.clienteId ?? ''),
  });
  // Modulos de la instalacion: sin plantillas no se pide ni se ofrece elegir
  // una; sin adjuntos no hay bloque de documentos.
  const { moduloActivo } = useConfiguracion();
  const plantillasActivas = moduloActivo('plantillas');
  const adjuntosActivos = moduloActivo('adjuntos');
  const puedeSubirAdjuntos = adjuntosActivos && puede(usuarioActual, 'tareas.adjuntos');
  // Cliente del directorio: solo lo asigna quien ve clientes y con el modulo activo.
  const tc = useTextoClientes();
  const tp = useTextoProyectos();
  const conCliente = puede(usuarioActual, 'clientes.ver') && moduloActivo('clientes');
  const clientes = useClientesCatalogo(conCliente)
    .filter((c) => c.estado === 'ACTIVO' || String(c.id) === form.clienteId);
  const [paso, setPaso] = useState(1);
  const [usuarios, setUsuarios] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [ocupados, setOcupados] = useState({});
  const [consultandoDisponibilidad, setConsultandoDisponibilidad] = useState(false);
  const esEdicion = Boolean(proyecto);
  const proyectoId = proyecto?.id;
  const miembrosExistentes = new Set((proyecto?.miembros || []).map(m => m.id));

  useEffect(() => {
    usuariosService.listarParaProyectos().then(d => setUsuarios(d.usuarios)).catch(console.error);
    if (!esEdicion && plantillasActivas) {
      proyectosService.listarPlantillas().then(d => setPlantillas(d.plantillas || [])).catch(console.error);
    }
  }, [esEdicion, plantillasActivas]);

  const plantillaSeleccionada = !proyecto && form.plantillaId
    ? plantillas.find(p => String(p.id) === String(form.plantillaId))
    : null;

  // Mostrar todos los usuarios, pero agrupados o resaltados por el área seleccionada.
  // Quien crea no se lista (el backend lo añade solo como creador); al editar
  // si aparece cuando ya es miembro, para poder verse y quitarse si quiere.
  const usuariosSeleccionables = usuarios.filter(u => (
    u.id !== usuarioActual?.id || (esEdicion && miembrosExistentes.has(u.id))
  ));
  const usuariosEnAreas = esAdminArea
    ? usuariosSeleccionables
    : usuariosSeleccionables.filter(u => form.areas.includes(u.area) || esAdminUsuario(u));
  const admins = usuariosSeleccionables.filter(esAdminUsuario);
  const usuariosPorArea = [
    ...(esAdminArea ? clavesAreas : form.areas).map(area => ({
      area,
      usuarios: usuariosEnAreas.filter(u => u.area === area && !esAdminUsuario(u)),
    })),
    ...(admins.length > 0 ? [{ area: 'ADMIN', usuarios: admins }] : []),
  ];
  const usuariosParaBloqueo = usuariosEnAreas.filter(u =>
    form.miembrosIds.includes(u.id) && (!proyecto || !miembrosExistentes.has(u.id))
  );
  const fechasBloqueadas = expandBlockedDates(
    usuariosParaBloqueo
      .filter(u => !esAdminUsuario(u))
      .flatMap(u => (ocupados[u.id] || []).map(conflicto => ({ ...conflicto, usuario: u })))
  );

  // Como texto, no como array: `usuariosEnAreas` se recalcula en cada render y
  // como dependencia del efecto lo dispararia sin parar.
  const idsConsulta = usuariosEnAreas.map(u => u.id).join(',');

  useEffect(() => {
    // Una respuesta lenta de una consulta anterior no pisa la actual
    let activo = true;
    const consultar = async () => {
      const ids = idsConsulta ? idsConsulta.split(',') : [];
      // Antes tambien se salia cuando no habia fecha de inicio, y eso borraba
      // la ocupacion del equipo: al pulsar "Limpiar" desaparecian los dias
      // bloqueados y ya no volvian. Sin fecha se consulta desde el mes actual.
      if (ids.length === 0) {
        setOcupados({});
        return;
      }

      setConsultandoDisponibilidad(true);
      try {
        const rangoMes = monthRangeFor(form.fechaInicio);
        const consultaInicio = rangoMes.start;
        // Siempre un ano por delante, aunque el proyecto termine antes: el
        // calendario se puede navegar y los dias ocupados tienen que salir
        // marcados tambien en los meses siguientes.
        const consultaFin = new Date(rangoMes.start.getFullYear(), rangoMes.start.getMonth() + 12, 0, 23, 59, 59);
        consultaFin.setHours(23, 59, 59, 999);
        const data = await agendaService.consultarDisponibilidad({
          usuarios_ids: ids.join(','),
          inicio: consultaInicio.toISOString(),
          fin: consultaFin.toISOString(),
          excluir_proyecto_id: proyectoId,
        });
        const porUsuario = {};
        data.conflictos?.forEach(conflicto => {
          if (!porUsuario[conflicto.usuarioId]) porUsuario[conflicto.usuarioId] = [];
          porUsuario[conflicto.usuarioId].push(conflicto);
        });
        if (activo) setOcupados(porUsuario);
      } catch (error) {
        if (!activo) return;
        console.error(error);
        setOcupados({});
      } finally {
        if (activo) setConsultandoDisponibilidad(false);
      }
    };

    consultar();
    return () => { activo = false; };
    // `fechaFin` ya no entra: la consulta cubre siempre un ano desde el mes de
    // inicio, asi que elegir el fin no cambia lo que hay que pedir.
  }, [idsConsulta, form.fechaInicio, proyectoId]);

  const toggleArea = (area) => {
    if (esAdminArea) return;
    setForm(prev => {
      const exists = prev.areas.includes(area);
      const areas = exists ? prev.areas.filter(a => a !== area) : [...prev.areas, area];
      const miembrosPermitidos = usuariosSeleccionables.filter(u => areas.includes(u.area) || esAdminUsuario(u)).map(u => u.id);
      return {
        ...prev,
        areas,
        miembrosIds: prev.miembrosIds.filter(id => miembrosPermitidos.includes(id)),
      };
    });
  };

  const toggleMiembro = (id) => {
    setForm(prev => {
      const exists = prev.miembrosIds.includes(id);
      if (exists) return { ...prev, miembrosIds: prev.miembrosIds.filter(x => x !== id) };
      return { ...prev, miembrosIds: [...prev.miembrosIds, id] };
    });
  };

  // Al editar no se recorre el asistente: se ve todo de corrido y se guarda.
  // Los pasos son para dar de alta, que es donde hay que decidir muchas cosas.
  const conPasos = !proyecto;
  const enPaso = (n) => !conPasos || paso === n;

  /** Lo minimo para poder pasar al siguiente paso. */
  const validarPaso = (n) => {
    if (n === 1 && !form.nombre.trim()) return t('projectFieldNameRequired');
    if (n === 2 && form.areas.length === 0) return t('projectPickArea');
    if (n === 2 && !form.fechaInicio) return t('projectStartDateRequired');
    return null;
  };

  const avanzar = () => {
    const error = validarPaso(paso);
    if (error) {
      showToast(error, 'error');
      return;
    }
    setPaso((n) => Math.min(PASOS_PROYECTO.length, n + 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Enter en un campo manda el formulario. En el alta por pasos eso creaba el
    // proyecto desde el paso 1 saltandose los otros dos: aqui Enter avanza.
    if (conPasos && paso < PASOS_PROYECTO.length) {
      avanzar();
      return;
    }
    // Al guardar se revalidan todos los pasos: en el modo de edicion no se pasa
    // por `avanzar`, asi que nadie los habria comprobado.
    for (const p of PASOS_PROYECTO) {
      const error = validarPaso(p.id);
      if (error) {
        showToast(error, 'error');
        if (conPasos) setPaso(p.id);
        return;
      }
    }
    if (form.fechaFin && new Date(`${form.fechaFin}T23:59:59`) <= new Date(`${form.fechaInicio}T00:00:00`)) {
      showToast(t('projectDateRangeError'), 'error');
      if (conPasos) setPaso(2);
      return;
    }
    const inicio = fechaDesdeClave(form.fechaInicio);
    const fin = form.fechaFin ? fechaDesdeClave(form.fechaFin) : inicio;
    const cursor = new Date(inicio);
    while (cursor <= fin) {
      const conflictosDia = fechasBloqueadas.get(claveDiaLocal(cursor)) || [];
      if (conflictosDia.some(esBloqueoReal)) {
        showToast(t('projectMemberRangeConflict'), 'error');
        if (conPasos) setPaso(2);
        return;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    setCargando(true);
    try {
      const formData = new FormData();
      formData.append('nombre', form.nombre);
      formData.append('descripcion', form.descripcion);
      formData.append('estado', form.estado);
      formData.append('area', form.areas.join(','));
      formData.append('fechaInicio', form.fechaInicio);
      formData.append('fechaFin', form.fechaFin);
      formData.append('miembrosIds', JSON.stringify(form.miembrosIds));
      if (plantillasActivas && form.plantillaId) formData.append('plantillaId', form.plantillaId);
      // Vacio = sin cliente (el backend lo toma como null)
      if (conCliente) formData.append('clienteId', form.clienteId);
      
      archivos.forEach(file => {
        formData.append('archivos', file);
      });

      if (proyecto) await proyectosService.editar(proyecto.id, formData);
      else await proyectosService.crear(formData);
      onGuardar({ creado: !proyecto });
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCargando(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="576px"
      // Alto fijo: cada paso tiene distinto largo y sin esto la ventana crecia
      // y encogia al avanzar, moviendo de sitio los botones de abajo.
      height={conPasos ? 'min(720px, 90dvh)' : undefined}
      title={proyecto ? t('projectEditTitle') : t('projectNewModalTitle')}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (paso === 1 ? onClose() : setPaso(paso - 1))}
            className="h-9 [@media(pointer:coarse)]:h-10 rounded-[8px] px-3.5 text-[13.5px] font-medium text-[var(--color-text-dim)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
          >
            {conPasos && paso > 1 ? t('back') : t('cancel')}
          </button>

          {conPasos && paso < PASOS_PROYECTO.length ? (
            <Button type="button" className="h-9 [@media(pointer:coarse)]:h-10 rounded-[8px] px-4" onClick={avanzar}>
              {t('next')} <ChevronRight size={16} />
            </Button>
          ) : (
            <Button type="button" className="h-9 [@media(pointer:coarse)]:h-10 rounded-[8px] px-4" onClick={handleSubmit} disabled={cargando}>
              {cargando ? t('saving') : t('projectSaveButton')}
            </Button>
          )}
        </div>
      )}
    >
          {/* Indicador de pasos. Solo al crear: para editar es mas comodo ver
              todo de corrido y guardar sin recorrer tres pantallas. */}
          {conPasos && (
            <ol className="proy-pasos mb-5" aria-label={tp('lista_paso', { n: paso, total: PASOS_PROYECTO.length })}>
              {PASOS_PROYECTO.map((p, indice) => {
                const activo = paso === p.id;
                const cumplido = paso > p.id;
                return (
                  <li key={p.id} data-estado={activo ? 'activo' : cumplido ? 'hecho' : undefined}>
                    <button
                      type="button"
                      // Solo se puede volver atras; avanzar exige pasar la validacion
                      onClick={() => cumplido && setPaso(p.id)}
                      disabled={!cumplido}
                      aria-current={activo ? 'step' : undefined}
                    >
                      <span className="proy-paso-num">{cumplido ? <Check size={12} strokeWidth={3} /> : indice + 1}</span>
                      <span className="truncate">{t(p.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <form onSubmit={handleSubmit} className="proy-formulario space-y-5">
            {/* ── Paso 1: lo basico ─────────────────────────────────────── */}
            {enPaso(1) && (
              <>
                {/* La plantilla va primero a proposito: rellena sola el area y la
                    descripcion, y para eso tiene que elegirse antes que ellas. */}
                {!proyecto && plantillasActivas && (
                  <div className="space-y-1.5">
                    <label className="form-label block">{t('projectTemplateLabel')}</label>
                    <SelectorSimple
                      valor={String(form.plantillaId || '')}
                      opcionVacia={t('projectTemplatePlaceholder')}
                      onCambio={plantillaId => {
                        const plantilla = plantillas.find(p => String(p.id) === plantillaId);
                        setForm(prev => ({
                          ...prev,
                          plantillaId,
                          descripcion: prev.descripcion || plantilla?.descripcion || '',
                          areas: prev.areas?.length ? prev.areas : getAreasProyecto(plantilla?.area),
                        }));
                      }}
                      opciones={plantillas.map(plantilla => ({
                        valor: plantilla.id,
                        etiqueta: `${plantilla.nombre} — ${plantilla.totalTareas || plantilla._count?.tareas || plantilla.tareas?.length || 0} ${t('projectTaskPlural')}`,
                      }))}
                    />
                    {!plantillaSeleccionada && (
                      <p className="text-xs font-normal text-[var(--color-text-muted)]">
                        {t('projectTemplateNoSelect')}
                      </p>
                    )}
                    {!plantillaSeleccionada && plantillas.length === 0 && (
                      <p className="text-xs font-normal text-[var(--color-warning)]">
                        {t('projectTemplateEmpty')}
                      </p>
                    )}
                    {plantillaSeleccionada && (
                      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-primary-10)] px-3.5 py-2.5">
                        <p className="text-sm font-medium text-[var(--color-text)]">{plantillaSeleccionada.nombre}</p>
                        <p className="text-xs font-normal text-[var(--color-text-muted)] mt-1">
                          {t('projectTemplateTasksBase', { count: plantillaSeleccionada.totalTareas || plantillaSeleccionada._count?.tareas || plantillaSeleccionada.tareas?.length || 0 })}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="form-label block">{t('projectFieldName')}</label>
                  <input className="form-input" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} required placeholder={t('projectFieldNamePlaceholder')} />
                </div>

                <div className="space-y-1.5">
                  <label className="form-label block">{t('taskDescription')}</label>
                  <textarea className="form-input resize-none" rows="3" value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} placeholder={t('projectFieldDescPlaceholder')} />
                </div>

                {conCliente && (
                  <div className="space-y-1.5">
                    <label htmlFor="proyecto-cliente" className="form-label block">{tc('cliProyCliente')}</label>
                    <SelectorSimple
                      id="proyecto-cliente"
                      valor={String(form.clienteId || '')}
                      opcionVacia={tc('cliProySinCliente')}
                      onCambio={clienteId => setForm(prev => ({ ...prev, clienteId }))}
                      opciones={clientes.map((c) => ({
                        valor: c.id,
                        etiqueta: `${c.nombre}${c.nombreComercial ? ` (${c.nombreComercial})` : ''}`,
                      }))}
                    />
                    <p className="text-xs font-normal text-[var(--color-text-muted)]">{tc('cliProyClienteAyuda')}</p>
                  </div>
                )}
              </>
            )}

            {/* ── Paso 2: responsables ──────────────────────────────────── */}
            {enPaso(2) && (
              <>
                {/* Areas y miembros van plegados: antes eran cuatro botones y
                    una tarjeta por area con todos los nombres a la vista, y solo
                    ese bloque ocupaba mas de una pantalla. */}
                <div className="space-y-1.5">
                  <label className="form-label block">{t('projectFieldArea')}</label>
                  <SelectorMultiple
                    placeholder={t('projectPickAreaShort')}
                    seleccionados={form.areas}
                    onToggle={toggleArea}
                    // Las configuradas mas las que ya tenga el proyecto aunque se
                    // hayan quitado de la configuracion (para poder desmarcarlas).
                    opciones={[...clavesAreas, ...form.areas.filter((a) => !clavesAreas.includes(a))].map((k) => ({
                      valor: k,
                      etiqueta: nombreArea(k),
                      // Fuera del administrador general, solo la propia area
                      deshabilitada: esAdminArea && k !== usuarioActual?.area,
                    }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="form-label block">{t('projectFieldMembers')}</label>
                    {consultandoDisponibilidad && <span className="text-xs font-medium text-[var(--color-primary)]">{t('projectCheckingCalendar')}</span>}
                  </div>
                  <SelectorMultiple
                    conBuscador
                    placeholder={t('projectPickMembersShort')}
                    vacioTexto={t('projectPickAreaFirst')}
                    seleccionados={form.miembrosIds}
                    onToggle={toggleMiembro}
                    opciones={usuariosPorArea.flatMap((grupo) => grupo.usuarios.map((u) => {
                      const conflictos = esAdminUsuario(u) ? [] : ocupados[u.id] || [];
                      const tieneProyectoActivo = conflictos.some(c => c.tipo === 'proyecto');
                      return {
                        valor: u.id,
                        etiqueta: u.nombre,
                        grupo: grupo.area === 'ADMIN' ? t('projectAdmins') : nombreArea(grupo.area),
                        // Se avisa de quien ya esta en otro proyecto, pero no se
                        // bloquea: a veces se quiere igual y es decision del admin.
                        aviso: tieneProyectoActivo ? t('projectMemberInProject') : null,
                        titulo: conflictos.length > 0
                          ? t('projectHasBusyItems', { items: conflictos.map(c => c.titulo).join(', ') })
                          : '',
                      };
                    }))}
                  />
                </div>

                {/* Un solo calendario para inicio y fin. La lista aparte de
                    "Calendario de responsables" se quito: la misma informacion
                    se ve ahora sobre los propios dias, marcados o tachados. */}
                <div className="space-y-1.5">
                  <label className="form-label block">{t('projectDateRange')}</label>
                  <SelectorRangoFechas
                    plegable
                    desde={form.fechaInicio}
                    hasta={form.fechaFin}
                    onChange={({ desde, hasta }) => setForm({ ...form, fechaInicio: desde, fechaFin: hasta })}
                    bloqueadas={fechasBloqueadas}
                    esBloqueoDuro={esBloqueoReal}
                  />
                </div>
              </>
            )}

            {/* ── Paso 3: lo opcional ───────────────────────────────────── */}
            {enPaso(3) && (
              <>
                <div className="space-y-1.5">
                  <label className="form-label block">{t('projectFieldStatus')}</label>
                  {/* Switch solo para activo/inactivo, que es el uso diario.
                      Terminar y archivar viven en el menu de la tarjeta. */}
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3.5 py-2.5">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {t(getEstadoProyecto(form.estado).labelKey)}
                    </span>
                    <Switch
                      checked={normalizarEstadoProyecto(form.estado) === 'ACTIVO'}
                      onCheckedChange={(activo) => setForm({ ...form, estado: activo ? 'ACTIVO' : 'INACTIVO' })}
                      aria-label={t('projectActiveSwitch')}
                    />
                  </div>
                </div>

                {adjuntosActivos && (
                <TaskAttachments
                  tareaId={proyecto?.id}
                  type="proyectos"
                  title={t('projectFieldDocuments')}
                  pendingFiles={archivos}
                  onPendingFilesChange={setArchivos}
                  showUploader={puedeSubirAdjuntos}
                  showExisting={Boolean(proyecto?.id)}
                  uploadLabel={proyecto ? t('projectAddFiles') : t('projectSelectFiles')}
                />
                )}
              </>
            )}
          </form>
    </Modal>
  );
};

// ── Componente Principal ─────────────────────────────────────────────────────
const ProyectosPage = () => {
  const { t } = usePreferences();
  const tp = useTextoProyectos();
  const { areas } = useConfiguracion();
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { mutate: mutateGlobal } = useSWRConfig();
  const esAdmin = usuario?.rol?.toUpperCase() === 'ADMIN';
  // Crear y editar salen de los permisos de la persona ("proyectos.crear",
  // "proyectos.editar"); el backend limita la creacion a su area. La pestaña
  // de equipo sigue siendo del admin.
  const { moduloActivo } = useConfiguracion();
  const puedeCrearProyecto = puede(usuario, 'proyectos.crear');
  const tc = useTextoClientes();
  // Filtro y nombre del cliente: quien ve el directorio, con el modulo activo.
  const conClientes = puede(usuario, 'clientes.ver') && moduloActivo('clientes');
  const clientesFiltro = useClientesCatalogo(conClientes);

  // Pestaña activa. "miembros" es la antigua pagina Comunidad, solo para admin.
  const [vista, setVista] = useState('proyectos');
  // Tarjetas o tabla; se recuerda en este navegador.
  const [forma, setForma] = useState(leerVistaGuardada);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [filtro, setFiltro] = useState('TODOS');
  const [area, setArea] = useState('TODAS');
  // El cliente vive en la URL (?clienteId=): asi la ficha del cliente puede
  // enlazar "ver todos sus proyectos" y el filtro sobrevive a recargar.
  const [searchParams, setSearchParams] = useSearchParams();
  const cliente = searchParams.get('clienteId') || 'TODOS';
  const setCliente = (valor) => setSearchParams((previos) => {
    const siguientes = new URLSearchParams(previos);
    if (valor === 'TODOS') siguientes.delete('clienteId');
    else siguientes.set('clienteId', valor);
    return siguientes;
  }, { replace: true });
  // Los archivados no se mezclan con el resto: o ves los vigentes o ves el
  // archivo. Por eso es un modo aparte y no una opcion mas del filtro de estado.
  const [verArchivados, setVerArchivados] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const busquedaDiferida = useDebounce(busqueda, 350);

  const cambiarForma = (nueva) => {
    setForma(nueva);
    try { localStorage.setItem(CLAVE_VISTA_LISTA, nueva); } catch { /* sin almacenamiento: solo dura esta visita */ }
  };

  // La lista va por SWR: la clave incluye todos los filtros, asi que cada
  // combinacion se guarda por separado y volver a una ya vista es instantaneo.
  // Antes se pedia todo de cero en cada entrada y se quedaba en el esqueleto.
  const clienteFiltro = conClientes ? cliente : 'TODOS';
  const claveLista = ['proyectos', busquedaDiferida, filtro, area, pagina, verArchivados, clienteFiltro];
  const { data, isLoading, mutate } = useSWR(
    claveLista,
    async ([, q, estado, areaClave, page, archivados, clienteClave]) => {
      // Busqueda, filtros y corte de pagina se resuelven en el servidor. Si se
      // filtrara aqui solo lo ya descargado, los totales y el numero de paginas
      // serian los de la pagina actual, no los de verdad.
      const respuesta = await proyectosService.listar({
        q,
        // En el archivo se ven solo los archivados. Fuera de el nunca aparecen:
        // "Todos" significa todo lo vigente, y el resto filtra por ese estado.
        ...(archivados
          ? { estado: 'ARCHIVADO' }
          : estado === 'TODOS' ? { excluirEstado: 'ARCHIVADO' } : { estado }),
        ...(areaClave !== 'TODAS' && { area: areaClave }),
        ...(clienteClave !== 'TODOS' && { clienteId: clienteClave }),
        page,
        limit: PROYECTOS_POR_PAGINA
      });
      return { proyectos: sortProyectos(respuesta.proyectos), meta: respuesta.meta || null };
    },
    { onError: (err) => showToast(err.message, 'error') }
  );

  const proyectos = data?.proyectos || [];
  const meta = data?.meta || null;

  // Cifras de cabecera. La lista va paginada (9), asi que salen de la lista
  // completa que ya pide la pestaña "Mi Equipo" (misma clave SWR, una sola
  // peticion compartida) y no de la pagina visible.
  const { data: todos, mutate: recargarTodos } = useProyectosTodos();
  const hoy = claveDiaLocal();
  const resumen = useMemo(() => {
    if (!todos) return null;
    const vigentes = todos.filter((p) => normalizarEstadoProyecto(p.estado) !== 'ARCHIVADO');
    const activos = vigentes.filter((p) => normalizarEstadoProyecto(p.estado) === 'ACTIVO');
    return {
      vigentes: vigentes.length,
      activos: activos.length,
      vencidos: vigentes.filter((p) => estaVencido(p, hoy)).length,
      revision: vigentes.filter(estaListoParaRevision).length,
      terminados: vigentes.filter((p) => normalizarEstadoProyecto(p.estado) === 'TERMINADO').length,
      avance: activos.length
        ? Math.round(activos.reduce((suma, p) => suma + progresoDe(p), 0) / activos.length)
        : 0,
    };
  }, [todos, hoy]);

  // La lista se cachea por combinacion de filtros. Tras crear o cambiar un
  // estado, las demas combinaciones (otra pagina, otro filtro, el archivo...)
  // quedarian con datos viejos durante el dedupingInterval. Se vacian todas
  // menos la actual, que se vuelve a pedir; tambien el Inicio. La lista
  // completa (cifras y "Mi Equipo") se vuelve a pedir en vez de vaciarse, para
  // que las cifras no se queden en blanco mientras tanto.
  const claveActualSerializada = JSON.stringify(claveLista);
  const invalidarOtrasListas = useCallback(() => {
    mutateGlobal(
      (key) => (Array.isArray(key) && key[0] === 'proyectos' && JSON.stringify(key) !== claveActualSerializada)
        || key === 'dashboard-admin',
      undefined,
      { revalidate: false },
    );
    recargarTodos();
  }, [mutateGlobal, claveActualSerializada, recargarTodos]);

  /** Si con el nuevo estado el proyecto ya no encaja aqui, tiene que irse. */
  const perteneceAVista = (estado) => (
    verArchivados
      ? estado === 'ARCHIVADO'
      : filtro === 'TODOS' ? estado !== 'ARCHIVADO' : estado === filtro
  );

  // Terminar, reactivar y archivar. Se manda solo el estado: el backend deja el
  // resto de campos intactos porque el update es parcial.
  const handleCambiarEstado = async (p, nuevoEstado) => {
    const estadoAnterior = normalizarEstadoProyecto(p.estado);
    const sigueVisible = perteneceAVista(nuevoEstado);

    // Al archivar, el proyecto desaparece de la lista en el acto. Antes solo se
    // le cambiaba la etiqueta y se quedaba ahi, como si no se hubiera archivado.
    mutate((actual) => actual && {
      ...actual,
      proyectos: sigueVisible
        ? actual.proyectos.map(x => (x.id === p.id ? { ...x, estado: nuevoEstado } : x))
        : actual.proyectos.filter(x => x.id !== p.id)
    }, { revalidate: false });

    try {
      const formData = new FormData();
      formData.append('estado', nuevoEstado);
      await proyectosService.editar(p.id, formData);

      if (nuevoEstado === 'ARCHIVADO') {
        // "Deshacer" devuelve el proyecto al estado que tenia antes de archivar
        // (normalmente ACTIVO), no a uno fijo.
        showToast(t('projectArchivedToast', { name: p.nombre }), 'success', {
          action: {
            label: t('undo'),
            onClick: () => handleCambiarEstado({ ...p, estado: 'ARCHIVADO' }, estadoAnterior),
          },
        });
      } else {
        const etiqueta = t(ESTADOS_PROYECTO.find(e => e.value === nuevoEstado)?.labelKey || 'statusActive');
        showToast(t('projectStatusUpdated', { name: p.nombre, status: etiqueta.toLowerCase() }));
      }

      // Si se fue el ultimo elemento de la pagina, retroceder: si no, quedaba
      // una pagina vacia con la paginacion apuntando a ella.
      if (!sigueVisible && proyectos.length === 1 && pagina > 1) setPagina(pagina - 1);
    } catch (err) {
      showToast(err.message, 'error');
    }

    // Se vuelve a pedir en cualquier caso: si salio de la vista cambian el total
    // y el corte de pagina, y si fallo hay que deshacer el cambio optimista.
    mutate();
    invalidarOtrasListas();
  };

  const handleGuardado = ({ creado } = {}) => {
    setModal(false);
    mutate();
    invalidarOtrasListas();
    showToast(creado ? t('projectCreated') : t('projectUpdated'));
  };

  // Al cambiar cualquier filtro hay que volver a la pagina 1: si estabas en la
  // 4 y el nuevo filtro solo tiene 2 paginas, te quedarias viendo una vacia.
  const cambiarFiltro = (accion) => { accion(); setPagina(1); };

  const limpiarFiltros = () => cambiarFiltro(() => {
    setBusqueda('');
    setFiltro('TODOS');
    setArea('TODAS');
    setCliente('TODOS');
  });

  const abrirAlta = () => { setEditando(null); setModal(true); };
  const abrirEdicion = (p) => { setEditando(p); setModal(true); };
  const verDetalle = (p) => navigate(`/proyectos/${p.id}`);

  const totalPaginas = meta?.totalPages || 1;
  const hayFiltros = Boolean(busqueda) || filtro !== 'TODOS' || area !== 'TODAS' || clienteFiltro !== 'TODOS';
  const verSoloActivos = () => {
    setVista('proyectos');
    cambiarFiltro(() => { setVerArchivados(false); setFiltro('ACTIVO'); });
  };
  const soloActivosAplicado = !verArchivados && filtro === 'ACTIVO';

  // El esqueleto sale solo cuando no hay absolutamente nada que mostrar. Al
  // buscar o cambiar de pagina se conserva lo anterior (keepPreviousData), asi
  // el input no se desmonta y no se pierde el foco al escribir.
  if (isLoading && !data) return <PageSkeleton cards={3} variant="grid" />;

  const propsFila = {
    hoy,
    esAdmin,
    puedeEditar: (p) => alcanzaProyecto(usuario, p, 'proyectos.editar'),
    mostrarCliente: conClientes,
    onEditar: abrirEdicion,
    onCambiarEstado: handleCambiarEstado,
  };
  const rejilla = (clases = '') => (
    <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${clases}`}>
      {proyectos.map((p) => (
        <ProyectoCard key={p.id} proyecto={p} {...propsFila} onVerDetalle={() => verDetalle(p)} />
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{tp('lista_eyebrow')}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">{t('projectsPageTitle')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{tp('lista_subtitulo')}</p>
        </div>
        {puedeCrearProyecto && (
          <Button className="h-9 w-full rounded-[8px] px-4 md:w-auto" onClick={abrirAlta}>
            <Plus size={16} /> {tp('lista_nuevo')}
          </Button>
        )}
      </header>

      {/* Indicadores en texto plano, en una franja (mismo lenguaje que el Inicio) */}
      <dl className="dash-cifras mb-6">
        <div>
          <dt><CircleDot size={14} style={{ color: 'var(--color-accent-success)' }} /> {tp('lista_cifActivos')}</dt>
          <dd>
            <button type="button" onClick={verSoloActivos} aria-pressed={soloActivosAplicado}>
              <strong>{resumen?.activos ?? '—'}</strong>
            </button>
            {' '}<span>{resumen ? tp('lista_cifActivosSub', { total: resumen.vigentes }) : ''}</span>
          </dd>
        </div>
        <div>
          <dt><AlertTriangle size={14} style={{ color: 'var(--color-error)' }} /> {tp('lista_cifVencidos')}</dt>
          <dd>
            <strong style={resumen?.vencidos ? { color: 'var(--color-error)' } : undefined}>{resumen?.vencidos ?? '—'}</strong>
            {' '}<span>{resumen && (resumen.vencidos ? tp('lista_cifVencidosSub') : tp('lista_cifVencidosCero'))}</span>
          </dd>
        </div>
        {/* "Listo para revision" es un aviso del admin; a un miembro le dice
            mas cuantos se cerraron. */}
        <div>
          <dt>
            <BadgeCheck size={14} style={{ color: 'var(--color-warning)' }} />
            {esAdmin ? tp('lista_cifRevision') : tp('lista_cifTerminados')}
          </dt>
          <dd>
            <strong>{(esAdmin ? resumen?.revision : resumen?.terminados) ?? '—'}</strong>
            {' '}<span>{resumen && (esAdmin ? tp('lista_cifRevisionSub') : tp('lista_cifTerminadosSub'))}</span>
          </dd>
        </div>
        <div>
          <dt><Gauge size={14} style={{ color: 'var(--color-accent-blue)' }} /> {tp('lista_cifAvance')}</dt>
          <dd>
            <strong>{resumen ? `${resumen.avance}%` : '—'}</strong>
            {' '}<span>{resumen && tp('lista_cifAvanceSub')}</span>
          </dd>
        </div>
      </dl>

      {/* La antigua pagina "Comunidad" vive ahora aqui como una pestaña, y solo
          la ve el admin: es quien reparte trabajo entre proyectos y necesita ver
          quien esta en cada uno. Sin ser admin no hay pestañas, se entra directo
          a la lista de proyectos. */}
      {esAdmin && (
        <div role="tablist" aria-label={tp('lista_pestanasAria')} className="dash-pestanas proy-pestanas mb-5">
          <button type="button" role="tab" aria-selected={vista === 'proyectos'} onClick={() => setVista('proyectos')}>
            <FolderOpen size={15} /> {t('projects')}
          </button>
          <button type="button" role="tab" aria-selected={vista === 'miembros'} onClick={() => setVista('miembros')}>
            <Users size={15} /> {t('teamTitle')}
          </button>
        </div>
      )}

      {vista === 'miembros' ? <PanelMiembros /> : (
      <>

      {/* Buscador y filtros en una sola fila. Van al servidor, para que la
          paginacion cuente sobre el resultado real y no sobre lo descargado.
          Regla general del sistema: la etiqueta va ENCIMA del control. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="proyectos-buscar" className="w-full min-w-0 sm:w-auto sm:min-w-[220px] sm:max-w-md sm:flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="proyectos-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => cambiarFiltro(() => setBusqueda(e.target.value))}
              placeholder={t('projectSearchPlaceholder')}
              className="proy-control w-full !pl-9 !pr-9"
            />
            {busqueda && (
              <Tooltip label={t('clearSearch')}>
                <button
                  type="button"
                  onClick={() => cambiarFiltro(() => setBusqueda(''))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        </CampoFiltro>

        {/* En el archivo el filtro de estado no aplica: ahi todo esta archivado */}
        {!verArchivados && (
          <CampoFiltro label={t('projectFieldStatus')} className="min-w-[140px] flex-1 sm:flex-none">
            <Select value={filtro} onValueChange={(v) => cambiarFiltro(() => setFiltro(v))}>
              <SelectTrigger className="proy-control w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODOS" className="text-sm font-normal">{t('projectFilterAll')}</SelectItem>
                {ESTADOS_PROYECTO.filter((e) => e.value !== 'ARCHIVADO').map((e) => (
                  <SelectItem key={e.value} value={e.value} className="text-sm font-normal">{t(e.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>
        )}

        <CampoFiltro label={t('projectFieldArea')} className="min-w-[140px] flex-1 sm:flex-none">
          <Select value={area} onValueChange={(v) => cambiarFiltro(() => setArea(v))}>
            <SelectTrigger className="proy-control w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[1500]">
              <SelectItem value="TODAS" className="text-sm font-normal">{t('projectFilterAllAreas')}</SelectItem>
              {areas.map(({ clave, nombre }) => (
                <SelectItem key={clave} value={clave} className="text-sm font-normal">{nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        {conClientes && clientesFiltro.length > 0 && (
          <CampoFiltro label={tc('cliProyCliente')} className="min-w-[140px] flex-1 sm:flex-none">
            <Select value={cliente} onValueChange={(v) => cambiarFiltro(() => setCliente(v))}>
              <SelectTrigger className="proy-control w-full sm:w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODOS" className="text-sm font-normal">{tc('cliProyTodosClientes')}</SelectItem>
                {clientesFiltro.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} className="text-sm font-normal">{c.nombreComercial || c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>
        )}

        <button
          type="button"
          className="proy-control proy-alternar"
          aria-pressed={verArchivados}
          onClick={() => cambiarFiltro(() => setVerArchivados((v) => !v))}
        >
          {verArchivados ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          {verArchivados ? t('projectBackToActive') : t('projectViewArchived')}
        </button>

        {hayFiltros && (
          <Button variant="ghost" className="h-9 rounded-[8px] px-3 text-[13px] text-[var(--color-text-dim)]" onClick={limpiarFiltros}>
            <X size={14} /> {t('clearFilters')}
          </Button>
        )}

        <div className="dash-segmento ml-auto" role="tablist" aria-label={tp('lista_vistaAria')}>
          <button type="button" role="tab" aria-selected={forma === 'tarjetas'} onClick={() => cambiarForma('tarjetas')} title={tp('lista_vistaTarjetas')}>
            <span className="inline-flex items-center gap-1.5"><LayoutGrid size={14} /> {tp('lista_vistaTarjetas')}</span>
          </button>
          <button type="button" role="tab" aria-selected={forma === 'lista'} onClick={() => cambiarForma('lista')} title={tp('lista_vistaLista')}>
            <span className="inline-flex items-center gap-1.5"><Rows3 size={14} /> {tp('lista_vistaLista')}</span>
          </button>
        </div>
      </div>

      {/* Aviso de que estas en el archivo, para que no parezca que la lista
          normal se vacio. */}
      {verArchivados && (
        <div className="alert-info mb-4 flex items-center gap-2 text-[13px]">
          <Archive size={15} />
          {t('projectArchivedNotice')}
        </div>
      )}

      {proyectos.length === 0 ? (
        <div className="proy-vacio">
          <FolderOpen size={28} className="text-[var(--color-text-muted)]" aria-hidden="true" />
          <p className="mt-2 text-[14px] font-medium text-[var(--color-text)]">
            {hayFiltros ? t('searchNoResults') : (verArchivados ? t('projectNoArchived') : t('projectNoResultsTitle'))}
          </p>
          <p className="mt-0.5 max-w-sm text-[13px] text-[var(--color-text-muted)]">
            {busqueda ? `"${busqueda}"` : (verArchivados ? t('projectArchivedNotice') : t('projectNoResultsSubtitle'))}
          </p>
          {/* Un estado vacio sin salida obliga a adivinar que hacer: aqui se
              ofrece lo mas probable segun como se llego a el. */}
          <div className="mt-4">
            {hayFiltros ? (
              <Button variant="outline" className="h-9 rounded-[8px]" onClick={limpiarFiltros}>
                <X size={15} /> {t('clearFilters')}
              </Button>
            ) : verArchivados ? (
              <Button variant="outline" className="h-9 rounded-[8px]" onClick={() => cambiarFiltro(() => setVerArchivados(false))}>
                <ArchiveRestore size={15} /> {t('projectBackToActive')}
              </Button>
            ) : puedeCrearProyecto && (
              <Button className="h-9 rounded-[8px]" onClick={abrirAlta}>
                <Plus size={16} /> {tp('lista_nuevo')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {forma === 'lista' ? (
            <>
              {/* La tabla no cabe en un movil: ahi se ven las tarjetas */}
              <div className="cli-panel hidden overflow-hidden md:block">
                <TablaProyectos proyectos={proyectos} {...propsFila} onVerDetalle={verDetalle} />
              </div>
              {rejilla('md:hidden')}
            </>
          ) : rejilla()}

          {/* Pie con el conteo; la paginacion solo si hay mas de una pagina */}
          {meta && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-[var(--color-text-muted)]">
              <span className="tabular-nums">
                {totalPaginas > 1
                  ? tp('lista_rango', {
                    desde: (meta.page - 1) * meta.limit + 1,
                    hasta: Math.min(meta.page * meta.limit, meta.total),
                    total: meta.total,
                  })
                  : meta.total === 1 ? tp('lista_conteoUno') : tp('lista_conteo', { n: meta.total })}
              </span>
              {totalPaginas > 1 && (
                <div className="flex items-center gap-1">
                  <button type="button" className="dash-icono" onClick={() => setPagina((n) => Math.max(1, n - 1))} disabled={!meta.hasPrev} aria-label={t('previous')} title={t('previous')}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="min-w-[52px] text-center font-medium tabular-nums text-[var(--color-text)]">{meta.page} / {totalPaginas}</span>
                  <button type="button" className="dash-icono" onClick={() => setPagina((n) => n + 1)} disabled={!meta.hasNext} aria-label={t('next')} title={t('next')}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      </>
      )}

      {modal && <ModalProyecto proyecto={editando} onClose={() => setModal(false)} onGuardar={handleGuardado} />}
    </div>
  );
};

export default ProyectosPage;
