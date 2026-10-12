// Ficha de un pago (Ventas): datos, comprobantes, bitácora y acciones.
import { useEffect, useState } from 'react';
import { Ban, Edit2, History, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import ActionMenu from '../ActionMenu';
import { ListSkeleton } from '../Skeleton';
import Comprobantes from './Comprobantes';
import Bitacora from './Bitacora';
import { Dato } from './piezas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useConfirmacion } from '../ConfirmDialog';
import { BADGE_ESTADO_PAGO } from '../../utils/finanzas';

const DetallePago = ({ open, pagoId, puedeEditar, onClose, onEditar, onCambio }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha, fechaHora } = useFormatoFinanzas();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [pago, setPago] = useState(null);
  const [error, setError] = useState(null);
  const [verBitacora, setVerBitacora] = useState(false);

  const recargar = async () => {
    const data = await finanzasService.pagos.obtener(pagoId);
    setPago(data.pago);
    return data.pago;
  };

  useEffect(() => {
    let cancelado = false;
    finanzasService.pagos.obtener(pagoId)
      .then((data) => { if (!cancelado) setPago(data.pago); })
      .catch((err) => { if (!cancelado) setError(err.message); });
    return () => { cancelado = true; };
  }, [pagoId]);

  const anular = async () => {
    const ok = await confirmar({ titulo: tf('finPagoAnularConfirm', { folio: pago.folio }), descripcion: tf('finPagoAnularTexto'), textoConfirmar: tf('finAnular'), peligro: true });
    if (!ok) return;
    try {
      await finanzasService.pagos.anular(pago.id);
      showToast(tf('finPagoAnulado'), 'success');
      await recargar();
      onCambio();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const eliminar = async () => {
    const ok = await confirmar({ titulo: tf('finPagoEliminarConfirm', { folio: pago.folio }), descripcion: tf('finEliminarTexto'), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await finanzasService.pagos.eliminar(pago.id);
      showToast(tf('finPagoEliminado'), 'success');
      onCambio();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const anulado = pago?.estado === 'ANULADO';
  const acciones = pago && puedeEditar ? [
    !anulado && { label: t('edit'), icon: <Edit2 size={14} />, onSelect: () => onEditar(pago) },
    !anulado && { label: tf('finAnular'), icon: <Ban size={14} />, onSelect: anular },
    { separator: true },
    { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onSelect: eliminar },
  ] : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="900px"
      title={pago ? pago.concepto : tf('finPago')}
      subtitle={pago ? `${pago.folio} · ${fecha(pago.fecha)}` : undefined}
      headerExtra={pago && (
        <div className="flex items-center gap-2">
          <span className={BADGE_ESTADO_PAGO[pago.estado] || 'badge-neutral'}>{tf(`finEstadoPago${pago.estado}`)}</span>
          {acciones.length > 0 && <ActionMenu size={18} className="h-10 w-10" items={acciones} />}
        </div>
      )}
    >
      {dialogo}
      {error && <div className="alert-error">{error}</div>}
      {!pago && !error && <ListSkeleton rows={4} header={false} />}
      {pago && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {anulado && (
              <div className="alert-info">{tf('finPagoAnuladoAviso')}{pago.motivoAnulacion ? `: ${pago.motivoAnulacion}` : ''}</div>
            )}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4">
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{tf('finMonto')}</div>
              <div className={`mt-1 text-[28px] font-semibold tabular-nums ${anulado ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}`}>{monto(pago.monto, pago.moneda)}</div>
              <div className="mt-1 text-[12.5px] text-[var(--color-text-muted)]">{tf(`finMetodo${pago.metodo}`)}{pago.referencia ? ` · ${tf('finReferencia')}: ${pago.referencia}` : ''}</div>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <Dato etiqueta={tf('finCliente')}>{pago.clienteNombre || pago.empresa?.nombre}</Dato>
              <Dato etiqueta={tf('finCuentaDestino')}>{pago.cuenta ? (pago.cuenta.banco ? `${pago.cuenta.nombre} · ${pago.cuenta.banco}` : pago.cuenta.nombre) : null}</Dato>
              <Dato etiqueta={tf('finContrato')}>{pago.contrato ? `${pago.contrato.folio} · ${pago.contrato.titulo}` : null}</Dato>
              <Dato etiqueta={tf('finProyecto')}>{pago.proyecto?.nombre}</Dato>
              <Dato etiqueta={tf('finRegistradoPor')}>{pago.creadoPor?.nombre}</Dato>
              <Dato etiqueta={tf('finRegistradoEl')}>{fechaHora(pago.creadoEn)}</Dato>
              {pago.notas && <Dato etiqueta={tf('finNotas')} ancho><span className="whitespace-pre-wrap">{pago.notas}</span></Dato>}
            </dl>
            <div>
              <Button variant="ghost" size="sm" className="text-[var(--color-text-dim)]" onClick={() => setVerBitacora((v) => !v)}>
                <History size={15} /> {verBitacora ? tf('finOcultarBitacora') : tf('finVerBitacora')}
              </Button>
              {verBitacora && <Bitacora entidad="pago" entidadId={pago.id} />}
            </div>
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <Comprobantes
              comprobantes={pago.comprobantes || []}
              puedeEditar={puedeEditar && !anulado}
              onSubir={async (archivo) => { await finanzasService.pagos.subirComprobante(pago.id, archivo); await recargar(); onCambio(); }}
              onCambio={async () => { await recargar(); onCambio(); }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DetallePago;
