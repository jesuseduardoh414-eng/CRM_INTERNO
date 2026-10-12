// Ventana para administrar las cuentas (bancos, caja, pasarelas) a las que
// entra el dinero de los pagos y de las que salen los gastos.
import { useState } from 'react';
import useSWR from 'swr';
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { ListSkeleton } from '../Skeleton';
import { AvisoError, Campo, Vacio } from './piezas';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useConfirmacion } from '../ConfirmDialog';
import { OPCIONES_SWR_FINANZAS, TIPOS_CUENTA } from '../../utils/finanzas';

const VACIA = { nombre: '', tipo: 'BANCO', banco: '', referencia: '', activa: true };

const GestionCuentas = ({ open, onClose, onCambio }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { data, mutate, isLoading } = useSWR(open ? 'finanzas-cuentas' : null, () => finanzasService.cuentas.listar(), OPCIONES_SWR_FINANZAS);
  const [form, setForm] = useState(null); // null = sin formulario; { id? , ...campos }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const cuentas = data?.cuentas || [];

  const cambiar = (e) => { const { name, value, type, checked } = e.target; setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value })); setError(null); };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      if (form.id) await finanzasService.cuentas.editar(form.id, form);
      else await finanzasService.cuentas.crear(form);
      showToast(form.id ? tf('finCuentaActualizada') : tf('finCuentaCreada'), 'success');
      setForm(null);
      await mutate();
      onCambio?.();
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (cuenta) => {
    const ok = await confirmar({ titulo: tf('finCuentaEliminarConfirm', { nombre: cuenta.nombre }), descripcion: tf('finCuentaEliminarTexto'), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      const res = await finanzasService.cuentas.eliminar(cuenta.id);
      showToast(res.desactivada ? tf('finCuentaDesactivada') : tf('finCuentaEliminada'), 'success');
      await mutate();
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="640px" title={tf('finCuentas')} subtitle={tf('finCuentasSubtitulo')}>
      {dialogo}
      {isLoading && !data && <ListSkeleton rows={3} header={false} />}
      {data && cuentas.length === 0 && !form && (
        <Vacio icono={<Landmark size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />} titulo={tf('finCuentasVacio')} texto={tf('finCuentasVacioHint')} />
      )}
      {cuentas.length > 0 && (
        <ul className="mb-4 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
          {cuentas.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <Landmark size={16} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--color-text)]">
                  <span className="truncate">{c.nombre}</span>
                  {!c.activa && <span className="badge-neutral">{tf('finInactiva')}</span>}
                </div>
                <div className="truncate text-[12px] text-[var(--color-text-muted)]">
                  {tf(`finTipoCuenta${c.tipo}`)}{c.banco ? ` · ${c.banco}` : ''}{c.referencia ? ` · ${c.referencia}` : ''}
                  {' · '}{tf('finCuentaMovimientos', { n: (c.totalPagos || 0) + (c.totalGastos || 0) })}
                </div>
              </div>
              <button type="button" className="dash-icono" title={t('edit')} aria-label={t('edit')} onClick={() => { setForm({ id: c.id, nombre: c.nombre, tipo: c.tipo, banco: c.banco || '', referencia: c.referencia || '', activa: c.activa }); setError(null); }}><Pencil size={15} /></button>
              <button type="button" className="dash-icono hover:!text-[var(--color-error)]" title={t('delete')} aria-label={t('delete')} onClick={() => eliminar(c)}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <form onSubmit={guardar} noValidate className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <AvisoError error={error} />
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Campo id="cta-nombre" label={tf('finCuentaNombre')} requerido>
              <input id="cta-nombre" name="nombre" className="form-input" value={form.nombre} onChange={cambiar} maxLength={120} required autoFocus placeholder={tf('finCuentaNombrePh')} />
            </Campo>
            <Campo id="cta-tipo" label={tf('finCuentaTipo')}>
              <SelectorSimple id="cta-tipo" valor={form.tipo} onCambio={(v) => cambiar({ target: { name: 'tipo', value: v } })} opciones={TIPOS_CUENTA.map((x) => ({ valor: x, etiqueta: tf(`finTipoCuenta${x}`) }))} />
            </Campo>
            <Campo id="cta-banco" label={tf('finCuentaBanco')}>
              <input id="cta-banco" name="banco" className="form-input" value={form.banco} onChange={cambiar} maxLength={80} />
            </Campo>
            <Campo id="cta-ref" label={tf('finCuentaReferencia')} ayuda={tf('finCuentaReferenciaAyuda')}>
              <input id="cta-ref" name="referencia" className="form-input" value={form.referencia} onChange={cambiar} maxLength={40} />
            </Campo>
            {form.id && (
              <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] sm:col-span-2">
                <input type="checkbox" name="activa" checked={form.activa} onChange={cambiar} className="h-4 w-4 accent-[var(--color-primary)]" />
                {tf('finCuentaActiva')}
              </label>
            )}
          </div>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={guardando}>{t('cancel')}</Button>
            <Button type="submit" disabled={guardando}>{guardando ? t('saving') : t('save')}</Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => { setForm({ ...VACIA }); setError(null); }}>
          <Plus size={16} /> {tf('finCuentaNueva')}
        </Button>
      )}
    </Modal>
  );
};

export default GestionCuentas;
