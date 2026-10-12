// Ficha de un gasto: datos, comprobantes, bitácora y acciones (marcar
// pagado, volver a pendiente, duplicar al mes siguiente, anular, eliminar).
import { useEffect, useState } from 'react';
import { Ban, CalendarClock, CheckCircle2, Copy, Edit2, History, RotateCcw, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import ActionMenu from '../ActionMenu';
import { ListSkeleton } from '../Skeleton';
import Comprobantes from './Comprobantes';
import Bitacora from './Bitacora';
import { Dato, PuntoPartida } from './piezas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { finanzasService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useConfirmacion } from '../ConfirmDialog';
import { BADGE_ESTADO_GASTO, estadoVisibleGasto, puedeEditarFinanzas } from '../../utils/finanzas';

const DetalleGasto = ({ open, gastoId, onClose, onEditar, onCambio, onDuplicado }) => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha, fechaHora } = useFormatoFinanzas();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [gasto, setGasto] = useState(null);
  const [error, setError] = useState(null);
  const [verBitacora, setVerBitacora] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const recargar = async () => {
    const data = await finanzasService.gastos.obtener(gastoId);
    setGasto(data.gasto);
    return data.gasto;
  };

  useEffect(() => {
    let cancelado = false;
    finanzasService.gastos.obtener(gastoId)
      .then((data) => { if (!cancelado) setGasto(data.gasto); })
      .catch((err) => { if (!cancelado) setError(err.message); });
    return () => { cancelado = true; };
  }, [gastoId]);

  const ejecutar = async (accion, mensaje) => {
    setOcupado(true);
    try {
      await accion();
      showToast(mensaje, 'success');
      await recargar();
      onCambio();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };

  const pagar = () => ejecutar(() => finanzasService.gastos.pagar(gasto.id), tf('finGastoPagado'));
  const reabrir = () => ejecutar(() => finanzasService.gastos.reabrir(gasto.id), tf('finGastoReabierto'));
  const anular = async () => {
    const ok = await confirmar({ titulo: tf('finGastoAnularConfirm', { folio: gasto.folio }), descripcion: tf('finGastoAnularTexto'), textoConfirmar: tf('finAnular'), peligro: true });
    if (ok) ejecutar(() => finanzasService.gastos.anular(gasto.id), tf('finGastoAnulado'));
  };
  const duplicar = async () => {
    const ok = await confirmar({ titulo: tf('finGastoDuplicarConfirm', { folio: gasto.folio }), descripcion: tf('finGastoDuplicarTexto'), textoConfirmar: tf('finDuplicar') });
    if (!ok) return;
    setOcupado(true);
    try {
      const data = await finanzasService.gastos.duplicar(gasto.id, 1);
      showToast(tf('finGastoDuplicado', { folio: data.gasto.folio }), 'success');
      onCambio();
      onDuplicado?.(data.gasto);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const eliminar = async () => {
    const ok = await confirmar({ titulo: tf('finGastoEliminarConfirm', { folio: gasto.folio }), descripcion: tf('finEliminarTexto'), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await finanzasService.gastos.eliminar(gasto.id);
      showToast(tf('finGastoEliminado'), 'success');
      onCambio();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const puedeEditar = gasto ? puedeEditarFinanzas(usuario, `gastos.${gasto.categoria}`) : false;
  const estado = gasto ? estadoVisibleGasto(gasto) : null;
  const anulado = gasto?.estado === 'ANULADO';
  const acciones = gasto && puedeEditar ? [
    // Mientras una acción está en curso no se puede lanzar otra (doble clic).
    !anulado && { label: t('edit'), icon: <Edit2 size={14} />, onSelect: () => onEditar(gasto), disabled: ocupado },
    gasto.estado === 'PAGADO' && { label: tf('finVolverPendiente'), icon: <RotateCcw size={14} />, onSelect: reabrir, disabled: ocupado },
    !anulado && { label: tf('finDuplicarMes'), icon: <Copy size={14} />, onSelect: duplicar, disabled: ocupado },
    !anulado && { label: tf('finAnular'), icon: <Ban size={14} />, onSelect: anular, disabled: ocupado },
    { separator: true },
    { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onSelect: eliminar },
  ] : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="900px"
      title={gasto ? gasto.concepto : tf('finGasto')}
      subtitle={gasto ? `${gasto.folio} · ${tf(`finCat${gasto.categoria}`)}` : undefined}
      headerExtra={gasto && (
        <div className="flex items-center gap-2">
          <span className={BADGE_ESTADO_GASTO[estado] || 'badge-neutral'}>{tf(`finEstadoGasto${estado}`)}</span>
          {acciones.length > 0 && <ActionMenu size={18} className="h-10 w-10" items={acciones} />}
        </div>
      )}
    >
      {dialogo}
      {error && <div className="alert-error">{error}</div>}
      {!gasto && !error && <ListSkeleton rows={4} header={false} />}
      {gasto && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {anulado && <div className="alert-info">{tf('finGastoAnuladoAviso')}{gasto.motivoAnulacion ? `: ${gasto.motivoAnulacion}` : ''}</div>}
            {gasto.vencido && <div className="alert-error">{tf('finGastoVencidoAviso', { n: Math.abs(gasto.diasRestantes) })}</div>}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{tf('finMonto')}</div>
                  <div className={`mt-1 text-[28px] font-semibold tabular-nums ${anulado ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}`}>{monto(gasto.monto, gasto.moneda)}</div>
                </div>
                {puedeEditar && gasto.estado === 'PENDIENTE' && (
                  <Button onClick={pagar} disabled={ocupado}><CheckCircle2 size={16} /> {tf('finMarcarPagado')}</Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-text-muted)]">
                <span>{tf('finFechaGasto')}: {fecha(gasto.fecha)}</span>
                {gasto.fechaLimite && <span className={gasto.vencido ? 'font-semibold text-[var(--color-error)]' : ''}><CalendarClock size={12} className="mr-1 inline" aria-hidden="true" />{tf('finFechaLimite')}: {fecha(gasto.fechaLimite)}</span>}
                {gasto.pagadoEn && <span>{tf('finPagadoEn')}: {fecha(gasto.pagadoEn)}</span>}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <Dato etiqueta={tf('finPartida')}>{gasto.partida ? <span className="inline-flex items-center gap-2"><PuntoPartida color={gasto.partida.color} />{gasto.partida.nombre}</span> : tf('finSinPartida')}</Dato>
              <Dato etiqueta={tf('finProveedor')}>{gasto.proveedorNombre || gasto.empresa?.nombre}</Dato>
              <Dato etiqueta={tf('finCuentaOrigen')}>{gasto.cuenta ? (gasto.cuenta.banco ? `${gasto.cuenta.nombre} · ${gasto.cuenta.banco}` : gasto.cuenta.nombre) : null}</Dato>
              <Dato etiqueta={tf('finMetodo')}>{gasto.metodo ? tf(`finMetodo${gasto.metodo}`) : null}{gasto.referencia ? ` · ${gasto.referencia}` : ''}</Dato>
              <Dato etiqueta={tf('finRegistradoPor')}>{gasto.creadoPor?.nombre}</Dato>
              <Dato etiqueta={tf('finRegistradoEl')}>{fechaHora(gasto.creadoEn)}</Dato>
              {gasto.descripcion && <Dato etiqueta={tf('finDescripcion')} ancho><span className="whitespace-pre-wrap">{gasto.descripcion}</span></Dato>}
              {gasto.notas && <Dato etiqueta={tf('finNotas')} ancho><span className="whitespace-pre-wrap">{gasto.notas}</span></Dato>}
            </dl>
            <div>
              <Button variant="ghost" size="sm" className="text-[var(--color-text-dim)]" onClick={() => setVerBitacora((v) => !v)}>
                <History size={15} /> {verBitacora ? tf('finOcultarBitacora') : tf('finVerBitacora')}
              </Button>
              {verBitacora && <Bitacora entidad="gasto" entidadId={gasto.id} />}
            </div>
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <Comprobantes
              titulo={tf('finComprobantesGasto')}
              comprobantes={gasto.comprobantes || []}
              puedeEditar={puedeEditar && !anulado}
              onSubir={async (archivo) => { await finanzasService.gastos.subirComprobante(gasto.id, archivo); await recargar(); onCambio(); }}
              onCambio={async () => { await recargar(); onCambio(); }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DetalleGasto;
