// Ventana para crear o editar una partida de tesorería (Marketing, Caja
// chica, Ahorro, Inversión...). El color sirve para reconocerla en el
// informe y en los gastos.
import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, Seccion } from './piezas';

// Paleta sugerida (colores de acento del tema, en hex para guardarlos).
const PALETA = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#c9a227', '#64748b'];

const FormularioPartida = ({ open, partida, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const editando = Boolean(partida?.id);
  const [form, setForm] = useState({
    nombre: partida?.nombre || '',
    color: partida?.color || PALETA[0],
    descripcion: partida?.descripcion || '',
    activa: partida?.activa ?? true,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cambiar = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
    setError(null);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const data = editando ? await finanzasService.partidas.editar(partida.id, form) : await finanzasService.partidas.crear(form);
      showToast(editando ? tf('finPartidaActualizada') : tf('finPartidaCreada', { nombre: data.partida.nombre }), 'success');
      onGuardado(data.partida);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="520px"
      title={editando ? tf('finPartidaEditar') : tf('finPartidaNueva')}
      subtitle={tf('finPartidaSubtitulo')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-partida" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <form id="form-partida" onSubmit={guardar} noValidate>
        <AvisoError error={error} />
        <Seccion>
          <Campo id="partida-nombre" label={tf('finPartidaNombre')} requerido ancho>
            <input id="partida-nombre" name="nombre" className="form-input" value={form.nombre} onChange={cambiar} maxLength={80} required autoFocus placeholder={tf('finPartidaNombrePh')} />
          </Campo>
          <Campo id="partida-color" label={tf('finPartidaColor')} ancho>
            <div className="flex flex-wrap items-center gap-2">
              {PALETA.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={tf('finPartidaColorN', { n: i + 1 })}
                  aria-pressed={form.color === c}
                  onClick={() => cambiar({ target: { name: 'color', value: c } })}
                  className="h-8 w-8 rounded-full border-2 transition-transform aria-pressed:scale-110"
                  style={{ background: c, borderColor: form.color === c ? 'var(--color-text)' : 'transparent' }}
                />
              ))}
              <input id="partida-color" name="color" type="color" value={form.color} onChange={cambiar} className="h-8 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-transparent p-0.5" aria-label={tf('finPartidaColorOtro')} />
            </div>
          </Campo>
          <Campo id="partida-desc" label={tf('finDescripcion')} ancho>
            <input id="partida-desc" name="descripcion" className="form-input" value={form.descripcion} onChange={cambiar} maxLength={255} placeholder={tf('finPartidaDescPh')} />
          </Campo>
          {editando && (
            <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] sm:col-span-2">
              <input type="checkbox" name="activa" checked={form.activa} onChange={cambiar} className="h-4 w-4 accent-[var(--color-primary)]" />
              {tf('finPartidaActiva')}
            </label>
          )}
        </Seccion>
      </form>
    </Modal>
  );
};

export default FormularioPartida;
