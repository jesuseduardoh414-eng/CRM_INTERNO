import { useMemo, useState } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import Tooltip2 from './Tooltip';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Sparkles,
  User,
} from 'lucide-react';
import {
  ESTADOS_TAREA,
  PRIORIDADES_TAREA,
  getEstadoTarea,
  getPrioridadTarea,
  asignadosDeTarea,
} from '../utils/estadosTarea';

const ICONOS_ESTADO = {
  PENDIENTE: <Clock3 size={12} />,
  EN_PROGRESO: <Sparkles size={12} />,
  HECHO: <CheckCircle2 size={12} />,
};

// Estados y prioridades salen del catalogo compartido (utils/estadosTarea).
// `solid` es el color de la barra, `soft` el fondo de la etiqueta y `glow` la
// sombra de la barra, derivada del mismo color para que siga al tema.
const STATUS_CONF = Object.fromEntries(ESTADOS_TAREA.map((estado) => [estado.value, {
  labelKey: estado.labelKey,
  solid: estado.color,
  soft: estado.bg,
  text: estado.fg,
  glow: `color-mix(in srgb, ${estado.color} 30%, transparent)`,
  icon: ICONOS_ESTADO[estado.value],
}]));

const PRIORITY_CONF = Object.fromEntries(PRIORIDADES_TAREA.map((prioridad) => [prioridad.value, {
  labelKey: prioridad.labelKey,
  solid: prioridad.color,
  soft: prioridad.bg,
  text: prioridad.fg,
}]));

// 10 filas por pagina, igual que la vista de lista.
const TAREAS_POR_PAGINA = 10;

const getLocale = () => document.documentElement.lang === 'en' ? 'en-US' : 'es-MX';
const formatFecha = (value) =>
  value ? new Date(value).toLocaleDateString(getLocale(), { day: '2-digit', month: 'short' }) : '—';

const formatMes = (value) =>
  new Date(value).toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const diffDays = (from, to) =>
  Math.max(1, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000) + 1);

const getTaskDates = (tarea) => {
  const start = new Date(tarea.fechaInicio || tarea.creadoEn);
  const end = new Date(tarea.venceEn || tarea.fechaInicio || tarea.creadoEn);
  return { start, end };
};

const getStatusConf = (estado) => STATUS_CONF[getEstadoTarea(estado).value];
const getPriorityConf = (prioridad) => PRIORITY_CONF[getPrioridadTarea(prioridad).value];
// Color de identidad del area: el configurado (useConfiguracion().colorArea),
// el mismo de Proyectos y del Inicio. Sin area, gris del tema.
const getAreaConf = (area, colorArea) => ({ solid: area ? colorArea(area) : 'var(--color-text-muted)' });

const getTaskAssignees = asignadosDeTarea;

const getPrimaryAssignee = (tarea) => getTaskAssignees(tarea)[0] || null;

const getTaskAssigneeLabel = (tarea, fallback) => {
  const nombres = getTaskAssignees(tarea).map((asignado) => asignado.nombre).filter(Boolean);
  return nombres.length > 0 ? nombres.join(', ') : fallback;
};

const Tooltip = ({ tarea, rect }) => {
  const { t } = usePreferences();
  const { colorArea } = useConfiguracion();
  if (!tarea || !rect) return null;

  const status = getStatusConf(tarea.estado);
  const priority = getPriorityConf(tarea.prioridad);
  const area = getAreaConf(getPrimaryAssignee(tarea)?.area, colorArea);
  const { start, end } = getTaskDates(tarea);
  const overdue = tarea.estado !== 'HECHO' && tarea.venceEn && startOfDay(tarea.venceEn) < startOfDay(new Date());
  const duracion = diffDays(start, end);

  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        top: Math.max(16, rect.top - 156),
        // Acotado tambien por la derecha: en un movil una barra pegada al borde
        // dejaba media tarjeta fuera de la pantalla.
        left: Math.max(16, Math.min(rect.left + rect.width / 2 - 130, window.innerWidth - 276)),
        zIndex: 1000,
        width: '260px',
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '10px',
        padding: '0.7rem 0.85rem',
        boxShadow: '0 12px 32px -12px rgb(15 23 42 / 0.35)',
        pointerEvents: 'none',
        color: 'var(--color-text-dim)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.55rem' }}>
        <div style={{ fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.25 }}>{tarea.titulo}</div>
        <span style={{ flexShrink: 0, padding: '0.22rem 0.5rem', borderRadius: '999px', background: priority.soft, color: priority.text, fontSize: '0.68rem', fontWeight: 500 }}>
          {t(priority.labelKey)}
        </span>
      </div>

      <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.77rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <User size={12} color={area.solid} />
          {getTaskAssigneeLabel(tarea, t('ganttUnassigned'))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CalendarRange size={12} color="var(--color-primary)" />
          {formatFecha(start)} → {formatFecha(end)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Flag size={12} color={priority.solid} />
          {t('ganttDurationLabel')}: {duracion === 1 ? t('ganttDurationOne') : t('ganttDurationMany', { count: duracion })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: status.solid, fontWeight: 500 }}>
          {status.icon}
          {t(status.labelKey)}
        </div>
        {overdue && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-error)', fontWeight: 500 }}>
            <AlertTriangle size={12} />
            {t('taskOverdue')}
          </div>
        )}
      </div>
    </div>
  );
};

const GanttView = ({ proyecto, tareas, onSeleccionarTarea }) => {
  const { t } = usePreferences();
  const tx = useTextoProyectos();
  const { colorArea } = useConfiguracion();
  const [hoveredTask, setHoveredTask] = useState(null);
  const [pagina, setPagina] = useState(1);

  const preparedTasks = useMemo(() => (
    tareas.map((tarea) => {
      const { start, end } = getTaskDates(tarea);
      const overdue = tarea.estado !== 'HECHO' && tarea.venceEn && startOfDay(tarea.venceEn) < startOfDay(new Date());
      return {
        ...tarea,
        start,
        end,
        overdue,
        durationDays: diffDays(start, end),
      };
    }).sort((a, b) => a.start - b.start)
  ), [tareas]);

  // Mes en pantalla. Antes se dibujaban de corrido todos los meses del
  // proyecto, asi que con un proyecto de medio ano la tabla se iba varias
  // pantallas a la derecha. Ahora se ve un mes y se navega entre ellos.
  const [mesVisible, setMesVisible] = useState(() => {
    const hoy = new Date();
    const primeraTarea = tareas.length > 0
      ? tareas.map((tarea) => getTaskDates(tarea).start).sort((a, b) => a - b)[0]
      : null;
    const fin = proyecto?.fechaFin ? new Date(proyecto.fechaFin) : null;
    // Se arranca en el mes de hoy si el proyecto sigue vivo; si ya termino, en
    // el de su primera tarea, que es donde hay algo que ver.
    const base = (!fin || fin >= hoy) ? hoy : (primeraTarea || hoy);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const range = useMemo(() => ({
    start: new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1),
    end: new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 0),
  }), [mesVisible]);

  const days = useMemo(() => {
    const arr = [];
    const cursor = new Date(range.start);
    while (cursor <= range.end) {
      arr.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return arr;
  }, [range]);

  // La rejilla tiene `days.length` columnas y las barras se reparten sobre ese
  // mismo numero: antes se posicionaban sobre `days.length - 1` y quedaban
  // desalineadas, con la del ultimo dia fuera de la tabla.
  const totalDays = days.length;

  const moverMes = (delta) => setMesVisible((actual) => (
    new Date(actual.getFullYear(), actual.getMonth() + delta, 1)
  ));

  const metrics = useMemo(() => {
    const total = preparedTasks.length;
    const hechas = preparedTasks.filter((t) => t.estado === 'HECHO').length;
    const enProgreso = preparedTasks.filter((t) => t.estado === 'EN_PROGRESO').length;
    const vencidas = preparedTasks.filter((t) => t.overdue).length;
    // Cuenta `asignados` (varios responsables), no solo el campo antiguo
    const sinAsignar = preparedTasks.filter((t) => getTaskAssignees(t).length === 0).length;
    return { total, hechas, enProgreso, vencidas, sinAsignar };
  }, [preparedTasks]);

  /** Indice del dia dentro del mes visible (puede salirse por ambos lados). */
  const indiceDia = (date) => (
    (startOfDay(date).getTime() - startOfDay(range.start).getTime()) / 86400000
  );

  // Recortado al mes visible: una tarea que empieza antes o acaba despues se
  // dibuja pegada al borde en vez de salirse de la rejilla.
  const recortar = (indice) => Math.min(totalDays - 1, Math.max(0, indice));

  /** ¿La tarea toca el mes que se esta viendo? */
  const enElMes = (tarea) => (
    startOfDay(tarea.end) >= startOfDay(range.start) && startOfDay(tarea.start) <= startOfDay(range.end)
  );

  const totalPaginas = Math.max(1, Math.ceil(preparedTasks.length / TAREAS_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const tareasVisibles = preparedTasks.slice(
    (paginaActual - 1) * TAREAS_POR_PAGINA,
    paginaActual * TAREAS_POR_PAGINA,
  );

  // La linea de "hoy" solo si hoy cae en el mes visible. Antes se recortaba a
  // 0-100 y en cualquier otro mes aparecia pegada a un borde.
  const hoyIndice = indiceDia(new Date());
  const hoyVisible = hoyIndice >= 0 && hoyIndice < totalDays;
  const hoyFraccion = (Math.floor(hoyIndice) + 0.5) / totalDays;

  // 26px por dia: 31 dias x 26 = 806px, que con la columna de nombres cabe en
  // una pantalla de escritorio sin desplazamiento horizontal.
  const DAY_WIDTH = 26;
  // La columna de nombres se estrecha en pantallas chicas: con 300px fijos en
  // un movil no quedaba sitio para ver ni un dia de la rejilla.
  const NAME_WIDTH = 'var(--gantt-name-width)';

  const mostrarTooltip = (tarea, elemento) => {
    if (!elemento) return;
    // Con foco de teclado se ancla a la barra si esta en pantalla; si la tarea
    // es de otro mes, a la propia fila.
    const barra = elemento.querySelector?.('[data-gantt-barra]');
    setHoveredTask({ tarea, rect: (barra || elemento).getBoundingClientRect() });
  };

  if (preparedTasks.length === 0) {
    return (
      <div className="det-panel flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
          <CalendarRange size={18} />
        </span>
        <p className="text-[13.5px] text-[var(--color-text-muted)]">{t('ganttEmpty')}</p>
      </div>
    );
  }

  // Cifras de la cabecera en texto plano. Antes eran cuatro cajas de color.
  const cifras = [
    { label: t('ganttTotal'), value: metrics.total, color: 'var(--color-text-muted)' },
    { label: t('ganttInProgress'), value: metrics.enProgreso, color: STATUS_CONF.EN_PROGRESO.solid },
    { label: t('ganttDone'), value: metrics.hechas, color: STATUS_CONF.HECHO.solid },
    { label: t('ganttOverdue'), value: metrics.vencidas, color: 'var(--color-error)' },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', '--gantt-name-width': 'clamp(140px, 28vw, 280px)' }}>
      {hoveredTask && <Tooltip tarea={hoveredTask.tarea} rect={hoveredTask.rect} />}

      <section className="det-panel overflow-hidden">
        {/* Cabecera: titulo y mes a la izquierda; cifras a la derecha */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold text-[var(--color-text)]">{tx('det_ganttTitulo')}</h3>
              <p className="text-[12px] text-[var(--color-text-muted)]">{tx('det_ganttSub')}</p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {cifras.map((item) => (
              <div key={item.label} className="flex items-baseline gap-1.5">
                <dd className="flex items-center gap-1.5 text-[15px] font-semibold tabular-nums text-[var(--color-text)]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} aria-hidden="true" />
                  {item.value}
                </dd>
                <dt className="text-[12.5px] text-[var(--color-text-muted)]">{item.label}</dt>
              </div>
            ))}
          </dl>
        </div>

        {/* Navegacion de mes y leyenda en una sola franja */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2">
          <div className="flex items-center gap-1">
            <Tooltip2 label={t('previous')}>
              <button type="button" onClick={() => moverMes(-1)} className="dash-icono">
                <ChevronLeft size={16} />
              </button>
            </Tooltip2>
            <span className="min-w-[130px] text-center text-[13px] font-semibold text-[var(--color-text)] first-letter:uppercase">
              {formatMes(range.start)}
            </span>
            <Tooltip2 label={t('next')}>
              <button type="button" onClick={() => moverMes(1)} className="dash-icono">
                <ChevronRight size={16} />
              </button>
            </Tooltip2>
            <button
              type="button"
              onClick={() => { const h = new Date(); setMesVisible(new Date(h.getFullYear(), h.getMonth(), 1)); }}
              className="ml-1 h-8 rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-3)]"
            >
              {tx('det_ganttHoy')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-text-muted)]">
            {Object.entries(STATUS_CONF).map(([key, conf]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: conf.solid }} aria-hidden="true" />
                {t(conf.labelKey)}
              </span>
            ))}
            <span className="h-3 w-px bg-[var(--color-border)]" aria-hidden="true" />
            {Object.entries(PRIORITY_CONF).map(([key, conf]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: conf.solid }} aria-hidden="true" />
                {t('projectPriority')} {t(conf.labelKey).toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {/* El tooltip va en posicion fija: al desplazar el gantt (con el dedo
            o la rueda) se quedaba flotando lejos de su barra. */}
        <div style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%' }} onScroll={() => setHoveredTask(null)}>
          <div style={{ minWidth: `calc(${NAME_WIDTH} + ${days.length * DAY_WIDTH}px)`, position: 'relative' }}>
            <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-20">
              <div
                className="det-etiqueta"
                style={{
                  width: NAME_WIDTH,
                  minWidth: NAME_WIDTH,
                  padding: '0.55rem 1rem',
                  borderRight: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  position: 'sticky',
                  left: 0,
                  zIndex: 30,
                }}
              >
                {t('ganttProjectTasks')}
              </div>

              <div className="flex-1">
                <div className="flex h-full">
                  {days.map((day) => {
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                    const isToday = startOfDay(day).getTime() === startOfDay(new Date()).getTime();
                    return (
                      <div
                        key={day.toISOString()}
                        className="flex items-center justify-center tabular-nums"
                        style={{
                          flex: 1,
                          fontSize: '11px',
                          fontWeight: isToday ? 700 : 500,
                          color: isToday ? 'var(--color-error)' : isWeekend ? 'color-mix(in srgb, var(--color-text-muted) 70%, transparent)' : 'var(--color-text-muted)',
                          background: isWeekend ? 'color-mix(in srgb, var(--color-surface-3) 60%, transparent)' : 'transparent',
                          borderRight: '1px solid var(--color-border-light)',
                        }}
                      >
                        {day.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
                <div style={{ width: NAME_WIDTH, minWidth: NAME_WIDTH }} />
                {days.map((day) => (
                  <div
                    key={`grid-${day.toISOString()}`}
                    style={{
                      flex: 1,
                      borderRight: '1px solid var(--color-border-light)',
                      background: day.getDay() === 0 || day.getDay() === 6
                        ? 'color-mix(in srgb, var(--color-surface-3) 60%, transparent)'
                        : 'transparent',
                    }}
                  />
                ))}
              </div>

              {tareasVisibles.map((tarea) => {
                const status = getStatusConf(tarea.estado);
                const priority = getPriorityConf(tarea.prioridad);
                const area = getAreaConf(getPrimaryAssignee(tarea)?.area, colorArea);
                const inicioIdx = recortar(indiceDia(tarea.start));
                const finIdx = recortar(indiceDia(tarea.end));
                const startPct = (inicioIdx / totalDays) * 100;
                const widthPct = ((finIdx - inicioIdx + 1) / totalDays) * 100;
                // Las tareas de otros meses conservan su fila para que la
                // paginacion no cambie de contenido al navegar entre meses,
                // pero en vez de barra muestran a que mes pertenecen.
                const visibleEsteMes = enElMes(tarea);
                const hecha = tarea.estado === 'HECHO';

                return (
                  // La fila entera abre la tarea, no solo la barra: en un mes
                  // donde la tarea no cae, la barra ni siquiera se dibuja.
                  <div
                    key={tarea.id}
                    role={onSeleccionarTarea ? 'button' : undefined}
                    tabIndex={onSeleccionarTarea ? 0 : undefined}
                    onClick={() => onSeleccionarTarea?.(tarea)}
                    onKeyDown={(e) => {
                      if (onSeleccionarTarea && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSeleccionarTarea(tarea);
                      }
                    }}
                    // El tooltip tambien con el foco del teclado, no solo con el raton
                    // Solo con foco de teclado: al cerrar la ventana de la
                    // tarea el foco vuelve a la fila y el tooltip quedaba pegado.
                    onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) mostrarTooltip(tarea, e.currentTarget); }}
                    onBlur={() => setHoveredTask(null)}
                    className="det-gantt-fila"
                    style={{ cursor: onSeleccionarTarea ? 'pointer' : 'default' }}
                  >
                    <div
                      className="det-gantt-nombre"
                      style={{ width: NAME_WIDTH, minWidth: NAME_WIDTH }}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.solid }} title={t(status.labelKey)} aria-hidden="true" />
                        <span className={`truncate text-[13px] font-medium ${hecha ? 'det-hecha' : 'text-[var(--color-text)]'}`}>
                          {tarea.titulo}
                        </span>
                        {tarea.overdue && (
                          <AlertTriangle size={12} className="shrink-0 text-[var(--color-error)]" aria-label={t('taskOverdue')} />
                        )}
                      </div>
                      {/* Aqui habia un punto con el color del area. Se quito:
                          el area ya va escrita abajo en la misma fila, y su
                          azul de DESARROLLO era el mismo de "En progreso" en
                          la leyenda, asi que se leia como un estado. */}
                      <div className="mt-0.5 flex min-w-0 items-center gap-2 pl-3.5 text-[11.5px] text-[var(--color-text-muted)]">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <User size={11} color={area.solid} className="shrink-0" />
                          <span className="truncate">{getTaskAssigneeLabel(tarea, t('ganttUnassigned'))}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatFecha(tarea.end)} · {tarea.durationDays === 1 ? t('ganttDurationOne') : t('ganttDurationMany', { count: tarea.durationDays })}
                        </span>
                        {/* En el movil la columna mide 140px: la prioridad ya
                            la marca el extremo de la barra y aqui no cabe. */}
                        <span className="hidden shrink-0 rounded-[4px] px-1 text-[10.5px] font-medium sm:inline" style={{ background: priority.soft, color: priority.text }}>
                          {t(priority.labelKey)}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 relative" style={{ minHeight: '52px' }}>
                      {!visibleEsteMes && (
                        <span
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-[12px] font-normal text-[var(--color-text-muted)] first-letter:uppercase"
                        >
                          {formatMes(tarea.start)}
                        </span>
                      )}
                      {visibleEsteMes && (
                      <div
                        data-gantt-barra=""
                        // Solo con raton: en una tableta el toque simulaba un
                        // mouseenter, el tooltip salia junto con la ventana de
                        // la tarea y se quedaba pegado al cerrarla.
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHoveredTask({ tarea, rect: e.currentTarget.getBoundingClientRect() }); }}
                        onPointerLeave={() => setHoveredTask(null)}
                        style={{
                          position: 'absolute',
                          left: `${startPct}%`,
                          width: `${widthPct}%`,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          height: '20px',
                          borderRadius: '5px',
                          background: `linear-gradient(90deg, ${status.solid} 0%, ${status.solid} 78%, ${priority.solid} 100%)`,
                          boxShadow: `0 2px 6px -2px ${status.glow}`,
                          // 0.85 y no 0.75: la opacidad tambien atenua el texto
                          // de la barra, y a 0.75 el blanco sobre verde bajaba a 4:1.
                          opacity: hecha ? 0.85 : 1,
                          cursor: 'pointer',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: '4px',
                            background: area.solid,
                          }}
                        />
                        {/* --color-on-estado: texto legible sobre los colores de estado/prioridad en ambos temas (>= 4.5:1) */}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0 0.5rem 0 0.6rem', color: 'var(--color-on-estado)', fontSize: '10.5px', fontWeight: 600 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tarea.durationDays}d
                          </span>
                          {widthPct > 12 && <span style={{ whiteSpace: 'nowrap' }}>{formatFecha(tarea.start)}</span>}
                        </div>
                      </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {hoyVisible && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  // Columna de nombres + la fraccion del area de dias que toca
                  left: `calc(${NAME_WIDTH} + (100% - ${NAME_WIDTH}) * ${hoyFraccion})`,
                  width: '1.5px',
                  background: 'var(--color-error)',
                  // Por debajo de la columna fija de nombres (z 10): al
                  // desplazar en horizontal la linea no debe cruzarla.
                  zIndex: 5,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ position: 'absolute', top: '4px', left: '-3px', width: '7.5px', height: '7.5px', borderRadius: '999px', background: 'var(--color-error)' }} />
              </div>
            )}
          </div>
        </div>

        {/* Paginacion de tareas. Con 10 filas la tabla ya no crece sin fin
            hacia abajo, igual que en la vista de lista. */}
        <div className="det-pie">
          <span className="tabular-nums">
            {totalPaginas > 1
              ? tx('det_rango', {
                desde: (paginaActual - 1) * TAREAS_POR_PAGINA + 1,
                hasta: Math.min(paginaActual * TAREAS_POR_PAGINA, preparedTasks.length),
                total: preparedTasks.length,
              })
              : t('ganttShowingTasks', { count: preparedTasks.length, tasks: preparedTasks.length === 1 ? t('projectTaskSingular') : t('projectTaskPlural'), days: days.length })}
            {' · '}
            {t('ganttUnassignedCount', { count: metrics.sinAsignar })}
          </span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-1">
              <Tooltip2 label={t('previous')}>
                <button
                  type="button"
                  onClick={() => setPagina((n) => Math.max(1, n - 1))}
                  disabled={paginaActual === 1}
                  className="dash-icono"
                >
                  <ChevronLeft size={16} />
                </button>
              </Tooltip2>
              <span className="min-w-[48px] text-center text-[12.5px] font-medium tabular-nums text-[var(--color-text)]">
                {paginaActual} / {totalPaginas}
              </span>
              <Tooltip2 label={t('next')}>
                <button
                  type="button"
                  onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))}
                  disabled={paginaActual === totalPaginas}
                  className="dash-icono"
                >
                  <ChevronRight size={16} />
                </button>
              </Tooltip2>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default GanttView;
