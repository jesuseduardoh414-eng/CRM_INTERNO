// Actividad del equipo (panel del administrador): qué hizo cada persona en un
// día, qué tiene en curso y qué le vence. Maestro-detalle: el equipo a la
// izquierda, la persona elegida a la derecha.
import { useRef, useState } from 'react';
import {
  CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, Download, FileSpreadsheet, FileText,
  Inbox, PlayCircle, RefreshCw, Search, Users,
} from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { statsService } from '../../services/api';
import { claveDiaLocal, fechaLocalDesdeISO } from '../../utils/fechasLocales';
import { useToast } from '../../context/ToastContext';
import { imprimirReporteDia } from '../../utils/reporteDia';
import { getPrioridadTarea } from '../../utils/estadosTarea';
import { fondoArea } from '../../utils/areas';
import UserAvatar from '../UserAvatar';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

// Las tres primeras miran un día concreto; "General" muestra todo lo acumulado.
const VISTAS_ACTIVIDAD = [
  { id: 'hechas', campo: 'hechasHoy', labelKey: 'dashboardViewDone', vacioKey: 'dashboardCompletedToday' },
  { id: 'manana', campo: 'faltanManana', labelKey: 'dashboardViewTomorrow', vacioKey: 'dashboardNoDueTomorrow' },
  { id: 'semana', campo: 'faltanSemana', labelKey: 'dashboardViewWeek', vacioKey: 'dashboardNoDueWeek' },
  { id: 'general', campo: null, labelKey: 'dashboardViewGeneral', vacioKey: null },
];

const ESTADOS = {
  HECHO: { icono: CheckCircle2, color: 'var(--color-success)' },
  EN_PROGRESO: { icono: PlayCircle, color: 'var(--color-accent-blue)' },
  PENDIENTE: { icono: CircleDashed, color: 'var(--color-text-muted)' },
};

const COLUMNAS_GENERAL = [
  { estado: 'PENDIENTE', labelKey: 'statusTodo', vacioKey: 'dashboardNoPending' },
  { estado: 'EN_PROGRESO', labelKey: 'statusInProgress', vacioKey: 'dashboardNoCurrent' },
  { estado: 'HECHO', labelKey: 'statusDone', vacioKey: 'dashboardNoDone' },
];

// Color estable por proyecto (punto junto al nombre). Tokens de index.css,
// los mismos que el gantt del inicio, para que sigan al tema claro/oscuro.
const COLORES_PROYECTO = [
  'var(--color-accent-blue)', 'var(--color-accent-green)', 'var(--color-accent-pink)', 'var(--color-accent-purple)',
  'var(--color-accent-amber)', 'var(--color-accent-success)', 'var(--color-gold)',
];
const colorProyecto = (proyecto) => {
  const semilla = String(proyecto?.id ?? proyecto?.nombre ?? '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return COLORES_PROYECTO[semilla % COLORES_PROYECTO.length];
};

const capitalizar = (texto = '') => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

/** Una tarea: estado, título, proyecto y la hora o fecha que importa en esa vista. */
const FilaTarea = ({ tarea, onOpen, mostrarHora, compacta = false }) => {
  const { t, locale } = usePreferences();
  const estado = ESTADOS[tarea.estado] || ESTADOS.PENDIENTE;
  const IconoEstado = estado.icono;
  const prioridad = getPrioridadTarea(tarea.prioridad);
  const hora = mostrarHora && tarea.completadoEn
    ? new Date(tarea.completadoEn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : null;
  // Vencimiento como día de calendario: con `new Date(iso)` podía salir el
  // día anterior o el siguiente según el huso horario.
  const vence = !hora && tarea.venceEn
    ? fechaLocalDesdeISO(tarea.venceEn)?.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) || null
    : null;

  return (
    <button type="button" onClick={() => onOpen?.(tarea)} className={`dash-tarea ${compacta ? 'dash-tarea-compacta' : ''}`}>
      <IconoEstado size={compacta ? 15 : 17} className="mt-0.5 shrink-0" style={{ color: estado.color }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium leading-snug text-[var(--color-text)]">
          {tarea.numeroActividad ? <span className="mr-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">#{tarea.numeroActividad}</span> : null}
          {tarea.titulo}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorProyecto(tarea.proyecto) }} aria-hidden="true" />
          <span className="truncate">{tarea.proyecto?.nombre || '—'}</span>
          {!compacta && tarea.prioridad === 'ALTA' && (
            <span className="shrink-0 rounded-full px-1.5 text-[11px] font-medium" style={{ color: prioridad.fg, background: prioridad.bg }}>
              {t(prioridad.labelKey)}
            </span>
          )}
        </span>
      </span>
      {(hora || vence) && (
        <span className="dash-tarea-hora">
          {hora ? <Clock size={11} /> : <CalendarClock size={11} />} {hora || vence}
        </span>
      )}
    </button>
  );
};

const Vacio = ({ icono: Icono = Inbox, texto }) => (
  <div className="flex flex-col items-center gap-3 px-6 pb-12 pt-16 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-muted)]"><Icono size={20} /></span>
    <p className="max-w-xs text-[13.5px] text-[var(--color-text-muted)]">{texto}</p>
  </div>
);

const ActividadEquipo = ({ miembros, onOpenTask, fecha, onFechaChange, cargando, error, onReintentar }) => {
  const { t, locale } = usePreferences();
  const { areas, nombreArea, colorArea, moduloActivo } = useConfiguracion();
  const [vista, setVista] = useState('hechas');
  const [busqueda, setBusqueda] = useState('');
  const [proyectoId, setProyectoId] = useState(null);
  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const reporteActivo = moduloActivo('reporteDiario');
  const { showToast } = useToast();
  const detalleRef = useRef(null);

  // En móvil el detalle queda debajo de la lista del equipo: al elegir a
  // alguien se baja hasta él, si no parecía que el toque no hacía nada.
  const elegirPersona = (id) => {
    setSeleccionadoId(id);
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  // La descarga puede fallar (sesión vencida, servidor caído): antes la
  // promesa quedaba sin atender y no se avisaba nada.
  const exportarExcel = async () => {
    try {
      await statsService.descargarReporteDia(fecha, proyectoId);
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  const hoy = claveDiaLocal();
  const esHoy = fecha === hoy;
  const vistaActual = VISTAS_ACTIVIDAD.find((v) => v.id === vista) || VISTAS_ACTIVIDAD[0];
  const esGeneral = vista === 'general';
  const lista = miembros || [];
  const fechaLegible = capitalizar(new Date(`${fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }));

  // El filtro de proyecto solo ofrece proyectos donde alguien tiene tareas.
  const proyectos = (() => {
    const mapa = new Map();
    lista.forEach((m) => (m.todasConFecha || []).forEach((tarea) => {
      if (tarea.proyecto?.id && !mapa.has(tarea.proyecto.id)) mapa.set(tarea.proyecto.id, tarea.proyecto.nombre);
    }));
    return [...mapa].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  })();
  const porProyecto = (tareas) => (proyectoId ? (tareas || []).filter((x) => x.proyecto?.id === proyectoId) : (tareas || []));

  const tareasDe = (m) => porProyecto(esGeneral ? m.todasConFecha : m[vistaActual.campo]);
  const contar = (m) => tareasDe(m).length;
  const termino = busqueda.trim().toLowerCase();

  // Quien tiene actividad primero; a igualdad, por nombre.
  const visibles = lista
    .filter((m) => !termino || String(m.nombre || '').toLowerCase().includes(termino))
    .map((m) => ({ m, total: contar(m) }))
    .sort((a, b) => b.total - a.total || String(a.m.nombre || '').localeCompare(String(b.m.nombre || ''), locale, { sensitivity: 'base' }))
    .map((fila) => fila.m);
  const maximo = Math.max(1, ...visibles.map(contar));

  const seleccionado = visibles.find((m) => m.id === seleccionadoId) || visibles.find((m) => contar(m) > 0) || visibles[0] || null;
  const tareasDetalle = seleccionado ? tareasDe(seleccionado) : [];

  // Reporte del día: lista completa (el buscador solo ubica), con el filtro de proyecto.
  const filasReporte = lista
    .map((m) => ({ miembro: m, hechas: porProyecto(m.hechasHoy), enProgreso: porProyecto(m.enProgreso) }))
    .filter((fila) => fila.hechas.length > 0)
    .sort((a, b) => b.hechas.length - a.hechas.length || String(a.miembro.nombre || '').localeCompare(String(b.miembro.nombre || ''), locale, { sensitivity: 'base' }));
  const puedeExportar = filasReporte.length > 0;
  const proyectoFiltrado = proyectos.find((p) => p.id === proyectoId) || null;

  const exportarPDF = () => imprimirReporteDia({
    locale,
    filas: filasReporte,
    textos: {
      titulo: t('reportDayTitle'),
      fechaLegible: capitalizar(new Date(`${fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      filtroProyecto: proyectoFiltrado ? t('reportDayFilterProject', { proyecto: proyectoFiltrado.nombre }) : '',
      tituloHechas: t('reportDayDone'),
      tituloEnCurso: t('reportDayInProgress'),
      conteoHechas: t('reportDayCountDone'),
      conteoEnCurso: t('reportDayCountInProgress'),
      vence: t('reportDayDue'),
      pie: t('reportDaySummary'),
      generado: t('reportDayGenerated'),
      vacio: t('dashboardExportEmpty'),
      areas: Object.fromEntries(areas.map((a) => [a.clave, a.nombre])),
    },
  });

  const moverDia = (dias) => {
    const d = new Date(`${fecha}T12:00:00`);
    d.setDate(d.getDate() + dias);
    onFechaChange(claveDiaLocal(d));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra: vista, día y exportar a un lado; búsqueda y proyecto al otro */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t('dashboardTeamActivity')} className="dash-segmento">
          {VISTAS_ACTIVIDAD.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} onClick={() => setVista(v.id)}>{t(v.labelKey)}</button>
          ))}
        </div>

        {!esGeneral && (
          <div className="flex items-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
            <button type="button" className="dash-icono" onClick={() => moverDia(-1)} aria-label={t('previous')} title={t('previous')}><ChevronLeft size={15} /></button>
            <label className="relative flex h-8 cursor-pointer items-center gap-2 px-2 text-[13px] font-medium text-[var(--color-text)]">
              <span className="tabular-nums">{esHoy ? t('dashboardToday') : fechaLegible}</span>
              <input
                type="date"
                value={fecha}
                max={hoy}
                aria-label={t('dashboardActivityDay')}
                onChange={(e) => e.target.value && onFechaChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <button type="button" className="dash-icono" onClick={() => moverDia(1)} disabled={esHoy} aria-label={t('next')} title={t('next')}><ChevronRight size={15} /></button>
            {!esHoy && <button type="button" className="h-8 rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-3)]" onClick={() => onFechaChange(hoy)}>{t('dashboardToday')}</button>}
          </div>
        )}

        {/* En móvil ocupa el ancho completo: buscador en su propia fila y el
            filtro de proyecto junto a exportar. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 basis-full sm:basis-auto">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t('dashboardSearchMember')}
              aria-label={t('dashboardSearchMember')}
              className="h-10 w-full rounded-[8px] sm:h-9 sm:w-[180px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-[13.5px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
          <Select value={proyectoId === null ? 'TODOS' : String(proyectoId)} onValueChange={(v) => setProyectoId(v === 'TODOS' ? null : Number(v))}>
            <SelectTrigger className="h-10 min-w-0 flex-1 rounded-[8px] text-[13.5px] font-normal sm:h-9 sm:w-[190px] sm:flex-none" aria-label={t('dashboardProjectFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1500] max-h-[320px]">
              <SelectItem value="TODOS" className="text-sm font-normal">{t('dashboardAllProjects')}</SelectItem>
              {proyectos.map((p) => <SelectItem key={p.id} value={String(p.id)} className="text-sm font-normal">{p.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          {reporteActivo && !esGeneral && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 rounded-[8px] sm:h-9" disabled={cargando || Boolean(error) || !puedeExportar} title={puedeExportar ? undefined : t('dashboardExportEmpty')}>
                  <Download size={15} /> {t('dashboardExport')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[1500] min-w-[200px]">
                <DropdownMenuItem className="gap-2 font-medium" onSelect={exportarPDF}><FileText size={14} /> {t('dashboardExportPdf')}</DropdownMenuItem>
                <DropdownMenuItem className="gap-2 font-medium" onSelect={exportarExcel}><FileSpreadsheet size={14} /> {t('dashboardExportExcel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {cargando && <p className="py-6 text-sm text-[var(--color-text-muted)]">{t('loading')}</p>}

      {!cargando && error && (
        <div className="alert-error" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{t('dashboardActivityError')} {error.message ? `(${error.message})` : ''}</span>
          <Button variant="outline" size="sm" onClick={onReintentar}><RefreshCw size={14} /> {t('retry')}</Button>
        </div>
      )}

      {!cargando && !error && (
        <div className="dash-maestro">
          {/* Equipo */}
          <div className="dash-equipo">
            <div className="dash-subcabecera">
              <span className="flex items-center gap-2"><Users size={14} /> {t('dashTeam')}</span>
              <span className="tabular-nums">{visibles.length}</span>
            </div>
            <div className="dash-equipo-lista min-h-0 flex-1 overflow-y-auto p-2">
              {visibles.length === 0 && <Vacio icono={Search} texto={t('dashboardNoMembers')} />}
              {visibles.map((m) => {
                const total = contar(m);
                const activo = seleccionado?.id === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => elegirPersona(m.id)} className="dash-persona" aria-current={activo || undefined}>
                    <UserAvatar usuario={m} size={34} radius={999} fontSize="0.72rem" color={colorArea(m.area)} background={fondoArea(colorArea(m.area), 0.12)} borderColor="transparent" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{m.nombre}</span>
                        <span className={`shrink-0 text-[13px] tabular-nums ${total ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>{total}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="truncate text-[11.5px] text-[var(--color-text-muted)]">{m.area ? nombreArea(m.area) : t('areaGeneral')}</span>
                        <span className="dash-barra" aria-hidden="true"><span style={{ width: `${(total / maximo) * 100}%`, background: colorArea(m.area) }} /></span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Persona elegida */}
          <div ref={detalleRef} className="dash-detalle">
            {!seleccionado ? (
              <Vacio icono={Users} texto={t('dashSelectPerson')} />
            ) : (
              <>
                <div className="dash-detalle-cabecera">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar usuario={seleccionado} size={44} radius={999} fontSize="0.85rem" color={colorArea(seleccionado.area)} background={fondoArea(colorArea(seleccionado.area), 0.12)} borderColor="transparent" />
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold text-[var(--color-text)]">{seleccionado.nombre}</p>
                      <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium" style={{ color: colorArea(seleccionado.area), background: fondoArea(colorArea(seleccionado.area), 0.12) }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorArea(seleccionado.area) }} />
                        {seleccionado.area ? nombreArea(seleccionado.area) : t('areaGeneral')}
                      </span>
                    </div>
                  </div>
                  <dl className="flex gap-1.5">
                    {[
                      ['dashDoneLabel', porProyecto(seleccionado.hechasHoy).length, 'var(--color-success)'],
                      ['dashDoingLabel', porProyecto(seleccionado.enProgreso).length, 'var(--color-accent-blue)'],
                      ['dashWeekLabel', porProyecto(seleccionado.faltanSemana).length, 'var(--color-warning)'],
                    ].map(([clave, n, color]) => (
                      <div key={clave} className="dash-mini">
                        <dd className="text-[18px] font-semibold tabular-nums leading-none" style={{ color: n ? color : 'var(--color-text-muted)' }}>{n}</dd>
                        <dt className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t(clave)}</dt>
                      </div>
                    ))}
                  </dl>
                </div>

                {esGeneral ? (
                  // Tres columnas segun el ancho del detalle, no de la pantalla
                  // (.dash-columnas): en una tableta con el menu lateral el
                  // detalle mide ~360px y tres columnas no se podian leer.
                  <div className="dash-columnas">
                    {COLUMNAS_GENERAL.map((col) => {
                      const deLaColumna = tareasDetalle.filter((x) => x.estado === col.estado);
                      const conf = ESTADOS[col.estado];
                      return (
                        <div key={col.estado} className="dash-columna">
                          <div className="flex items-center justify-between px-3 py-2.5 text-[12.5px] font-semibold" style={{ color: conf.color }}>
                            <span className="flex items-center gap-1.5"><conf.icono size={14} /> {t(col.labelKey)}</span>
                            <span className="tabular-nums">{deLaColumna.length}</span>
                          </div>
                          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                            {deLaColumna.length === 0
                              ? <p className="px-2 py-4 text-center text-[12.5px] text-[var(--color-text-muted)]">{t(col.vacioKey)}</p>
                              : deLaColumna.map((tarea) => <FilaTarea key={tarea.id} tarea={tarea} onOpen={onOpenTask} mostrarHora={col.estado === 'HECHO'} compacta />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : tareasDetalle.length === 0 ? (
                  <Vacio icono={vista === 'hechas' ? CheckCircle2 : CalendarClock} texto={t(vistaActual.vacioKey)} />
                ) : (
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                    {tareasDetalle.map((tarea) => <FilaTarea key={tarea.id} tarea={tarea} onOpen={onOpenTask} mostrarHora={vista === 'hechas'} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ActividadEquipo;
