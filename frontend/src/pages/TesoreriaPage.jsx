// Tesorería: la bolsa de ingresos (pagos registrados) y cómo se reparte en
// partidas. Cada partida muestra lo asignado, lo gastado, lo comprometido
// (gastos pendientes) y lo disponible. Permiso `tesoreria` (ver / editar).
import { useState } from 'react';
import useSWR from 'swr';
import { Link, Navigate } from 'react-router-dom';
import { Archive, ArrowDownToLine, FolderPlus, Landmark, Pencil, PiggyBank, Plus, Trash2, Wallet } from 'lucide-react';
import { finanzasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { useConfirmacion } from '../components/ConfirmDialog';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import ActionMenu from '../components/ActionMenu';
import { Button } from '../components/ui/button';
import FormularioPartida from '../components/finanzas/FormularioPartida';
import FormularioAsignacion from '../components/finanzas/FormularioAsignacion';
import { Cifras, ErrorCarga, Panel, PuntoPartida, SelectorAnio, Vacio } from '../components/finanzas/piezas';
import { useFormatoFinanzas } from '../hooks/useFormatoFinanzas';
import {
  OPCIONES_SWR_FINANZAS, aniosSelector, nivelFinanzas, nombreMes, puedeVerFinanzas, recargarFinanzas, tieneAccesoGastos,
} from '../utils/finanzas';
import GestionCuentas from '../components/finanzas/GestionCuentas';

// Tarjeta de una partida: disponible, barra de gastado / comprometido y cifras.
const TarjetaPartida = ({ p, acciones, tf, monto }) => {
  const base = Math.max(p.asignado, p.gastado + p.comprometido, 0.01);
  const pctGastado = Math.min(100, (p.gastado / base) * 100);
  const pctComprometido = Math.min(100 - pctGastado, (p.comprometido / base) * 100);
  return (
    <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text)]">
            <PuntoPartida color={p.color} size={10} />
            <span className="truncate">{p.nombre}</span>
            {!p.activa && <span className="badge-neutral">{tf('finArchivada')}</span>}
          </div>
          {p.descripcion && <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{p.descripcion}</p>}
        </div>
        {acciones.length > 0 && <ActionMenu size={16} className="-mr-2 -mt-1 h-9 w-9" items={acciones} />}
      </div>
      <div className={`mt-3 text-[22px] font-semibold tabular-nums ${p.disponible < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'}`}>{monto(p.disponible)}</div>
      <div className="text-[11.5px] uppercase tracking-wider text-[var(--color-text-muted)]">{tf('finDisponible')}</div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]" role="img" aria-label={tf('finBarraPartida', { gastado: monto(p.gastado), comprometido: monto(p.comprometido), asignado: monto(p.asignado) })}>
        <span style={{ width: `${pctGastado}%`, background: p.color || 'var(--color-primary)' }} />
        <span style={{ width: `${pctComprometido}%`, background: p.color || 'var(--color-primary)', opacity: 0.45 }} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div><dt className="text-[var(--color-text-muted)]">{tf('finAsignado')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(p.asignado)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{tf('finGastado')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(p.gastado)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{tf('finComprometido')}</dt><dd className="font-medium tabular-nums text-[var(--color-text)]">{monto(p.comprometido)}</dd></div>
      </dl>
    </li>
  );
};


const TesoreriaPage = () => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha, locale } = useFormatoFinanzas();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [formPartida, setFormPartida] = useState(null);
  const [formAsignacion, setFormAsignacion] = useState(null);
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [cuentasAbiertas, setCuentasAbiertas] = useState(false);
  const nivel = nivelFinanzas(usuario, 'tesoreria');
  const puedeVer = nivel !== 'ninguno';
  const puedeEditar = nivel === 'editar';

  const { data, error, isLoading, mutate } = useSWR(puedeVer ? ['finanzas-tesoreria', anio] : null, () => finanzasService.tesoreria.resumen({ anio }), OPCIONES_SWR_FINANZAS);

  if (!puedeVer) return <Navigate to="/dashboard" replace />;

  const partidas = data?.partidas || [];
  const activas = partidas.filter((p) => p.activa);
  const archivadas = partidas.filter((p) => !p.activa);
  const negativo = (data?.sinAsignar ?? 0) < 0;

  const archivarPartida = async (p) => {
    const archivar = conMovimientos(p);
    const ok = await confirmar({
      titulo: archivar ? tf('finPartidaArchivarConfirm', { nombre: p.nombre }) : tf('finPartidaEliminarConfirm', { nombre: p.nombre }),
      descripcion: archivar ? tf('finPartidaArchivarTexto') : tf('finPartidaEliminarTexto'),
      textoConfirmar: archivar ? tf('finArchivar') : t('delete'),
      peligro: !archivar,
    });
    if (!ok) return;
    try {
      const res = await finanzasService.partidas.eliminar(p.id);
      showToast(res.archivada ? tf('finPartidaArchivada') : tf('finPartidaEliminada'), 'success');
      recargarFinanzas();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const reactivarPartida = async (p) => {
    try {
      await finanzasService.partidas.editar(p.id, { activa: true });
      showToast(tf('finPartidaReactivada'), 'success');
      recargarFinanzas();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const eliminarAsignacion = async (a) => {
    const ok = await confirmar({ titulo: tf('finAsignacionEliminarConfirm', { monto: monto(a.monto), partida: a.partida?.nombre || '' }), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await finanzasService.tesoreria.eliminarAsignacion(a.id);
      showToast(tf('finAsignacionEliminada'), 'success');
      recargarFinanzas();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const conMovimientos = (p) => p.totalAsignaciones > 0 || p.totalGastos > 0;
  const accionesDe = (p) => (puedeEditar ? [
    p.activa && { label: tf('finAsignar'), icon: <ArrowDownToLine size={14} />, onSelect: () => setFormAsignacion({ asignacion: null, partidaId: p.id, clave: Date.now() }) },
    { label: t('edit'), icon: <Pencil size={14} />, onSelect: () => setFormPartida({ partida: p, clave: Date.now() }) },
    !p.activa && { label: tf('finReactivar'), icon: <FolderPlus size={14} />, onSelect: () => reactivarPartida(p) },
    p.activa && { separator: true },
    p.activa && { label: conMovimientos(p) ? tf('finArchivar') : t('delete'), icon: conMovimientos(p) ? <Archive size={14} /> : <Trash2 size={14} />, danger: true, onSelect: () => archivarPartida(p) },
  ] : []);

  const cifras = data ? [
    { clave: 'ingresos', etiqueta: tf('finKpiBolsa'), valor: monto(data.ingresos), sub: tf('finKpiBolsaSub') },
    { clave: 'asignado', etiqueta: tf('finKpiAsignado'), valor: monto(data.asignado), sub: tf('finKpiAsignadoSub', { n: activas.length }) },
    { clave: 'sinAsignar', etiqueta: tf('finKpiSinAsignar'), valor: monto(data.sinAsignar), alerta: negativo ? 'error' : undefined, sub: negativo ? tf('finKpiSinAsignarNeg') : undefined },
    { clave: 'gastado', etiqueta: tf('finKpiGastadoPartidas'), valor: monto(partidas.reduce((s, p) => s + p.gastado, 0)), sub: tf('finKpiComprometidoSub', { monto: monto(partidas.reduce((s, p) => s + p.comprometido, 0)) }) },
  ] : [];

  return (
    <div className="mx-auto max-w-7xl">
      {dialogo}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tf('finTesoreriaTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tf('finTesoreriaSubtitulo')}</p>
        </div>
        {puedeEditar && (
          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            <Button variant="outline" className="w-full md:w-auto" onClick={() => setCuentasAbiertas(true)}><Landmark size={16} /> {tf('finCuentas')}</Button>
            <Button variant="outline" className="w-full md:w-auto" onClick={() => setFormPartida({ partida: null, clave: Date.now() })}><FolderPlus size={16} /> {tf('finPartidaNueva')}</Button>
            <Button className="w-full md:w-auto" onClick={() => setFormAsignacion({ asignacion: null, partidaId: null, clave: Date.now() })} disabled={activas.length === 0}><ArrowDownToLine size={16} /> {tf('finAsignar')}</Button>
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
            titulo={tf('finPartidas')}
            icono={<Wallet size={14} aria-hidden="true" />}
            conteo={activas.length}
            className="mb-6"
            extra={archivadas.length > 0 && (
              <button type="button" className="cli-enlace" onClick={() => setVerArchivadas((v) => !v)}>
                {verArchivadas ? tf('finOcultarArchivadas') : tf('finVerArchivadas', { n: archivadas.length })}
              </button>
            )}
          >
            {partidas.length === 0 ? (
              <Vacio
                icono={<PiggyBank size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
                titulo={tf('finPartidasVacio')}
                texto={tf('finPartidasVacioHint')}
                accion={puedeEditar && <Button onClick={() => setFormPartida({ partida: null, clave: Date.now() })}><Plus size={16} /> {tf('finPartidaNueva')}</Button>}
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {activas.map((p) => <TarjetaPartida key={p.id} p={p} acciones={accionesDe(p)} tf={tf} monto={monto} />)}
                {verArchivadas && archivadas.map((p) => <TarjetaPartida key={p.id} p={p} acciones={accionesDe(p)} tf={tf} monto={monto} />)}
              </ul>
            )}
            {(data.sinPartida.gastado > 0 || data.sinPartida.comprometido > 0) && (
              <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                {tf('finSinPartidaResumen', { gastado: monto(data.sinPartida.gastado), comprometido: monto(data.sinPartida.comprometido) })}
              </p>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel
              titulo={tf('finPorMes', { anio })}
              extra={(
                <CampoFiltro label={tf('finAnio')}>
                  <SelectorAnio anio={anio} anios={aniosSelector()} onCambio={setAnio} etiqueta={tf('finAnio')} />
                </CampoFiltro>
              )}
            >
              <div className="rep-tabla-envoltura">
                <table className="rep-tabla">
                  <thead>
                    <tr>
                      <th>{tf('finInfMes')}</th>
                      <th className="rep-num">{tf('finIngresos')}</th>
                      <th className="rep-num">{tf('finAsignado')}</th>
                      <th className="rep-num">{tf('finGastadoConPartidaOSin')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porMes.map((m) => (
                      <tr key={m.mes}>
                        <td className="capitalize">{nombreMes(m.mes, locale)}</td>
                        <td className="rep-num tabular-nums">{m.ingresos ? monto(m.ingresos) : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                        <td className="rep-num tabular-nums">{m.asignado ? monto(m.asignado) : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                        <td className="rep-num tabular-nums">{m.gastado ? monto(m.gastado) : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{tf('finTotal')}</td>
                      <td className="rep-num tabular-nums">{monto(data.porMes.reduce((s, m) => s + m.ingresos, 0))}</td>
                      <td className="rep-num tabular-nums">{monto(data.porMes.reduce((s, m) => s + m.asignado, 0))}</td>
                      <td className="rep-num tabular-nums">{monto(data.porMes.reduce((s, m) => s + m.gastado, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Panel>

            <Panel titulo={tf('finUltimasAsignaciones')} conteo={data.ultimasAsignaciones.length}>
              {data.ultimasAsignaciones.length === 0
                ? <p className="px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">{tf('finAsignacionesVacio')}</p>
                : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {data.ultimasAsignaciones.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <PuntoPartida color={a.partida?.color} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-[var(--color-text)]">{a.partida?.nombre}{a.nota ? <span className="font-normal text-[var(--color-text-muted)]"> · {a.nota}</span> : null}</div>
                          <div className="text-[12px] text-[var(--color-text-muted)]">{fecha(a.fecha)} · {a.creadoPor?.nombre || '—'}</div>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--color-text)]">{monto(a.monto)}</span>
                        {puedeEditar && (
                          <ActionMenu size={15} className="-mr-2 h-9 w-9" items={[
                            { label: t('edit'), icon: <Pencil size={14} />, onSelect: () => setFormAsignacion({ asignacion: a, partidaId: null, clave: Date.now() }) },
                            { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => eliminarAsignacion(a) },
                          ]} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              {activas.length > 0 && tieneAccesoGastos(usuario) && (
                <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                  {tf('finVerGastosPartidaHint')} <Link to="/gastos" className="cli-enlace">{tf('finIrGastos')}</Link>
                </p>
              )}
            </Panel>
          </div>
        </>
      )}

      {formPartida && (
        <FormularioPartida key={formPartida.clave} open partida={formPartida.partida} onClose={() => setFormPartida(null)} onGuardado={() => { setFormPartida(null); recargarFinanzas(); }} />
      )}
      {formAsignacion && (
        <FormularioAsignacion
          key={formAsignacion.clave}
          open
          asignacion={formAsignacion.asignacion}
          partidas={partidas}
          partidaInicial={formAsignacion.partidaId}
          sinAsignar={data?.sinAsignar ?? 0}
          onClose={() => setFormAsignacion(null)}
          onGuardado={() => { setFormAsignacion(null); recargarFinanzas(); }}
        />
      )}
      {cuentasAbiertas && <GestionCuentas open onClose={() => setCuentasAbiertas(false)} onCambio={recargarFinanzas} />}
    </div>
  );
};

export default TesoreriaPage;
