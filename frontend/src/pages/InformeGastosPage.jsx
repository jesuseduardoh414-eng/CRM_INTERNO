// Informe de gastos (/gastos/informe): tabla de meses por partidas (las
// columnas son las partidas creadas en Tesorería) o por categorías, con
// totales y descarga a Excel. Permiso `informe` (usuario.finanzas).
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
import { ListSkeleton } from '../components/Skeleton';
import { Cifras, ErrorCarga, PuntoPartida, SelectorAnio, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import { OPCIONES_SWR_FINANZAS, aniosSelector, nivelFinanzas, nombreMes } from '../utils/finanzas';
import NavCategoriasGastos from '../components/finanzas/NavCategoriasGastos';

const VISTAS = ['partidas', 'categorias'];

const InformeGastosPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const { monto, locale } = useFormatoFinanzas();
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [vista, setVista] = useState('partidas');
  const [descargando, setDescargando] = useState(false);
  const puedeVer = nivelFinanzas(usuario, 'informe') !== 'ninguno';

  const { data, error, isLoading, mutate } = useSWR(puedeVer ? ['finanzas-informe', anio, vista] : null, () => finanzasService.informe({ anio, vista }), OPCIONES_SWR_FINANZAS);

  if (!puedeVer) return <Navigate to="/gastos" replace />;

  const descargar = async () => {
    setDescargando(true);
    try {
      await finanzasService.descargarInforme({ anio, vista });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDescargando(false);
    }
  };

  const columnas = data?.columnas || [];
  // Un año con solo asignaciones (sin gastos) también se muestra: la fila de lo asignado.
  const totalAsignado = data?.asignado ? Object.values(data.asignado).reduce((a, b) => a + b, 0) : 0;
  const hayDatos = data && (data.totales.total > 0 || totalAsignado > 0);
  const celda = (valor) => (valor ? <span className="tabular-nums">{monto(valor)}</span> : <span className="text-[var(--color-text-muted)]">—</span>);
  const mesActual = new Date().getMonth() + 1;

  const cifras = data ? [
    { clave: 'total', etiqueta: tf('finInfTotalAnio', { anio }), valor: monto(data.totales.total) },
    { clave: 'pendientes', etiqueta: tf('finInfPendientes'), valor: monto(data.pendientes), alerta: data.pendientes > 0 && 'warning' },
    { clave: 'promedio', etiqueta: tf('finInfPromedioMes'), valor: monto(data.totales.total / Math.max(1, anio === new Date().getFullYear() ? mesActual : 12)) },
    ...(data.asignado ? [{ clave: 'asignado', etiqueta: tf('finInfAsignadoAnio'), valor: monto(Object.values(data.asignado).reduce((a, b) => a + b, 0)) }] : []),
  ] : [];

  return (
    <div className="mx-auto max-w-7xl">
      <NavCategoriasGastos />
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{tf('finGastosTitulo')}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finInformeTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finInformeSubtitulo')}</p>
        </div>
        <Button variant="outline" className="w-full md:w-auto" onClick={descargar} disabled={descargando || !hayDatos}>
          {descargando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {tf('finExcel')}
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <CampoFiltro label={tf('finAnio')}>
          <SelectorAnio anio={anio} anios={aniosSelector()} onCambio={setAnio} etiqueta={tf('finAnio')} />
        </CampoFiltro>
        <CampoFiltro label={tf('finInfColumnas')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={tf('finInfColumnas')}>
            {VISTAS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>{tf(`finInfVista_${v}`)}</button>
            ))}
          </div>
        </CampoFiltro>
      </div>

      {data && <Cifras cifras={cifras} className="mb-6" />}

      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={6} header={false} /></div>}
        {error && !data && <ErrorCarga texto={tf('finErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
        {data && !hayDatos && <Vacio titulo={tf('finInfVacio', { anio })} texto={tf('finInfVacioHint')} />}
        {hayDatos && (
          <div className="rep-tabla-envoltura">
            <table className="rep-tabla fin-informe">
              <thead>
                <tr>
                  <th>{tf('finInfMes')}</th>
                  {columnas.map((c) => (
                    <th key={c.clave} className="rep-num">
                      <span className="inline-flex items-center gap-1.5">
                        {vista === 'partidas' && c.partidaId && <PuntoPartida color={c.color} />}
                        {vista === 'categorias' ? tf(`finCat${c.clave}`) : c.clave === 'sin' ? tf('finSinPartida') : c.nombre}
                        {c.activa === false && <span className="badge-neutral">{tf('finArchivada')}</span>}
                      </span>
                    </th>
                  ))}
                  <th className="rep-num">{tf('finTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {data.filas.map((fila) => (
                  <tr key={fila.mes} className={anio === new Date().getFullYear() && fila.mes === mesActual ? 'fin-mes-actual' : undefined}>
                    <td className="capitalize">{nombreMes(fila.mes, locale)}</td>
                    {columnas.map((c) => <td key={c.clave} className="rep-num">{celda(fila.valores[c.clave])}</td>)}
                    <td className="rep-num font-semibold">{celda(fila.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{tf('finTotal')}</td>
                  {columnas.map((c) => <td key={c.clave} className="rep-num">{celda(data.totales[c.clave])}</td>)}
                  <td className="rep-num">{celda(data.totales.total)}</td>
                </tr>
                {data.asignado && (
                  <tr className="fin-fila-asignado">
                    <td>{tf('finInfAsignadoAnio')}</td>
                    {columnas.map((c) => <td key={c.clave} className="rep-num">{celda(data.asignado[c.clave])}</td>)}
                    <td className="rep-num">{celda(Object.values(data.asignado).reduce((a, b) => a + b, 0))}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        {data?.excluidos?.otrasMonedas > 0 && (
          <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">{tf('finInfOtrasMonedas', { n: data.excluidos.otrasMonedas, moneda: data.moneda })}</p>
        )}
      </div>
    </div>
  );
};

export default InformeGastosPage;
