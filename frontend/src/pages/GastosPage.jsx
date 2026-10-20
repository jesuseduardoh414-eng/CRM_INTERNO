// Gastos de una categoría (/gastos/:categoria): cifras, presupuesto del mes,
// próximos a vencer, filtros y lista. La ficha y el formulario son ventanas. El permiso es por
// categoría (usuario.permisos, finanzas.gastos.*) y lo vuelve a comprobar el servidor.
import { useState } from 'react';
import useSWR from 'swr';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AlarmClock, ChevronRight, Paperclip, Plus, ReceiptText, Search, X } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { useDebounce } from '../utils/useDebounce';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import FormularioGasto from '../components/finanzas/FormularioGasto';
import DetalleGasto from '../components/finanzas/DetalleGasto';
import { Cifras, ErrorCarga, SelectorAnio, TarjetaPresupuesto, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import {
  BADGE_ESTADO_GASTO, ESTADOS_FILTRO_GASTO, aniosSelector, categoriaDesdeSlug, estadoVisibleGasto, nombreMesAnio,
  OPCIONES_SWR_FINANZAS, puedeFinanzas, recargarFinanzas,
} from '../utils/finanzas';
import NavCategoriasGastos from '../components/finanzas/NavCategoriasGastos';

// La ruta lleva la categoría; la vista se monta de cero (key) al cambiarla
// desde el menú, así filtros y ventanas no arrastran nada de la anterior.
const GastosPage = () => {
  const { categoria: slug } = useParams();
  const categoria = categoriaDesdeSlug(slug);
  // Categoría desconocida o sin permiso: a /gastos, que lleva a la primera visible.
  if (!categoria) return <Navigate to="/gastos" replace />;
  return <VistaCategoria key={categoria} categoria={categoria} />;
};

const VistaCategoria = ({ categoria }) => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha, locale } = useFormatoFinanzas();
  const [params, setParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('TODOS');
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [formulario, setFormulario] = useState(null);
  const [detalleId, setDetalleId] = useState(() => Number(params.get('gasto')) || null);
  const q = useDebounce(busqueda, 300);
  const puedeVer = puedeFinanzas(usuario, `gastos.${categoria}`);
  const puedeCrear = puedeFinanzas(usuario, `gastos.${categoria}`, 'crear');

  const filtroAnio = estado === 'PENDIENTE' || estado === 'VENCIDO' ? '' : anio;
  const { data, error, isLoading, mutate } = useSWR(
    puedeVer ? ['finanzas-gastos', categoria, q, estado, filtroAnio] : null,
    () => finanzasService.gastos.listar({ categoria, q, estado: estado === 'TODOS' ? '' : estado, anio: filtroAnio }),
    OPCIONES_SWR_FINANZAS,
  );
  const { data: resumen } = useSWR(puedeVer ? ['finanzas-gastos-resumen', categoria, anio] : null, () => finanzasService.gastos.resumen({ categoria, anio }), OPCIONES_SWR_FINANZAS);
  // Presupuesto de la categoría en el mes actual (lo decide el servidor).
  const { data: datosPresupuesto } = useSWR(puedeVer ? ['finanzas-presupuesto-categoria', categoria, 'actual'] : null, () => finanzasService.gastos.presupuesto({ categoria }), OPCIONES_SWR_FINANZAS);
  const { data: catalogos } = useSWR(puedeVer ? 'finanzas-catalogos' : null, () => finanzasService.catalogos(), OPCIONES_SWR_FINANZAS);
  // Por pagar: los pendientes con fecha límite, los más urgentes primero (vencidos incluidos).
  const { data: proximos } = useSWR(puedeVer ? ['finanzas-gastos-proximos', categoria] : null, () => finanzasService.gastos.listar({ categoria, estado: 'PENDIENTE', orden: 'limite', limit: 6, page: 1 }), OPCIONES_SWR_FINANZAS);

  if (!puedeVer) return <Navigate to="/gastos" replace />;

  const presupuesto = datosPresupuesto?.presupuesto;
  // Un gasto cambia los saldos de Tesorería y el informe: se recarga todo lo de finanzas.
  const recargarTodo = () => { recargarFinanzas(); };
  const gastos = data?.gastos || [];
  const hayFiltros = Boolean(busqueda) || estado !== 'TODOS';
  const limpiar = () => { setBusqueda(''); setEstado('TODOS'); };
  const abrirNuevo = () => setFormulario({ gasto: null, clave: Date.now() });
  const abrirEdicion = (gasto) => { setDetalleId(null); setFormulario({ gasto, clave: Date.now() }); };
  const cerrarDetalle = () => { setDetalleId(null); if (params.has('gasto')) { params.delete('gasto'); setParams(params, { replace: true }); } };
  const alternarEstado = (v) => setEstado((actual) => (actual === v ? 'TODOS' : v));

  // Pendientes con fecha límite, los más urgentes primero (vencidos incluidos).
  const porVencer = (proximos?.gastos || [])
    .filter((g) => g.fechaLimite)
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))
    .slice(0, 6);

  const cifras = [
    anio === new Date().getFullYear() && { clave: 'mes', etiqueta: tf('finKpiGastoMes'), valor: resumen ? monto(resumen.mes.total) : null, sub: resumen ? tf('finKpiGastos', { n: resumen.mes.cantidad }) : null },
    { clave: 'anual', etiqueta: tf('finKpiGastoAnio', { anio }), valor: resumen ? monto(resumen.anual.total) : null, sub: resumen ? tf('finKpiGastos', { n: resumen.anual.cantidad }) : null },
    { clave: 'pendientes', etiqueta: tf('finKpiPendientes'), valor: resumen ? monto(resumen.pendientes.total) : null, sub: resumen ? tf('finKpiGastos', { n: resumen.pendientes.cantidad }) : null, alerta: resumen?.pendientes.cantidad > 0 && 'warning', onClick: () => alternarEstado('PENDIENTE'), activo: estado === 'PENDIENTE' },
    { clave: 'vencidos', etiqueta: tf('finKpiVencidos'), valor: resumen ? monto(resumen.vencidos.total) : null, sub: resumen ? tf('finKpiGastos', { n: resumen.vencidos.cantidad }) : null, alerta: resumen?.vencidos.cantidad > 0 && 'error', onClick: () => alternarEstado('VENCIDO'), activo: estado === 'VENCIDO' },
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-7xl">
      <NavCategoriasGastos />
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{tf('finGastosTitulo')}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf(`finCat${categoria}`)}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf(`finCat${categoria}Hint`)}</p>
        </div>
        {puedeCrear && (
          <Button className="w-full md:w-auto" onClick={abrirNuevo}><Plus size={16} /> {tf('finGastoNuevo')}</Button>
        )}
      </div>

      <Cifras cifras={cifras} className="mb-6" />

      {(presupuesto || porVencer.length > 0) && (
        <div className="mb-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {presupuesto && (
            <TarjetaPresupuesto
              as="section"
              fila={presupuesto}
              titulo={tf('finPresupuestoMesGastos', { mes: nombreMesAnio(presupuesto.anio, presupuesto.mes, locale) })}
              tf={tf}
              monto={monto}
              nota={!presupuesto.tienePresupuesto ? tf('finCategoriaSinPresupuesto', { mes: nombreMesAnio(presupuesto.anio, presupuesto.mes, locale) }) : undefined}
              extra={puedeFinanzas(usuario, 'tesoreria', 'editar') && (
                <Link to="/tesoreria" className="cli-enlace shrink-0 text-[12.5px]">{presupuesto.tienePresupuesto ? t('edit') : tf('finFijarEnTesoreria')}</Link>
              )}
            />
          )}
          {porVencer.length > 0 && (
            <section className="cli-panel overflow-hidden">
              <header className="cli-panel-cabecera">
                <h2 className="cli-etiqueta">
                  <AlarmClock size={14} className="text-[var(--color-warning)]" aria-hidden="true" />
                  {tf('finPorVencerTitulo')}
                  <span className="cli-conteo">{porVencer.length}</span>
                </h2>
              </header>
              <ul className="divide-y divide-[var(--color-border)]">
                {porVencer.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => setDetalleId(g.id)} className="cli-fila w-full !border-t-0 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{g.concepto}</span>
                        <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{g.folio}{g.proveedorNombre ? ` · ${g.proveedorNombre}` : ''} · {monto(g.monto, g.moneda)}</span>
                      </span>
                      <span className={`shrink-0 text-[12px] font-semibold ${g.vencido ? 'text-[var(--color-error)]' : 'text-[var(--color-warning)]'}`}>
                        {g.vencido ? tf('finVencioHace', { n: Math.abs(g.diasRestantes) }) : g.diasRestantes === 0 ? tf('finVenceHoy') : tf('finVenceEn', { n: g.diasRestantes })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="gastos-buscar" className="min-w-[240px] max-w-md flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="gastos-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={tf('finGastosBuscarPh')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
        </CampoFiltro>
        <CampoFiltro label={tf('finAnio')}>
          <SelectorAnio anio={anio} anios={aniosSelector()} onCambio={setAnio} etiqueta={tf('finAnio')} />
        </CampoFiltro>
        <CampoFiltro label={tf('finEstado')}>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger aria-label={tf('finEstado')} className="h-10 w-[170px] text-[13.5px] font-normal"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[1500]">
              <SelectItem value="TODOS" className="text-sm font-normal">{tf('finTodos')}</SelectItem>
              {ESTADOS_FILTRO_GASTO.map((v) => <SelectItem key={v} value={v} className="text-sm font-normal">{tf(`finEstadoGasto${v}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CampoFiltro>
        {hayFiltros && (
          <Button variant="ghost" className="h-10 text-[var(--color-text-dim)]" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
        )}
      </div>

      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={5} header={false} /></div>}
        {error && !data && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
        {data && gastos.length === 0 && (
          <Vacio
            icono={<ReceiptText size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
            titulo={hayFiltros ? tf('finSinResultados') : tf('finGastosVacio')}
            texto={!hayFiltros ? tf('finGastosVacioHint') : undefined}
            accion={hayFiltros
              ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
              : (puedeCrear && <Button onClick={abrirNuevo}><Plus size={16} /> {tf('finGastoNuevo')}</Button>)}
          />
        )}

        {gastos.length > 0 && (
          <>
            <div className="hidden overflow-x-auto overscroll-x-contain lg:block">
              <table className="cli-tabla">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1]">{tf('finColGasto')}</th>
                    <th>{tf('finProveedor')}</th>
                    <th>{tf('finFecha')}</th>
                    <th>{tf('finFechaLimite')}</th>
                    <th className="text-right">{tf('finMonto')}</th>
                    <th>{tf('finEstado')}</th>
                    <th aria-hidden="true" className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {gastos.map((g) => {
                    const est = estadoVisibleGasto(g);
                    return (
                      <tr key={g.id} onClick={() => setDetalleId(g.id)} className="group">
                        <td className="sticky left-0 z-[1] min-w-[220px] max-w-[320px] bg-[var(--color-surface)] group-hover:bg-[color-mix(in_srgb,var(--color-text)_3%,var(--color-surface))]">
                          <button type="button" className="block max-w-full text-left text-[13.5px] font-medium leading-snug text-[var(--color-text)] hover:underline" onClick={(e) => { e.stopPropagation(); setDetalleId(g.id); }}>{g.concepto}</button>
                          <div className="mt-0.5 flex items-center gap-2 truncate text-[12px] text-[var(--color-text-muted)]">
                            <span className="font-mono">{g.folio}</span>
                            {g.totalComprobantes > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} aria-hidden="true" />{g.totalComprobantes}</span>}
                          </div>
                        </td>
                        <td className="max-w-[220px] truncate text-[13px]">{g.proveedorNombre || g.empresa?.nombre || '—'}</td>
                        <td className="whitespace-nowrap text-[13px]">{fecha(g.fecha)}</td>
                        <td className={`whitespace-nowrap text-[13px] ${g.vencido ? 'font-semibold text-[var(--color-error)]' : ''}`}>{g.fechaLimite ? fecha(g.fechaLimite) : '—'}</td>
                        <td className="text-right"><span className={`font-semibold tabular-nums ${g.estado === 'ANULADO' ? 'text-[var(--color-text-muted)] line-through' : ''}`}>{monto(g.monto, g.moneda)}</span></td>
                        <td><span className={BADGE_ESTADO_GASTO[est] || 'badge-neutral'}>{tf(`finEstadoGasto${est}`)}</span></td>
                        <td className="pr-3"><ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="grid grid-cols-1 md:grid-cols-2 lg:hidden">
              {gastos.map((g) => {
                const est = estadoVisibleGasto(g);
                return (
                  <li key={g.id} className="border-t border-[var(--color-border)] first:border-t-0 md:[&:nth-child(2)]:border-t-0 md:odd:border-r">
                    <button type="button" onClick={() => setDetalleId(g.id)} className="h-full w-full px-4 py-3.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_3%,transparent)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium leading-snug text-[var(--color-text)]">{g.concepto}</div>
                          <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{g.folio}{g.proveedorNombre ? ` · ${g.proveedorNombre}` : ''}</div>
                        </div>
                        <span className={`shrink-0 ${BADGE_ESTADO_GASTO[est] || 'badge-neutral'}`}>{tf(`finEstadoGasto${est}`)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-[var(--color-text-muted)]">{fecha(g.fecha)}{g.fechaLimite ? ` · ${tf('finVence')} ${fecha(g.fechaLimite)}` : ''}</span>
                        <span className={`font-semibold tabular-nums ${g.estado === 'ANULADO' ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}`}>{monto(g.monto, g.moneda)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              <span>{gastos.length === 1 ? tf('finGastosCuentaUno') : tf('finGastosCuenta', { n: gastos.length })}</span>
              {data?.resumenFiltro && <span>{tf('finTotalFiltro')}: <strong className="tabular-nums text-[var(--color-text)]">{monto(data.resumenFiltro.total)}</strong></span>}
            </div>
          </>
        )}
      </div>

      {formulario && (
        <FormularioGasto
          key={formulario.clave}
          open
          gasto={formulario.gasto}
          categoria={categoria}
          catalogos={catalogos}
          onClose={() => setFormulario(null)}
          onGuardado={(guardado) => { setFormulario(null); recargarTodo(); setDetalleId(guardado.id); }}
        />
      )}
      {detalleId && (
        <DetalleGasto
          key={detalleId}
          open
          gastoId={detalleId}
          onClose={cerrarDetalle}
          onEditar={abrirEdicion}
          onCambio={recargarTodo}
          onDuplicado={(nuevo) => setDetalleId(nuevo.id)}
        />
      )}
    </div>
  );
};

export default GastosPage;
