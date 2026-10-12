// Panel "Acceso al portal" de la ficha de un cliente: quién puede entrar a su
// portal, invitaciones pendientes y la ventana para dar acceso a un contacto.
import { useState } from 'react';
import useSWR from 'swr';
import { Ban, Clock, Loader2, Mail, Plus, RefreshCcw, RotateCcw, Send, Trash2, UserRound } from 'lucide-react';
import { empresasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmacion } from '../ConfirmDialog';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import ActionMenu from '../ActionMenu';
import Modal from '../Modal';
import { Button } from '../ui/button';
import '../../portal.css';

const OTRA = 'otra';

const VentanaInvitar = ({ empresa, contactos, conAcceso, onClose, onListo }) => {
  const { t } = usePreferences();
  const tp = useTextoPortal();
  const { showToast } = useToast();
  // Primer contacto con correo que aún no tiene acceso.
  const sugerido = contactos.find((c) => c.email && !conAcceso.has(c.email.toLowerCase()));
  const [eleccion, setEleccion] = useState(sugerido ? String(sugerido.id) : OTRA);
  const [form, setForm] = useState({ nombre: '', email: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const contacto = contactos.find((c) => String(c.id) === eleccion);

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    if (contacto && !contacto.email) { setError(tp('ptlContactoSinCorreo')); return; }
    setEnviando(true);
    try {
      const respuesta = await empresasService.darAcceso(empresa.id, contacto
        ? { contactoId: contacto.id }
        : { nombre: form.nombre.trim(), email: form.email.trim() });
      showToast(respuesta.advertencia || tp('ptlInvitacionEnviada'), respuesta.advertencia ? 'info' : 'success');
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="520px"
      title={tp('ptlInvitarTitulo')}
      subtitle={tp('ptlInvitarAyuda', { empresa: empresa.nombreComercial || empresa.nombre })}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>{t('cancel')}</Button>
          <Button type="submit" form="form-acceso-portal" disabled={enviando}>
            {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {tp('ptlEnviarInvitacion')}
          </Button>
        </div>
      )}
    >
      <form id="form-acceso-portal" onSubmit={enviar} noValidate>
        {error && <div role="alert" className="alert-error mb-5">{error}</div>}
        {contactos.length > 0 && (
          <fieldset className="form-group">
            <legend className="form-label">{tp('ptlElegirContacto')}</legend>
            <div className="flex flex-col gap-2">
              {contactos.map((c) => {
                const yaTiene = c.email && conAcceso.has(c.email.toLowerCase());
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${eleccion === String(c.id) ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface-3)]'} ${yaTiene ? 'pointer-events-none opacity-55' : ''}`}
                  >
                    <input type="radio" name="contacto" value={c.id} checked={eleccion === String(c.id)} onChange={(e) => setEleccion(e.target.value)} disabled={yaTiene} className="accent-[var(--color-primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{c.nombre}{c.puesto ? <span className="font-normal text-[var(--color-text-muted)]"> · {c.puesto}</span> : null}</span>
                      <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{c.email || tp('ptlContactoSinCorreo')}</span>
                    </span>
                    {yaTiene && <span className="badge-neutral shrink-0">{tp('ptlConAcceso')}</span>}
                  </label>
                );
              })}
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${eleccion === OTRA ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface-3)]'}`}>
                <input type="radio" name="contacto" value={OTRA} checked={eleccion === OTRA} onChange={() => setEleccion(OTRA)} className="accent-[var(--color-primary)]" />
                <span className="text-[13.5px] font-medium">{tp('ptlOtraPersona')}</span>
              </label>
            </div>
          </fieldset>
        )}
        {eleccion === OTRA && (
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <div className="form-group">
              <label className="form-label" htmlFor="acc-nombre">{tp('ptlNombre')}<span className="text-[var(--color-error)]"> *</span></label>
              <input id="acc-nombre" className="form-input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} maxLength={255} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="acc-email">{tp('ptlCorreo')}<span className="text-[var(--color-error)]"> *</span></label>
              <input id="acc-email" type="email" className="form-input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={191} />
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};

const AccesoPortal = ({ empresa }) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [invitando, setInvitando] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(['empresa-accesos', empresa.id], () => empresasService.accesos(empresa.id));

  const usuarios = data?.usuarios || [];
  const invitaciones = data?.invitaciones || [];
  const total = usuarios.length + invitaciones.length;
  const inactiva = empresa.estado === 'INACTIVO';
  const conAcceso = new Set([...usuarios, ...invitaciones].map((u) => u.email.toLowerCase()));
  const fecha = (valor) => new Date(valor).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const accion = async (fn, mensaje) => {
    try {
      await fn();
      showToast(mensaje, 'success');
      mutate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const suspender = async (u) => {
    const ok = await confirmar({ titulo: tp('ptlSuspenderConfirm', { nombre: u.nombre }), descripcion: tp('ptlSuspenderTexto'), textoConfirmar: tp('ptlSuspender'), peligro: true });
    if (ok) accion(() => empresasService.estadoAcceso(empresa.id, u.id, 'inactivo'), tp('ptlAccesoSuspendidoOk'));
  };

  const cancelar = async (i) => {
    const ok = await confirmar({ titulo: tp('ptlCancelarConfirm', { nombre: i.nombre }), descripcion: tp('ptlCancelarTexto'), textoConfirmar: tp('ptlCancelarInv'), peligro: true });
    if (ok) accion(() => empresasService.cancelarAcceso(empresa.id, i.id), tp('ptlCancelarInv'));
  };

  return (
    <section className="cli-panel">
      {dialogo}
      <header className="cli-panel-cabecera">
        <h2 className="cli-etiqueta">
          {tp('ptlAccesoTitulo')}
          <span className="cli-conteo">{total}</span>
        </h2>
        {!inactiva && data && (
          <button type="button" className="cli-enlace -my-2 min-h-[40px]" onClick={() => setInvitando(true)}>
            <Plus size={14} /> {tp('ptlDarAcceso')}
          </button>
        )}
      </header>

      {inactiva && <p className="px-4 pt-3 text-[12.5px] text-[var(--color-text-muted)]">{tp('ptlEmpresaInactiva')}</p>}

      {/* Mientras carga (o si falla) no se dice "nadie tiene acceso": sería falso */}
      {isLoading && !data ? (
        <div className="flex justify-center py-8 text-[var(--color-text-muted)]"><Loader2 size={18} className="animate-spin" aria-label={tp('ptlCargando')} /></div>
      ) : error && !data ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-[13px] text-[var(--color-text-dim)]">{error.message || tp('ptlErrorCarga')}</p>
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCcw size={14} /> {tp('ptlReintentar')}</Button>
        </div>
      ) : total === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[13px] text-[var(--color-text-dim)]">{tp('ptlSinAccesos')}</p>
          <p className="mx-auto mt-1 max-w-[260px] text-[12px] text-[var(--color-text-muted)]">{tp('ptlAccesoAyuda')}</p>
        </div>
      ) : (
        <ul>
          {usuarios.map((u) => {
            const activo = u.estado === 'activo';
            return (
              <li key={`u-${u.id}`} className="cli-contacto">
                <span className="cli-avatar" aria-hidden="true"><UserRound size={15} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{u.nombre}</span>
                    <span className={activo ? 'badge-success' : 'badge-neutral'}>{activo ? tp('ptlAccesoActivo') : tp('ptlAccesoSuspendido')}</span>
                  </div>
                  <div className="truncate text-[12.5px] text-[var(--color-text-dim)]">{u.email}</div>
                  <div className="text-[11.5px] text-[var(--color-text-muted)]">
                    {u.ultimoLoginEn ? tp('ptlUltimoIngreso', { fecha: fecha(u.ultimoLoginEn) }) : tp('ptlNuncaIngreso')}
                  </div>
                </div>
                <ActionMenu
                  size={15}
                  className="-mr-1 shrink-0"
                  items={[
                    activo
                      ? { label: tp('ptlSuspender'), icon: <Ban size={15} />, onSelect: () => suspender(u), danger: true }
                      : { label: tp('ptlReactivar'), icon: <RotateCcw size={15} />, onSelect: () => accion(() => empresasService.estadoAcceso(empresa.id, u.id, 'activo'), tp('ptlAccesoReactivado')) },
                  ]}
                />
              </li>
            );
          })}
          {invitaciones.map((i) => (
            <li key={`i-${i.id}`} className="cli-contacto">
              <span className="cli-avatar" aria-hidden="true">{i.vencida ? <Clock size={15} /> : <Mail size={15} />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{i.nombre}</span>
                  <span className={i.vencida ? 'badge-warning' : 'badge-info'}>{i.vencida ? tp('ptlAccesoVencida') : tp('ptlAccesoPendiente')}</span>
                </div>
                <div className="truncate text-[12.5px] text-[var(--color-text-dim)]">{i.email}</div>
                {!i.vencida && <div className="text-[11.5px] text-[var(--color-text-muted)]">{tp('ptlVence2', { fecha: fecha(i.expiraEn) })}</div>}
              </div>
              <ActionMenu
                size={15}
                className="-mr-1 shrink-0"
                items={[
                  !inactiva && { label: tp('ptlReenviar'), icon: <Send size={15} />, onSelect: () => accion(() => empresasService.reenviarAcceso(empresa.id, i.id), tp('ptlInvitacionEnviada')) },
                  { label: tp('ptlCancelarInv'), icon: <Trash2 size={15} />, onSelect: () => cancelar(i), danger: true },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      {invitando && (
        <VentanaInvitar
          empresa={empresa}
          contactos={empresa.contactos}
          conAcceso={conAcceso}
          onClose={() => setInvitando(false)}
          onListo={() => { setInvitando(false); mutate(); }}
        />
      )}
    </section>
  );
};

export default AccesoPortal;
