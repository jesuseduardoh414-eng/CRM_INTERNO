// Página de Contratos (solo administradores): indicadores, próximos a vencer,
// filtros y lista. El detalle y el formulario son ventanas.
import { useState } from 'react';
import useSWR from 'swr';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  AlarmClock, Building2, ChevronRight, FilePlus2, FileText, FileWarning, RefreshCcw, Search, X,
} from 'lucide-react';
import { contratosService, empresasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoClientes } from '../hooks/useTextoClientes';
import { useToast } from '../context/ToastContext';
import { useConfirmacion } from '../components/ConfirmDialog';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { inicialesEmpresa } from '../utils/empresas';
import FormularioContrato from '../components/contratos/FormularioContrato';
import DetalleContrato from '../components/contratos/DetalleContrato';
import { useDebounce } from '../utils/useDebounce';
import {
  ESTADOS_FILTRO, TIPOS_CONTRATO, TONO_VIGENCIA, estadoVisible, formatearFechaCorta, formatearMonto, progresoVigencia,
  textoVencimiento,
} from '../utils/contratos';

// Barra de avance de la vigencia con su texto (o el aviso de vencimiento).
const Vigencia = ({ contrato, t, locale }) => {
  const est = estadoVisible(contrato);
  const venc = textoVencimiento(t, contrato);
  const progreso = progresoVigencia(contrato);
  if (!contrato.fechaInicio && !contrato.fechaFin) return <span className="text-[var(--color-text-muted)]">{t('ctrNoDates')}</span>;
  return (
    <div className="min-w-[170px] max-w-[220px]">
      <div className="whitespace-nowrap tabular-nums text-[var(--color-text)]">
        {formatearFechaCorta(contrato.fechaInicio, locale) || '—'} <span className="text-[var(--color-text-muted)]">→</span> {formatearFechaCorta(contrato.fechaFin, locale) || '—'}
      </div>
      {progreso && (
        <div className="ctr-barra mt-1.5" data-tono={TONO_VIGENCIA[est] || 'neutral'} role="progressbar" aria-valuenow={progreso.porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label={t('ctrElapsed', { p: progreso.porcentaje })}>
          <span style={{ width: `${progreso.porcentaje}%` }} />
        </div>
      )}
      <div className="mt-1 flex items-center gap-1 text-[12px]">
        {venc
          ? <span className={`font-medium ${est === 'VENCIDO' ? 'text-[var(--color-error)]' : est === 'POR_VENCER' ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}>{venc}</span>
          : contrato.renovacionAutomatica
            ? <span className="flex items-center gap-1 text-[var(--color-text-muted)]"><RefreshCcw size={11} aria-hidden="true" /> {t('ctrAutoRenew')}</span>
            : progreso?.diasParaIniciar > 0 && <span className="text-[var(--color-text-muted)]">{t('ctrStartsIn', { n: progreso.diasParaIniciar })}</span>}
      </div>
    </div>
  );
};

const IndicadorPdf = ({ total, t }) => (
  <span className="ctr-pdf" data-falta={total === 0 || undefined}>
    {total === 0 ? <FileWarning size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
    {total === 0 ? t('ctrNoPdf') : t('ctrPdfCount', { n: total })}
  </span>
);

const SEGMENTOS_TIPO = ['TODOS', ...TIPOS_CONTRATO];

const ContratosPage = () => {
  const { t, locale } = usePreferences();
  const { usuario } = useAuth();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();

  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('TODOS');
  const [estado, setEstado] = useState('TODOS');
  const [formulario, setFormulario] = useState(null); // { contrato?, clave }
  // Desde la ficha de una empresa se llega con ?id= (abre ese contrato) o
  // con ?empresaId= (filtra la lista por esa empresa).
  const [params, setParams] = useSearchParams();
  const [detalleId, setDetalleId] = useState(() => Number(params.get('id')) || null);
  const empresaId = params.get('empresaId') || '';
  const tc = useTextoClientes();
  const { moduloActivo } = useConfiguracion();
  const q = useDebounce(busqueda, 300);
  const esAdmin = usuario?.rol === 'ADMIN';

  const { data, error, isLoading, mutate } = useSWR(
    esAdmin ? ['contratos', q, tipo, estado, empresaId] : null,
    () => contratosService.listar({ q, tipo: tipo === 'TODOS' ? '' : tipo, estado: estado === 'TODOS' ? '' : estado, empresaId }),
  );
  // Mismo key que la ficha de la empresa: si se viene de ahí ya está en caché.
  const { data: empresaFiltro } = useSWR(esAdmin && empresaId ? ['empresa', Number(empresaId)] : null, () => empresasService.obtener(empresaId));
  const { data: resumen, mutate: recargarResumen } = useSWR(esAdmin ? 'contratos-resumen' : null, () => contratosService.resumen());
  const { data: catalogos } = useSWR(esAdmin ? 'contratos-catalogos' : null, () => contratosService.catalogos());

  if (!esAdmin) return <Navigate to="/dashboard" replace />;

  const recargarTodo = () => { mutate(); recargarResumen(); };
  const contratos = data?.contratos || [];
  const hayFiltros = Boolean(busqueda) || tipo !== 'TODOS' || estado !== 'TODOS' || Boolean(empresaId);
  const quitarParam = (clave) => {
    if (!params.has(clave)) return;
    const nuevos = new URLSearchParams(params);
    nuevos.delete(clave);
    setParams(nuevos, { replace: true });
  };
  const cerrarDetalle = () => { setDetalleId(null); quitarParam('id'); };
  const conteo = resumen?.conteo;
  const alternarEstado = (valor) => setEstado((actual) => (actual === valor ? 'TODOS' : valor));

  const abrirNuevo = () => setFormulario({ contrato: null, clave: Date.now() });
  const abrirEdicion = (contrato) => { cerrarDetalle(); setFormulario({ contrato, clave: Date.now() }); };

  const eliminar = async (contrato) => {
    const ok = await confirmar({
      titulo: t('ctrDeleteConfirm', { folio: contrato.folio }),
      descripcion: t('ctrDeleteConfirmText'),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await contratosService.eliminar(contrato.id);
      // También quita ?id= de la URL: si no, recargar reabría un contrato borrado.
      cerrarDetalle();
      showToast(t('ctrDeleted'), 'success');
      recargarTodo();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const montos = resumen?.montosVigentes || {};
  const sumaMonedas = (tipoContrato) => Object.entries(montos)
    .filter(([, valores]) => valores[tipoContrato] > 0)
    .map(([moneda, valores]) => formatearMonto(valores[tipoContrato], moneda, locale))
    .join(' · ') || '—';

  // Cifras de cabecera: las cuatro primeras filtran la lista al pulsarlas.
  const cifras = [
    { clave: 'ctrKpiActive', valor: conteo?.vigentes, filtro: 'VIGENTE' },
    { clave: 'ctrKpiExpiring', valor: conteo?.porVencer, filtro: 'POR_VENCER', alerta: conteo?.porVencer > 0 && 'warning' },
    { clave: 'ctrKpiExpired', valor: conteo?.vencidos, filtro: 'VENCIDO', alerta: conteo?.vencidos > 0 && 'error' },
    { clave: 'ctrKpiInProgress', valor: conteo?.enProceso, filtro: 'BORRADOR' },
    { clave: 'ctrKpiIncome', valor: resumen ? sumaMonedas('CLIENTE') : null },
    { clave: 'ctrKpiExpense', valor: resumen ? sumaMonedas('PROVEEDOR') : null },
  ];
  const limpiar = () => { setBusqueda(''); setTipo('TODOS'); setEstado('TODOS'); quitarParam('empresaId'); };

  return (
    <div className="mx-auto max-w-7xl">
      {dialogo}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{t('ctrTitle')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{t('ctrSubtitle')}</p>
        </div>
        <Button className="w-full md:w-auto" onClick={abrirNuevo}>
          <FilePlus2 size={16} /> {t('ctrNew')}
        </Button>
      </div>

      <dl className="cli-cifras mb-6">
        {cifras.map(({ clave, valor, filtro, alerta }) => {
          const contenido = (
            <>
              <dd style={alerta ? { color: `var(--color-${alerta})` } : undefined}>{valor ?? '—'}</dd>
              <dt>{t(clave)}</dt>
            </>
          );
          return (
            <div key={clave}>
              {filtro
                ? <button type="button" onClick={() => alternarEstado(filtro)} aria-pressed={estado === filtro} data-activo={estado === filtro || undefined}>{contenido}</button>
                : <span>{contenido}</span>}
            </div>
          );
        })}
      </dl>

      {resumen?.proximosAVencer?.length > 0 && (
        <section className="cli-panel mb-6 overflow-hidden">
          <header className="cli-panel-cabecera">
            <h2 className="cli-etiqueta">
              <AlarmClock size={14} className="text-[var(--color-warning)]" aria-hidden="true" />
              {t('ctrExpiringTitle')}
              <span className="cli-conteo">{resumen.proximosAVencer.length}</span>
            </h2>
          </header>
          <ul className="divide-y divide-[var(--color-border)]">
            {resumen.proximosAVencer.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setDetalleId(c.id)} className="cli-fila w-full !border-t-0 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{c.titulo}</span>
                    <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{c.folio} · {c.contraparteNombre}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold text-[var(--color-warning)]">{c.diasRestantes === 0 ? t('ctrToday') : t('ctrDaysLeft', { n: c.diasRestantes })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="contratos-buscar" className="min-w-[240px] max-w-md flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="contratos-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t('ctrSearchPlaceholder')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
        </CampoFiltro>
        <CampoFiltro label={t('ctrFieldType')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={t('ctrFieldType')}>
            {SEGMENTOS_TIPO.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={tipo === v} onClick={() => setTipo(v)}>
                {t(v === 'TODOS' ? 'ctrSegAll' : `ctrSeg${v}`)}
              </button>
            ))}
          </div>
        </CampoFiltro>
        <CampoFiltro label={t('ctrFieldStatus')}>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="h-10 w-[180px] text-[13.5px] font-normal"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[1500]">
              <SelectItem value="TODOS" className="text-sm font-normal">{t('ctrAllStatuses')}</SelectItem>
              {ESTADOS_FILTRO.map((v) => <SelectItem key={v} value={v} className="text-sm font-normal">{t(`ctrStatus${v}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CampoFiltro>
        {hayFiltros && (
          <Button variant="ghost" className="h-10 text-[var(--color-text-dim)]" onClick={limpiar}>
            <X size={15} /> {t('clearFilters')}
          </Button>
        )}
      </div>

      {empresaId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-dim)]">
          <Building2 size={15} className="text-[var(--color-text-muted)]" aria-hidden="true" />
          {moduloActivo('clientes')
            ? <Link to={`/clientes/${empresaId}`} className="font-medium text-[var(--color-text)] hover:underline">{tc('cliCtrFiltrando', { nombre: empresaFiltro?.empresa?.nombre || '…' })}</Link>
            : <span className="font-medium text-[var(--color-text)]">{tc('cliCtrFiltrando', { nombre: empresaFiltro?.empresa?.nombre || '…' })}</span>}
          <button type="button" onClick={() => quitarParam('empresaId')} className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]">
            <X size={13} /> {tc('cliQuitarFiltro')}
          </button>
        </div>
      )}

      {/* Lista */}
      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={5} header={false} /></div>}
        {error && !data && (
          <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-[var(--color-text-muted)]">
            <span>{t('ctrLoadError')}</span>
            <Button variant="outline" onClick={() => mutate()}><RefreshCcw size={15} /> {t('retry')}</Button>
          </div>
        )}
        {data && contratos.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <FileText size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />
            <p className="text-[14px] font-medium text-[var(--color-text)]">{hayFiltros ? t('ctrNoResults') : t('ctrEmpty')}</p>
            {!hayFiltros && <p className="max-w-sm text-[13px] text-[var(--color-text-muted)]">{t('ctrEmptyHint')}</p>}
            <div className="mt-3">
              {hayFiltros
                ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
                : <Button onClick={abrirNuevo}><FilePlus2 size={16} /> {t('ctrNew')}</Button>}
            </div>
          </div>
        )}

        {contratos.length > 0 && (
          <>
            {/* La tabla necesita ~1000px: solo desde xl (con barra lateral el
                ancho útil ronda 960-1110px). Si aun así no cabe, se desplaza
                dentro de su caja con el contrato fijo a la izquierda. */}
            <div className="hidden overflow-x-auto overscroll-x-contain xl:block">
            <table className="cli-tabla">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1]">{t('ctrColContract')}</th>
                  <th>{t('ctrColCounterparty')}</th>
                  <th>{t('ctrColTerm')}</th>
                  <th className="text-right">{t('ctrColAmount')}</th>
                  <th>{t('ctrColStatus')}</th>
                  <th>{t('ctrColFiles')}</th>
                  <th aria-hidden="true" className="w-8" />
                </tr>
              </thead>
              <tbody>
                {contratos.map((c) => {
                  const est = estadoVisible(c);
                  const monto = formatearMonto(c.monto, c.moneda, locale);
                  return (
                    <tr key={c.id} onClick={() => setDetalleId(c.id)} className="group">
                      <td className="sticky left-0 z-[1] min-w-[200px] max-w-[300px] bg-[var(--color-surface)] group-hover:bg-[color-mix(in_srgb,var(--color-text)_3%,var(--color-surface))]">
                        <button type="button" className="block max-w-full text-left text-[13.5px] font-medium leading-snug text-[var(--color-text)] hover:underline" onClick={(e) => { e.stopPropagation(); setDetalleId(c.id); }}>
                          {c.titulo}
                        </button>
                        <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">
                          <span className="font-mono">{c.folio}</span>
                          {c.categoria && <> · {t(`ctrCat${c.categoria}`)}</>}
                        </div>
                      </td>
                      <td className="max-w-[280px]">
                        <div className="flex items-center gap-2.5">
                          <span className="ctr-mono" aria-hidden="true">{inicialesEmpresa(c.contraparteNombre)}</span>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-[var(--color-text)]" title={c.contraparteNombre}>{c.contraparteNombre}</div>
                            <span className="cli-tipo" data-tipo={c.tipo}>{t(`ctrType${c.tipo}`)}</span>
                          </div>
                        </div>
                      </td>
                      <td><Vigencia contrato={c} t={t} locale={locale} /></td>
                      <td className="text-right">
                        {monto
                          ? (
                            <>
                              <div className="font-semibold tabular-nums">{monto}</div>
                              {c.periodicidadPago && <div className="text-[12px] text-[var(--color-text-muted)]">{t(`ctrPer${c.periodicidadPago}`)}</div>}
                            </>
                          )
                          : <span className="text-[var(--color-text-muted)]">{t('ctrNoAmount')}</span>}
                      </td>
                      <td><span className="ctr-estado" data-estado={est}>{t(`ctrStatus${est}`)}</span></td>
                      <td><IndicadorPdf total={c.totalArchivos} t={t} /></td>
                      <td className="pr-3">
                        {/* Sin puntero que pase por encima (táctil) la flecha se ve siempre */}
                        <ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Tarjetas: una columna en teléfono y dos en tableta (hasta xl) */}
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:hidden">
              {contratos.map((c) => {
                const est = estadoVisible(c);
                const monto = formatearMonto(c.monto, c.moneda, locale);
                return (
                  <li key={c.id} className="border-t border-[var(--color-border)] first:border-t-0 md:[&:nth-child(2)]:border-t-0 md:odd:border-r">
                    <button type="button" onClick={() => setDetalleId(c.id)} className="h-full w-full px-4 py-3.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_3%,transparent)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium leading-snug text-[var(--color-text)]">{c.titulo}</div>
                          <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{c.folio} · {c.contraparteNombre}</div>
                        </div>
                        <span className="ctr-estado shrink-0" data-estado={est}>{t(`ctrStatus${est}`)}</span>
                      </div>
                      <div className="mt-2.5 text-[13px]"><Vigencia contrato={c} t={t} locale={locale} /></div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                        <span className="font-semibold tabular-nums text-[var(--color-text)]">
                          {monto || <span className="font-normal text-[var(--color-text-muted)]">{t('ctrNoAmount')}</span>}
                          {monto && c.periodicidadPago && <span className="ml-1.5 text-[12px] font-normal text-[var(--color-text-muted)]">{t(`ctrPer${c.periodicidadPago}`)}</span>}
                        </span>
                        <IndicadorPdf total={c.totalArchivos} t={t} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              {contratos.length === 1 ? t('ctrCountOne') : t('ctrCount', { n: contratos.length })}
            </div>
          </>
        )}
      </div>

      {formulario && (
        <FormularioContrato
          key={formulario.clave}
          open
          contrato={formulario.contrato}
          catalogos={catalogos}
          onClose={() => setFormulario(null)}
          onGuardado={(guardado) => { setFormulario(null); recargarTodo(); setDetalleId(guardado.id); }}
        />
      )}
      {detalleId && (
        <DetalleContrato
          key={detalleId}
          open
          contratoId={detalleId}
          onClose={cerrarDetalle}
          onEditar={abrirEdicion}
          onEliminar={eliminar}
          onCambio={recargarTodo}
        />
      )}
    </div>
  );
};

export default ContratosPage;
