// Tabla de progreso de proyectos. La usan el panel del administrador (inicio)
// y la página de Reportes; los datos son `proyectosProgreso` de las
// estadísticas de admin.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import Tooltip from '../Tooltip';
import CampoFiltro from '../CampoFiltro';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ESTADOS_PROYECTO, getEstadoProyecto, normalizarEstadoProyecto } from '../../utils/estadosProyecto';
import { fechaLocalDesdeISO } from '../../utils/fechasLocales';

const PROYECTOS_POR_PAGINA_TABLA = 10;

/**
 * Progreso de proyectos en tabla.
 *
 * Por defecto oculta los terminados y archivados: la idea es ver lo que sigue
 * en marcha. El admin decide cuando un proyecto esta terminado desde su menu,
 * y a partir de ahi sale de esta lista salvo que se pida verlo con el filtro.
 */
const TablaProgresoProyectos = ({ proyectos, onAbrirProyecto }) => {
  const { t, locale } = usePreferences();
  const [filtro, setFiltro] = useState('EN_CURSO');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const FILTROS = [
    { valor: 'EN_CURSO', labelKey: 'dashboardFilterInProgress' },
    { valor: 'TODOS', labelKey: 'projectFilterAll' },
    ...ESTADOS_PROYECTO.map((e) => ({ valor: e.value, labelKey: e.labelKey })),
    ];

  // Aqui la busqueda es local: los proyectos ya vienen todos en las estadisticas,
  // no hace falta ir al servidor por cada letra.
  const termino = busqueda.trim().toLowerCase();
  const filtrados = proyectos.filter((p) => {
    const estado = normalizarEstadoProyecto(p.estado);
    const coincideEstado = filtro === 'EN_CURSO'
      ? estado !== 'TERMINADO' && estado !== 'ARCHIVADO'
      : filtro === 'TODOS' || estado === filtro;
    const coincideTexto = !termino || String(p.nombre || '').toLowerCase().includes(termino);
    return coincideEstado && coincideTexto;
  });

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PROYECTOS_POR_PAGINA_TABLA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice(
    (paginaActual - 1) * PROYECTOS_POR_PAGINA_TABLA,
    paginaActual * PROYECTOS_POR_PAGINA_TABLA,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">{t('dashboardProjectProgress')}</h3>

        <div className="flex w-full items-end gap-3 flex-wrap sm:w-auto">
          <CampoFiltro label={t('search')} className="min-w-0 basis-full sm:basis-auto">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none">
                <Search size={15} />
              </span>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }}
                placeholder={t('projectSearchPlaceholder')}
                aria-label={t('projectSearchPlaceholder')}
                className="h-10 w-full sm:h-9 sm:w-[220px] pl-9 pr-3 rounded-lg bg-[var(--color-surface-3)] border-0 text-sm font-normal text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              />
            </div>
          </CampoFiltro>

          <CampoFiltro label={t('projectFieldStatus')} className="flex-1 sm:flex-none">
            <Select value={filtro} onValueChange={(v) => { setFiltro(v); setPagina(1); }}>
              <SelectTrigger className="h-10 w-full sm:h-9 sm:w-[160px] text-sm font-normal border-0 bg-[var(--color-surface-3)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[1500]">
                {FILTROS.map((f) => (
                  <SelectItem key={f.valor} value={f.valor} className="text-sm font-normal">
                    {t(f.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="py-12 text-center text-sm font-normal text-[var(--color-text-muted)]">
          {t('projectNoResultsTitle')}
        </div>
              ) : (
        <>
        {/* Móvil: tarjetas. Las siete columnas no caben en 360px y la tabla
            obligaba a desplazar en horizontal para ver el avance. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {visibles.map((p) => {
            const estado = getEstadoProyecto(p.estado);
            const pct = p.porcentaje ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onAbrirProyecto(p.id)}
                  className="flex w-full flex-col gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left"
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-[var(--color-text)]">{p.nombre}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium" style={{ color: estado.color, background: estado.bg }}>
                      {t(estado.labelKey)}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                      <span className="block h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-9 text-right text-xs font-medium text-[var(--color-text-dim)]">{pct}%</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                    <span>{t('dashboardTasksLabel')}: <b className="font-medium text-[var(--color-text)]">{p.totalTareas ?? 0}</b></span>
                    <span>
                      {t('dashboardPending')}:{' '}
                      <b className="font-medium" style={{ color: p.pendientes > 0 ? 'var(--color-error)' : 'var(--color-text)' }}>{p.pendientes ?? 0}</b>
                    </span>
                    <span>{t('teamTitle')}: <b className="font-medium text-[var(--color-text)]">{p.miembros ?? 0}</b></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="dash-tabla-progreso hidden min-h-0 flex-1 overflow-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-medium">{t('dashboardProjects')}</TableHead>
                <TableHead className="font-medium">{t('projectFieldStatus')}</TableHead>
                <TableHead className="font-medium w-[180px]">{t('dashboardProgress')}</TableHead>
                <TableHead className="font-medium text-right">{t('dashboardTasksLabel')}</TableHead>
                <TableHead className="font-medium text-right">{t('dashboardPending')}</TableHead>
                <TableHead className="font-medium text-right">{t('teamTitle')}</TableHead>
                <TableHead className="font-medium">{t('projectFieldStart')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((p) => {
                const estado = getEstadoProyecto(p.estado);
                const pct = p.porcentaje ?? 0;
                return (
                  <TableRow
                    key={p.id}
                    onClick={() => onAbrirProyecto(p.id)}
                    // La fila entera abre el proyecto: también con teclado
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onAbrirProyecto(p.id); }}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium text-[var(--color-text)]">{p.nombre}</TableCell>
                    <TableCell>
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-md whitespace-nowrap"
                        style={{ color: estado.color, background: estado.bg }}
                      >
                        {t(estado.labelKey)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--color-primary)]"
                            style={{ width: `${pct}%` }}
                />
                        </div>
                        <span className="text-xs font-medium text-[var(--color-text-dim)] w-9 text-right">{pct}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-normal">{p.totalTareas ?? 0}</TableCell>
                    <TableCell className="text-right font-normal">
                      <span className={p.pendientes > 0 ? 'font-medium' : ''} style={p.pendientes > 0 ? { color: 'var(--color-error)' } : undefined}>
                        {p.pendientes ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-normal">{p.miembros ?? 0}</TableCell>
                    <TableCell className="font-normal text-[var(--color-text-muted)] whitespace-nowrap">
                      {/* Como dia de calendario: con new Date() salia un dia antes */}
                      {fechaLocalDesdeISO(p.fechaInicio)
                        ? fechaLocalDesdeISO(p.fechaInicio).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' })
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      {totalPaginas > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-2 border-t border-[var(--color-border)]">
          <span className="text-sm font-normal text-[var(--color-text-muted)]">
            {t('timelineRange', {
              desde: (paginaActual - 1) * PROYECTOS_POR_PAGINA_TABLA + 1,
              hasta: Math.min(paginaActual * PROYECTOS_POR_PAGINA_TABLA, filtrados.length),
              total: filtrados.length
            })}
          </span>
          <div className="flex items-center gap-2">
            <Tooltip label={t('previous')}>
              <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setPagina((n) => Math.max(1, n - 1))} disabled={paginaActual === 1}>
                <ChevronLeft size={16} />
              </Button>
            </Tooltip>
            <span className="text-sm font-medium text-[var(--color-text)] min-w-[70px] text-center">
              {paginaActual} / {totalPaginas}
            </span>
            <Tooltip label={t('next')}>
              <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))} disabled={paginaActual === totalPaginas}>
                <ChevronRight size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
};

export default TablaProgresoProyectos;
