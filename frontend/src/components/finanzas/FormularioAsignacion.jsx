// Ventana para apartar dinero de la bolsa de ingresos a una partida (o
// editar una asignación). Muestra cuánto queda sin asignar.
import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, Seccion } from './piezas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { hoyClave } from '../../utils/finanzas';

const FormularioAsignacion = ({ open, asignacion, partidas, partidaInicial, sinAsignar, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto } = useFormatoFinanzas();
  const { showToast } = useToast();
  const editando = Boolean(asignacion?.id);
  const [inicial] = useState(() => ({
    partidaId: String(asignacion?.partidaId || asignacion?.partida?.id || partidaInicial || ''),
    monto: asignacion ? String(asignacion.monto) : '',
    fecha: asignacion?.fecha || hoyClave(),
    nota: asignacion?.nota || '',
  }));
  const [form, setForm] = useState({
    partidaId: String(asignacion?.partidaId || asignacion?.partida?.id || partidaInicial || ''),
    monto: asignacion ? String(asignacion.monto) : '',
    fecha: asignacion?.fecha || hoyClave(),
    nota: asignacion?.nota || '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Al editar, lo que ya tenía esta asignación vuelve a estar disponible.
  const disponible = Math.round(((sinAsignar ?? 0) + (editando ? Number(asignacion.monto) : 0)) * 100) / 100;

  const cambiar = (e) => { const { name, value } = e.target; setForm((p) => ({ ...p, [name]: value })); setError(null); };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      // Al editar solo se mandan los campos que cambiaron: así corregir la nota
      // de una asignación de una partida archivada (o con la bolsa en negativo) no choca.
      const cambios = editando ? Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== inicial[k])) : form;
      const data = editando
        ? await finanzasService.tesoreria.editarAsignacion(asignacion.id, cambios)
        : await finanzasService.tesoreria.crearAsignacion(form);
      showToast(tf('finAsignacionGuardada'), 'success');
      onGuardado(data.asignacion);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  const opciones = (partidas || []).filter((p) => p.activa || String(p.id) === form.partidaId).map((p) => ({ valor: String(p.id), etiqueta: p.nombre }));
  // El tope solo aplica si el monto cambia (o es una asignación nueva).
  const cambiaMonto = !editando || form.monto !== inicial.monto;
  const excede = cambiaMonto && form.monto !== '' && Number(form.monto) > disponible;

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="520px"
      title={editando ? tf('finAsignacionEditar') : tf('finAsignar')}
      subtitle={tf('finAsignarSubtitulo')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-asignacion" disabled={guardando || excede}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : tf('finAsignar')}
          </Button>
        </div>
      )}
    >
      <form id="form-asignacion" onSubmit={guardar} noValidate>
        <AvisoError error={error} />
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${disponible <= 0 ? 'border-[var(--color-error)] text-[var(--color-error)]' : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]'}`}>
          {tf('finSinAsignarDisponible')}: <strong className="tabular-nums">{monto(disponible)}</strong>
        </div>
        <Seccion>
          <Campo id="asig-partida" label={tf('finPartida')} requerido ancho>
            <SelectorSimple id="asig-partida" valor={form.partidaId} onCambio={(v) => cambiar({ target: { name: 'partidaId', value: v } })} opcionVacia={tf('finElegir')} opciones={opciones} />
          </Campo>
          <Campo id="asig-monto" label={tf('finMonto')} requerido ayuda={excede ? tf('finAsignarExcede') : undefined}>
            <input id="asig-monto" name="monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={cambiar} required autoFocus />
          </Campo>
          <Campo id="asig-fecha" label={tf('finFecha')} requerido>
            <input id="asig-fecha" name="fecha" type="date" className="form-input" value={form.fecha} onChange={cambiar} required />
          </Campo>
          <Campo id="asig-nota" label={tf('finNota')} ancho>
            <input id="asig-nota" name="nota" className="form-input" value={form.nota} onChange={cambiar} maxLength={255} placeholder={tf('finNotaAsignacionPh')} />
          </Campo>
        </Seccion>
      </form>
    </Modal>
  );
};

export default FormularioAsignacion;
