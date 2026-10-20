// Página de Reportes (solo administradores). Un panel con cuatro vistas:
// el reporte del día, el rendimiento por persona en un periodo, el avance de
// los proyectos y el resumen por cliente. Cada vista exporta a Excel (y el
// reporte del día también a PDF).
import { useState } from 'react';
import useSWR from 'swr';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowDownUp, ArrowUp, BarChart3, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  Clock, Download, FileSpreadsheet, FileSignature, FileText, FolderKanban, Inbox, PlayCircle, RefreshCw, Target, Users,
} from 'lucide-react';
import { reportesService, statsService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useToast } from '../context/ToastContext';
import { useTextoReportes } from '../hooks/useTextoReportes';
import UserAvatar from '../components/UserAvatar';
import TablaProgresoProyectos from '../components/dashboard/TablaProgresoProyectos';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { claveDiaLocal, fechaDesdeClave } from '../utils/fechasLocales';
import { imprimirReporteDia } from '../utils/reporteDia';
import { fondoArea } from '../utils/areas';
import { puede } from '../utils/permisos';
import { formatearMonto } from '../utils/contratos';

const capitalizar = (texto = '') => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

// Mismo cálculo y mismos tokens de color por proyecto que la actividad del inicio.
const COLORES_PROYECTO = [
  'var(--color-accent-blue)', 'var(--color-accent-green)', 'var(--color-accent-pink)', 'var(--color-accent-purple)',
  'var(--color-accent-amber)', 'var(--color-accent-success)', 'var(--color-gold)',
];
const colorProyecto = (proyecto) => {
  const semilla = String(proyecto?.id ?? proyecto?.nombre ?? '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return COLORES_PROYECTO[semilla % COLORES_PROYECTO.length];
};

// Color del % a tiempo / avance: verde, ámbar o rojo según qué tan bien va.
const tonoPorcentaje = (pct) => {
  if (pct === null || pct === undefined) return 'var(--color-text-muted)';
  if (pct >= 85) return 'var(--color-success)';
  if (pct >= 60) return 'var(--color-warning)';
  return 'var(--color-error)';
};

// ── Rangos de fecha ─────────────────────────────────────────────────────────
// Siempre a mediodía local para que ningún cambio de huso mueva el día.
const PRESETS = [
  { id: 'semana', claveTexto: 'presetSemana' },
  { id: 'mes', claveTexto: 'presetMes' },
  { id: '30', claveTexto: 'preset30' },
  { id: 'mesPasado', claveTexto: 'presetMesPasado' },
];

const rangoPreset = (id) => {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
  const anio = d.getFullYear();
  const mes = d.getMonth();
  if (id === 'semana') {
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { desde: claveDiaLocal(lunes), hasta: claveDiaLocal(d) };
  }
  if (id === '30') {
    const inicio = new Date(d);
    inicio.setDate(d.getDate() - 29);
    return { desde: claveDiaLocal(inicio), hasta: claveDiaLocal(d) };
  }
  if (id === 'mesPasado') {
    return { desde: claveDiaLocal(new Date(anio, mes - 1, 1, 12)), hasta: claveDiaLocal(new Date(anio, mes, 0, 12)) };
  }
  return { desde: claveDiaLocal(new Date(anio, mes, 1, 12)), hasta: claveDiaLocal(d) };
};

// ── Orden de tablas ─────────────────────────────────────────────────────────
// Los vacíos (null) siempre al final, ordene como ordene.
const useOrden = (inicial) => {
  const [orden, setOrden] = useState(inicial);
  const alternar = (campo, numerico) => setOrden((actual) => (
    actual.campo === campo
      ? { campo, dir: actual.dir === 'asc' ? 'desc' : 'asc' }
      : { campo, dir: numerico ? 'desc' : 'asc' }
  ));
  const ordenar = (filas, locale) => [...filas].sort((a, b) => {
    const va = a[orden.campo];
    const vb = b[orden.campo];
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    const comp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), locale, { sensitivity: 'base' });
    return orden.dir === 'asc' ? comp : -comp;
  });
  // Elegir columna desde el selector del móvil: los números de mayor a menor.
  const elegir = (campo, numerico) => setOrden((actual) => (
    actual.campo === campo ? actual : { campo, dir: numerico ? 'desc' : 'asc' }
  ));
  const invertir = () => setOrden((actual) => ({ ...actual, dir: actual.dir === 'asc' ? 'desc' : 'asc' }));
  return { orden, alternar, elegir, invertir, ordenar };
};

/**
 * Orden de la vista en tarjetas (móvil): en vez de cabeceras de tabla, un
 * selector "Ordenar por" y un botón que invierte el sentido. Mismo estado que
 * las cabeceras de la tabla de escritorio.
 * `columnas`: [{ campo, etiqueta, numerico }].
 */
const OrdenMovil = ({ columnas, orden, onElegir, onInvertir }) => {
  const tr = useTextoReportes();
  const Flecha = orden.dir === 'asc' ? ArrowUp : ArrowDown;
  const textoDir = orden.dir === 'asc' ? tr('ordenAsc') : tr('ordenDesc');
  return (
    <div className="rep-orden-movil">
      <ArrowDownUp size={15} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      <Select
        value={orden.campo}
        onValueChange={(campo) => onElegir(campo, Boolean(columnas.find((c) => c.campo === campo)?.numerico))}
      >
        <SelectTrigger className="h-10 min-w-0 flex-1 rounded-[8px] text-[13.5px] font-normal" aria-label={tr('ordenarPorEtiqueta')}>
          <span className="mr-1 shrink-0 text-[var(--color-text-muted)]">{tr('ordenarPorEtiqueta')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[1500] max-h-[320px]">
          {columnas.map((c) => <SelectItem key={c.campo} value={c.campo} className="text-sm font-normal">{c.etiqueta}</SelectItem>)}
        </SelectContent>
      </Select>
      <button type="button" className="rep-orden-dir" onClick={onInvertir} aria-label={textoDir} title={textoDir}>
        <Flecha size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

// Cifra pequeña de una tarjeta: etiqueta arriba, número abajo.
const Dato = ({ etiqueta, children }) => (
  <div>
    <dt>{etiqueta}</dt>
    <dd>{children}</dd>
  </div>
);

const Encabezado = ({ campo, children, numerico = false, orden, onOrdenar, className = '' }) => {
  const tr = useTextoReportes();
  const activo = orden.campo === campo;
  const Flecha = orden.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`${numerico ? 'rep-num' : ''} ${className}`} aria-sort={activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="rep-orden" data-activo={activo || undefined} onClick={() => onOrdenar(campo, numerico)} title={tr('ordenarPor', { col: children })}>
        {children}
        <Flecha size={11} className={activo ? '' : 'opacity-0'} aria-hidden="true" />
      </button>
    </th>
  );
};

// Barrita con el porcentaje al lado (para % a tiempo y avance).
const Medidor = ({ pct }) => (
  <span className="rep-medidor">
    <span className="rep-barra" aria-hidden="true">
      <span style={{ width: `${pct ?? 0}%`, background: tonoPorcentaje(pct) }} />
    </span>
    <span className="w-9 text-right tabular-nums" style={{ color: pct === null || pct === undefined ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
      {pct === null || pct === undefined ? '—' : `${pct}%`}
    </span>
  </span>
);

// Número de tabla: los ceros en gris para que resalte lo que sí hay.
const Num = ({ valor, alerta = false }) => (
  <span className={valor ? (alerta ? 'font-semibold' : '') : 'text-[var(--color-text-muted)]'} style={valor && alerta ? { color: 'var(--color-error)' } : undefined}>
    {valor ?? 0}
  </span>
);

const Vacio = ({ icono: Icono = Inbox, texto }) => (
  <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-muted)]"><Icono size={19} /></span>
    <p className="max-w-xs text-[13.5px] text-[var(--color-text-muted)]">{texto}</p>
  </div>
);

const ErrorCarga = ({ error, onReintentar }) => {
  const { t } = usePreferences();
  const tr = useTextoReportes();
  return (
    <div className="alert-error" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>{tr('errorCarga')} {error?.message ? `(${error.message})` : ''}</span>
      <Button variant="outline" size="sm" onClick={onReintentar}><RefreshCw size={14} /> {t('retry')}</Button>
    </div>
  );
};

const Cargando = () => {
  const { t } = usePreferences();
  return <p className="py-6 text-sm text-[var(--color-text-muted)]">{t('loading')}</p>;
};

// Botón de exportar con su estado: deshabilitado mientras descarga.
const BotonExcel = ({ onExportar, disabled }) => {
  const tr = useTextoReportes();
  const { showToast } = useToast();
  const [exportando, setExportando] = useState(false);
  const exportar = async () => {
    setExportando(true);
    try {
      await onExportar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExportando(false);
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-10 rounded-[8px] sm:h-9" onClick={exportar} disabled={disabled || exportando}>
      <FileSpreadsheet size={15} /> {exportando ? tr('exportando') : tr('exportarExcel')}
    </Button>
  );
};

// ── 1. Reporte diario ───────────────────────────────────────────────────────
const ReporteDiario = () => {
  const { t, locale } = usePreferences();
  const tr = useTextoReportes();
  const { areas, nombreArea, colorArea } = useConfiguracion();
  const { showToast } = useToast();
  const [fecha, setFecha] = useState(() => claveDiaLocal());
  const [proyectoId, setProyectoId] = useState(null);

  // Misma clave que la actividad del inicio: comparten caché.
  const { data, error, isLoading, mutate } = useSWR(
    ['actividad-equipo', fecha],
    async ([, dia]) => statsService.actividadEquipo(dia),
    { keepPreviousData: false },
  );
  const lista = data?.miembros || [];

  const hoy = claveDiaLocal();
  const esHoy = fecha === hoy;
  const fechaLegible = capitalizar(new Date(`${fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }));

  const moverDia = (dias) => {
    const d = new Date(`${fecha}T12:00:00`);
    d.setDate(d.getDate() + dias);
    setFecha(claveDiaLocal(d));
  };

  // El filtro solo ofrece proyectos donde alguien cerró o tiene algo en curso.
  const proyectos = (() => {
    const mapa = new Map();
    lista.forEach((m) => [...(m.hechasHoy || []), ...(m.enProgreso || [])].forEach((tarea) => {
      if (tarea.proyecto?.id && !mapa.has(tarea.proyecto.id)) mapa.set(tarea.proyecto.id, tarea.proyecto.nombre);
    }));
    return [...mapa].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  })();
  const porProyecto = (tareas) => (proyectoId ? (tareas || []).filter((x) => x.proyecto?.id === proyectoId) : (tareas || []));
  const proyectoFiltrado = proyectos.find((p) => p.id === proyectoId) || null;

  // Mismo recorte que el PDF: quien cerró al menos una tarea, el que más primero.
  const filas = lista
    .map((m) => ({ miembro: m, hechas: porProyecto(m.hechasHoy), enProgreso: porProyecto(m.enProgreso) }))
    .filter((fila) => fila.hechas.length > 0)
    .sort((a, b) => b.hechas.length - a.hechas.length || String(a.miembro.nombre || '').localeCompare(String(b.miembro.nombre || ''), locale, { sensitivity: 'base' }));

  const totalHechas = filas.reduce((n, f) => n + f.hechas.length, 0);
  const totalEnCurso = filas.reduce((n, f) => n + f.enProgreso.length, 0);
  const proyectosConEntrega = new Set(filas.flatMap((f) => f.hechas.map((x) => x.proyecto?.id).filter(Boolean))).size;
  const puedeExportar = filas.length > 0 && !error;

  const exportarPDF = () => imprimirReporteDia({
    locale,
    filas,
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

  const exportarExcel = async () => {
    try {
      await statsService.descargarReporteDia(fecha, proyectoId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          <button type="button" className="dash-icono" onClick={() => moverDia(-1)} aria-label={t('previous')} title={t('previous')}><ChevronLeft size={15} /></button>
          <label className="relative flex h-8 cursor-pointer items-center gap-2 px-2 text-[13px] font-medium text-[var(--color-text)]">
            <CalendarDays size={14} className="text-[var(--color-text-muted)]" />
            <span className="tabular-nums">{esHoy ? t('dashboardToday') : fechaLegible}</span>
            <input
              type="date"
              value={fecha}
              max={hoy}
              aria-label={t('dashboardActivityDay')}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button type="button" className="dash-icono" onClick={() => moverDia(1)} disabled={esHoy} aria-label={t('next')} title={t('next')}><ChevronRight size={15} /></button>
          {!esHoy && <button type="button" className="h-8 rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-3)]" onClick={() => setFecha(hoy)}>{t('dashboardToday')}</button>}
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Select value={proyectoId === null ? 'TODOS' : String(proyectoId)} onValueChange={(v) => setProyectoId(v === 'TODOS' ? null : Number(v))}>
            <SelectTrigger className="h-10 min-w-0 flex-1 rounded-[8px] text-[13.5px] font-normal sm:h-9 sm:w-[200px] sm:flex-none" aria-label={t('dashboardProjectFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1500] max-h-[320px]">
              <SelectItem value="TODOS" className="text-sm font-normal">{t('dashboardAllProjects')}</SelectItem>
              {proyectos.map((p) => <SelectItem key={p.id} value={String(p.id)} className="text-sm font-normal">{p.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 rounded-[8px] sm:h-9" disabled={isLoading || !puedeExportar} title={puedeExportar ? undefined : t('dashboardExportEmpty')}>
                <Download size={15} /> {t('dashboardExport')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[1500] min-w-[200px]">
              <DropdownMenuItem className="gap-2 font-medium" onSelect={exportarPDF}><FileText size={14} /> {t('dashboardExportPdf')}</DropdownMenuItem>
              <DropdownMenuItem className="gap-2 font-medium" onSelect={exportarExcel}><FileSpreadsheet size={14} /> {t('dashboardExportExcel')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoading && <Cargando />}
      {!isLoading && error && <ErrorCarga error={error} onReintentar={() => mutate()} />}

      {!isLoading && !error && (
        <>
          <dl className="dash-cifras rep-cifras mb-5">
            <div>
              <dt><CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} /> {tr('diaHechas')}</dt>
              <dd><strong>{totalHechas}</strong> <span>{tr('diaHechasSub', { n: filas.length, total: lista.length })}</span></dd>
            </div>
            <div>
              <dt><PlayCircle size={14} style={{ color: 'var(--color-accent-blue)' }} /> {tr('diaEnCurso')}</dt>
              <dd><strong>{totalEnCurso}</strong> <span>{tr('diaEnCursoSub')}</span></dd>
            </div>
            <div>
              <dt><FolderKanban size={14} /> {tr('diaProyectos')}</dt>
              <dd><strong>{proyectosConEntrega}</strong> <span>{tr('diaProyectosSub')}</span></dd>
            </div>
          </dl>

          {filas.length === 0 ? (
            <Vacio icono={CheckCircle2} texto={proyectoId ? tr('diaVacioProyecto') : tr('diaVacio')} />
          ) : (
            <div className="rep-lista">
              {filas.map(({ miembro, hechas, enProgreso }) => (
                <div key={miembro.id} className="rep-dia-fila">
                  <div className="flex min-w-0 items-start gap-3">
                    <UserAvatar usuario={miembro} size={32} radius={999} fontSize="0.7rem" color={colorArea(miembro.area)} background={fondoArea(colorArea(miembro.area), 0.12)} borderColor="transparent" />
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{miembro.nombre}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-muted)]">
                        {miembro.area ? nombreArea(miembro.area) : t('areaGeneral')}
                        {enProgreso.length > 0 && <> · {tr('diaEnCursoPersona', { n: enProgreso.length })}</>}
                      </p>
                    </div>
                    <span className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-[var(--color-text)]">{hechas.length}</span>
                  </div>
                  <ul className="min-w-0 space-y-1">
                    {hechas.map((tarea) => (
                      <li key={tarea.id} className="rep-dia-tarea">
                        <CheckCircle2 size={14} className="mt-[3px] shrink-0" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="text-[13px] text-[var(--color-text)]">
                            {tarea.numeroActividad ? <span className="mr-1.5 tabular-nums text-[var(--color-text-muted)]">#{tarea.numeroActividad}</span> : null}
                            {tarea.titulo}
                          </span>
                          <span className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorProyecto(tarea.proyecto) }} aria-hidden="true" />
                            {tarea.proyecto?.nombre || '—'}
                          </span>
                        </span>
                        {tarea.completadoEn && (
                          <span className="flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-[var(--color-text-muted)]">
                            <Clock size={11} /> {new Date(tarea.completadoEn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── 2. Por persona ──────────────────────────────────────────────────────────
const COLUMNAS_PERSONAS = [
  { campo: 'hechas', clave: 'colHechas' },
  { campo: 'aTiempo', clave: 'colATiempo' },
  { campo: 'tarde', clave: 'colTarde' },
  { campo: 'cumplimiento', clave: 'colCumplimiento', medidor: true },
  { campo: 'enCurso', clave: 'colEnCurso' },
  { campo: 'pendientes', clave: 'colPendientes' },
  { campo: 'vencidas', clave: 'colVencidas', alerta: true },
];

const ReportePersonas = () => {
  const { t, locale } = usePreferences();
  const tr = useTextoReportes();
  const { nombreArea, colorArea } = useConfiguracion();
  const [rango, setRango] = useState(() => rangoPreset('mes'));
  const { orden, alternar, elegir, invertir, ordenar } = useOrden({ campo: 'hechas', dir: 'desc' });
  const rangoValido = Boolean(rango.desde && rango.hasta) && rango.desde <= rango.hasta;
  const hoy = claveDiaLocal();

  const { data, error, isLoading, mutate } = useSWR(
    rangoValido ? ['reporte-personas', rango.desde, rango.hasta] : null,
    ([, desde, hasta]) => reportesService.personas({ desde, hasta }),
    { keepPreviousData: true },
  );

  const presetActivo = PRESETS.find((p) => {
    const r = rangoPreset(p.id);
    return r.desde === rango.desde && r.hasta === rango.hasta;
  })?.id;

  const fechaCorta = (clave) => fechaDesdeClave(clave)?.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) || clave;
  const personas = ordenar(
    (data?.personas || []).map((p) => ({ ...p, areaNombre: p.area ? nombreArea(p.area) : t('areaGeneral') })),
    locale,
  );
  const totales = data?.totales;
  const columnasOrden = [
    { campo: 'nombre', etiqueta: tr('colPersona') },
    { campo: 'areaNombre', etiqueta: tr('colArea') },
    ...COLUMNAS_PERSONAS.map((c) => ({ campo: c.campo, etiqueta: tr(c.clave), numerico: true })),
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={tr('vistaPersonas')} className="dash-segmento">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={presetActivo === p.id} onClick={() => setRango(rangoPreset(p.id))}>{tr(p.claveTexto)}</button>
          ))}
        </div>
        {/* En móvil las dos fechas van a lo ancho, cada una en su fila: lado a
            lado no cabían en 360px. `min`/`max` cruzados para que el
            calendario nativo no deje elegir un rango al revés. */}
        <div className="rep-fechas">
          <label className="rep-fecha">
            <span>{tr('desde')}</span>
            <input type="date" value={rango.desde} max={rango.hasta || hoy} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
          </label>
          <label className="rep-fecha">
            <span>{tr('hasta')}</span>
            <input type="date" value={rango.hasta} min={rango.desde || undefined} max={hoy} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
          </label>
        </div>
        <div className="sm:ml-auto">
          <BotonExcel onExportar={() => reportesService.descargarPersonas(rango)} disabled={!rangoValido || !personas.length} />
        </div>
      </div>

      {!rangoValido && <p className="alert-error">{tr('rangoInvalido')}</p>}
      {rangoValido && isLoading && !data && <Cargando />}
      {rangoValido && error && !data && <ErrorCarga error={error} onReintentar={() => mutate()} />}

      {rangoValido && data && (
        <>
          <dl className="dash-cifras rep-cifras mb-5">
            <div>
              <dt><CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} /> {tr('resHechas')}</dt>
              <dd><strong>{totales?.hechas ?? 0}</strong> <span>{tr('resHechasSub', { desde: fechaCorta(data.desde), hasta: fechaCorta(data.hasta) })}</span></dd>
            </div>
            <div>
              <dt><Target size={14} style={{ color: tonoPorcentaje(totales?.cumplimiento) }} /> {tr('resATiempo')}</dt>
              <dd><strong>{totales?.cumplimiento === null || totales?.cumplimiento === undefined ? '—' : `${totales.cumplimiento}%`}</strong> <span>{tr('resATiempoSub', { n: totales?.tarde ?? 0 })}</span></dd>
            </div>
            <div>
              <dt><CircleAlert size={14} style={{ color: 'var(--color-error)' }} /> {tr('resVencidas')}</dt>
              <dd><strong>{totales?.vencidas ?? 0}</strong> <span>{tr('resVencidasSub', { n: totales?.enCurso ?? 0, p: totales?.pendientes ?? 0 })}</span></dd>
            </div>
          </dl>

          {personas.length === 0 ? (
            <Vacio icono={Users} texto={tr('personasVacio')} />
          ) : (
            <>
            {/* Móvil: tarjetas con lo principal (hechas, % a tiempo, carga y
                vencidas) y un selector para ordenar. La tabla queda para escritorio. */}
            <div className="rep-solo-movil" aria-busy={isLoading || undefined}>
              <OrdenMovil columnas={columnasOrden} orden={orden} onElegir={elegir} onInvertir={invertir} />
              <ul className="rep-tarjetas">
                {personas.map((p) => (
                  <li key={p.id} className="rep-tarjeta">
                    <div className="rep-tarjeta-cab">
                      <UserAvatar usuario={p} size={32} radius={999} fontSize="0.7rem" color={colorArea(p.area)} background={fondoArea(colorArea(p.area), 0.12)} borderColor="transparent" />
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-[var(--color-text)]">{p.nombre}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-[var(--color-text-dim)]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorArea(p.area) }} aria-hidden="true" />
                          {p.areaNombre}
                        </p>
                      </div>
                    </div>
                    <dl className="rep-tarjeta-datos">
                      <Dato etiqueta={tr('colHechas')}><Num valor={p.hechas} /></Dato>
                      <Dato etiqueta={tr('colEnCurso')}><Num valor={p.enCurso} /></Dato>
                      <Dato etiqueta={tr('colPendientes')}><Num valor={p.pendientes} /></Dato>
                      <Dato etiqueta={tr('colVencidas')}><Num valor={p.vencidas} alerta /></Dato>
                    </dl>
                    <div className="rep-tarjeta-medidor">
                      <span>{tr('colCumplimiento')}</span>
                      <Medidor pct={p.cumplimiento} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rep-tabla-envoltura rep-solo-escritorio" aria-busy={isLoading || undefined}>
              <table className="rep-tabla">
                <thead>
                  <tr>
                    <Encabezado campo="nombre" orden={orden} onOrdenar={alternar}>{tr('colPersona')}</Encabezado>
                    <Encabezado campo="areaNombre" orden={orden} onOrdenar={alternar}>{tr('colArea')}</Encabezado>
                    {COLUMNAS_PERSONAS.map((c) => (
                      <Encabezado key={c.campo} campo={c.campo} numerico orden={orden} onOrdenar={alternar}>{tr(c.clave)}</Encabezado>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="flex min-w-[140px] items-center gap-2.5 sm:min-w-[180px]">
                          <UserAvatar usuario={p} size={28} radius={999} fontSize="0.65rem" color={colorArea(p.area)} background={fondoArea(colorArea(p.area), 0.12)} borderColor="transparent" />
                          <span className="truncate font-medium">{p.nombre}</span>
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-[var(--color-text-dim)]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorArea(p.area) }} aria-hidden="true" />
                          {p.areaNombre}
                        </span>
                      </td>
                      {COLUMNAS_PERSONAS.map((c) => (
                        <td key={c.campo} className="rep-num">
                          {c.medidor ? <Medidor pct={p[c.campo]} /> : <Num valor={p[c.campo]} alerta={c.alerta} />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totales && (
                  <tfoot>
                    <tr>
                      <td colSpan={2}>{tr('total')}</td>
                      {COLUMNAS_PERSONAS.map((c) => (
                        <td key={c.campo} className="rep-num">
                          {c.medidor ? <Medidor pct={totales[c.campo]} /> : <Num valor={totales[c.campo]} alerta={c.alerta} />}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// ── 3. Por proyecto ─────────────────────────────────────────────────────────
const ReporteProyectos = () => {
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useSWR('reportes-admin-stats', () => statsService.getAdminStats());
  if (isLoading && !data) return <Cargando />;
  if (error && !data) return <ErrorCarga error={error} onReintentar={() => mutate()} />;
  return <TablaProgresoProyectos proyectos={data?.proyectosProgreso || []} onAbrirProyecto={(id) => navigate(`/proyectos/${id}`)} />;
};

// ── 4. Por cliente ──────────────────────────────────────────────────────────
const ReporteClientes = () => {
  const { locale } = usePreferences();
  const tr = useTextoReportes();
  const { orden, alternar, elegir, invertir, ordenar } = useOrden({ campo: 'proyectosActivos', dir: 'desc' });
  const { data, error, isLoading, mutate } = useSWR('reporte-clientes', () => reportesService.clientes());

  const montos = (porMoneda) => Object.entries(porMoneda || {})
    .filter(([, monto]) => monto > 0)
    .map(([moneda, monto]) => formatearMonto(monto, moneda, locale));

  const clientes = ordenar(data?.clientes || [], locale);
  const conActivos = clientes.filter((c) => c.proyectosActivos > 0).length;
  const totalContratos = clientes.reduce((n, c) => n + (c.contratosVigentes || 0), 0);
  const montosTotales = clientes.reduce((acc, c) => {
    Object.entries(c.montosVigentes || {}).forEach(([moneda, monto]) => { acc[moneda] = (acc[moneda] || 0) + monto; });
    return acc;
  }, {});
  const textoMontosTotales = montos(montosTotales);
  const textoEstado = (estado) => ({ ACTIVO: tr('estadoACTIVO'), INACTIVO: tr('estadoINACTIVO') })[estado] || estado;
  const columnasOrden = [
    { campo: 'nombre', etiqueta: tr('colCliente') },
    { campo: 'estado', etiqueta: tr('colEstado') },
    { campo: 'proyectosActivos', etiqueta: tr('colProyectos'), numerico: true },
    { campo: 'tareas', etiqueta: tr('colTareas'), numerico: true },
    { campo: 'tareasVencidas', etiqueta: tr('colVencidas'), numerico: true },
    { campo: 'avance', etiqueta: tr('colAvance'), numerico: true },
    { campo: 'contratosVigentes', etiqueta: tr('colContratos'), numerico: true },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
        <BotonExcel onExportar={() => reportesService.descargarClientes()} disabled={!clientes.length} />
      </div>

      {isLoading && !data && <Cargando />}
      {error && !data && <ErrorCarga error={error} onReintentar={() => mutate()} />}

      {data && (
        <>
          <dl className="dash-cifras rep-cifras mb-5">
            <div>
              <dt><Building2 size={14} /> {tr('resClientes')}</dt>
              <dd><strong>{clientes.length}</strong> <span>{tr('resClientesSub', { n: conActivos })}</span></dd>
            </div>
            <div>
              <dt><FileSignature size={14} /> {tr('resContratos')}</dt>
              <dd><strong>{totalContratos}</strong></dd>
            </div>
            <div>
              <dt><BarChart3 size={14} /> {tr('resMontos')}</dt>
              <dd>
                {textoMontosTotales.length
                  ? textoMontosTotales.map((m) => <strong key={m}>{m}</strong>)
                  : <strong>—</strong>}
              </dd>
            </div>
          </dl>

          {clientes.length === 0 ? (
            <Vacio icono={Building2} texto={tr('clientesVacio')} />
          ) : (
            <>
            {/* Móvil: una tarjeta por cliente con proyectos, tareas, vencidas,
                contratos y el avance; el monto vigente debajo si lo hay. */}
            <div className="rep-solo-movil">
              <OrdenMovil columnas={columnasOrden} orden={orden} onElegir={elegir} onInvertir={invertir} />
              <ul className="rep-tarjetas">
                {clientes.map((c) => {
                  const textoMontos = montos(c.montosVigentes);
                  const activo = c.estado !== 'INACTIVO';
                  return (
                    <li key={c.id} className="rep-tarjeta">
                      <div className="rep-tarjeta-cab">
                        <div className="min-w-0 flex-1">
                          <Link to={`/clientes/${c.id}`} className="rep-enlace block truncate text-[14px]">{c.nombre}</Link>
                          {c.razonSocial && c.razonSocial !== c.nombre && (
                            <span className="mt-0.5 block truncate text-[11.5px] text-[var(--color-text-muted)]">{c.razonSocial}</span>
                          )}
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--color-text-dim)]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: activo ? 'var(--color-success)' : 'var(--color-text-muted)' }} aria-hidden="true" />
                          {textoEstado(c.estado)}
                        </span>
                      </div>
                      <dl className="rep-tarjeta-datos">
                        <Dato etiqueta={tr('colProyectos')}>
                          <Num valor={c.proyectos} />
                          {c.proyectosActivos > 0 && <span className="ml-1 text-[11px] font-normal text-[var(--color-text-muted)]">{tr('proyectosActivos', { n: c.proyectosActivos })}</span>}
                        </Dato>
                        <Dato etiqueta={tr('colTareas')}>
                          {c.tareas ? <>{c.tareasHechas}<span className="font-normal text-[var(--color-text-muted)]"> / {c.tareas}</span></> : <Num valor={0} />}
                        </Dato>
                        <Dato etiqueta={tr('colVencidas')}><Num valor={c.tareasVencidas} alerta /></Dato>
                        <Dato etiqueta={tr('colContratos')}><Num valor={c.contratosVigentes} /></Dato>
                      </dl>
                      <div className="rep-tarjeta-medidor">
                        <span>{tr('colAvance')}</span>
                        <Medidor pct={c.avance} />
                      </div>
                      {textoMontos.length > 0 && (
                        <p className="rep-tarjeta-montos">
                          <span>{tr('colMontos')}</span>
                          <b>{textoMontos.join(' · ')}</b>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rep-tabla-envoltura rep-solo-escritorio">
              <table className="rep-tabla">
                <thead>
                  <tr>
                    <Encabezado campo="nombre" orden={orden} onOrdenar={alternar}>{tr('colCliente')}</Encabezado>
                    <Encabezado campo="estado" orden={orden} onOrdenar={alternar}>{tr('colEstado')}</Encabezado>
                    <Encabezado campo="proyectosActivos" numerico orden={orden} onOrdenar={alternar}>{tr('colProyectos')}</Encabezado>
                    <Encabezado campo="tareas" numerico orden={orden} onOrdenar={alternar}>{tr('colTareas')}</Encabezado>
                    <Encabezado campo="tareasVencidas" numerico orden={orden} onOrdenar={alternar}>{tr('colVencidas')}</Encabezado>
                    <Encabezado campo="avance" numerico orden={orden} onOrdenar={alternar}>{tr('colAvance')}</Encabezado>
                    <Encabezado campo="contratosVigentes" numerico orden={orden} onOrdenar={alternar}>{tr('colContratos')}</Encabezado>
                    <th className="rep-num">{tr('colMontos')}</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => {
                    const textoMontos = montos(c.montosVigentes);
                    const activo = c.estado !== 'INACTIVO';
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/clientes/${c.id}`} className="rep-enlace">{c.nombre}</Link>
                          {c.razonSocial && c.razonSocial !== c.nombre && (
                            <span className="mt-0.5 block max-w-[280px] truncate text-[11.5px] text-[var(--color-text-muted)]">{c.razonSocial}</span>
                          )}
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-[var(--color-text-dim)]">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: activo ? 'var(--color-success)' : 'var(--color-text-muted)' }} aria-hidden="true" />
                            {textoEstado(c.estado)}
                          </span>
                        </td>
                        <td className="rep-num">
                          <Num valor={c.proyectos} />
                          {c.proyectosActivos > 0 && <span className="ml-1.5 text-[11.5px] text-[var(--color-text-muted)]">{tr('proyectosActivos', { n: c.proyectosActivos })}</span>}
                        </td>
                        <td className="rep-num">
                          {c.tareas ? <>{c.tareasHechas}<span className="text-[var(--color-text-muted)]"> / {c.tareas}</span></> : <Num valor={0} />}
                        </td>
                        <td className="rep-num"><Num valor={c.tareasVencidas} alerta /></td>
                        <td className="rep-num"><Medidor pct={c.avance} /></td>
                        <td className="rep-num"><Num valor={c.contratosVigentes} /></td>
                        <td className="rep-num">
                          {textoMontos.length
                            ? textoMontos.map((m) => <span key={m} className="block">{m}</span>)
                            : <span className="text-[var(--color-text-muted)]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// ── Página ──────────────────────────────────────────────────────────────────
const VISTAS = [
  { id: 'diario', icono: CalendarDays, claveTexto: 'vistaDiario', claveDesc: 'descDiario', modulo: 'reporteDiario', Componente: ReporteDiario },
  { id: 'personas', icono: Users, claveTexto: 'vistaPersonas', claveDesc: 'descPersonas', Componente: ReportePersonas },
  { id: 'proyectos', icono: FolderKanban, claveTexto: 'vistaProyectos', claveDesc: 'descProyectos', Componente: ReporteProyectos },
  { id: 'clientes', icono: Building2, claveTexto: 'vistaClientes', claveDesc: 'descClientes', modulo: 'clientes', Componente: ReporteClientes },
];

const ReportesPage = () => {
  const { locale } = usePreferences();
  const tr = useTextoReportes();
  const { usuario } = useAuth();
  const { moduloActivo } = useConfiguracion();
  const [params, setParams] = useSearchParams();

  if (!puede(usuario, 'reportes.ver')) return <Navigate to="/dashboard" replace />;

  // Las vistas de un módulo apagado no se ofrecen; la vista va en la URL
  // (?vista=) para poder compartir o recargar sin perderla.
  const vistas = VISTAS.filter((v) => !v.modulo || moduloActivo(v.modulo));
  const actual = vistas.find((v) => v.id === params.get('vista')) || vistas[0];
  const elegir = (id) => setParams((p) => { const sig = new URLSearchParams(p); sig.set('vista', id); return sig; }, { replace: true });
  const Componente = actual.Componente;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
          {capitalizar(new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }))}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">{tr('titulo')}</h1>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{tr('subtitulo')}</p>
      </header>

      <section className="dash-panel mb-8">
        <div className="dash-panel-cabecera">
          <div role="tablist" aria-label={tr('titulo')} className="dash-pestanas">
            {vistas.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={actual.id === v.id} onClick={() => elegir(v.id)}>
                <v.icono size={15} /> {tr(v.claveTexto)}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">{tr(actual.claveDesc)}</p>
        </div>
        <div className="p-3 sm:p-5">
          <Componente key={actual.id} />
        </div>
      </section>
    </div>
  );
};

export default ReportesPage;
