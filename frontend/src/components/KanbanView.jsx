import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react';
import UserAvatar from './UserAvatar';
import ActionMenu from './ActionMenu';
import {
  CircleDashed,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Pencil,
  Eye,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import {
  ESTADOS_TAREA,
  getPrioridadTarea,
  siguienteEstadoTarea,
  asignadosDeTarea,
} from '../utils/estadosTarea';
import { claveDiaLocal, claveDesdeISO, estaPorVencer } from '../utils/fechasLocales';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoPermisos } from '../hooks/useTextoPermisos';
import { useTextoProyectos } from '../hooks/useTextoProyectos';

// ── Configuración Visual ───────────────────────────────────────────────────
// Nombres y colores salen del catalogo compartido (utils/estadosTarea): aqui
// solo se añade el icono de cada columna, el mismo de la lista y del inicio.
const ICONOS_COLUMNA = {
  PENDIENTE: CircleDashed,
  EN_PROGRESO: PlayCircle,
  HECHO: CheckCircle2,
};

const COLUMNAS = ESTADOS_TAREA.map((estado) => ({
  key: estado.value,
  labelKey: estado.labelKey,
  Icono: ICONOS_COLUMNA[estado.value],
  color: estado.color,
}));

// 10 tarjetas por pagina en cada columna, igual que la lista y el gantt.
const TAREAS_POR_PAGINA = 10;

// ── Utilidades ──────────────────────────────────────────────────────────────
const getLocale = () => document.documentElement.lang === 'en' ? 'en-US' : 'es-MX';
const formatFecha = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(getLocale(), { day: '2-digit', month: 'short' });
};

const esVencida = (fechaStr) => {
  if (!fechaStr) return false;
  return claveDesdeISO(fechaStr) < claveDiaLocal();
};

/**
 * ¿La tarea "toca" el dia de hoy? Una hecha, si se cerro hoy. Una abierta, si
 * hoy cae dentro de su rango inicio–vencimiento (una tarea del 1 al 5 tiene
 * que salir el dia 3; antes solo salia si empezaba o vencia justo hoy).
 */
const tareaTocaHoy = (tarea, hoy) => {
  if (tarea.estado === 'HECHO') {
    return Boolean(tarea.completadoEn) && claveDiaLocal(new Date(tarea.completadoEn)) === hoy;
  }
  const inicio = tarea.fechaInicio ? claveDesdeISO(tarea.fechaInicio) : null;
  const fin = tarea.venceEn ? claveDesdeISO(tarea.venceEn) : null;
  if (inicio && fin) return inicio <= hoy && hoy <= fin;
  if (inicio) return inicio === hoy;
  if (fin) return fin === hoy;
  return false;
};

const getScrollSnapshot = (el, count) => {
  if (!el) return null;

  const cards = Array.from(el.querySelectorAll('[data-task-id]'));
  const anchor = cards.find((card) => card.offsetTop + card.offsetHeight > el.scrollTop) || cards[0] || null;

  return {
    count,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    anchorTaskId: anchor?.dataset?.taskId || null,
    anchorOffsetTop: anchor?.offsetTop ?? null,
  };
};

const sortKanbanColumnTasks = (tareas = [], columna) => {
  if (columna !== 'HECHO') return tareas;

  return [...tareas].sort((a, b) => {
    return new Date(b.completadoEn || b.creadoEn || 0).getTime() - new Date(a.completadoEn || a.creadoEn || 0).getTime();
  });
};

// ── Tarjeta Kanban ───────────────────────────────────────────────────────────
// Plana y compacta, como las tareas del inicio: prioridad y aviso arriba,
// titulo, y responsables, fecha y acciones en el pie.
const KanbanCard = ({
  tarea,
  actualizando,
  onClick,
  onEditar,
  onEliminar,
  onCambiarEstado,
  onDragStart,
  onDragEnd,
  // Sin permiso (ni admin del proyecto, ni creador, ni responsable) no se
  // ofrece avanzar, mover ni borrar: el backend lo rechazaria.
  gestionable = true,
  // Borrar depende ademas del permiso "borrar tareas" de la instalacion.
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
  const hecha = tarea.estado === 'HECHO';
  const vencida = esVencida(tarea.venceEn) && !hecha;
  // Aviso suave antes de vencer; los dias los fija la configuracion (0 = apagado).
  const porVencer = !vencida && !hecha
    && estaPorVencer(tarea.venceEn, reglasTareas.diasPorVencer);
  // "Mover a..." en el menu: con el dedo no se puede arrastrar (el arrastre de
  // HTML5 no existe en pantallas tactiles) y la flecha de avanzar solo va
  // hacia delante. Desde aqui se llega a cualquier columna, tambien para
  // devolver una tarea hecha.
  const movimientos = gestionable
    ? COLUMNAS.filter((col) => col.key !== tarea.estado).map((col) => ({
      label: tx('det_moverA', { estado: t(col.labelKey) }),
      icon: <col.Icono size={14} style={{ color: col.color }} />,
      onSelect: () => onCambiarEstado(tarea.id, col.key),
    }))
    : [];
  const acciones = [
    ...movimientos,
    movimientos.length > 0 && { separator: true },
    gestionable && { label: t('edit'), icon: <Pencil size={14} />, onSelect: () => onEditar(tarea) },
    borrable && { label: t('delete'), icon: <Trash2 size={14} />, onSelect: () => onEliminar(tarea), danger: true },
  ].filter(Boolean);
  const sigEstado = siguienteEstadoTarea(tarea.estado);
  const asignados = asignadosDeTarea(tarea);
  const arrastrable = !seleccionable && gestionable;

  return (
    <div
      data-task-id={tarea.id}
      // Sin arrastre mientras se seleccionan: mover y marcar tarjetas con el
      // mismo gesto se pisan y acabas cambiando de columna sin querer.
      draggable={arrastrable}
      onDragStart={(e) => {
        // Sin esto, arrastrar el avatar o el texto de una tarjeta no
        // arrastrable tambien la movia al soltarla en otra columna.
        if (!arrastrable) { e.preventDefault(); return; }
        onDragStart(e, tarea.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => (seleccionable ? onAlternarSeleccion?.(tarea.id) : onClick(tarea))}
      // Se abre (o se marca) tambien con el teclado, como las filas de la lista
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (seleccionable) onAlternarSeleccion?.(tarea.id);
        else onClick(tarea);
      }}
      className="det-kanban-tarjeta"
      data-seleccionada={seleccionada || undefined}
      data-actualizando={actualizando || undefined}
      style={{ cursor: actualizando ? 'wait' : (arrastrable ? 'grab' : 'pointer') }}
    >
      <div className="flex items-center gap-2">
        {seleccionable && (
          <input
            type="checkbox"
            checked={seleccionada}
            onChange={() => onAlternarSeleccion?.(tarea.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={tarea.titulo}
            className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
          />
        )}
        <span className="det-chip" style={{ background: prio.bg, color: prio.fg }}>
          {t(prio.labelKey)}
        </span>
        {vencida && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-error)]">
            <AlertTriangle size={11} /> {t('taskOverdue')}
          </span>
        )}
        {porVencer && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning)]">
            <CalendarClock size={11} /> {tp('tareaPorVencer')}
          </span>
        )}
      </div>

      <div>
        <p className={`text-[13.5px] font-medium leading-snug ${hecha ? 'det-hecha' : 'text-[var(--color-text)]'}`}>
          {tarea.numeroActividad ? <span className="mr-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">#{tarea.numeroActividad}</span> : null}
          {tarea.titulo}
        </p>
        {tarea.descripcion && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-text-muted)]">
            {tarea.descripcion}
          </p>
        )}
      </div>

      {/* Responsables, fecha y menu juntos en el pie: asi una tarea completada
          no deja una fila de acciones vacia con el menu suelto en medio. */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-2">
        <UserAvatar
          usuario={asignados[0]}
          size={22}
          radius={999}
          fontSize="0.58rem"
          color="var(--color-text-dim)"
          background="var(--color-surface-3)"
          borderColor="transparent"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-muted)]">
          {asignados.map((asignado) => asignado.nombre?.split(' ')[0]).filter(Boolean).join(', ') || t('taskUnassigned')}
        </span>
        {tarea.venceEn && (
          <span className="det-vence" data-tono={vencida ? 'vencida' : porVencer ? 'por-vencer' : hecha ? 'hecha' : undefined}>
            {formatFecha(tarea.venceEn)}
          </span>
        )}
        {/* Accion principal: solo existe mientras la tarea pueda avanzar */}
        {!hecha && gestionable && !seleccionable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCambiarEstado(tarea.id, sigEstado); }}
            title={t('taskAdvanceStatus')}
            aria-label={t('taskAdvanceStatus')}
            className="dash-icono det-kanban-avanzar"
          >
            <ArrowRight size={14} />
          </button>
        )}
        {/* En modo seleccion manda la barra de arriba: un "Eliminar" aqui que
            borra solo esta tarjeta despista. */}
        {!seleccionable && (
          <ActionMenu
            size={14}
            items={acciones.length ? acciones : [
              { label: t('viewDetail'), icon: <Eye size={14} />, onSelect: () => onClick(tarea) },
            ]}
          />
        )}
      </div>
    </div>
  );
};

// ── Columna Kanban ───────────────────────────────────────────────────────────
// Columna con fondo suave y cabecera (icono, nombre, cuantas). Crece con sus
// tarjetas hasta un tope; vacia, solo muestra un aviso pequeño punteado.
const KanbanColumna = ({ col, tareas, actualizando, onClick, onEditar, onEliminar, onCambiarEstado, onDragStart, onDragEnd, onDrop, pagina, onCambiarPagina, scrollRef, puedeGestionar, puedeBorrar, seleccionable, seleccionadas, onAlternarSeleccion }) => {
  const { t } = usePreferences();
  const tx = useTextoProyectos();
  const [dragOver, setDragOver] = useState(false);

  // Paginacion por columna. Antes era un "Ver mas" que solo alargaba la
  // columna: no se podia volver atras ni saber cuantas quedaban por delante.
  const totalPaginas = Math.max(1, Math.ceil(tareas.length / TAREAS_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const tareasVisibles = tareas.slice(
    (paginaActual - 1) * TAREAS_POR_PAGINA,
    paginaActual * TAREAS_POR_PAGINA,
  );

  return (
    <div
      className="det-kanban-columna w-[85vw] min-w-[85vw] max-w-[85vw] md:w-auto md:min-w-0 md:max-w-none flex-shrink-0"
      data-arrastrando={dragOver || undefined}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e, col.key); }}
    >
      <div className="det-kanban-cabecera">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text)]">
          <col.Icono size={15} style={{ color: col.color }} aria-hidden="true" />
          {t(col.labelKey)}
        </span>
        <span className="text-[12.5px] font-medium tabular-nums text-[var(--color-text-muted)]">{tareas.length}</span>
      </div>

      <div ref={scrollRef} className="det-kanban-cuerpo">
        {tareasVisibles.map(t => (
          <KanbanCard
            key={t.id}
            tarea={t}
            actualizando={actualizando === t.id}
            onClick={onClick}
            onEditar={onEditar}
            onEliminar={onEliminar}
            onCambiarEstado={onCambiarEstado}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            gestionable={puedeGestionar ? puedeGestionar(t) : true}
            borrable={puedeBorrar ? puedeBorrar(t) : (puedeGestionar ? puedeGestionar(t) : true)}
            seleccionable={seleccionable}
            seleccionada={!!seleccionadas?.has(t.id)}
            onAlternarSeleccion={onAlternarSeleccion}
          />
        ))}

        {tareas.length === 0 && (
          <div className="det-kanban-vacio">
            {dragOver ? tx('det_soltarAqui') : t('taskNoTasks')}
          </div>
        )}
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2 py-1.5">
          <button
            type="button"
            onClick={() => onCambiarPagina(Math.max(1, paginaActual - 1))}
            disabled={paginaActual === 1}
            aria-label={t('previous')}
            className="dash-icono !h-7 !w-7"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[12px] font-medium tabular-nums text-[var(--color-text-muted)]">
            {paginaActual} / {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => onCambiarPagina(Math.min(totalPaginas, paginaActual + 1))}
            disabled={paginaActual === totalPaginas}
            aria-label={t('next')}
            className="dash-icono !h-7 !w-7"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
};

// ── View Principal ───────────────────────────────────────────────────────────
const KanbanView = ({
  tareas,
  onClick,
  onEditar,
  onEliminar,
  onCambiarEstado,
  puedeGestionar,
  // Opcional: si no llega, borrar sigue la misma regla que gestionar.
  puedeBorrar,
  // Avisa al padre de que tareas esta mostrando el tablero (tiene su propio
  // filtro de dia), para que "Seleccionar todas" no marque las escondidas.
  onTareasVisiblesChange,
  seleccionable = false,
  seleccionadas,
  onAlternarSeleccion,
}) => {
  const { t } = usePreferences();
  const [actualizando, setActualizando] = useState(null);
  const [optimisticMoves, setOptimisticMoves] = useState({});
  // Arranca mostrando todo: el filtro "Hoy" escondia las tareas en curso que
  // no empiezan ni vencen justo hoy, y parecia que el tablero estaba vacio.
  const [soloHoy, setSoloHoy] = useState(false);
  const [paginas, setPaginas] = useState({ PENDIENTE: 1, EN_PROGRESO: 1, HECHO: 1 });
  const dragId = useRef(null);
  const columnasRef = useRef({});
  const scrollRestoreRef = useRef(null);
  const scrollFocusRef = useRef(null);

  // Un movimiento optimista deja de valer en cuanto el padre refleja el nuevo
  // estado (o lo revierte por error). Se deriva aqui en vez de limpiarlo con
  // un efecto, que provocaba un render extra en cascada.
  const movimientosVigentes = useMemo(() => {
    const entradas = Object.entries(optimisticMoves);
    if (entradas.length === 0) return optimisticMoves;
    const vigentes = {};
    entradas.forEach(([taskId, movimiento]) => {
      const tareaReal = tareas.find((item) => item.id === Number(taskId));
      if (!tareaReal) return;
      if (tareaReal.estado === movimiento.estado || tareaReal.estado === movimiento.previousEstado) return;
      vigentes[taskId] = movimiento;
    });
    return vigentes;
  }, [optimisticMoves, tareas]);

  const tareasConEstadoLocal = useMemo(() => (
    tareas.map((tarea) => {
      const movimiento = movimientosVigentes[tarea.id];
      if (!movimiento) return tarea;
      return {
        ...tarea,
        estado: movimiento.estado,
        completadoEn: movimiento.completadoEn,
      };
    })
  ), [tareas, movimientosVigentes]);

  const handleDragStart = (e, id) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  };

  const registrarSnapshotScroll = (origen, destino) => {
    const snapshot = {};

    [origen, destino].filter(Boolean).forEach((columna) => {
      const el = columnasRef.current[columna];
      if (!el) return;
      snapshot[columna] = getScrollSnapshot(
        el,
        tareasConEstadoLocal.filter(t => t.estado === columna).length
      );
    });

    scrollRestoreRef.current = Object.keys(snapshot).length > 0 ? snapshot : null;
  };

  const aplicarMovimientoOptimista = (tareaActual, nuevoEstado) => {
    if (!tareaActual || tareaActual.estado === nuevoEstado) return;

    // Se parte de los vigentes: asi los movimientos ya confirmados se van del
    // estado y no se acumulan.
    setOptimisticMoves({
      ...movimientosVigentes,
      [Number(tareaActual.id)]: {
        previousEstado: tareaActual.estado,
        estado: nuevoEstado,
        completadoEn: nuevoEstado === 'HECHO' ? new Date().toISOString() : null,
      }
    });

    // Al mover una tarjeta a otra columna, saltar a la pagina donde cae, para
    // no perderla de vista. "Hecho" va de la mas reciente a la mas vieja, asi
    // que la recien completada cae en la primera pagina; antes se saltaba a la
    // ultima y se veian las completadas hace meses.
    setPaginas((prev) => ({
      ...prev,
      [nuevoEstado]: nuevoEstado === 'HECHO' ? 1 : Math.max(1, Math.ceil(
        (tareasConEstadoLocal.filter((item) => item.estado === nuevoEstado).length + 1) / TAREAS_POR_PAGINA,
      )),
    }));
  };

  const handleCambiarEstadoKanban = async (id, nuevoEstado) => {
    const tareaActual = tareasConEstadoLocal.find(x => x.id === Number(id));
    if (!tareaActual || tareaActual.estado === nuevoEstado) return;
    if (puedeGestionar && !puedeGestionar(tareaActual)) return;

    aplicarMovimientoOptimista(tareaActual, nuevoEstado);
    registrarSnapshotScroll(tareaActual.estado, nuevoEstado);
    scrollFocusRef.current = nuevoEstado === 'HECHO'
      ? { column: 'HECHO', behavior: 'top' }
      : null;
    setActualizando(Number(id));

    try {
      await onCambiarEstado(Number(id), nuevoEstado);
    } finally {
      setActualizando(null);
    }
  };

  const handleDrop = async (e, colKey) => {
    const id = dragId.current;
    if (!id) return;
    const t = tareasConEstadoLocal.find(x => x.id === Number(id));
    if (t && t.estado !== colKey) {
      await handleCambiarEstadoKanban(Number(id), colKey);
    }
    dragId.current = null;
  };

  const hoy = claveDiaLocal();
  const tareasFiltradas = useMemo(() => (
    soloHoy
      ? tareasConEstadoLocal.filter((t) => Boolean(movimientosVigentes[t.id]) || tareaTocaHoy(t, hoy))
      : tareasConEstadoLocal
  ), [soloHoy, tareasConEstadoLocal, movimientosVigentes, hoy]);

  // El padre necesita saber que se ve para "Seleccionar todas". Al desmontar
  // (cambio de vista) se avisa con null para que vuelva a la lista general.
  useEffect(() => {
    onTareasVisiblesChange?.(tareasFiltradas);
  }, [tareasFiltradas, onTareasVisiblesChange]);

  useEffect(() => () => {
    onTareasVisiblesChange?.(null);
  }, [onTareasVisiblesChange]);

  const tareasPorColumna = useMemo(() => ({
    PENDIENTE: sortKanbanColumnTasks(
      tareasFiltradas.filter(t => t.estado === 'PENDIENTE'),
      'PENDIENTE'
    ),
    EN_PROGRESO: sortKanbanColumnTasks(
      tareasFiltradas.filter(t => t.estado === 'EN_PROGRESO'),
      'EN_PROGRESO'
    ),
    HECHO: sortKanbanColumnTasks(
      tareasFiltradas.filter(t => t.estado === 'HECHO'),
      'HECHO'
    ),
  }), [tareasFiltradas]);

  useLayoutEffect(() => {
    const snapshot = scrollRestoreRef.current;
    const scrollFocus = scrollFocusRef.current;

    if (scrollFocus?.behavior === 'top') {
      const destino = columnasRef.current[scrollFocus.column];
      if (destino) {
        destino.scrollTop = 0;
      }
      scrollFocusRef.current = null;
      scrollRestoreRef.current = null;
      return;
    }

    if (!snapshot) return;

    const cambioRealDetectado = Object.entries(snapshot).some(([columna, previo]) => {
      const totalActual = tareasPorColumna[columna]?.length ?? 0;
      return totalActual !== previo.count;
    });

    if (!cambioRealDetectado) return;

    Object.entries(snapshot).forEach(([columna, previo]) => {
      const el = columnasRef.current[columna];
      if (!el || !previo) return;

      if (previo.anchorTaskId) {
        const anchorActual = el.querySelector(`[data-task-id="${previo.anchorTaskId}"]`);
        if (anchorActual) {
          const deltaAnchor = anchorActual.offsetTop - previo.anchorOffsetTop;
          el.scrollTop = Math.max(0, previo.scrollTop + deltaAnchor);
          return;
        }
      }

      const delta = el.scrollHeight - previo.scrollHeight;
      el.scrollTop = Math.max(0, previo.scrollTop + delta);
    });

    scrollRestoreRef.current = null;
    scrollFocusRef.current = null;
  }, [tareasPorColumna]);

  return (
    <div className="flex flex-col gap-3">
      {/* Filtro de día, como segmento: antes eran dos botones grandes con sombra */}
      <div role="tablist" aria-label={t('projectTaskFilters')} className="dash-segmento self-start">
        <button type="button" role="tab" onClick={() => setSoloHoy(false)} aria-selected={!soloHoy}>
          {t('taskFilterAll')}
        </button>
        <button type="button" role="tab" onClick={() => setSoloHoy(true)} aria-selected={soloHoy}>
          {t('taskFilterToday')}
        </button>
      </div>

      <div className="flex md:grid md:grid-cols-3 items-start gap-3 overflow-x-auto md:overflow-visible pb-2 snap-x snap-mandatory lg:snap-none">
        {COLUMNAS.map(col => (
          <div key={col.key} className="snap-center md:min-w-0">
            <KanbanColumna
              col={col}
              tareas={tareasPorColumna[col.key]}
              actualizando={actualizando}
              onClick={onClick}
              onEditar={onEditar}
              onEliminar={onEliminar}
              onCambiarEstado={handleCambiarEstadoKanban}
              onDragStart={handleDragStart}
              // Soltar fuera de una columna no pasa por handleDrop: sin
              // limpiar, el siguiente drop de otra cosa movia esta tarea.
              onDragEnd={() => { dragId.current = null; }}
              onDrop={handleDrop}
              pagina={paginas[col.key]}
              onCambiarPagina={(n) => setPaginas(prev => ({ ...prev, [col.key]: n }))}
              scrollRef={(el) => { columnasRef.current[col.key] = el; }}
              puedeGestionar={puedeGestionar}
              puedeBorrar={puedeBorrar}
              seleccionable={seleccionable}
              seleccionadas={seleccionadas}
              onAlternarSeleccion={onAlternarSeleccion}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default KanbanView;
