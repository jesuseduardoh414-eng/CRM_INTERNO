// Cotizaciones (/cotizaciones): las que nos envían los proveedores y las que
// enviamos a clientes. Cada una guarda su archivo original y los cambios como
// versiones nuevas (nada se reemplaza). Permiso `cotizaciones` (ver / subir);
// corregir, cambiar el estado o eliminar es del administrador general.
import { useState } from 'react';
import useSWR from 'swr';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileStack, Layers, Plus, Search, X } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { useDebounce } from '../utils/useDebounce';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import FormularioCotizacion from '../components/finanzas/FormularioCotizacion';
import DetalleCotizacion from '../components/finanzas/DetalleCotizacion';
import { Cifras, ErrorCarga, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import {
  BADGE_ESTADO_COTIZACION, ESTADOS_COTIZACION, OPCIONES_SWR_FINANZAS, TIPOS_COTIZACION, puedeFinanzas, recargarFinanzas,
} from '../utils/finanzas';

const CotizacionesPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha } = useFormatoFinanzas();
  const [params, setParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('TODOS');
  const [estado, setEstado] = useState('TODOS');
  const [formulario, setFormulario] = useState(null);
  const [detalleId, setDetalleId] = useState(() => Number(params.get('cotizacion')) || null);
  const q = useDebounce(busqueda, 300);
  const puedeVer = puedeFinanzas(usuario, 'cotizaciones');
  // Subir cotizaciones y versiones nuevas = "crear". Corregir, cambiar el
  // estado y eliminar son casillas aparte (de fábrica, solo el administrador
  // general).
  const puedeSubir = puedeFinanzas(usuario, 'cotizaciones', 'crear');
  const permisosCotizacion = {
    editar: puedeFinanzas(usuario, 'cotizaciones', 'editar'),
    aprobar: puedeFinanzas(usuario, 'cotizaciones', 'aprobar'),
    eliminar: puedeFinanzas(usuario, 'cotizaciones', 'eliminar'),
  };

  const { data, error, isLoading, mutate } = useSWR(
    puedeVer ? ['finanzas-cotizaciones', q, tipo, estado] : null,
    () => finanzasService.cotizaciones.listar({ q, tipo: tipo === 'TODOS' ? '' : tipo, estado: estado === 'TODOS' ? '' : estado }),
    { ...OPCIONES_SWR_FINANZAS, keepPreviousData: true },
  );
  const { data: catalogos } = useSWR(puedeSubir ? 'finanzas-catalogos' : null, () => finanzasService.catalogos(), OPCIONES_SWR_FINANZAS);

  if (!puedeVer) return <Navigate to="/dashboard" replace />;

  const cotizaciones = data?.cotizaciones || [];
  const conteos = data?.conteos || {};
  const total = ESTADOS_COTIZACION.reduce((s, e) => s + (conteos[e] || 0), 0);
  const hayFiltros = Boolean(busqueda) || tipo !== 'TODOS' || estado !== 'TODOS';
  const limpiar = () => { setBusqueda(''); setTipo('TODOS'); setEstado('TODOS'); };
  const alternarEstado = (e) => setEstado((actual) => (actual === e ? 'TODOS' : e));
  const cerrarDetalle = () => { setDetalleId(null); if (params.has('cotizacion')) { params.delete('cotizacion'); setParams(params, { replace: true }); } };
  const abrirNueva = () => setFormulario({ cotizacion: null, clave: Date.now() });

  const cifras = [
    { clave: 'total', etiqueta: tf('finCotKpiTotal'), valor: data ? String(total) : null, onClick: () => setEstado('TODOS'), activo: estado === 'TODOS' && Boolean(data) },
    { clave: 'pendientes', etiqueta: tf('finCotKpiPendientes'), valor: data ? String(conteos.PENDIENTE || 0) : null, alerta: conteos.PENDIENTE > 0 && 'warning', onClick: () => alternarEstado('PENDIENTE'), activo: estado === 'PENDIENTE' },
    { clave: 'aprobadas', etiqueta: tf('finCotKpiAprobadas'), valor: data ? String(conteos.APROBADA || 0) : null, onClick: () => alternarEstado('APROBADA'), activo: estado === 'APROBADA' },
    { clave: 'rechazadas', etiqueta: tf('finCotKpiRechazadas'), valor: data ? String(conteos.RECHAZADA || 0) : null, onClick: () => alternarEstado('RECHAZADA'), activo: estado === 'RECHAZADA' },
  ];

  const montoVigente = (c) => (c.montoActual !== null ? monto(c.montoActual, c.moneda) : <span className="font-normal text-[var(--color-text-muted)]">{tf('finCotSinMonto')}</span>);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finCotizacionesTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finCotizacionesSubtitulo')}</p>
        </div>
        {puedeSubir && <Button className="w-full md:w-auto" onClick={abrirNueva}><Plus size={16} /> {tf('finCotizacionNueva')}</Button>}
      </div>

      <Cifras cifras={cifras} className="mb-6" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="cot-buscar" className="min-w-[240px] max-w-md flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="cot-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={tf('finCotBuscarPh')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
        </CampoFiltro>
        <CampoFiltro label={tf('finCotTipo')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={tf('finCotTipo')}>
            {['TODOS', ...TIPOS_COTIZACION].map((v) => (
              <button key={v} type="button" role="tab" aria-selected={tipo === v} onClick={() => setTipo(v)}>{v === 'TODOS' ? tf('finCotTodas') : tf(`finCotFiltro${v}`)}</button>
            ))}
          </div>
        </CampoFiltro>
        {hayFiltros && <Button variant="ghost" className="h-10 text-[var(--color-text-dim)]" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>}
      </div>

      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={5} header={false} /></div>}
        {error && !data && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
        {data && cotizaciones.length === 0 && (
          <Vacio
            icono={<FileStack size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
            titulo={hayFiltros ? tf('finSinResultados') : tf('finCotVacio')}
            texto={!hayFiltros ? tf('finCotVacioHint') : undefined}
            accion={hayFiltros
              ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
              : (puedeSubir && <Button onClick={abrirNueva}><Plus size={16} /> {tf('finCotizacionNueva')}</Button>)}
          />
        )}

        {cotizaciones.length > 0 && (
          <>
            <div className="hidden overflow-x-auto overscroll-x-contain lg:block">
              <table className="cli-tabla">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1]">{tf('finCotizacion')}</th>
                    <th>{tf('finCotTipo')}</th>
                    <th>{tf('finCotColContraparte')}</th>
                    <th>{tf('finFecha')}</th>
                    <th className="text-center">{tf('finCotColVersiones')}</th>
                    <th className="text-right">{tf('finCotMontoVigente')}</th>
                    <th>{tf('finEstado')}</th>
                    <th aria-hidden="true" className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {cotizaciones.map((c) => (
                    <tr key={c.id} onClick={() => setDetalleId(c.id)} className="group">
                      <td className="sticky left-0 z-[1] min-w-[220px] max-w-[320px] bg-[var(--color-surface)] group-hover:bg-[color-mix(in_srgb,var(--color-text)_3%,var(--color-surface))]">
                        <button type="button" className="block max-w-full text-left text-[13.5px] font-medium leading-snug text-[var(--color-text)] hover:underline" onClick={(e) => { e.stopPropagation(); setDetalleId(c.id); }}>{c.titulo}</button>
                        <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-text-muted)]">{c.folio}</div>
                      </td>
                      <td className="whitespace-nowrap text-[13px]">{tf(`finCotTipo${c.tipo}`)}</td>
                      <td className="max-w-[220px] truncate text-[13px]">{c.contraparteNombre || c.empresa?.nombre || '—'}</td>
                      <td className="whitespace-nowrap text-[13px]">{fecha(c.fecha)}</td>
                      <td className="text-center text-[13px]"><span className="inline-flex items-center gap-1 tabular-nums"><Layers size={13} className="text-[var(--color-text-muted)]" aria-hidden="true" />{c.totalVersiones}</span></td>
                      <td className="text-right">
                        <span className="font-semibold tabular-nums">{montoVigente(c)}</span>
                        {c.totalVersiones > 1 && c.diferencia !== null && c.diferencia !== 0 && (
                          <span className={`block text-[11.5px] tabular-nums ${c.diferencia > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>{c.diferencia > 0 ? '+' : '−'}{monto(Math.abs(c.diferencia), c.moneda)}</span>
                        )}
                      </td>
                      <td><span className={BADGE_ESTADO_COTIZACION[c.estado] || 'badge-neutral'}>{tf(`finCotEstado${c.estado}`)}</span></td>
                      <td className="pr-3"><ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid grid-cols-1 md:grid-cols-2 lg:hidden">
              {cotizaciones.map((c) => (
                <li key={c.id} className="border-t border-[var(--color-border)] first:border-t-0 md:[&:nth-child(2)]:border-t-0 md:odd:border-r">
                  <button type="button" onClick={() => setDetalleId(c.id)} className="h-full w-full px-4 py-3.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_3%,transparent)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium leading-snug text-[var(--color-text)]">{c.titulo}</div>
                        <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{c.folio} · {tf(`finCotTipo${c.tipo}`)} · {c.contraparteNombre || c.empresa?.nombre || '—'}</div>
                      </div>
                      <span className={`shrink-0 ${BADGE_ESTADO_COTIZACION[c.estado] || 'badge-neutral'}`}>{tf(`finCotEstado${c.estado}`)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-[var(--color-text-muted)]">{fecha(c.fecha)} · {tf('finCotVersion', { n: c.totalVersiones })}</span>
                      <span className="font-semibold tabular-nums text-[var(--color-text)]">{montoVigente(c)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              {cotizaciones.length === 1 ? tf('finCotCuentaUno') : tf('finCotCuenta', { n: cotizaciones.length })}
            </div>
          </>
        )}
      </div>

      {formulario && (
        <FormularioCotizacion
          key={formulario.clave}
          open
          cotizacion={formulario.cotizacion}
          catalogos={catalogos}
          onClose={() => setFormulario(null)}
          onGuardado={(guardada) => { setFormulario(null); recargarFinanzas(); setDetalleId(guardada.id); }}
        />
      )}
      {detalleId && (
        <DetalleCotizacion
          key={detalleId}
          cotizacionId={detalleId}
          puedeSubir={puedeSubir}
          permisos={permisosCotizacion}
          onClose={cerrarDetalle}
          onEditar={(c) => { setDetalleId(null); setFormulario({ cotizacion: c, clave: Date.now() }); }}
          onCambio={recargarFinanzas}
        />
      )}
    </div>
  );
};

export default CotizacionesPage;
