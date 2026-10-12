// Ventana para registrar o editar una empresa del directorio. Al registrarla
// se puede capturar ya su primer contacto (queda como principal).
import { useEffect, useRef, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { empresasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoClientes } from '../../hooks/useTextoClientes';
import { TIPOS_EMPRESA } from '../../utils/empresas';

const CAMPOS = ['nombre', 'nombreComercial', 'tipo', 'rfc', 'sector', 'email', 'telefono', 'sitioWeb', 'direccion', 'ciudad', 'notas'];
const CONTACTO_VACIO = { nombre: '', puesto: '', email: '', telefono: '' };

const Seccion = ({ titulo, ayuda, children }) => (
  <fieldset className="mb-6 last:mb-0">
    <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
      {titulo}
      {ayuda && <span className="ml-2 font-normal normal-case tracking-normal">{ayuda}</span>}
    </legend>
    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{children}</div>
  </fieldset>
);

const Campo = ({ id, label, requerido, ancho = false, children }) => (
  <div className={`form-group ${ancho ? 'sm:col-span-2' : ''}`}>
    <label className="form-label" htmlFor={id}>{label}{requerido && <span className="text-[var(--color-error)]"> *</span>}</label>
    {children}
  </div>
);

const FormularioEmpresa = ({ open, empresa, tipoInicial = 'CLIENTE', onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tc = useTextoClientes();
  const { showToast } = useToast();
  const editando = Boolean(empresa?.id);
  // Se monta con un `key` distinto en cada apertura: el estado parte de cero.
  const [form, setForm] = useState(() => Object.fromEntries(CAMPOS.map((k) => [k, empresa?.[k] ?? (k === 'tipo' ? tipoInicial : '')])));
  const [contacto, setContacto] = useState(CONTACTO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const refError = useRef(null);

  // El aviso va arriba: en móvil, tras pulsar Guardar, quedaba fuera de la vista.
  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const cambiar = (e) => { setForm((prev) => ({ ...prev, [e.target.name]: e.target.value })); setError(null); };
  const cambiarContacto = (e) => { setContacto((prev) => ({ ...prev, [e.target.name]: e.target.value })); setError(null); };

  const guardar = async (e) => {
    e.preventDefault();
    // Puede abrirse desde dentro de otro formulario (el de contratos): el
    // submit de React sube por el árbol de componentes aunque el DOM esté en
    // un portal, y sin esto guardaría también el formulario de fuera.
    e.stopPropagation();
    if (!form.nombre.trim()) { setError({ texto: tc('cliNombreObligatorio') }); return; }
    setGuardando(true);
    setError(null);
    // Vacío = null, para poder borrar un dato al editar.
    const datos = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]));
    if (!editando && contacto.nombre.trim()) {
      datos.contactos = [{ ...Object.fromEntries(Object.entries(contacto).map(([k, v]) => [k, v.trim() || null])), principal: true }];
    }
    try {
      const data = editando ? await empresasService.editar(empresa.id, datos) : await empresasService.crear(datos);
      showToast(editando ? tc('cliActualizada') : tc('cliCreada'), 'success');
      onGuardado(data.empresa);
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
      maxWidth="720px"
      title={editando ? tc('cliEditarTitulo') : tc('cliNuevaTitulo')}
      subtitle={editando ? empresa.nombre : tc('cliObligatorios')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-empresa" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? tc('cliGuardando') : tc('cliGuardar')}
          </Button>
        </div>
      )}
    >
      <form id="form-empresa" onSubmit={guardar} noValidate>
        {error && (
          <div ref={refError} role="alert" className="alert-error mb-5 flex-col items-start">
            {/* Con varios errores el mensaje es la lista unida: mejor en viñetas. */}
            {error.detalles?.length > 1
              ? <ul className="list-disc pl-5 text-sm">{error.detalles.map((d) => <li key={d}>{d}</li>)}</ul>
              : <span>{error.texto}</span>}
          </div>
        )}

        <Seccion titulo={tc('cliSecEmpresa')}>
          <Campo id="emp-nombre" label={tc('cliNombre')} requerido ancho>
            <input id="emp-nombre" name="nombre" className="form-input" value={form.nombre} onChange={cambiar} placeholder={tc('cliNombrePh')} maxLength={255} required autoFocus />
          </Campo>
          <Campo id="emp-comercial" label={tc('cliNombreComercial')}>
            <input id="emp-comercial" name="nombreComercial" className="form-input" value={form.nombreComercial} onChange={cambiar} maxLength={255} />
          </Campo>
          <Campo id="emp-tipo" label={tc('cliTipo')} requerido>
            <SelectorSimple
              id="emp-tipo"
              valor={form.tipo}
              onCambio={(v) => cambiar({ target: { name: 'tipo', value: v } })}
              opciones={TIPOS_EMPRESA.map((v) => ({ valor: v, etiqueta: tc(`cliTipo${v}`) }))}
            />
          </Campo>
          <Campo id="emp-rfc" label={tc('cliRfc')}>
            <input id="emp-rfc" name="rfc" className="form-input uppercase" value={form.rfc} onChange={cambiar} maxLength={13} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="XAXX010101000" />
          </Campo>
          <Campo id="emp-sector" label={tc('cliSector')}>
            <input id="emp-sector" name="sector" className="form-input" value={form.sector} onChange={cambiar} maxLength={80} placeholder={tc('cliSectorPh')} />
          </Campo>
        </Seccion>

        <Seccion titulo={tc('cliSecContacto')}>
          <Campo id="emp-email" label={tc('cliEmail')}>
            <input id="emp-email" name="email" type="email" className="form-input" value={form.email} onChange={cambiar} maxLength={191} />
          </Campo>
          <Campo id="emp-tel" label={tc('cliTelefono')}>
            <input id="emp-tel" name="telefono" type="tel" inputMode="tel" className="form-input" value={form.telefono} onChange={cambiar} maxLength={40} />
          </Campo>
          <Campo id="emp-web" label={tc('cliSitioWeb')}>
            <input id="emp-web" name="sitioWeb" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="form-input" value={form.sitioWeb} onChange={cambiar} maxLength={255} placeholder="empresa.com" />
          </Campo>
          <Campo id="emp-ciudad" label={tc('cliCiudad')}>
            <input id="emp-ciudad" name="ciudad" className="form-input" value={form.ciudad} onChange={cambiar} maxLength={120} />
          </Campo>
          <Campo id="emp-dir" label={tc('cliDireccion')} ancho>
            <input id="emp-dir" name="direccion" className="form-input" value={form.direccion} onChange={cambiar} maxLength={500} />
          </Campo>
          <Campo id="emp-notas" label={tc('cliNotas')} ancho>
            <textarea id="emp-notas" name="notas" rows={2} className="form-input" value={form.notas} onChange={cambiar} />
          </Campo>
        </Seccion>

        {!editando && (
          <Seccion titulo={tc('cliSecPrimerContacto')} ayuda={tc('cliPrimerContactoAyuda')}>
            <Campo id="emp-c-nombre" label={tc('cliContactoNombre')}>
              <input id="emp-c-nombre" name="nombre" className="form-input" value={contacto.nombre} onChange={cambiarContacto} maxLength={255} />
            </Campo>
            <Campo id="emp-c-puesto" label={tc('cliContactoPuesto')}>
              <input id="emp-c-puesto" name="puesto" className="form-input" value={contacto.puesto} onChange={cambiarContacto} maxLength={120} />
            </Campo>
            <Campo id="emp-c-email" label={tc('cliEmail')}>
              <input id="emp-c-email" name="email" type="email" className="form-input" value={contacto.email} onChange={cambiarContacto} maxLength={191} />
            </Campo>
            <Campo id="emp-c-tel" label={tc('cliTelefono')}>
              <input id="emp-c-tel" name="telefono" type="tel" inputMode="tel" className="form-input" value={contacto.telefono} onChange={cambiarContacto} maxLength={40} />
            </Campo>
          </Seccion>
        )}
      </form>
    </Modal>
  );
};

export default FormularioEmpresa;
