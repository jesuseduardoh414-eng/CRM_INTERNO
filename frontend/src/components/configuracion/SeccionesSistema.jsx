// Secciones de sistema del panel de configuración: usuarios y seguridad,
// documentos y archivos, correo y avisos, proyectos y horarios, más el panel
// lateral de estado del sistema. Las reglas se editan en el borrador de la
// página (`cambiar`); la gestión de administradores actúa al momento.
import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import {
  Archive, ArrowRight, CalendarOff, CheckCircle2, Clock, Copy, Database, ExternalLink, Eye, EyeOff, FileImage, FileSignature, FileSpreadsheet, FileText, FileType, KeyRound, Lock, LogOut,
  HardDrive, Mail, MailCheck, Minus, Paperclip, Plus, RefreshCcw, Send, ShieldCheck, ShieldOff, TriangleAlert, Unlock, UserCheck, UserPlus, UserX, Users,
} from 'lucide-react';
import { configuracionService } from '../../services/api';
import SelectorSimple from '../SelectorSimple';
import EditorHorarioSemana from '../EditorHorarioSemana';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useConfirmacion } from '../ConfirmDialog';
import ActionMenu from '../ActionMenu';
import { Campo, Fila, Interruptor } from './PiezasConfiguracion';

const ZONAS = [
  'America/Mexico_City', 'America/Cancun', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana',
  'America/Bogota', 'America/Lima', 'America/Guayaquil', 'America/Caracas', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Montevideo', 'America/Asuncion', 'America/La_Paz', 'America/Guatemala', 'America/El_Salvador', 'America/Tegucigalpa',
  'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Santo_Domingo', 'America/Puerto_Rico',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid', 'UTC',
];

// ── Controles reutilizables ──────────────────────────────────────────────

/** Número con botones − / + y unidad. */
export const CampoNumero = ({ id, etiqueta, ayuda, valor, min, max, paso = 1, unidad, onChange }) => {
  const fijar = (n) => onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} htmlFor={id}>
      <div className="flex h-10 w-full max-w-[13rem] items-stretch overflow-hidden rounded-[6px] border border-[var(--cfg-linea-fuerte)] bg-[var(--color-surface)] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_var(--color-primary-20)]">
        <button type="button" className="flex w-9 items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] disabled:opacity-40" onClick={() => fijar(valor - paso)} disabled={valor <= min} aria-label="-">
          <Minus size={14} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={paso}
          value={valor}
          onChange={(e) => fijar(Number(e.target.value))}
          className="w-0 min-w-0 flex-1 border-x border-[var(--cfg-linea)] bg-transparent text-center text-[15px] font-semibold tabular-nums text-[var(--color-text)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unidad && <span className="flex items-center border-r border-[var(--cfg-linea)] px-2.5 text-[12px] text-[var(--color-text-muted)]">{unidad}</span>}
        <button type="button" className="flex w-9 items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] disabled:opacity-40" onClick={() => fijar(valor + paso)} disabled={valor >= max} aria-label="+">
          <Plus size={14} />
        </button>
      </div>
    </Campo>
  );
};

/** Opciones excluyentes como tarjetas (radio). */
export const OpcionesTarjeta = ({ nombre, valor, opciones, onChange, columnas = 3 }) => (
  <div role="radiogroup" aria-label={nombre} className={`grid grid-cols-1 gap-2.5 ${columnas === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
    {opciones.map((op) => {
      const elegida = valor === op.valor;
      const Icono = op.icono;
      return (
        <button
          key={String(op.valor)}
          type="button"
          role="radio"
          aria-checked={elegida}
          onClick={() => onChange(op.valor)}
          className={`flex flex-col gap-1 rounded-[8px] border p-3 text-left transition-colors ${elegida ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)] shadow-[0_0_0_1px_var(--color-primary)]' : 'border-[var(--cfg-linea-fuerte)] hover:bg-[var(--color-surface-3)]'}`}
        >
          <span className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--color-text)]">
            {Icono && <Icono size={15} className={elegida ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'} />}
            {op.titulo}
            <span className={`ml-auto h-3.5 w-3.5 rounded-full border-2 ${elegida ? 'border-[var(--color-primary)] bg-[var(--color-primary)] shadow-[inset_0_0_0_2px_var(--color-surface)]' : 'border-[var(--cfg-linea-fuerte)]'}`} aria-hidden="true" />
          </span>
          <span className="text-[12.5px] leading-snug text-[var(--color-text-dim)]">{op.texto}</span>
        </button>
      );
    })}
  </div>
);

const Estado = ({ ok, children }) => (
  <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium ${ok ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
    {ok ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />} {children}
  </span>
);

const CajaEnlace = ({ enlace, onCerrar }) => {
  const { t } = usePreferences();
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="mt-4 rounded-[8px] border border-[var(--color-gold-20)] bg-[var(--color-gold-10)] p-3">
      <p className="text-[12.5px] font-semibold text-[var(--color-text)]">{t('admLink')}</p>
      <div className="mt-1.5 flex gap-2">
        <input readOnly value={enlace} className="cfg-input font-mono text-[12.5px]" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="cfg-btn shrink-0"
          onClick={async () => { await navigator.clipboard?.writeText(enlace).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 1800); }}
        >
          {copiado ? <CheckCircle2 size={14} /> : <Copy size={14} />} {copiado ? t('admCopied') : t('admCopy')}
        </button>
        <button type="button" className="cfg-btn cfg-btn-texto shrink-0" onClick={onCerrar}>✕</button>
      </div>
      <p className="cfg-ayuda">{t('admLinkHint')}</p>
    </div>
  );
};

// ── Usuarios y seguridad ─────────────────────────────────────────────────

const Administradores = () => {
  const { t, language } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { areas } = useConfiguracion();
  const [datos, setDatos] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState({ nombre: '', email: '', area: 'ADMINISTRACION' });
  const [enviando, setEnviando] = useState(false);
  const [enlace, setEnlace] = useState(null);
  const locale = language === 'en' ? enUS : es;
  const hace = (fecha) => formatDistanceToNow(new Date(fecha), { addSuffix: true, locale });

  const cargar = useCallback(() => configuracionService.administradores().then(setDatos).catch((e) => showToast(e.message, 'error')), [showToast]);
  useEffect(() => {
    let cancelado = false;
    configuracionService.administradores().then((d) => { if (!cancelado) setDatos(d); }).catch(() => {});
    return () => { cancelado = true; };
  }, []);

  const mostrarResultado = (r) => {
    showToast(r.mensaje, r.correoEnviado === false ? 'info' : 'success');
    if (r.enlace) setEnlace(r.enlace);
  };

  const invitar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      mostrarResultado(await configuracionService.invitarAdministrador(form));
      setForm({ nombre: '', email: '', area: 'ADMINISTRACION' });
      setFormAbierto(false);
      cargar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const accion = async (admin, tipo) => {
    const confirmaciones = {
      quitar2fa: { titulo: t('admConfirmRemove2fa', { name: admin.nombre }), descripcion: t('admConfirmRemove2faText'), peligro: true },
      desactivar: { titulo: t('admConfirmDeactivate', { name: admin.nombre }), descripcion: t('admConfirmDeactivateText'), peligro: true },
      cerrarSesiones: { titulo: t('admConfirmClose', { name: admin.nombre }) },
    };
    if (confirmaciones[tipo] && !(await confirmar({ ...confirmaciones[tipo], textoConfirmar: t('secContinue') }))) return;
    try {
      mostrarResultado(await configuracionService.accionAdministrador(admin.id, tipo));
      cargar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const admins = datos?.administradores || [];
  const invitaciones = datos?.invitaciones || [];

  return (
    <Fila
      titulo={t('admTitle')}
      descripcion={t('admHint')}
      extra={!formAbierto && <button type="button" className="cfg-btn cfg-btn-primario" onClick={() => setFormAbierto(true)}><UserPlus size={14} /> {t('admInvite')}</button>}
    >
      {dialogo}
      {formAbierto && (
        <form onSubmit={invitar} className="mb-5 grid grid-cols-1 gap-3 rounded-[8px] border border-[var(--cfg-linea)] bg-[var(--color-surface-3)] p-4 sm:grid-cols-[1fr_1fr_10rem]">
          <Campo etiqueta={t('admName')} htmlFor="adm-nombre"><input id="adm-nombre" className="cfg-input" required minLength={3} maxLength={100} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} autoFocus /></Campo>
          <Campo etiqueta={t('admEmail')} htmlFor="adm-email"><input id="adm-email" type="email" className="cfg-input" required maxLength={191} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Campo>
          <Campo etiqueta={t('admArea')} htmlFor="adm-area">
            <SelectorSimple
              id="adm-area"
              valor={form.area}
              onCambio={(v) => setForm({ ...form, area: v })}
              opciones={areas.map((a) => ({ valor: a.clave, etiqueta: a.nombre }))}
            />
          </Campo>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <button type="button" className="cfg-btn cfg-btn-texto" onClick={() => setFormAbierto(false)}>{t('admCancel')}</button>
            <button type="submit" className="cfg-btn cfg-btn-primario" disabled={enviando}><Send size={14} /> {enviando ? t('admSending') : t('admSend')}</button>
          </div>
        </form>
      )}

      {datos && admins.length === 0 && <p className="rounded-[8px] border border-dashed border-[var(--cfg-linea-fuerte)] p-5 text-center text-[13.5px] text-[var(--color-text-dim)]">{t('admEmpty')}</p>}

      <ul className="cfg-lista">
        {admins.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-bold text-[var(--color-on-primary)]">
              {a.nombre.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{a.nombre}</p>
              <p className="truncate text-[12.5px] text-[var(--color-text-dim)]">{a.email} · {a.ultimoLoginEn ? t('admLastLogin', { when: hace(a.ultimoLoginEn) }) : t('admNeverLogged')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={a.estado === 'inactivo' ? 'badge-neutral' : 'badge-success'}>{a.estado === 'inactivo' ? t('admInactive') : t('admActive')}</span>
              <span className={a.dosFactoresActivo ? 'badge-info' : 'badge-warning'}>{a.dosFactoresActivo ? t('adm2faOn') : t('adm2faOff')}</span>
              {a.bloqueado && <span className="badge-danger">{t('admLocked')}</span>}
              {a.sesionesActivas > 0 && <span className="badge-neutral">{t('admSessions', { n: a.sesionesActivas })}</span>}
            </div>
            <ActionMenu items={[
              { label: t('admActReset'), icon: <KeyRound size={14} />, onSelect: () => accion(a, 'restablecer') },
              a.bloqueado && { label: t('admActUnlock'), icon: <Unlock size={14} />, onSelect: () => accion(a, 'desbloquear') },
              a.dosFactoresActivo && { label: t('admActRemove2fa'), icon: <ShieldOff size={14} />, onSelect: () => accion(a, 'quitar2fa') },
              a.sesionesActivas > 0 && { label: t('admActCloseSessions'), icon: <LogOut size={14} />, onSelect: () => accion(a, 'cerrarSesiones') },
              a.estado === 'inactivo'
                ? { label: t('admActActivate'), icon: <UserCheck size={14} />, onSelect: () => accion(a, 'activar') }
                : { label: t('admActDeactivate'), icon: <UserX size={14} />, onSelect: () => accion(a, 'desactivar'), danger: true },
            ]} />
          </li>
        ))}
      </ul>

      {invitaciones.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{t('admPending')}</p>
          <ul className="space-y-2">
            {invitaciones.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-[8px] border border-dashed border-[var(--cfg-linea-fuerte)] px-3 py-2.5">
                <Mail size={16} className="shrink-0 text-[var(--color-text-muted)]" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--color-text)]"><strong className="font-semibold">{inv.nombre}</strong> · {inv.email}</span>
                <span className={inv.vencida ? 'badge-danger' : 'badge-neutral'}>{inv.vencida ? t('admExpired') : t('admExpires', { when: hace(inv.expiraEn) })}</span>
                <button type="button" className="cfg-btn" onClick={async () => { try { mostrarResultado(await configuracionService.reenviarInvitacionAdmin(inv.id)); cargar(); } catch (e) { showToast(e.message, 'error'); } }}>
                  <RefreshCcw size={13} /> {t('admResend')}
                </button>
                <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" onClick={async () => { try { await configuracionService.eliminarInvitacionAdmin(inv.id); cargar(); } catch (e) { showToast(e.message, 'error'); } }}>
                  {t('admDelete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {enlace && <CajaEnlace enlace={enlace} onCerrar={() => setEnlace(null)} />}
    </Fila>
  );
};

export const SeccionAccesos = ({ seguridad, cambiar }) => {
  const { t } = usePreferences();
  const set = (campo) => (valor) => cambiar('seguridad', campo, valor);
  return (
    <>
      <Administradores />
      <Fila titulo={t('secRules2fa')} descripcion={t('secRules2faHint')}>
        <OpcionesTarjeta
          nombre={t('secRules2fa')}
          valor={seguridad.dosFactores}
          onChange={set('dosFactores')}
          opciones={[
            { valor: 'ninguno', titulo: t('secRules2faNone'), texto: t('secRules2faNoneText'), icono: ShieldOff },
            { valor: 'admins', titulo: t('secRules2faAdmins'), texto: t('secRules2faAdminsText'), icono: ShieldCheck },
            { valor: 'todos', titulo: t('secRules2faAll'), texto: t('secRules2faAllText'), icono: Users },
          ]}
        />
      </Fila>
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Fila titulo={t('secRulesPassword')} descripcion={t('secRulesPasswordHint')}>
          <CampoNumero id="seg-pass" etiqueta={t('secRulesPasswordMin')} valor={seguridad.passwordMin} min={8} max={32} unidad={t('unitChars')} onChange={set('passwordMin')} />
        </Fila>
        <Fila titulo={t('secRulesSessions')} descripcion={t('secRulesSessionsHint')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoNumero id="seg-sesion" etiqueta={t('secRulesSessionHours')} valor={seguridad.sesionHoras} min={1} max={24} unidad={t('unitHours')} onChange={set('sesionHoras')} />
            <CampoNumero id="seg-recordar" etiqueta={t('secRulesRememberDays')} ayuda={t('secRulesRememberOff')} valor={seguridad.recordarDias} min={0} max={90} unidad={t('unitDays')} onChange={set('recordarDias')} />
          </div>
        </Fila>
      </div>
      <Fila titulo={t('secRulesLock')} descripcion={t('secRulesLockHint')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoNumero id="seg-intentos" etiqueta={t('secRulesAttempts')} valor={seguridad.intentosBloqueo} min={3} max={10} onChange={set('intentosBloqueo')} />
          <CampoNumero id="seg-bloqueo" etiqueta={t('secRulesLockMinutes')} valor={seguridad.bloqueoMinutos} min={5} max={240} paso={5} unidad={t('unitMinutes')} onChange={set('bloqueoMinutos')} />
        </div>
      </Fila>
      <Fila titulo={t('secRulesInvites')} descripcion={t('secRulesInvitesHint')}>
        <div className="space-y-5">
          <CampoNumero id="seg-invitacion" etiqueta={t('secRulesInviteHours')} valor={seguridad.invitacionHoras} min={12} max={168} paso={12} unidad={t('unitHours')} onChange={set('invitacionHoras')} />
          <div>
            <p className="cfg-label">{t('secRulesRegistration')}</p>
            <OpcionesTarjeta
              nombre={t('secRulesRegistration')}
              valor={seguridad.registro || 'cerrado'}
              onChange={set('registro')}
              opciones={[
                { valor: 'cerrado', titulo: t('secRulesRegClosed'), texto: t('secRulesRegClosedText'), icono: Lock },
                { valor: 'aprobacion', titulo: t('secRulesRegApproval'), texto: t('secRulesRegApprovalText'), icono: UserCheck },
                { valor: 'abierto', titulo: t('secRulesRegOpen'), texto: t('secRulesRegOpenText'), icono: UserPlus },
              ]}
            />
          </div>
          {seguridad.registro && seguridad.registro !== 'cerrado' && (
            <Campo etiqueta={t('secRulesDomains')} ayuda={t('secRulesDomainsHint')} htmlFor="seg-dominios">
              <input id="seg-dominios" className="cfg-input max-w-md" maxLength={300} value={seguridad.dominiosRegistro || ''} onChange={(e) => set('dominiosRegistro')(e.target.value)} placeholder="empresa.com" />
            </Campo>
          )}
        </div>
      </Fila>
    </>
  );
};

// ── Documentos y archivos ────────────────────────────────────────────────

const TIPOS = [
  { clave: 'pdf', icono: FileText, ext: '.pdf' },
  { clave: 'imagenes', icono: FileImage, ext: '.png .jpg .gif .webp' },
  { clave: 'office', icono: FileSpreadsheet, ext: '.docx .xlsx .pptx' },
  { clave: 'texto', icono: FileType, ext: '.txt .csv .json' },
  { clave: 'comprimidos', icono: Archive, ext: '.zip' },
];

/** 1536 -> "1.5 KB" */
const tamano = (bytes) => {
  if (bytes === null || bytes === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};

export const SeccionArchivos = ({ archivos, cambiar, estado }) => {
  const { t } = usePreferences();
  const set = (campo) => (valor) => cambiar('subidas', campo, valor);
  const almacen = estado?.almacenamiento;
  return (
    <>
      <Fila titulo={t('filesTypes')} descripcion={t('filesTypesHint')}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {TIPOS.map(({ clave, icono: Icono, ext }) => {
            const activo = archivos.tiposAdjuntos[clave] !== false;
            return (
              <button
                key={clave}
                type="button"
                role="switch"
                aria-checked={activo}
                onClick={() => set('tiposAdjuntos')({ ...archivos.tiposAdjuntos, [clave]: !activo })}
                className={`flex items-center gap-3 rounded-[8px] border p-3 text-left transition-colors ${activo ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--cfg-linea-fuerte)] opacity-70 hover:opacity-100'}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${activo ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)]'}`}><Icono size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-[var(--color-text)]">{t(`filesType_${clave}`)}</span>
                  <span className="block truncate font-mono text-[11.5px] text-[var(--color-text-muted)]">{ext}</span>
                </span>
                <span className="cfg-switch shrink-0" aria-checked={activo} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </Fila>
      <Fila titulo={t('filesSizes')} descripcion={t('filesSizesHint')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CampoNumero id="arc-adjuntos" etiqueta={t('filesMaxAttachments')} valor={archivos.adjuntosMaxMB} min={1} max={25} unidad={t('unitMb')} onChange={set('adjuntosMaxMB')} />
          <CampoNumero id="arc-perfil" etiqueta={t('filesMaxProfile')} valor={archivos.fotoPerfilMaxMB} min={1} max={5} unidad={t('unitMb')} onChange={set('fotoPerfilMaxMB')} />
          <CampoNumero id="arc-contratos" etiqueta={t('filesMaxContracts')} valor={archivos.contratosMaxMB} min={1} max={50} unidad={t('unitMb')} onChange={set('contratosMaxMB')} />
        </div>
      </Fila>
      <Fila titulo={t('filesStorage')} descripcion={t('filesStorageHint')}>
        {almacen && (
          <div className="mb-4 rounded-[8px] border border-[var(--cfg-linea-fuerte)] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-primary)] text-[var(--color-on-primary)]"><HardDrive size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--color-text)]">
                  {t('filesDiskTitle')} <Estado ok={almacen.adjuntos.ok}>{almacen.adjuntos.ok ? t('sysOk') : t('filesStoreNoWrite')}</Estado>
                </p>
                <p className="mt-1 break-all font-mono text-[12px] text-[var(--color-text-dim)]">{almacen.adjuntos.ruta}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--cfg-linea)] pt-3">
              {[[t('filesDiskFiles'), (almacen.adjuntos.archivos ?? 0).toLocaleString()], [t('filesDiskUsed'), tamano(almacen.adjuntos.bytes)], [t('filesDiskFree'), tamano(almacen.adjuntos.libreBytes)]].map(([dt, dd]) => (
                <div key={dt}>
                  <dt className="text-[11.5px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{dt}</dt>
                  <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-[var(--color-text)]">{dd}</dd>
                </div>
              ))}
            </dl>
            <p className="cfg-ayuda !mt-3">{t('filesDiskHint')}</p>
          </div>
        )}
        <ul className="cfg-lista">
          <li className="flex items-center gap-3">
            <Paperclip size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="flex-1 text-[13.5px] font-medium text-[var(--color-text)]">{t('filesStoreAttachments')}</span>
            {almacen && <Estado ok={almacen.adjuntos.ok}>{t('filesDiskShort')}</Estado>}
          </li>
          <li className="flex items-center gap-3">
            <FileSignature size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-[var(--color-text)]">{t('filesStoreContracts')}</span>
              {almacen && <span className="block truncate font-mono text-[11.5px] text-[var(--color-text-muted)]">{almacen.contratos.ruta}</span>}
            </span>
            {almacen && <Estado ok={almacen.contratos.ok}>{almacen.contratos.ok ? t('sysOk') : t('filesStoreNoWrite')}</Estado>}
          </li>
          <li className="flex items-center gap-3">
            <Database size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="flex-1 text-[13.5px] font-medium text-[var(--color-text)]">{t('filesStoreBrand')}</span>
            {almacen && <Estado ok>{almacen.marca.proveedor}</Estado>}
          </li>
        </ul>
      </Fila>
    </>
  );
};

// ── Correo y avisos ──────────────────────────────────────────────────────

export const SeccionCorreo = ({ avisos, cambiar, estado, emailPorDefecto, cambiosSinGuardar }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [destino, setDestino] = useState(emailPorDefecto || '');
  const [enviando, setEnviando] = useState(false);
  const correo = estado?.correo;

  const probar = async () => {
    setEnviando(true);
    try {
      const r = await configuracionService.correoPrueba(destino);
      showToast(r.mensaje, r.simulado ? 'info' : 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const textoEstado = !correo ? '…'
    : correo.modo === 'smtp' ? t('mailOkSmtp', { servidor: correo.servidor })
      : correo.modo === 'smtp_env' ? t('mailOk', { servidor: correo.servidor })
        : correo.modo === 'consola' ? t('mailConsole') : t('mailMissing');
  return (
    <>
      <Fila titulo={t('mailTestTitle')} descripcion={t('mailServiceHint')}>
        <div className={`flex items-start gap-3 rounded-[8px] border p-3.5 ${correo?.ok ? 'border-[color:var(--badge-success-bg)] bg-[var(--badge-success-bg)]' : 'border-[color:var(--badge-warning-bg)] bg-[var(--badge-warning-bg)]'}`}>
          {correo?.ok ? <MailCheck size={18} className="mt-0.5 shrink-0 text-[var(--badge-success-fg)]" /> : <TriangleAlert size={18} className="mt-0.5 shrink-0 text-[var(--badge-warning-fg)]" />}
          <div className={`text-[13.5px] ${correo?.ok ? 'text-[var(--badge-success-fg)]' : 'text-[var(--badge-warning-fg)]'}`}>
            <p className="font-semibold">{textoEstado}</p>
            {correo?.remitente && <p className="mt-0.5 opacity-90">{t('mailFrom', { email: correo.remitente })}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Campo etiqueta={t('mailTestTo')} htmlFor="mail-prueba" className="min-w-[14rem] flex-1">
            <input id="mail-prueba" type="email" className="cfg-input" value={destino} onChange={(e) => setDestino(e.target.value)} />
          </Campo>
          <button type="button" className="cfg-btn h-10" onClick={probar} disabled={enviando || !destino || cambiosSinGuardar}>
            <Send size={14} /> {enviando ? t('mailTesting') : t('mailTest')}
          </button>
        </div>
        {cambiosSinGuardar && <p className="cfg-ayuda !text-[var(--color-warning)]">{t('mailSaveFirst')}</p>}
      </Fila>
      <Fila titulo={t('notifTitle')} descripcion={t('notifHint')}>
        <div className="cfg-lista">
          <Interruptor id="av-tareas" activo={avisos.tareas} onChange={(v) => cambiar('avisos', 'tareas', v)} etiqueta={t('notifTasks')} ayuda={t('notifTasksHint')} />
          <Interruptor id="av-comentarios" activo={avisos.comentarios} onChange={(v) => cambiar('avisos', 'comentarios', v)} etiqueta={t('notifComments')} ayuda={t('notifCommentsHint')} />
          <Interruptor id="av-agenda" activo={avisos.recordatorios} onChange={(v) => cambiar('avisos', 'recordatorios', v)} etiqueta={t('notifReminders')} ayuda={t('notifRemindersHint')} />
          <Interruptor id="av-dispositivo" activo={avisos.nuevoDispositivo} onChange={(v) => cambiar('avisos', 'nuevoDispositivo', v)} etiqueta={t('notifDevice')} ayuda={t('notifDeviceHint')} />
        </div>
      </Fila>
      <AvisosCorreo avisos={avisos} cambiar={cambiar} correoOk={correo?.ok} />
    </>
  );
};

// Horas del resumen diario cada 30 min; si la guardada no cae en la rejilla
// (el servidor acepta cualquier HH:MM) se agrega para no perderla.
const HORAS_RESUMEN = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/** Avisos por correo: van además del aviso dentro del CRM, no en su lugar. */
const AvisosCorreo = ({ avisos, cambiar, correoOk }) => {
  const { t } = usePreferences();
  const set = (campo) => (valor) => cambiar('avisos', campo, valor);
  const horas = HORAS_RESUMEN.includes(avisos.horaResumen) || !avisos.horaResumen ? HORAS_RESUMEN : [...HORAS_RESUMEN, avisos.horaResumen].sort();
  return (
    <Fila titulo={t('mailNotifTitle')} descripcion={t('mailNotifHint')}>
      {correoOk === false && (
        <p className="mb-2 flex items-start gap-2 rounded-[8px] bg-[var(--color-surface-3)] p-3 text-[12.5px] leading-snug text-[var(--color-text-dim)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" /> {t('mailNotifNoServer')}
        </p>
      )}
      <div className="cfg-lista">
        <Interruptor id="avc-asignaciones" activo={avisos.correoAsignaciones} onChange={set('correoAsignaciones')} etiqueta={t('mailNotifAssign')} ayuda={t('mailNotifAssignHint')} />
        <Interruptor id="avc-invitaciones" activo={avisos.correoInvitaciones} onChange={set('correoInvitaciones')} etiqueta={t('mailNotifInvite')} ayuda={t('mailNotifInviteHint')} />
        <div>
          <Interruptor id="avc-recordatorios" activo={avisos.correoRecordatorios} onChange={set('correoRecordatorios')} etiqueta={t('mailNotifReminder')} ayuda={t('mailNotifReminderHint')} />
          {avisos.correoRecordatorios && (
            <div className="mt-3">
              <CampoNumero id="avc-minutos" etiqueta={t('mailNotifMinutes')} ayuda={t('mailNotifMinutesHint')} valor={avisos.minutosRecordatorio ?? 30} min={5} max={1440} paso={5} unidad={t('unitMinutes')} onChange={set('minutosRecordatorio')} />
            </div>
          )}
        </div>
        <div>
          <Interruptor id="avc-resumen" activo={avisos.correoResumenDiario} onChange={set('correoResumenDiario')} etiqueta={t('mailNotifDigest')} ayuda={t('mailNotifDigestHint')} />
          {avisos.correoResumenDiario && (
            <Campo etiqueta={t('mailNotifDigestHour')} ayuda={t('mailNotifDigestHourHint')} htmlFor="avc-hora" className="mt-3">
              <SelectorSimple
                id="avc-hora"
                className="max-w-[9rem] tabular-nums"
                valor={avisos.horaResumen || '08:00'}
                onCambio={set('horaResumen')}
                opciones={horas.map((h) => ({ valor: h, etiqueta: h }))}
              />
            </Campo>
          )}
        </div>
      </div>
    </Fila>
  );
};

// ── Google Calendar ──────────────────────────────────────────────────────

// Clases completas (Tailwind no detecta clases armadas con variables).
const TONOS_ESTADO = {
  success: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
  warning: 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]',
  neutral: 'bg-[var(--color-surface-3)] text-[var(--color-text-dim)]',
};
const REGEX_CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/;
const clientIdGoogleValido = (id) => !id || REGEX_CLIENT_ID.test(id.trim());

const BotonCopiar = ({ texto }) => {
  const { t } = usePreferences();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="cfg-btn shrink-0"
      onClick={async () => { await navigator.clipboard?.writeText(texto).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 1800); }}
    >
      {copiado ? <CheckCircle2 size={14} /> : <Copy size={14} />} {copiado ? t('admCopied') : t('admCopy')}
    </button>
  );
};

/**
 * Credenciales OAuth de Google de la empresa. El secreto sigue el mismo
 * patrón que la contraseña SMTP: '' = conservar, null = borrar, y el
 * servidor solo devuelve `secretGuardado`. `guardado` es el estado del
 * servidor (no el borrador) para que el estado no cambie mientras se escribe.
 */
export const SeccionGoogle = ({ google, guardado, modulos, cambiar, onQuitar, onIrModulos }) => {
  const { t } = usePreferences();
  const [verSecreto, setVerSecreto] = useState(false);
  const set = (campo) => (valor) => cambiar('google', campo, valor);
  const origen = window.location.origin;
  const idValido = clientIdGoogleValido(google.clientId || '');
  const moduloApagado = modulos.googleCalendar === false || modulos.agenda === false;
  const configurado = Boolean(guardado?.clientId && guardado?.secretGuardado);
  const incompleto = !configurado && Boolean(guardado?.clientId || guardado?.secretGuardado);
  const quitarPendiente = Boolean(guardado?.clientId || guardado?.secretGuardado) && !google.clientId && !google.secretGuardado;

  const estado = moduloApagado
    ? { tono: 'neutral', icono: CalendarOff, titulo: t('gcalStatusOff'), texto: t('gcalStatusOffText') }
    : configurado
      ? { tono: 'success', icono: CheckCircle2, titulo: t('gcalStatusOk'), texto: t('gcalStatusOkText') }
      : { tono: 'warning', icono: TriangleAlert, titulo: incompleto ? t('gcalStatusPartial') : t('gcalStatusMissing'), texto: t('gcalStatusMissingText') };
  const IconoEstado = estado.icono;

  const PASOS = [
    { titulo: 'gcalStep1', texto: 'gcalStep1Text', enlace: 'https://console.cloud.google.com/projectcreate' },
    { titulo: 'gcalStep2', texto: 'gcalStep2Text', enlace: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' },
    { titulo: 'gcalStep3', texto: 'gcalStep3Text', enlace: 'https://console.cloud.google.com/apis/credentials/consent' },
    { titulo: 'gcalStep4', texto: 'gcalStep4Text', enlace: 'https://console.cloud.google.com/apis/credentials' },
    { titulo: 'gcalStep5', texto: 'gcalStep5Text', origen: true },
    { titulo: 'gcalStep6', texto: 'gcalStep6Text' },
  ];

  return (
    <>
      <Fila
        titulo={t('gcalCredentials')}
        descripcion={t('gcalCredentialsHint')}
        extra={(google.clientId || google.secretGuardado) && (
          <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" onClick={onQuitar}><Minus size={13} /> {t('gcalRemove')}</button>
        )}
      >
        <div className={`mb-5 flex items-start gap-3 rounded-[8px] p-3.5 ${TONOS_ESTADO[estado.tono]}`}>
          <IconoEstado size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <p className="font-semibold">{estado.titulo}</p>
            <p className="mt-0.5 opacity-90">{estado.texto}</p>
          </div>
          {moduloApagado && <button type="button" className="cfg-btn shrink-0" onClick={onIrModulos}>{t('gcalGoModules')} <ArrowRight size={13} /></button>}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Campo etiqueta={t('gcalClientId')} ayuda={idValido ? t('gcalClientIdHint') : null} htmlFor="gcal-id">
            <input
              id="gcal-id"
              className="cfg-input font-mono text-[13px]"
              maxLength={200}
              placeholder="123456789012-abc123.apps.googleusercontent.com"
              value={google.clientId || ''}
              onChange={(e) => set('clientId')(e.target.value.trim())}
              aria-invalid={!idValido}
              autoComplete="off"
              spellCheck={false}
            />
            {!idValido && <p className="cfg-ayuda !text-[var(--color-error)]">{t('gcalClientIdInvalid')}</p>}
          </Campo>
          <Campo etiqueta={t('gcalSecret')} ayuda={google.secretGuardado && !google.secret ? t('gcalSecretSaved') : t('gcalSecretHint')} htmlFor="gcal-secreto">
            <div className="relative">
              <input
                id="gcal-secreto"
                type={verSecreto ? 'text' : 'password'}
                className="cfg-input !pr-10 font-mono text-[13px]"
                maxLength={200}
                placeholder={google.secretGuardado ? '••••••••••' : 'GOCSPX-…'}
                value={google.secret || ''}
                onChange={(e) => set('secret')(e.target.value.trim())}
                autoComplete="new-password"
                spellCheck={false}
              />
              <button type="button" className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]" onClick={() => setVerSecreto((v) => !v)} aria-label={verSecreto ? t('hidePassword') : t('showPassword')}>
                {verSecreto ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Campo>
        </div>
        {quitarPendiente && <p className="cfg-ayuda !text-[var(--color-warning)]">{t('gcalRemovePending')}</p>}
      </Fila>

      <Fila titulo={t('gcalGuide')} descripcion={t('gcalGuideHint')}>
        <ol className="cfg-lista">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-10)] text-[12px] font-bold tabular-nums text-[var(--color-primary)]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-semibold text-[var(--color-text)]">
                  {t(p.titulo)}
                  {p.enlace && (
                    <a href={p.enlace} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline">
                      {t('gcalOpen')} <ExternalLink size={11} />
                    </a>
                  )}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">{t(p.texto)}</p>
                {p.origen && (
                  <>
                    <div className="mt-2 flex gap-2">
                      <input readOnly value={origen} aria-label={t('gcalOrigin')} className="cfg-input font-mono text-[12.5px]" onFocus={(e) => e.target.select()} />
                      <BotonCopiar texto={origen} />
                    </div>
                    <p className="cfg-ayuda">{t('gcalOriginHint')}</p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Fila>
    </>
  );
};

// ── Proyectos y horarios ─────────────────────────────────────────────────

const RelojZona = ({ zona }) => {
  const { t, locale } = usePreferences();
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  let hora = '';
  try {
    hora = new Intl.DateTimeFormat(locale, { timeZone: zona, weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ahora);
  } catch { /* zona no soportada por el navegador */ }
  return <p className="cfg-ayuda flex items-center gap-1.5"><Clock size={13} /> {t('opsNow', { hora })}</p>;
};

export const SeccionOperacion = ({ operacion, cambiar }) => {
  const { t, tBase } = usePreferences();
  const set = (campo) => (valor) => cambiar('operacion', campo, valor);
  // El editor devuelve el horario entero; solo se toca lo que cambio
  const cambiarHorario = (nuevo) => {
    ['diasLaborales', 'horaEntrada', 'horaSalida', 'horaComidaInicio', 'horaComidaFin', 'horariosPorDia'].forEach((campo) => {
      if (JSON.stringify(nuevo[campo]) !== JSON.stringify(operacion[campo])) set(campo)(nuevo[campo]);
    });
  };
  const etiqueta = (grupo, clave) => (valor) => cambiar('operacion', grupo, { ...operacion[grupo], [clave]: valor });
  const ESTADOS = [['PENDIENTE', 'statusTodo', 'var(--color-text-muted)'], ['EN_PROGRESO', 'statusInProgress', 'var(--color-accent-blue)'], ['HECHO', 'statusDone', 'var(--color-accent-green)']];
  const PRIORIDADES = [['BAJA', 'priorityLow', 'var(--color-accent-blue)'], ['MEDIA', 'priorityMedium', 'var(--color-accent-warning)'], ['ALTA', 'priorityHigh', 'var(--color-accent-error)']];

  const listaEtiquetas = (grupo, filas) => (
    <div className="space-y-2">
      {filas.map(([clave, llave, color]) => (
        <div key={clave} className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: color }} aria-hidden="true" />
          <input aria-label={tBase(llave)} className="cfg-input !pl-8" maxLength={30} placeholder={tBase(llave)} value={operacion[grupo][clave] || ''} onChange={(e) => etiqueta(grupo, clave)(e.target.value)} />
        </div>
      ))}
    </div>
  );

  return (
    <>
      <Fila titulo={t('opsTimezone')} descripcion={t('opsTimezoneHint')}>
        <SelectorSimple
          id="ops-zona"
          className="max-w-md"
          valor={operacion.zonaHoraria}
          onCambio={set('zonaHoraria')}
          opciones={ZONAS.map((z) => ({ valor: z, etiqueta: z.replace(/_/g, ' ') }))}
        />
        <RelojZona zona={operacion.zonaHoraria} />
      </Fila>
      <Fila titulo={t('opsSchedule')} descripcion={t('opsScheduleHint')}>
        {/* Dias laborales, horario general y los dias con horario propio */}
        <EditorHorarioSemana idBase="ops-horario" valor={operacion} onCambio={cambiarHorario} />
      </Fila>
      <Fila titulo={t('opsLabels')} descripcion={t('opsLabelsHint')}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:divide-x sm:divide-[var(--cfg-linea)]">
          <div><p className="cfg-label">{t('opsStatuses')}</p>{listaEtiquetas('etiquetasEstados', ESTADOS)}</div>
          <div className="sm:pl-5"><p className="cfg-label">{t('opsPriorities')}</p>{listaEtiquetas('etiquetasPrioridades', PRIORIDADES)}</div>
        </div>
      </Fila>
    </>
  );
};

// ── Panel lateral: estado del sistema ────────────────────────────────────

export const PanelEstado = ({ estado, onRefrescar, seccion }) => {
  const { t } = usePreferences();
  const [girando, setGirando] = useState(false);
  const filas = estado ? [
    { icono: Database, etiqueta: t('sysDatabase'), ok: estado.baseDatos.ok, valor: estado.baseDatos.ok ? t('sysOk') : t('sysWarn') },
    {
      icono: Mail,
      etiqueta: t('sysMail'),
      ok: estado.correo.ok,
      valor: { smtp: 'SMTP', smtp_env: 'SMTP (.env)', consola: t('sysMailConsole') }[estado.correo.modo] || t('sysWarn'),
      detalle: estado.correo.servidor,
    },
    {
      icono: Paperclip,
      etiqueta: t('sysAttachments'),
      ok: estado.almacenamiento.adjuntos.ok,
      valor: estado.almacenamiento.adjuntos.ok ? tamano(estado.almacenamiento.adjuntos.bytes) : t('sysWarn'),
      detalle: estado.almacenamiento.adjuntos.ok ? t('sysAttachmentsDetail', { n: (estado.almacenamiento.adjuntos.archivos ?? 0).toLocaleString() }) : null,
    },
    { icono: FileSignature, etiqueta: t('sysContracts'), ok: estado.almacenamiento.contratos.ok, valor: estado.almacenamiento.contratos.ok ? t('sysOk') : t('sysWarn') },
    { icono: Clock, etiqueta: t('sysTime'), ok: true, valor: estado.servidor.horaLocal, detalle: estado.servidor.zonaHoraria.replace(/_/g, ' ') },
    estado.administradores && {
      icono: ShieldCheck,
      etiqueta: t('sysAdmins'),
      ok: estado.administradores.activos > 0,
      valor: t('sysAdminsValue', { n: estado.administradores.activos, m: estado.administradores.con2fa }),
    },
  ].filter(Boolean) : [];

  return (
    <div className="space-y-4">
      <div className="cfg-previa">
        <div className="cfg-previa-cabecera">
          <span className="text-[14px] font-semibold text-[var(--color-text)]">{t('sysTitle')}</span>
          <button
            type="button"
            className="cfg-btn cfg-btn-texto"
            onClick={async () => { setGirando(true); await onRefrescar(); setGirando(false); }}
            aria-label={t('sysRefresh')}
            title={t('sysRefresh')}
          >
            <RefreshCcw size={14} className={girando ? 'animate-spin' : ''} />
          </button>
        </div>
        <ul className="divide-y divide-[var(--cfg-linea)]">
          {!estado && <li className="px-4 py-6 text-center text-[13px] text-[var(--color-text-muted)]">…</li>}
          {filas.map(({ icono: Icono, etiqueta, ok, valor, detalle }) => (
            <li key={etiqueta} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${ok ? 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]' : 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]'}`}><Icono size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[var(--color-text)]">{etiqueta}</span>
                {detalle && <span className="block truncate text-[11.5px] text-[var(--color-text-muted)]">{detalle}</span>}
              </span>
              <span className={`max-w-[50%] truncate text-right text-[12.5px] font-semibold ${ok ? 'text-[var(--color-text)]' : 'text-[var(--color-warning)]'}`}>{valor}</span>
            </li>
          ))}
        </ul>
      </div>
      {seccion && (
        <div className="rounded-[10px] border border-[var(--color-gold-20)] bg-[var(--color-gold-10)] p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-gold-text)]">{t('sysTipTitle')}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-text)]">{t(`sysTip_${seccion}`)}</p>
        </div>
      )}
    </div>
  );
};
