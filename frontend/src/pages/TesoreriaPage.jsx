// Tesorería: la bolsa de ingresos (pagos registrados) y el presupuesto de cada
// mes por categoría de gastos, que sale de esa bolsa. Cada categoría muestra
// presupuesto, gastado, pendiente y remanente; al cerrar el mes, lo que no se
// gastó vuelve a la bolsa. Permiso `tesoreria` (ver / editar).
import { useState } from 'react';
import useSWR from 'swr';
import { Link, Navigate } from 'react-router-dom';
import { CalendarCheck, ChevronLeft, ChevronRight, Landmark, PiggyBank, SlidersHorizontal, Wallet } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import FormularioPresupuesto from '../components/finanzas/FormularioPresupuesto';
import { Cifras, ErrorCarga, Panel, SelectorAnio, TarjetaPresupuesto, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import {
  OPCIONES_SWR_FINANZAS, aniosSelector, moverMes, nombreMes, nombreMesAnio, puedeFinanzas, puedeVerFinanzas, recargarFinanzas, rutaCategoria,
} from '../utils/finanzas';
import GestionCuentas from '../components/finanzas/GestionCuentas';

const TesoreriaPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, locale } = useFormatoFinanzas();
  // null = el mes actual (lo decide el servidor, en la zona de la empresa).
  const [periodo, setPeriodo] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [cuentasAbiertas, setCuentasAbiertas] = useState(false);
  const puedeVer = puedeFinanzas(usuario, 'tesoreria');
  const puedeEditar = puedeFinanzas(usuario, 'tesoreria', 'editar');

  const { data, error, isLoading, mutate } = useSWR(
    puedeVer ? ['finanzas-tesoreria', periodo?.anio ?? 'actual', periodo?.mes ?? 'actual'] : null,
    () => finanzasService.tesoreria.resumen(periodo || {}),
    { ...OPCIONES_SWR_FINANZAS, keepPreviousData: true },
  );

  if (!puedeVer) return <Navigate to="/dashboard" replace />;

  const negativo = (data?.sinAsignar ?? 0) < 0;
  const presupuesto = data?.presupuesto;
  const nombre = data ? nombreMesAnio(data.anio, data.mes, locale) : '';
  const esMesActual = data && data.anio === data.mesActual.anio && data.mes === data.mesActual.mes;
  const conMovimientos = presupuesto?.categorias.some((c) => c.presupuesto > 0 || c.gastado > 0 || c.comprometido > 0);
  const irA = (delta) => data && setPeriodo(moverMes({ anio: data.anio, mes: data.mes }, delta));
  const celda = (valor, { signo = false } = {}) => (valor
    ? <span className={`tabular-nums ${signo && valor < 0 ? 'text-[var(--color-error)]' : ''}`}>{monto(valor)}</span>
    : <span className="text-[var(--color-text-muted)]">—</span>);

  const cifras = data ? [
    { clave: 'ingresos', etiqueta: tf('finKpiBolsa'), valor: monto(data.ingresos), sub: tf('finKpiBolsaSub') },
    { clave: 'gastado', etiqueta: tf('finKpiGastadoTotal'), valor: monto(data.gastado), sub: tf('finKpiGastadoTotalSub', { monto: monto(data.comprometido) }) },
    { clave: 'apartado', etiqueta: tf('finKpiApartado'), valor: monto(data.apartado), sub: tf('finKpiApartadoSub') },
    { clave: 'sinAsignar', etiqueta: tf('finKpiSinAsignar'), valor: monto(data.sinAsignar), alerta: negativo ? 'error' : undefined, sub: negativo ? tf('finKpiSinAsignarNeg') : tf('finKpiSinAsignarSub') },
  ] : [];

  const navegador = data && (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => irA(-1)} aria-label={tf('finMesAnterior')} title={tf('finMesAnterior')}><ChevronLeft size={16} /></Button>
      {!esMesActual && (
        <Button variant="ghost" className="h-9 px-2.5 text-[12.5px]" onClick={() => setPeriodo(null)}><CalendarCheck size={14} /> {tf('finIrMesActual')}</Button>
      )}
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => irA(1)} aria-label={tf('finMesSiguiente')} title={tf('finMesSiguiente')}><ChevronRight size={16} /></Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finTesoreriaTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finTesoreriaSubtitulo')}</p>
        </div>
        {puedeEditar && (
          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            <Button variant="outline" className="w-full md:w-auto" onClick={() => setCuentasAbiertas(true)}><Landmark size={16} /> {tf('finCuentas')}</Button>
            <Button className="w-full md:w-auto" onClick={() => setFormAbierto(true)} disabled={!data}>
              <SlidersHorizontal size={16} /> {conMovimientos ? tf('finEditarPresupuesto') : tf('finFijarPresupuesto')}
            </Button>
          </div>
        )}
      </div>

      {isLoading && !data && <ListSkeleton rows={4} header={false} />}
      {error && !data && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}

      {data && (
        <>
          <Cifras cifras={cifras} className="mb-6" />
          {data.otrasMonedas > 0 && <p className="-mt-3 mb-5 text-[12.5px] text-[var(--color-text-muted)]">{tf('finTesOtrasMonedas', { n: data.otrasMonedas, moneda: data.moneda })}</p>}
          {data.ingresos === 0 && puedeVerFinanzas(usuario, 'ventas') && (
            <div className="alert-info mb-6">{tf('finTesSinIngresos')} <Link to="/ventas" className="font-medium underline">{tf('finIrVentas')}</Link></div>
          )}

          <Panel
            titulo={tf('finPresupuestoDe', { mes: nombre })}
            icono={<Wallet size={14} aria-hidden="true" />}
            className="mb-6"
            extra={navegador}
          >
            {presupuesto.cerrado && (
              <p className="border-b border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                <span className="badge-neutral mr-2">{tf('finMesCerrado')}</span>{tf('finMesCerradoHint')}
              </p>
            )}
            {!conMovimientos ? (
              <Vacio
                icono={<PiggyBank size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
                titulo={tf('finPresupuestoVacio', { mes: nombre })}
                texto={tf('finPresupuestoVacioHint')}
                accion={puedeEditar && <Button onClick={() => setFormAbierto(true)}><SlidersHorizontal size={16} /> {tf('finFijarPresupuesto')}</Button>}
              />
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {presupuesto.categorias.map((c) => (
                    <TarjetaPresupuesto
                      key={c.categoria}
                      fila={c}
                      titulo={tf(`finCat${c.categoria}`)}
                      tf={tf}
                      monto={monto}
                      extra={puedeVerFinanzas(usuario, `gastos.${c.categoria}`) && (
                        <Link to={rutaCategoria(c.categoria)} className="cli-enlace shrink-0 text-[12.5px]">{tf('finVerGastos')}</Link>
                      )}
                    />
                  ))}
                </ul>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                  <div className="font-medium text-[var(--color-text)]">{tf('finTotalMes')}</div>
                  <div>{tf('finPresupuesto')}: <strong className="tabular-nums text-[var(--color-text)]">{monto(presupuesto.totales.presupuesto)}</strong></div>
                  <div>{tf('finGastado')}: <strong className="tabular-nums text-[var(--color-text)]">{monto(presupuesto.totales.gastado)}</strong></div>
                  <div>{tf('finPendientePago')}: <strong className="tabular-nums text-[var(--color-text)]">{monto(presupuesto.totales.comprometido)}</strong></div>
                  <div>{tf('finRemanente')}: <strong className={`tabular-nums ${presupuesto.totales.remanente < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'}`}>{monto(presupuesto.totales.remanente)}</strong></div>
                </dl>
              </>
            )}
          </Panel>

          <Panel
            titulo={tf('finPorMes', { anio: data.anio })}
            extra={(
              <CampoFiltro label={tf('finAnio')}>
                <SelectorAnio anio={data.anio} anios={aniosSelector()} onCambio={(a) => setPeriodo({ anio: a, mes: data.mes })} etiqueta={tf('finAnio')} />
              </CampoFiltro>
            )}
          >
            <div className="rep-tabla-envoltura">
              <table className="rep-tabla fin-informe">
                <thead>
                  <tr>
                    <th>{tf('finInfMes')}</th>
                    <th className="rep-num">{tf('finIngresos')}</th>
                    <th className="rep-num">{tf('finPresupuesto')}</th>
                    <th className="rep-num">{tf('finGastado')}</th>
                    <th className="rep-num">{tf('finPendientePago')}</th>
                    <th className="rep-num">{tf('finRemanente')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porMes.map((m) => (
                    <tr key={m.mes} className={m.mes === data.mes ? 'fin-mes-actual' : undefined}>
                      <td>
                        <button type="button" className="cli-enlace capitalize" onClick={() => setPeriodo({ anio: data.anio, mes: m.mes })} aria-current={m.mes === data.mes ? 'true' : undefined}>
                          {nombreMes(m.mes, locale)}
                        </button>
                      </td>
                      <td className="rep-num">{celda(m.ingresos)}</td>
                      <td className="rep-num">{celda(m.presupuesto)}</td>
                      <td className="rep-num">{celda(m.gastado)}</td>
                      <td className="rep-num">{celda(m.comprometido)}</td>
                      <td className="rep-num">{celda(m.remanente, { signo: true })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{tf('finTotal')}</td>
                    {['ingresos', 'presupuesto', 'gastado', 'comprometido', 'remanente'].map((campo) => (
                      <td key={campo} className="rep-num">{celda(Math.round(data.porMes.reduce((s, m) => s + m[campo], 0) * 100) / 100, { signo: campo === 'remanente' })}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        </>
      )}

      {formAbierto && data && (
        <FormularioPresupuesto
          key={`${data.anio}-${data.mes}`}
          open
          presupuesto={data.presupuesto}
          anterior={data.anterior}
          sinAsignar={data.sinAsignar}
          onClose={() => setFormAbierto(false)}
          onGuardado={() => { setFormAbierto(false); recargarFinanzas(); }}
        />
      )}
      {cuentasAbiertas && <GestionCuentas open onClose={() => setCuentasAbiertas(false)} onCambio={recargarFinanzas} />}
    </div>
  );
};

export default TesoreriaPage;
