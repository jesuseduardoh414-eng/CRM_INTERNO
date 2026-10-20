// Ventas: pagos recibidos de los clientes. Cifras del año, filtros y lista;
// la ficha y el formulario son ventanas. Los permisos de ventas (ver / crear / editar / eliminar)
// viene en usuario.permisos (finanzas.ventas.*) y lo vuelve a comprobar el servidor.
import { useState } from 'react';
import useSWR from 'swr';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Landmark, Paperclip, Plus, Receipt, Search, X } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { useDebounce } from '../utils/useDebounce';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import FormularioPago from '../components/finanzas/FormularioPago';
import DetallePago from '../components/finanzas/DetallePago';
import GestionCuentas from '../components/finanzas/GestionCuentas';
import { Cifras, ErrorCarga, SelectorAnio, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import { BADGE_ESTADO_PAGO, OPCIONES_SWR_FINANZAS, aniosSelector, puedeFinanzas, recargarFinanzas } from '../utils/finanzas';

const SEGMENTOS_ESTADO = ['TODOS', 'REGISTRADO', 'ANULADO'];

const VentasPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha } = useFormatoFinanzas();
  const [params, setParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('TODOS');
  const [cuentaId, setCuentaId] = useState('');
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [formulario, setFormulario] = useState(null);
  const [detalleId, setDetalleId] = useState(() => Number(params.get('pago')) || null);
  const [cuentasAbiertas, setCuentasAbiertas] = useState(false);
  const q = useDebounce(busqueda, 300);
  const puedeVer = puedeFinanzas(usuario, 'ventas');
  const puedeCrear = puedeFinanzas(usuario, 'ventas', 'crear');
  const puedeEditar = puedeFinanzas(usuario, 'ventas', 'editar');
  const puedeEliminar = puedeFinanzas(usuario, 'ventas', 'eliminar');
  // Las cuentas las gestiona quien edita ventas o tesorería (igual que el servidor).
  const gestionaCuentas = puedeEditar || puedeFinanzas(usuario, 'tesoreria', 'editar');

  const { data, error, isLoading, mutate } = useSWR(
    puedeVer ? ['finanzas-pagos', q, estado, cuentaId, anio] : null,
    () => finanzasService.pagos.listar({ q, estado: estado === 'TODOS' ? '' : estado, cuentaId, anio }),
    OPCIONES_SWR_FINANZAS,
  );
  const { data: resumen } = useSWR(puedeVer ? ['finanzas-pagos-resumen', anio] : null, () => finanzasService.pagos.resumen({ anio }), OPCIONES_SWR_FINANZAS);
  const { data: catalogos } = useSWR(puedeVer ? 'finanzas-catalogos' : null, () => finanzasService.catalogos(), OPCIONES_SWR_FINANZAS);

  if (!puedeVer) return <Navigate to="/dashboard" replace />;

  // Un pago cambia la bolsa de Tesorería: se recargan todas las claves de finanzas.
  const recargarTodo = () => { recargarFinanzas(); };
  const pagos = data?.pagos || [];
  const hayFiltros = Boolean(busqueda) || estado !== 'TODOS' || Boolean(cuentaId);
  const limpiar = () => { setBusqueda(''); setEstado('TODOS'); setCuentaId(''); };
  const abrirNuevo = () => setFormulario({ pago: null, clave: Date.now() });
  const abrirEdicion = (pago) => { setDetalleId(null); setFormulario({ pago, clave: Date.now() }); };
  const cerrarDetalle = () => { setDetalleId(null); if (params.has('pago')) { params.delete('pago'); setParams(params, { replace: true }); } };

  const cifras = [
    // "Este mes" solo tiene sentido en el año en curso.
    anio === new Date().getFullYear() && { clave: 'mes', etiqueta: tf('finKpiMes'), valor: resumen ? monto(resumen.mes.total) : null, sub: resumen ? tf('finKpiPagos', { n: resumen.mes.cantidad }) : null },
    { clave: 'anual', etiqueta: tf('finKpiAnio', { anio }), valor: resumen ? monto(resumen.anual.total) : null, sub: resumen ? tf('finKpiPagos', { n: resumen.anual.cantidad }) : null },
    { clave: 'historico', etiqueta: tf('finKpiHistorico'), valor: resumen ? monto(resumen.historico.total) : null, sub: resumen ? tf('finKpiPagos', { n: resumen.historico.cantidad }) : null },
    { clave: 'cuentas', etiqueta: tf('finKpiCuentas'), valor: catalogos ? catalogos.cuentas.filter((c) => c.activa).length : null, onClick: gestionaCuentas ? () => setCuentasAbiertas(true) : undefined },
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finVentasTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finVentasSubtitulo')}</p>
        </div>
        {(gestionaCuentas || puedeCrear) && (
          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            {gestionaCuentas && <Button variant="outline" className="w-full md:w-auto" onClick={() => setCuentasAbiertas(true)}><Landmark size={16} /> {tf('finCuentas')}</Button>}
            {puedeCrear && <Button className="w-full md:w-auto" onClick={abrirNuevo}><Plus size={16} /> {tf('finPagoNuevo')}</Button>}
          </div>
        )}
      </div>

      <Cifras cifras={cifras} className="mb-6" />

      {resumen?.otrasMonedas?.length > 0 && (
        <p className="mb-4 text-[12.5px] text-[var(--color-text-muted)]">
          {tf('finOtrasMonedasAviso', { lista: resumen.otrasMonedas.map((m) => `${monto(m.total, m.moneda)} (${m.cantidad})`).join(' · ') })}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="pagos-buscar" className="min-w-[240px] max-w-md flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="pagos-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={tf('finPagosBuscarPh')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
        </CampoFiltro>
        <CampoFiltro label={tf('finAnio')}>
          <SelectorAnio anio={anio} anios={aniosSelector()} onCambio={setAnio} etiqueta={tf('finAnio')} />
        </CampoFiltro>
        <CampoFiltro label={tf('finEstado')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={tf('finEstado')}>
            {SEGMENTOS_ESTADO.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={estado === v} onClick={() => setEstado(v)}>
                {v === 'TODOS' ? tf('finTodos') : tf(`finEstadoPago${v}`)}
              </button>
            ))}
          </div>
        </CampoFiltro>
        {catalogos?.cuentas?.length > 0 && (
          <CampoFiltro label={tf('finCuenta')}>
            <Select value={cuentaId || 'TODAS'} onValueChange={(v) => setCuentaId(v === 'TODAS' ? '' : v)}>
              <SelectTrigger aria-label={tf('finCuenta')} className="h-10 w-[200px] text-[13.5px] font-normal"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODAS" className="text-sm font-normal">{tf('finTodasCuentas')}</SelectItem>
                {catalogos.cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)} className="text-sm font-normal">{c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </CampoFiltro>
        )}
        {hayFiltros && (
          <Button variant="ghost" className="h-10 text-[var(--color-text-dim)]" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
        )}
      </div>

      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={5} header={false} /></div>}
        {error && !data && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
        {data && pagos.length === 0 && (
          <Vacio
            icono={<Receipt size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
            titulo={hayFiltros ? tf('finSinResultados') : tf('finPagosVacio')}
            texto={!hayFiltros ? tf('finPagosVacioHint') : undefined}
            accion={hayFiltros
              ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
              : (puedeCrear && <Button onClick={abrirNuevo}><Plus size={16} /> {tf('finPagoNuevo')}</Button>)}
          />
        )}

        {pagos.length > 0 && (
          <>
            <div className="hidden overflow-x-auto overscroll-x-contain lg:block">
              <table className="cli-tabla">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1]">{tf('finColPago')}</th>
                    <th>{tf('finCliente')}</th>
                    <th>{tf('finFecha')}</th>
                    <th>{tf('finCuenta')}</th>
                    <th className="text-right">{tf('finMonto')}</th>
                    <th>{tf('finEstado')}</th>
                    <th aria-hidden="true" className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p) => (
                    <tr key={p.id} onClick={() => setDetalleId(p.id)} className="group">
                      <td className="sticky left-0 z-[1] min-w-[220px] max-w-[320px] bg-[var(--color-surface)] group-hover:bg-[color-mix(in_srgb,var(--color-text)_3%,var(--color-surface))]">
                        <button type="button" className="block max-w-full text-left text-[13.5px] font-medium leading-snug text-[var(--color-text)] hover:underline" onClick={(e) => { e.stopPropagation(); setDetalleId(p.id); }}>{p.concepto}</button>
                        <div className="mt-0.5 flex items-center gap-2 truncate text-[12px] text-[var(--color-text-muted)]">
                          <span className="font-mono">{p.folio}</span>
                          <span>· {tf(`finMetodo${p.metodo}`)}</span>
                          {p.totalComprobantes > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} aria-hidden="true" />{p.totalComprobantes}</span>}
                        </div>
                      </td>
                      <td className="max-w-[260px] truncate text-[13px]">{p.clienteNombre || p.empresa?.nombre || '—'}</td>
                      <td className="whitespace-nowrap text-[13px]">{fecha(p.fecha)}</td>
                      <td className="max-w-[180px] truncate text-[13px] text-[var(--color-text-dim)]">{p.cuenta?.nombre || '—'}</td>
                      <td className="text-right"><span className={`font-semibold tabular-nums ${p.estado === 'ANULADO' ? 'text-[var(--color-text-muted)] line-through' : ''}`}>{monto(p.monto, p.moneda)}</span></td>
                      <td><span className={BADGE_ESTADO_PAGO[p.estado] || 'badge-neutral'}>{tf(`finEstadoPago${p.estado}`)}</span></td>
                      <td className="pr-3"><ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid grid-cols-1 md:grid-cols-2 lg:hidden">
              {pagos.map((p) => (
                <li key={p.id} className="border-t border-[var(--color-border)] first:border-t-0 md:[&:nth-child(2)]:border-t-0 md:odd:border-r">
                  <button type="button" onClick={() => setDetalleId(p.id)} className="h-full w-full px-4 py-3.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_3%,transparent)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium leading-snug text-[var(--color-text)]">{p.concepto}</div>
                        <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{p.folio} · {p.clienteNombre || p.empresa?.nombre || '—'}</div>
                      </div>
                      <span className={`shrink-0 ${BADGE_ESTADO_PAGO[p.estado] || 'badge-neutral'}`}>{tf(`finEstadoPago${p.estado}`)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-[var(--color-text-muted)]">{fecha(p.fecha)}{p.cuenta ? ` · ${p.cuenta.nombre}` : ''}</span>
                      <span className={`font-semibold tabular-nums ${p.estado === 'ANULADO' ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}`}>{monto(p.monto, p.moneda)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              <span>{pagos.length === 1 ? tf('finPagosCuentaUno') : tf('finPagosCuenta', { n: pagos.length })}</span>
              {data?.resumenFiltro && <span>{tf('finTotalFiltro')}: <strong className="tabular-nums text-[var(--color-text)]">{monto(data.resumenFiltro.total)}</strong></span>}
            </div>
          </>
        )}
      </div>

      {formulario && (
        <FormularioPago
          key={formulario.clave}
          open
          pago={formulario.pago}
          catalogos={catalogos}
          onClose={() => setFormulario(null)}
          onGuardado={(guardado) => { setFormulario(null); recargarTodo(); setDetalleId(guardado.id); }}
        />
      )}
      {detalleId && (
        <DetallePago key={detalleId} open pagoId={detalleId} puedeEditar={puedeEditar} puedeEliminar={puedeEliminar} onClose={cerrarDetalle} onEditar={abrirEdicion} onCambio={recargarTodo} />
      )}
      {cuentasAbiertas && (
        <GestionCuentas open onClose={() => setCuentasAbiertas(false)} onCambio={recargarTodo} />
      )}
    </div>
  );
};

export default VentasPage;
