import { useState, useEffect, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { proyectosService, statsService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { PageSkeleton } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import UserAvatar from '../components/UserAvatar';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getEstadoProyecto } from '../utils/estadosProyecto';
import { claveDiaLocal, fechaLocalDesdeISO } from '../utils/fechasLocales';
import ActividadEquipo from '../components/dashboard/ActividadEquipo';
import TablaProgresoProyectos from '../components/dashboard/TablaProgresoProyectos';
import InicioMiembro from '../components/miembro/InicioMiembro';
import {
  Layers,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ListChecks,
  GanttChartSquare,
  BarChart3,
  CalendarRange,
  PlayCircle as IconoEnCurso,
  CalendarClock,
  FolderOpen,
} from 'lucide-react';



const IconProjects = () => <Layers size={16} strokeWidth={2} />;

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

/**
 * Fecha de fin de un proyecto para la linea de tiempo, en tres niveles segun
 * que tan real sea el dato:
 *
 * 'real' → tiene fechaFin capturada
 * 'deducida' → no la tiene, pero se usa el cierre de su ultima tarea hecha
 * 'estimada' → no hay nada; se dibujan 7 dias solo para que la barra exista
 *
 * Solo la ultima se marca visualmente, porque es la unica inventada.
 */
const getProjectRange = (project) => {
  // fechaInicio y fechaFin llegan como 'YYYY-MM-DD' a medianoche UTC: se leen
  // como dia de calendario (utils/fechasLocales); con `new Date(iso)` en Mexico
  // salian un dia antes. `creadoEn` si es un instante real y se usa tal cual.
  const inicioProyecto = fechaLocalDesdeISO(project?.fechaInicio);
  const creadoEn = project?.creadoEn ? new Date(project.creadoEn) : null;
  const startCandidates = [inicioProyecto, creadoEn].filter((date) => date && !Number.isNaN(date.getTime()));
  const start = startCandidates.length
    ? new Date(Math.min(...startCandidates.map((date) => date.getTime())))
    : new Date();

  const finProyecto = fechaLocalDesdeISO(project?.fechaFin);
  if (finProyecto) {
    return { start, end: finProyecto, origenFin: 'real' };
  }

  const ultimoCierre = project?.ultimaTareaCompletadaEn
    ? new Date(project.ultimaTareaCompletadaEn)
    : null;

  // Solo sirve si el cierre es posterior al inicio; si no, la barra saldria al reves
  if (ultimoCierre && !Number.isNaN(ultimoCierre.getTime()) && ultimoCierre > start) {
    return { start, end: ultimoCierre, origenFin: 'deducida' };
  }

  return {
    start,
    end: new Date(start.getTime() + (7 * 24 * 60 * 60 * 1000)),
    origenFin: 'estimada'
  };
};

// Solo la primera letra. El `capitalize` de CSS pone mayuscula a cada palabra
// y dejaba "Mayo De 2026" en vez de "Mayo de 2026".
const capitalizar = (texto = '') => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

// Densidad de la linea de tiempo. Con "mes" un proyecto de 4 dias mide ~32px;
// con "semana" mide ~96px y se puede leer.
const ESCALAS_TIMELINE = {
  semana: { labelKey: 'timelineWeek', pxPorDia: 24 },
  mes: { labelKey: 'timelineMonth', pxPorDia: 8 },
  trimestre: { labelKey: 'timelineQuarter', pxPorDia: 2.8 }
};









// Colores de proyecto a partir de los tokens de index.css (antes eran hex
// fijos y en modo oscuro no cambiaban). `soft` es el halo y `accent` el relleno
// de avance; los dos salen del mismo token para seguir al tema.
const TOKENS_PROYECTO = [
  'var(--color-accent-blue)',
  'var(--color-accent-green)',
  'var(--color-accent-pink)',
  'var(--color-accent-purple)',
  'var(--color-accent-amber)',
  'var(--color-accent-success)',
  'var(--color-gold)',
];
const PROJECT_TIMELINE_COLORS = TOKENS_PROYECTO.map((solid) => ({
  solid,
  soft: `color-mix(in srgb, ${solid} 16%, transparent)`,
  accent: `color-mix(in srgb, ${solid} 45%, var(--color-surface))`,
}));

// Rojo de la linea de "hoy": acento vivo, se usa como trazo y no como texto
const ROJO_HOY = 'var(--color-accent-error)';
const mezcla = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;


const getProjectTimelineColor = (project) => {
  const seed = String(project?.nombre || project?.id || '')
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PROJECT_TIMELINE_COLORS[seed % PROJECT_TIMELINE_COLORS.length];
};




// Seis por página: es lo que cabe en el panel de vistas sin obligar a desplazar
// dentro del gantt (6 × 84px de fila + cabecera y pie).
const PROYECTOS_POR_PAGINA = 6;

const ProjectTimeline = ({ projectEntries, selectedProjectId, onSelectProject }) => {
  const { t, locale } = usePreferences();
  const [escala, setEscala] = useState('mes');
  const [pagina, setPagina] = useState(1);

  const todos = projectEntries.filter((entry) => entry.start && entry.end);
  // Al elegir un proyecto se muestra solo ese; el boton "ver todos" lo devuelve.
  const filtrados = selectedProjectId
    ? todos.filter((entry) => entry.project.id === selectedProjectId)
    : todos;

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PROYECTOS_POR_PAGINA));
  // Se recorta en vez de reiniciar con un efecto: al filtrar a un solo proyecto
  // totalPaginas baja a 1 y esto ya deja la pagina en rango por si solo.
  const paginaActual = Math.min(pagina, totalPaginas);
  const validEntries = filtrados.slice(
    (paginaActual - 1) * PROYECTOS_POR_PAGINA,
    paginaActual * PROYECTOS_POR_PAGINA,
  );

  // El eje se calcula sobre TODOS los filtrados, no sobre la pagina visible:
  // si dependiera de la pagina, cada una tendria un rango de fechas distinto y
  // las barras "saltarian" al pasar de pagina.
  const range = (() => {
    if (!filtrados.length) {
      const start = new Date();
      return { start, end: new Date(start.getTime() + (14 * 24 * 60 * 60 * 1000)) };
    }
    return {
      start: new Date(Math.min(...filtrados.map((entry) => entry.start.getTime()))),
      end: new Date(Math.max(...filtrados.map((entry) => entry.end.getTime())))
    };
  })();

  const totalDays = Math.max(1, Math.ceil((endOfDay(range.end) - startOfDay(range.start)) / (1000 * 60 * 60 * 24)));

  // Ancho en pixeles (antes eran porcentajes). Con pixeles la escala puede
  // cambiar la densidad y el area se desplaza en horizontal si no cabe.
  const pxPorDia = ESCALAS_TIMELINE[escala].pxPorDia;
  const anchoTotal = Math.max(560, Math.round(totalDays * pxPorDia));

  // Sin useMemo: son un puñado de meses y depende de valores derivados que el
  // compilador de React no puede memorizar de forma fiable.
  const months = (() => {
    const items = [];
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    const endMonth = new Date(range.end.getFullYear(), range.end.getMonth(), 1);

    while (cursor <= endMonth) {
      const monthStart = new Date(cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const visibleStart = monthStart < range.start ? range.start : monthStart;
      const visibleEnd = monthEnd > range.end ? range.end : monthEnd;
      const days = Math.max(1, Math.ceil((endOfDay(visibleEnd) - startOfDay(visibleStart)) / (1000 * 60 * 60 * 24)));
      const ancho = Math.round((days / totalDays) * anchoTotal);

      items.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        // Con poco espacio se abrevia el mes, para que no se corte a la mitad
        label: capitalizar(cursor.toLocaleDateString(locale, ancho < 110
          ? { month: 'short' }
          : { month: 'long', year: 'numeric' })),
        ancho
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }
    return items;
  })();

  const getPx = (date) => ((startOfDay(date) - startOfDay(range.start)) / (1000 * 60 * 60 * 24) / totalDays) * anchoTotal;
  const todayPx = getPx(new Date());
  const hoyVisible = todayPx >= 0 && todayPx <= anchoTotal;

  const proyectoSeleccionado = selectedProjectId
    ? todos.find((entry) => entry.project.id === selectedProjectId)
    : null;

  if (!todos.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: '20px', color: 'var(--color-text-muted)', fontWeight: 400 }}>
        {t('timelineEmpty')}
      </div>
    );
  }

  return (
    // Se ajusta al alto que le den: barra de control arriba y paginacion abajo
    // siempre visibles, y las filas desplazan en medio. Antes crecia libre y la
    // paginacion quedaba fuera del panel, sin nada que avisara que seguia ahi.
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: '1px solid var(--color-border)', borderRadius: '20px', overflow: 'hidden', background: 'var(--color-surface)' }}>
      {/* Barra de control: proyecto y escala juntos, con la etiqueta arriba */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.25rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text-dim)' }}>
              <FolderKanban size={14} color="var(--color-primary)" />
                  {t('projects')}
            </span>
            <Select
              value={selectedProjectId === null ? 'TODOS' : String(selectedProjectId)}
              onValueChange={(valor) => onSelectProject(valor === 'TODOS' ? null : Number(valor))}
            >
              <SelectTrigger className="h-10 w-[200px] text-sm font-normal sm:h-9 sm:w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[1500] max-h-[320px]">
                <SelectItem value="TODOS" className="text-sm font-normal">{t('dashboardAllProjects')}</SelectItem>
                {todos.map((entry) => (
                  <SelectItem key={entry.project.id} value={String(entry.project.id)} className="text-sm font-normal">
                    {entry.project.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text-dim)' }}>
          <Layers size={14} color="var(--color-primary)" />
              {t('timelineScale')}
            </span>
            <Select value={escala} onValueChange={setEscala}>
              <SelectTrigger className="h-10 w-[150px] text-sm font-normal sm:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[1500]">
                {Object.entries(ESCALAS_TIMELINE).map(([clave, conf]) => (
                  <SelectItem key={clave} value={clave} className="text-sm font-normal">{t(conf.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {proyectoSeleccionado ? (
            <Button variant="ghost" size="sm" onClick={() => onSelectProject(null)} className="text-[var(--color-primary)]">
              <X size={14} /> {t('timelineShowAll')}
            </Button>
              ) : (
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-primary)', background: 'var(--color-primary-10)', padding: '0.32rem 0.55rem', borderRadius: '999px' }}>
              {t('timelineVisibleCount', { count: validEntries.length })}
            </span>
          )}
          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-error)', background: 'var(--color-error-bg)', padding: '0.32rem 0.55rem', borderRadius: '999px' }}>
            {t('timelineTodayLine')}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '0.32rem 0.55rem', borderRadius: '999px' }}>
            <span style={{ width: '18px', height: '9px', borderRadius: '999px', background: 'repeating-linear-gradient(45deg, var(--color-text-muted) 0 3px, transparent 3px 6px)' }} />
            {t('timelineEstimated')}
          </span>
        </div>
      </div>

      {/* El desplazamiento vertical vive aqui, no en cada columna, para que los
          nombres y las barras se muevan juntos. La columna de la derecha solo
          desplaza en horizontal (overflowY hidden), si no crearia su propio
          scroll vertical y las dos columnas se desincronizarian. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Ancho de la columna de nombres en CSS (.dash-gantt-nombres): en
            movil se estrecha para que quede sitio a las barras. */}
        <div className="dash-gantt-nombres">
          <div className="dash-gantt-celda" style={{ paddingTop: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-3)', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                  {t('projects')}
          </div>
        {validEntries.map((entry, index) => {
          const palette = getProjectTimelineColor(entry.project);
          const statusConf = getEstadoProyecto(entry.project.estado);
          const progress = entry.project.progresoGeneral ?? entry.project.progreso ?? 0;
          const selected = selectedProjectId === entry.project.id;
          const miembros = entry.project.miembros || [];

            return (
              <button
              key={entry.project.id}
                type="button"
                className="dash-gantt-celda"
                aria-pressed={selected}
                onClick={() => onSelectProject(selected ? null : entry.project.id)}
                style={{
                  width: '100%', height: '84px', paddingTop: '0.9rem', paddingBottom: '0.9rem',
                  border: 'none',
                borderBottom: index < validEntries.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                background: selected ? 'var(--color-primary-10)' : 'var(--color-surface)',
                  cursor: 'pointer', textAlign: 'left', position: 'relative',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.35rem'
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: palette.solid }} />
                <div style={{ fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.project.nombre}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.3rem', minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 500, color: statusConf.color, background: statusConf.bg, padding: '0.2rem 0.42rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                    {t(statusConf.labelKey)}
                    </span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 500, color: palette.solid, background: palette.soft, padding: '0.2rem 0.42rem', borderRadius: '999px' }}>
                    {progress}%
                    </span>
                  </div>

                  {/* Miembros. Se usa UserAvatar para que salga la foto de perfil:
                      antes esta lista dibujaba la inicial a mano. */}
                  <div className="dash-gantt-avatares" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {miembros.slice(0, 3).map((miembro) => (
                      <div key={miembro.id} style={{ marginRight: '-7px' }}>
                        <UserAvatar
                          usuario={miembro}
                          size={22}
                          radius={999}
                          fontSize="0.55rem"
                          color={palette.solid}
                          background="var(--color-surface)"
                          borderColor={palette.soft}
                />
                      </div>
                    ))}
                    {miembros.length > 3 && (
                      <span style={{ marginLeft: '0.55rem', fontSize: '0.7rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                        +{miembros.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ width: `${anchoTotal}px`, position: 'relative' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-3)' }}>
          {months.map((month) => (
                <div key={month.key} style={{ width: `${month.ancho}px`, minWidth: `${month.ancho}px`, padding: '1rem 0.6rem', borderRight: '1px solid var(--color-border)', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-primary)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {month.label}
                </div>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              {hoyVisible && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPx}px`, width: '2px', background: mezcla(ROJO_HOY, 90), zIndex: 8, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: '6px', left: '-5px', width: '12px', height: '12px', borderRadius: '999px', background: ROJO_HOY, boxShadow: `0 0 0 4px ${mezcla(ROJO_HOY, 14)}` }} />
                </div>
              )}

        {validEntries.map((entry, index) => {
                const left = getPx(entry.start);
                // Ancho minimo para que la barra siga siendo visible y clickeable
                const ancho = Math.max(26, getPx(entry.end) - left);
          const selected = selectedProjectId === entry.project.id;
          const progress = entry.project.progresoGeneral ?? entry.project.progreso ?? 0;
          const palette = getProjectTimelineColor(entry.project);
                const fechas = `${entry.start.toLocaleDateString(locale, { day: '2-digit', month: 'short' })} – ${entry.end.toLocaleDateString(locale, { day: '2-digit', month: 'short' })}`;
                const esEstimada = entry.origenFin === 'estimada';
                const notaFin = esEstimada
                  ? t('timelineEstimatedShort')
                  : entry.origenFin === 'deducida'
                    ? t('timelineDerivedShort')
                    : '';
                // La etiqueta va donde quepa. Con barras anchas no hay hueco a
                // ningun lado, asi que se dibuja dentro de la propia barra.
                const anchoEtiqueta = 190;
                const posicionEtiqueta = left + ancho + anchoEtiqueta < anchoTotal
                  ? 'despues'
                  : left > anchoEtiqueta
                    ? 'antes'
                    : 'dentro';

                return (
                  <div
              key={entry.project.id}
                    onClick={() => onSelectProject(selected ? null : entry.project.id)}
                    style={{
                      height: '84px', position: 'relative', cursor: 'pointer',
                borderBottom: index < validEntries.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                      background: selected ? 'var(--color-primary-10)' : 'transparent'
                    }}
                  >
                    <div
                      title={`${entry.project.nombre} · ${fechas}${notaFin ? ` · ${notaFin}` : ''}`}
                      style={{
                        position: 'absolute', left: `${left}px`, width: `${ancho}px`,
                        top: '50%', transform: 'translateY(-50%)', height: '22px', borderRadius: '999px',
                        // Solo la fecha inventada se raya. La deducida del ultimo
                        // cierre es un dato real y se dibuja como cualquier otra.
                        background: esEstimada
                          ? `repeating-linear-gradient(45deg, ${palette.solid} 0 6px, ${mezcla(palette.solid, 40)} 6px 12px)`
                          : mezcla(palette.solid, 87),
                        boxShadow: selected ? `0 12px 24px ${palette.soft}` : `0 8px 18px ${palette.soft}`,
                        overflow: 'hidden'
                      }}
                    >
                      {!esEstimada && (
                  <div style={{ width: `${progress}%`, maxWidth: '100%', height: '100%', borderRadius: '999px', background: palette.accent, opacity: 0.92 }} />
                      )}
                    </div>
                    {/* Una sola etiqueta: antes habia una al inicio y otra al
                        final, y con barras cortas se encimaban. */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '0.72rem',
                        fontWeight: 400,
                        whiteSpace: 'nowrap',
                        ...(posicionEtiqueta === 'despues' && {
                          left: `${left + ancho + 10}px`,
                    color: 'var(--color-text-muted)',
                        }),
                        ...(posicionEtiqueta === 'antes' && {
                          left: `${left - anchoEtiqueta - 14}px`,
                          width: `${anchoEtiqueta}px`,
                          textAlign: 'right',
                    color: 'var(--color-text-muted)',
                        }),
                        // Dentro de la barra va sobre una pastilla del color de
                        // la superficie: los colores salen de tokens que
                        // cambian con el tema y no se puede calcular de
                        // antemano si sobre ellos se lee mejor blanco o negro.
                        ...(posicionEtiqueta === 'dentro' && {
                          left: `${left + ancho - 8}px`,
                          transform: 'translate(-100%, -50%)',
                          color: 'var(--color-text)',
                          background: 'var(--color-surface)',
                          padding: '0.05rem 0.45rem',
                          borderRadius: '999px',
                        })
                      }}
                    >
                      {fechas}{notaFin ? ` · ${notaFin}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Paginacion entre proyectos. Se oculta al ver uno solo o si todos caben. */}
      {totalPaginas > 1 && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem 1.1rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-3)' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
            {t('timelineRange', {
              desde: (paginaActual - 1) * PROYECTOS_POR_PAGINA + 1,
              hasta: Math.min(paginaActual * PROYECTOS_POR_PAGINA, filtrados.length),
              total: filtrados.length
            })}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Tooltip label={t('previous')}>
              <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaActual === 1}>
                <ChevronLeft size={16} />
              </Button>
            </Tooltip>
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text)', minWidth: '78px', textAlign: 'center' }}>
              {paginaActual} / {totalPaginas}
            </span>
            <Tooltip label={t('next')}>
              <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaActual === totalPaginas}>
                <ChevronRight size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
};

// Cuantas actividades se cerraron en cada mes. Los datos vienen ya agrupados
// del servidor (stats.actividadPorMes), no se calculan aqui.
const ActividadPorMes = ({ datos }) => {
  const { t, locale } = usePreferences();
  const meses = datos?.meses || [];
  const sinFecha = datos?.sinFecha || 0;

  const maximo = Math.max(1, ...meses.map((m) => m.total));
  const total = meses.reduce((suma, m) => suma + m.total, 0);

  const nombreMes = (clave) => {
    const [anio, mes] = clave.split('-').map(Number);
    return capitalizar(new Date(anio, mes - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text)' }}>{t('monthlyActivityTitle')}</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 400, marginTop: '0.2rem' }}>
            {t('monthlyActivitySubtitle')}
          </p>
        </div>
        {total > 0 && (
          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-primary)', background: 'var(--color-primary-10)', padding: '0.32rem 0.6rem', borderRadius: '999px' }}>
            {t('monthlyActivityTotal', { count: total })}
          </span>
        )}
      </div>

      {meses.length === 0 ? (
        <div style={{ padding: '2.5rem', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: '16px', color: 'var(--color-text-muted)', fontWeight: 400 }}>
          {t('monthlyActivityEmpty')}
        </div>
              ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {meses.map((m) => {
            const pct = Math.round((m.total / maximo) * 100);
            return (
              <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="dash-mes-etiqueta" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-dim)' }}>
                  {nombreMes(m.mes)}
                </div>
                <div style={{ flex: 1, height: '26px', background: 'var(--color-surface-3)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      minWidth: m.total > 0 ? '30px' : 0,
                      height: '100%',
                      borderRadius: '999px',
                      background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                      transition: 'width 0.5s ease'
                    }}
                />
                </div>
                <div style={{ minWidth: '2.5rem', textAlign: 'right', fontSize: '1rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  {m.total}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Las terminadas sin fecha de cierre no se pueden ubicar en un mes; se
          avisa en vez de repartirlas o inventarles una fecha. */}
      {sinFecha > 0 && (
        <p style={{ marginTop: '1.25rem', fontSize: '0.78rem', fontWeight: 400, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertCircle size={13} />
          {t('monthlyActivityNoDate', { count: sinFecha })}
        </p>
      )}
    </div>
  );
};


/**
 * Vistas del panel del Inicio. Solo se muestra una a la vez; el orden es el que
 * pidió el usuario y "actividad" es la de arranque porque es lo que revisa a diario.
 */
const VISTAS_PANEL = [
  { id: 'actividad', labelKey: 'dashboardPanelActivity', icono: ListChecks },
  { id: 'gantt', labelKey: 'dashboardPanelGantt', icono: GanttChartSquare },
  { id: 'progreso', labelKey: 'dashboardPanelProgress', icono: BarChart3 },
  { id: 'mes', labelKey: 'dashboardPanelMonthly', icono: CalendarRange },
];

// El alto único del panel (para que cambiar de vista no mueva nada de lugar)
// vive en CSS, en .dash-panel-inicio, y solo aplica en escritorio. En móvil el
// equipo y el detalle van uno debajo del otro y con alto fijo el detalle
// quedaba recortado; ahí el panel crece con su contenido.

const DashboardAdmin = () => {
  const { t, locale } = usePreferences();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [vistaPanel, setVistaPanel] = useState('actividad');

  // Actividad del equipo por día. Va por su propia clave para que cambiar de
  // fecha no obligue a recalcular todas las estadísticas, y para que volver a
  // un día ya consultado sea inmediato.
  const [fechaActividad, setFechaActividad] = useState(() => claveDiaLocal());

  // Sin keepPreviousData: al cambiar de día no se puede enseñar la lista del
  // día anterior bajo la fecha nueva (ni dejarla ahí si el día nuevo falla).
  const {
    data: actividadRespuesta,
    error: errorActividad,
    isLoading: cargandoActividad,
    mutate: recargarActividad,
  } = useSWR(
    ['actividad-equipo', fechaActividad],
    async ([, fecha]) => statsService.actividadEquipo(fecha),
    { keepPreviousData: false, onError: (error) => showToast?.(error.message, 'error') },
  );
  const actividadDia = actividadRespuesta?.miembros ?? null;

  // El tablero completo (estadísticas + proyectos del gantt) también por SWR:
  // es la pantalla de entrada y la más pesada, y antes volvía a pedirlo todo
  // cada vez que se entraba, con el esqueleto de carga en blanco.
  const { data: tablero, error: errorTablero, isLoading: cargando, mutate: recargarTablero } = useSWR(
    'dashboard-admin',
    async () => {
      const [statsData, projectsData] = await Promise.all([
        statsService.getAdminStats(),
        proyectosService.listar(),
      ]);
      return { stats: statsData, projects: projectsData.proyectos || [] };
    },
    { onError: (error) => showToast?.(error.message || t('dashboardConnectionError'), 'error') },
  );

  const stats = tablero?.stats || null;
  // Memorizado: `|| []` crearia un array nuevo en cada render y eso invalidaria
  // los useMemo del gantt aunque los datos no hubieran cambiado.
  const projects = useMemo(() => tablero?.projects || [], [tablero]);

  const cargarDashboard = useCallback(() => { recargarTablero(); }, [recargarTablero]);

  useEffect(() => {
    let timeoutId = null;
    const handleScheduleChanged = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void cargarDashboard();
      }, 150);
    };

    window.addEventListener('crm:schedule-changed', handleScheduleChanged);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('crm:schedule-changed', handleScheduleChanged);
    };
  }, [cargarDashboard]);

  const openTaskProject = (task) => {
    const projectId = task?.proyecto?.id || task?.proyectoId || selectedProjectId;
    if (projectId) navigate(`/proyectos/${projectId}`);
  };

  const projectEntries = useMemo(() => (
    projects.map((project) => {
      const range = getProjectRange(project);
      return { project, start: range.start, end: range.end, origenFin: range.origenFin };
    })
  ), [projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const { proyectos, tareas, proyectosProgreso, actividadMiembros, actividadPorMes } = stats || {};

  // Las estadísticas del tablero traen la actividad de HOY. Solo sirven de
  // respaldo cuando el día elegido es hoy: para otro día, si la petición
  // falla, se muestra el error y no datos de otra fecha.
  const esHoyActividad = fechaActividad === claveDiaLocal();
  const miembrosActividad = actividadDia ?? (esHoyActividad ? actividadMiembros : null);
  const errorActividadVisible = !actividadDia && errorActividad && !(esHoyActividad && actividadMiembros)
    ? errorActividad
    : null;

  const globalDone = stats?.tareas?.estados?.find((estado) => estado.estado === 'HECHO')?._count || 0;
  const globalRemaining = Math.max((stats?.tareas?.total || 0) - globalDone, 0);
  // El esqueleto solo la primera vez: al volver ya hay datos en cache y se
  // pinta al instante mientras llega la version fresca.
  if (cargando && !stats) return <PageSkeleton cards={4} />;
  if (!stats) {
    return (
      <div style={{ padding: '4rem 1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <p style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t('dashboardConnectionError')}</p>
        {errorTablero?.message && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{errorTablero.message}</p>
        )}
        <Button onClick={() => recargarTablero()}>
          <RefreshCw size={15} /> {t('retry')}
        </Button>
      </div>
    );
  }

  // Indicadores del día elegido en la actividad (por defecto, hoy).
  const listaDia = miembrosActividad || [];
  const sumar = (campo) => listaDia.reduce((n, m) => n + (m[campo]?.length || 0), 0);
  const hechasDia = sumar('hechasHoy');
  const personasConEntrega = listaDia.filter((m) => m.hechasHoy?.length).length;
  const fechaCorta = capitalizar(new Date(`${fechaActividad}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }));

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            {capitalizar(new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }))}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">{t('dashboardAdminTitle')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{t('dashboardAdminSubtitle')}</p>
        </div>
        <Button variant="outline" className="h-9 self-start rounded-[8px] lg:self-auto" onClick={() => navigate('/proyectos')}>
          <FolderOpen size={15} /> {t('dashGoProjects')}
        </Button>
      </header>

      {/* Indicadores en texto plano, en una franja: cifra, qué es y un detalle */}
      <dl className="dash-cifras mb-6">
        <div>
          <dt><CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} /> {esHoyActividad ? t('dashKpiDoneToday') : t('dashKpiDoneOn', { fecha: fechaCorta })}</dt>
          <dd><strong>{hechasDia}</strong> <span>{t('dashKpiDoneSub', { n: personasConEntrega, total: listaDia.length })}</span></dd>
        </div>
        <div>
          <dt><IconoEnCurso size={14} style={{ color: 'var(--color-accent-blue)' }} /> {t('dashKpiDoing')}</dt>
          <dd><strong>{sumar('enProgreso')}</strong> <span>{t('dashKpiDoingShort')}</span></dd>
        </div>
        <div>
          <dt><CalendarClock size={14} style={{ color: 'var(--color-warning)' }} /> {t('dashKpiDueWeek')}</dt>
          <dd><strong>{sumar('faltanSemana')}</strong> <span>{t('dashKpiDueWeekSub', { n: sumar('faltanManana') })}</span></dd>
        </div>
        <div>
          <dt><IconProjects /> {t('dashboardProjects')}</dt>
          <dd>
            <button type="button" onClick={() => navigate('/proyectos')}><strong>{proyectos.total}</strong></button>
            {' '}<span>{t('dashKpiProjectsSub', { n: globalRemaining, total: tareas.total })}</span>
          </dd>
        </div>
      </dl>

      {/* Un solo panel con las cuatro vistas; actividad es la de arranque. */}
      <section className="dash-panel dash-panel-inicio mb-8">
        <div className="dash-panel-cabecera">
          <div role="tablist" aria-label={t('dashboardAdminTitle')} className="dash-pestanas">
            {VISTAS_PANEL.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={vistaPanel === v.id} onClick={() => setVistaPanel(v.id)}>
                <v.icono size={15} /> {t(v.labelKey)}
              </button>
            ))}
          </div>
          {vistaPanel === 'actividad' && <p className="text-[12.5px] text-[var(--color-text-muted)]">{t('dashboardTeamActivityDesc')}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {vistaPanel === 'actividad' && (
            <ActividadEquipo
              miembros={miembrosActividad || []}
              fecha={fechaActividad}
              onFechaChange={setFechaActividad}
              cargando={cargandoActividad && !miembrosActividad}
              error={errorActividadVisible}
              onReintentar={() => recargarActividad()}
              onOpenTask={openTaskProject}
                />
          )}

          {vistaPanel === 'gantt' && (
            <div className="flex h-full min-h-0 flex-col">
              <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.3rem' }}>{t('dashboardProjectGantt')}</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                {selectedProject ? t('dashboardFocusedView', { project: selectedProject.nombre }) : t('dashboardGlobalView')}
                  </p>
                </div>
                <Button
                  size="sm"
                onClick={() => navigate(selectedProject ? `/proyectos/${selectedProject.id}` : '/proyectos')}
                >
                {selectedProject ? t('dashboardOpenProject') : t('dashboardViewBoard')}
                </Button>
              </div>

              {/* El selector de proyecto vive dentro de ProjectTimeline, junto al
                  de escala. El gantt ya no se minimiza: siempre esta visible. */}
              <ProjectTimeline projectEntries={projectEntries} selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} />
            </div>
          )}

          {vistaPanel === 'progreso' && (
            <TablaProgresoProyectos proyectos={proyectosProgreso || []} onAbrirProyecto={(id) => navigate(`/proyectos/${id}`)} />
          )}

          {vistaPanel === 'mes' && <ActividadPorMes datos={actividadPorMes} />}
        </div>
      </section>
    </div>
  );
};

const DashboardPage = () => {
  const { usuario } = useAuth();
  return usuario?.rol === 'ADMIN' ? <DashboardAdmin /> : <InicioMiembro />;
};

export default DashboardPage;
