// Ventana para cambiar quién ve un artículo o un archivo ya guardado. Quien
// la abre necesita el permiso conocimiento.acceso; `onGuardar(valor)` hace la
// petición y la ventana se cierra si sale bien.
import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import SelectorAcceso from './SelectorAcceso';

const Contenido = ({ titulo, inicial, onCerrar, onGuardar, ...selector }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [valor, setValor] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar(valor);
      onCerrar();
    } catch (err) {
      showToast([err.message, ...(err.detalles || [])].join(' · '), 'error');
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={guardando ? undefined : onCerrar}
      title={titulo}
      maxWidth="560px"
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>{t('cancel')}</Button>
          <Button type="button" onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <SelectorAcceso valor={valor} onCambio={setValor} nombre="acceso-modal" {...selector} />
    </Modal>
  );
};

/** Props: abierto, titulo, inicial, onCerrar, onGuardar y las del SelectorAcceso (contexto, autorId...). */
const ModalAcceso = ({ abierto, ...props }) => (abierto ? <Contenido {...props} /> : null);

export default ModalAcceso;
