// Ventana para añadir o editar un contacto de una empresa. Marcar uno como
// principal le quita la marca al anterior (lo resuelve el backend).
import { useEffect, useRef, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { empresasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoClientes } from '../../hooks/useTextoClientes';

const FormularioContacto = ({ open, empresaId, contacto, sugerirPrincipal = false, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tc = useTextoClientes();
  const { showToast } = useToast();
  const editando = Boolean(contacto?.id);
  const [form, setForm] = useState(() => ({
    nombre: contacto?.nombre || '',
    puesto: contacto?.puesto || '',
    email: contacto?.email || '',
    telefono: contacto?.telefono || '',
    notas: contacto?.notas || '',
    principal: contacto ? Boolean(contacto.principal) : sugerirPrincipal,
  }));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const refError = useRef(null);

  // El aviso va arriba: en móvil, tras pulsar Guardar, quedaba fuera de la vista.
  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const cambiar = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError(tc('cliNombreObligatorio')); return; }
    setGuardando(true);
    setError('');
    const datos = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]));
    try {
      if (editando) await empresasService.editarContacto(contacto.id, datos);
      else await empresasService.crearContacto(empresaId, datos);
      showToast(tc('cliContactoGuardado'), 'success');
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="560px"
      title={editando ? tc('cliEditarContacto') : tc('cliNuevoContacto')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-contacto" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? tc('cliGuardando') : tc('cliGuardar')}
          </Button>
        </div>
      )}
    >
      <form id="form-contacto" onSubmit={guardar} noValidate className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {error && <div ref={refError} role="alert" className="alert-error mb-5 sm:col-span-2">{error}</div>}
        <div className="form-group">
          <label className="form-label" htmlFor="con-nombre">{tc('cliContactoNombre')}<span className="text-[var(--color-error)]"> *</span></label>
          <input id="con-nombre" name="nombre" className="form-input" value={form.nombre} onChange={cambiar} maxLength={255} required autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="con-puesto">{tc('cliContactoPuesto')}</label>
          <input id="con-puesto" name="puesto" className="form-input" value={form.puesto} onChange={cambiar} maxLength={120} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="con-email">{tc('cliEmail')}</label>
          <input id="con-email" name="email" type="email" className="form-input" value={form.email} onChange={cambiar} maxLength={191} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="con-tel">{tc('cliTelefono')}</label>
          <input id="con-tel" name="telefono" type="tel" inputMode="tel" className="form-input" value={form.telefono} onChange={cambiar} maxLength={40} />
        </div>
        <div className="form-group sm:col-span-2">
          <label className="form-label" htmlFor="con-notas">{tc('cliContactoNotas')}</label>
          <textarea id="con-notas" name="notas" rows={2} className="form-input" value={form.notas} onChange={cambiar} />
        </div>
        <label className="flex min-h-[40px] items-center gap-2.5 text-sm text-[var(--color-text)] sm:col-span-2">
          <input type="checkbox" name="principal" checked={form.principal} onChange={cambiar} className="h-4 w-4 accent-[var(--color-primary)]" />
          {tc('cliContactoEsPrincipal')}
        </label>
      </form>
    </Modal>
  );
};

export default FormularioContacto;
