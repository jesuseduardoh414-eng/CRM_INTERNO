// Informe de gastos (/gastos/informe). Vistas:
//   presupuesto  presupuesto contra lo gastado por categoría, de un mes o del
//                año completo, más el resumen mes a mes
//   categorias   tabla de meses por categorías (lo gastado)
//   partidas     las partidas anteriores a los presupuestos por categoría
//                (solo historial; sale si existen)
// Con descarga a Excel. Permiso `finanzas.informe.ver` (usuario.permisos).
import { useState } from 'react';
import useSWR from 'swr';
import { Navigate } from 'react-router-dom';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ListSkeleton } from '../components/Skeleton';
import { Cifras, ErrorCarga, Panel, PuntoPartida, SelectorAnio, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import { OPCIONES_SWR_FINANZAS, aniosSelector, nombreMes, nombreMesAnio, puedeVerFinanzas } from '../utils/finanzas';
import NavCategoriasGastos from '../components/finanzas/NavCategoriasGastos';

const ANIO_COMPLETO = 'anio';

const InformeGastosPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const { monto, locale } = useFormatoFinanzas();
  const hoy = new Date();
  const [anio, setAnio] = useState(() => hoy.getFullYear());
  const [vista, setVista] = useState('presupuesto');
  // Mes del informe de presupuesto (1-12) o null = año completo.
  const [mes, setMes] = useState(() => hoy.getMonth() + 1);
  const [descargando, setDescargando] = useState(false);
  const puedeVer = puedeVerFinanzas(usuario, 'informe');
  const params = { anio, vista, ...(vista === 'presupuesto' && mes ? { mes } : {}) };

  const { data, error, mutate } = useSWR(
    puedeVer ? ['finanzas-informe', anio, vista, vista === 'presupuesto' ? mes : null] : null,
    () => finanzasService.informe(params),
    { ...OPCIONES_SWR_FINANZAS, keepPreviousData: true },
  );

  if (!puedeVer) return <Navigate to="/gastos" replace />;

  const descargar = async () => {
    setDescargando(true);
    try {
      await finanzasService.descargarInforme(params);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDescargando(false);
    }
  };

  // Mientras llega una vista nueva, keepPreviousData trae la anterior: no se pinta mezclada.
  const actual = data?.vista === vista ? data : null;
  const vistas = ['presupuesto', 'categorias', ...(data?.hayPartidas ? ['partidas'] : [])];
  const celda = (valor, { signo = false } = {}) => (valor
    ? <span className={`tabular-nums ${signo && valor < 0 ? 'text-[var(--color-error)]' : ''}`}>{monto(valor)}</span>
    : <span className="text-[var(--color-text-muted)]">—</span>);
  const mesActual = hoy.getMonth() + 1;
  const periodo = mes ? nombreMesAnio(anio, mes, locale) : String(anio);

  let hayDatos = false;
  let cifras = [];
  if (actual?.vista === 'presupuesto') {
    const tot = actual.totales;
    hayDatos = tot.presupuesto > 0 || tot.gastado > 0 || tot.comprometido > 0;
    cifras = [
      { clave: 'presupuesto', etiqueta: tf('finInfPresupuestado'), valor: monto(tot.presupuesto) },
      { clave: 'gastado', etiqueta: tf('finGastado'), valor: monto(tot.gastado), sub: tot.comprometido > 0 ? tf('finInfPendienteSub', { monto: monto(tot.comprometido) }) : undefined },
      { clave: 'remanente', etiqueta: tf('finRemanente'), valor: monto(tot.remanente), alerta: tot.remanente < 0 ? 'error' : undefined },
      { clave: 'usado', etiqueta: tf('finInfUsado'), valor: tot.porcentaje === null ? '—' : `${tot.porcentaje}%`, alerta: tot.porcentaje > 100 ? 'error' : undefined },
    ];
  } else if (actual) {
    const totalAsignado = actual.asignado ? Object.values(actual.asignado).reduce((a, b) => a + b, 0) : 0;
    hayDatos = actual.totales.total > 0 || totalAsignado > 0;
    cifras = [
      { clave: 'total', etiqueta: tf('finInfTotalAnio', { anio }), valor: monto(actual.totales.total) },
      { clave: 'pendientes', etiqueta: tf('finInfPendientes'), valor: monto(actual.pendientes), alerta: actual.pendientes > 0 && 'warning' },
      { clave: 'promedio', etiqueta: tf('finInfPromedioMes'), valor: monto(actual.totales.total / Math.max(1, anio === hoy.getFullYear() ? mesActual : 12)) },
      ...(actual.asignado ? [{ clave: 'asignado', etiqueta: tf('finInfAsignadoAnio'), valor: monto(totalAsignado) }] : []),
    ];
  }

  return (
    <div className="mx-auto max-w-7xl">
      <NavCategoriasGastos />
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{tf('finGastosTitulo')}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finInformeTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finInformeSubtitulo')}</p>
        </div>
        <Button variant="outline" className="w-full md:w-auto" onClick={descargar} disabled={descargando || !actual}>
          {descargando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {tf('finExcel')}
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <CampoFiltro label={tf('finInfVista')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={tf('finInfVista')}>
            {vistas.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>{tf(`finInfVista_${v}`)}</button>
            ))}
          </div>
        </CampoFiltro>
        <CampoFiltro label={tf('finAnio')}>
          <SelectorAnio anio={anio} anios={aniosSelector()} onCambio={setAnio} etiqueta={tf('finAnio')} />
        </CampoFiltro>
        {vista === 'presupuesto' && (
          <CampoFiltro label={tf('finInfPeriodo')}>
            <Select value={mes ? String(mes) : ANIO_COMPLETO} onValueChange={(v) => setMes(v === ANIO_COMPLETO ? null : Number(v))}>
              <SelectTrigger aria-label={tf('finInfPeriodo')} className="h-10 w-[180px] text-[13.5px] font-normal capitalize"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value={ANIO_COMPLETO} className="text-sm font-normal">{tf('finInfAnioCompleto')}</SelectItem>
                {Array.from({ length: 12 }, (_v, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)} className="text-sm font-normal capitalize">{nombreMes(i + 1, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>
        )}
      </div>

      {actual && <Cifras cifras={cifras} className="mb-6" />}

      {(!actual || actual.vista !== 'presupuesto') && (
        <div className="cli-panel overflow-hidden">
          {!actual && !error && <div className="p-4"><ListSkeleton rows={6} header={false} /></div>}
          {error && !actual && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
          {actual?.vista === 'partidas' && <p className="border-b border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">{tf('finInfPartidasHint')}</p>}
          {actual && !hayDatos && <Vacio titulo={tf('finInfVacio', { anio })} texto={tf('finInfVacioHint')} />}
          {actual && hayDatos && (
            <div className="rep-tabla-envoltura">
              <table className="rep-tabla fin-informe">
                <thead>
                  <tr>
                    <th>{tf('finInfMes')}</th>
                    {actual.columnas.map((c) => (
                      <th key={c.clave} className="rep-num">
                        <span className="inline-flex items-center gap-1.5">
                          {actual.vista === 'partidas' && c.partidaId && <PuntoPartida color={c.color} />}
                          {actual.vista === 'categorias' ? tf(`finCat${c.clave}`) : c.clave === 'sin' ? tf('finSinPartida') : c.nombre}
                        </span>
                      </th>
                    ))}
                    <th className="rep-num">{tf('finTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {actual.filas.map((fila) => (
                    <tr key={fila.mes} className={anio === hoy.getFullYear() && fila.mes === mesActual ? 'fin-mes-actual' : undefined}>
                      <td className="capitalize">{nombreMes(fila.mes, locale)}</td>
                      {actual.columnas.map((c) => <td key={c.clave} className="rep-num">{celda(fila.valores[c.clave])}</td>)}
                      <td className="rep-num font-semibold">{celda(fila.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{tf('finTotal')}</td>
                    {actual.columnas.map((c) => <td key={c.clave} className="rep-num">{celda(actual.totales[c.clave])}</td>)}
                    <td className="rep-num">{celda(actual.totales.total)}</td>
                  </tr>
                  {actual.asignado && (
                    <tr className="fin-fila-asignado">
                      <td>{tf('finInfAsignadoAnio')}</td>
                      {actual.columnas.map((c) => <td key={c.clave} className="rep-num">{celda(actual.asignado[c.clave])}</td>)}
                      <td className="rep-num">{celda(Object.values(actual.asignado).reduce((a, b) => a + b, 0))}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
          {actual?.excluidos?.otrasMonedas > 0 && (
            <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">{tf('finInfOtrasMonedas', { n: actual.excluidos.otrasMonedas, moneda: actual.moneda })}</p>
          )}
        </div>
      )}

      {actual?.vista === 'presupuesto' && (
        <>
          <Panel titulo={tf('finPresupuestoDe', { mes: periodo })} className="mb-6">
            {!hayDatos ? (
              <Vacio titulo={tf('finInfVacioPresupuesto', { periodo })} texto={tf('finInfVacioPresupuestoHint')} />
            ) : (
              <div className="rep-tabla-envoltura">
                <table className="rep-tabla">
                  <thead>
                    <tr>
                      <th>{tf('finCategoria')}</th>
                      <th className="rep-num">{tf('finPresupuesto')}</th>
                      <th className="rep-num">{tf('finGastado')}</th>
                      <th className="rep-num">{tf('finPendientePago')}</th>
                      <th className="rep-num">{tf('finRemanente')}</th>
                      <th className="rep-num">{tf('finPctUsado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actual.filas.map((f) => (
                      <tr key={f.categoria}>
                        <td>{tf(`finCat${f.categoria}`)}</td>
                        <td className="rep-num">{celda(f.presupuesto)}</td>
                        <td className="rep-num">{celda(f.gastado)}</td>
                        <td className="rep-num">{celda(f.comprometido)}</td>
                        <td className="rep-num">{celda(f.remanente, { signo: true })}</td>
                        <td className={`rep-num tabular-nums ${f.porcentaje > 100 ? 'text-[var(--color-error)]' : ''}`}>{f.porcentaje === null ? <span className="text-[var(--color-text-muted)]">—</span> : `${f.porcentaje}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{tf('finTotal')}</td>
                      <td className="rep-num">{celda(actual.totales.presupuesto)}</td>
                      <td className="rep-num">{celda(actual.totales.gastado)}</td>
                      <td className="rep-num">{celda(actual.totales.comprometido)}</td>
                      <td className="rep-num">{celda(actual.totales.remanente, { signo: true })}</td>
                      <td className="rep-num tabular-nums">{actual.totales.porcentaje === null ? '—' : `${actual.totales.porcentaje}%`}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {actual.excluidos?.otrasMonedas > 0 && (
              <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">{tf('finInfOtrasMonedas', { n: actual.excluidos.otrasMonedas, moneda: actual.moneda })}</p>
            )}
          </Panel>

          <Panel titulo={tf('finPorMes', { anio })}>
            <div className="rep-tabla-envoltura">
              <table className="rep-tabla fin-informe">
                <thead>
                  <tr>
                    <th>{tf('finInfMes')}</th>
                    <th className="rep-num">{tf('finPresupuesto')}</th>
                    <th className="rep-num">{tf('finGastado')}</th>
                    <th className="rep-num">{tf('finPendientePago')}</th>
                    <th className="rep-num">{tf('finRemanente')}</th>
                  </tr>
                </thead>
                <tbody>
                  {actual.porMes.map((m) => (
                    <tr key={m.mes} className={m.mes === mes ? 'fin-mes-actual' : undefined}>
                      <td>
                        <button type="button" className="cli-enlace capitalize" onClick={() => setMes(m.mes)} aria-current={m.mes === mes ? 'true' : undefined}>{nombreMes(m.mes, locale)}</button>
                      </td>
                      <td className="rep-num">{celda(m.presupuesto)}</td>
                      <td className="rep-num">{celda(m.gastado)}</td>
                      <td className="rep-num">{celda(m.comprometido)}</td>
                      <td className="rep-num">{celda(m.remanente, { signo: true })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={mes === null ? 'fin-mes-actual' : undefined}>
                    <td>
                      <button type="button" className="cli-enlace" onClick={() => setMes(null)} aria-current={mes === null ? 'true' : undefined}>{tf('finInfAnioCompleto')}</button>
                    </td>
                    {['presupuesto', 'gastado', 'comprometido', 'remanente'].map((campo) => (
                      <td key={campo} className="rep-num">{celda(Math.round(actual.porMes.reduce((s, m) => s + m[campo], 0) * 100) / 100, { signo: campo === 'remanente' })}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
};

export default InformeGastosPage;
