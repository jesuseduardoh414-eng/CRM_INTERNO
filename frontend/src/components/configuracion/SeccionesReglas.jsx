// Bloques del panel de configuración para áreas, reglas de tareas, permisos
// por área, módulos y servidor de correo (SMTP). Editan el borrador de la
// página con `cambiar` / `onChange`; nada se guarda hasta pulsar Guardar,
// salvo "Probar conexión", que solo consulta al servidor.
import { useState } from 'react';
import {
  BookOpen, Building2, CalendarDays, CalendarSync, Check, CircleDot, ClipboardList, Download, Eye, EyeOff, FileSignature, FileSpreadsheet,
  LayoutTemplate, Loader2, MessageSquare, Minus, Paperclip, PlugZap, Plus, Server, ShieldCheck, Trash2, TriangleAlert, Wallet,
} from 'lucide-react';
import { configuracionService } from '../../services/api';
import SelectorSimple from '../SelectorSimple';
import { usePreferences } from '../../context/PreferencesContext';
import { AREA_GENERAL, CLAVE_TRADUCCION_AREA, nombreDesdeClave } from '../../utils/areas';
import { Campo, Fila, Interruptor } from './PiezasConfiguracion';
import { CampoNumero, OpcionesTarjeta } from './SeccionesSistema';
import PermisosPorArea from './PermisosPorArea';

const MAX_AREAS = 20;
const COLORES_AREA = ['#2563eb', '#f59e0b', '#8b5cf6', '#db2777', '#0d9488', '#ea580c', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#ca8a04', '#64748b'];
// Igual que el backend: sin acentos ni mayúsculas, para detectar nombres repetidos.
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ── Áreas ────────────────────────────────────────────────────────────────

export const EditorAreas = ({ areas, onChange }) => {
  const { t, tBase } = usePreferences();
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState('');
  const nombreFabrica = (clave) => (CLAVE_TRADUCCION_AREA[clave] ? tBase(CLAVE_TRADUCCION_AREA[clave]) : nombreDesdeClave(clave));
  const nombreVisible = (a) => a.nombre || (a.clave ? nombreFabrica(a.clave) : '');

  const cambiarArea = (i, campo, valor) => onChange(areas.map((a, j) => (j === i ? { ...a, [campo]: valor } : a)));
  const quitar = (i) => onChange(areas.filter((_, j) => j !== i));

  const agregar = (e) => {
    e?.preventDefault();
    const nombre = nueva.trim();
    if (!nombre) return;
    if (areas.length >= MAX_AREAS) { setError(t('areasMax', { n: MAX_AREAS })); return; }
    if (areas.some((a) => normalizar(nombreVisible(a)) === normalizar(nombre))) { setError(t('areasDuplicated')); return; }
    const color = COLORES_AREA.find((c) => !areas.some((a) => a.color === c)) || COLORES_AREA[areas.length % COLORES_AREA.length];
    onChange([...areas, { nombre, color }]);
    setNueva('');
    setError('');
  };

  return (
    <div>
      <ul className="divide-y divide-[var(--cfg-linea)] rounded-[8px] border border-[var(--cfg-linea-fuerte)]">
        {areas.map((a, i) => {
          const general = a.clave === AREA_GENERAL;
          return (
            <li key={a.clave || `nueva-${i}`} className="flex items-center gap-3 px-3 py-2.5">
              <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-[6px] border border-black/10" style={{ background: a.color }} title={t('areasColor')}>
                <input type="color" value={a.color} onChange={(e) => cambiarArea(i, 'color', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t('areasColorOf', { area: nombreVisible(a) })} />
              </label>
              <input
                className="cfg-input min-w-0 flex-1"
                maxLength={40}
                value={a.nombre ?? (a.clave ? nombreFabrica(a.clave) : '')}
                placeholder={a.clave ? nombreFabrica(a.clave) : ''}
                onChange={(e) => cambiarArea(i, 'nombre', e.target.value)}
                aria-label={t('areasName')}
              />
              {general && <span className="badge-info shrink-0" title={t('areasGeneralHint')}><ShieldCheck size={12} /> {t('areasGeneral')}</span>}
              {!a.clave && <span className="badge-warning shrink-0">{t('areasNew')}</span>}
              <button
                type="button"
                className="cfg-btn cfg-btn-texto cfg-btn-peligro shrink-0 disabled:invisible"
                onClick={() => quitar(i)}
                disabled={general}
                aria-label={t('areasRemove', { area: nombreVisible(a) })}
                title={general ? t('areasGeneralHint') : t('areasRemoveHint')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={agregar} className="mt-3 flex gap-2">
        <input
          className="cfg-input max-w-sm"
          maxLength={40}
          value={nueva}
          onChange={(e) => { setNueva(e.target.value); setError(''); }}
          placeholder={t('areasNewPlaceholder')}
          aria-label={t('areasNewPlaceholder')}
          disabled={areas.length >= MAX_AREAS}
        />
        <button type="submit" className="cfg-btn shrink-0" disabled={!nueva.trim() || areas.length >= MAX_AREAS}><Plus size={14} /> {t('areasAdd')}</button>
      </form>
      {error ? <p className="cfg-ayuda !text-[var(--color-error)]">{error}</p> : <p className="cfg-ayuda">{t('areasFootnote', { n: areas.length, max: MAX_AREAS })}</p>}
    </div>
  );
};

// ── Reglas de tareas ─────────────────────────────────────────────────────

export const ReglasTareas = ({ tareas, operacion, cambiar }) => {
  const { t, tBase } = usePreferences();
  const set = (campo) => (valor) => cambiar('tareas', campo, valor);
  const nombreEstado = (clave, llave) => operacion.etiquetasEstados?.[clave] || tBase(llave);
  const nombrePrioridad = (clave, llave) => operacion.etiquetasPrioridades?.[clave] || tBase(llave);
  return (
    <Fila titulo={t('rulesTitle')} descripcion={t('rulesHint')}>
      <div className="space-y-5">
        <div>
          <p className="cfg-label">{t('rulesInitialStatus')}</p>
          <OpcionesTarjeta
            nombre={t('rulesInitialStatus')}
            columnas={2}
            valor={tareas.estadoInicial}
            onChange={set('estadoInicial')}
            opciones={[
              { valor: 'PENDIENTE', titulo: nombreEstado('PENDIENTE', 'statusTodo'), texto: t('rulesStatusTodoText'), icono: CircleDot },
              { valor: 'EN_PROGRESO', titulo: nombreEstado('EN_PROGRESO', 'statusInProgress'), texto: t('rulesStatusProgressText'), icono: Loader2 },
            ]}
          />
        </div>
        <div>
          <p className="cfg-label">{t('rulesDefaultPriority')}</p>
          <div role="radiogroup" aria-label={t('rulesDefaultPriority')} className="cfg-segmentado max-w-md">
            {[['BAJA', 'priorityLow', 'var(--color-accent-blue)'], ['MEDIA', 'priorityMedium', 'var(--color-accent-warning)'], ['ALTA', 'priorityHigh', 'var(--color-accent-error)']].map(([clave, llave, color]) => (
              <button key={clave} type="button" role="radio" aria-checked={tareas.prioridadDefecto === clave} onClick={() => set('prioridadDefecto')(clave)}>
                <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" /> {nombrePrioridad(clave, llave)}
              </button>
            ))}
          </div>
          <p className="cfg-ayuda">{t('rulesDefaultPriorityHint')}</p>
        </div>
      </div>
      <div className="cfg-lista mt-5">
        <Interruptor id="rt-fecha" activo={tareas.exigirFechaLimite} onChange={set('exigirFechaLimite')} etiqueta={t('rulesRequireDue')} ayuda={t('rulesRequireDueHint')} />
        <Interruptor id="rt-responsable" activo={tareas.exigirResponsable} onChange={set('exigirResponsable')} etiqueta={t('rulesRequireOwner')} ayuda={t('rulesRequireOwnerHint')} />
        <Interruptor id="rt-creador" activo={tareas.asignarAlCreador} onChange={set('asignarAlCreador')} etiqueta={t('rulesAssignCreator')} ayuda={t('rulesAssignCreatorHint')} />
      </div>
      <div className="mt-5">
        <CampoNumero id="rt-vencer" etiqueta={t('rulesDueSoon')} ayuda={t('rulesDueSoonHint')} valor={tareas.diasPorVencer} min={0} max={30} unidad={t('unitDays')} onChange={set('diasPorVencer')} />
      </div>
    </Fila>
  );
};

// ── Roles y permisos ─────────────────────────────────────────────────────

/**
 * Sección Permisos: los tres niveles y, debajo, la tabla por área
 * (PermisosPorArea). `catalogo` y `defectos` vienen de GET /configuracion.
 */
export const SeccionPermisos = ({ areas, permisosAreas, onCambio, catalogo, defectos }) => {
  const { t } = usePreferences();
  return (
    <>
      <Fila titulo={t('permRoles')} descripcion={t('permRolesHint')}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {[['permRoleGeneral', 'permRoleGeneralText', Building2], ['permRoleAdmin', 'permRoleAdminText', ShieldCheck], ['permRoleMember', 'permRoleMemberText', ClipboardList]].map(([titulo, texto, Icono]) => (
            <div key={titulo} className="rounded-[8px] border border-[var(--cfg-linea-fuerte)] p-3">
              <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--color-text)]"><Icono size={15} className="text-[var(--color-primary)]" /> {t(titulo)}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-text-dim)]">{t(texto)}</p>
            </div>
          ))}
        </div>
      </Fila>
      <PermisosPorArea areas={areas} valor={permisosAreas} onCambio={onCambio} catalogo={catalogo} defectos={defectos} />
      <p className="cfg-ayuda px-1">{t('permFootnote')}</p>
    </>
  );
};

// ── Módulos ──────────────────────────────────────────────────────────────

const MODULOS = [
  // El portal de clientes se retiró (2026-10-12): el CRM es solo de uso interno.
  { grupo: 'modGroupSections', filas: [['agenda', CalendarDays], ['contratos', FileSignature], ['clientes', Building2], ['finanzas', Wallet], ['conocimiento', BookOpen]] },
  { grupo: 'modGroupProjects', filas: [['plantillas', LayoutTemplate], ['importar', FileSpreadsheet], ['comentarios', MessageSquare], ['adjuntos', Paperclip]] },
  { grupo: 'modGroupIntegrations', filas: [['googleCalendar', CalendarSync], ['reporteDiario', Download]] },
];
// Un módulo que vive dentro de otro no se puede encender si el otro está apagado.
const DEPENDE_DE = { googleCalendar: 'agenda' };

export const ListaModulos = ({ modulos, cambiar }) => {
  const { t } = usePreferences();
  // Se cuentan solo los módulos que se ven (no los retirados, como el portal).
  const visibles = MODULOS.flatMap(({ filas }) => filas.map(([clave]) => clave));
  const activos = visibles.filter((clave) => modulos[clave] !== false).length;
  return (
    <Fila titulo={t('cfgModules')} descripcion={t('cfgModulesHint')} zona="modulos" extra={<span className="badge-neutral">{t('modActiveCount', { n: activos, total: visibles.length })}</span>}>
      <div className="space-y-5">
        {MODULOS.map(({ grupo, filas }) => (
          <div key={grupo}>
            <p className="cfg-label">{t(grupo)}</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {filas.map(([clave, Icono]) => {
                const padre = DEPENDE_DE[clave];
                const bloqueado = padre && modulos[padre] === false;
                const activo = modulos[clave] !== false && !bloqueado;
                return (
                  <button
                    key={clave}
                    type="button"
                    role="switch"
                    aria-checked={activo}
                    disabled={bloqueado}
                    onClick={() => cambiar('modulos', clave, !activo)}
                    className={`flex items-start gap-3 rounded-[8px] border p-3 text-left transition-colors disabled:cursor-not-allowed ${activo ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--cfg-linea-fuerte)] opacity-75 hover:opacity-100'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${activo ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)]'}`}><Icono size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-[var(--color-text)]">{t(`mod_${clave}`)}</span>
                      <span className="block text-[12px] leading-snug text-[var(--color-text-dim)]">{bloqueado ? t('modNeeds', { modulo: t(`mod_${padre}`) }) : t(`mod_${clave}Hint`)}</span>
                    </span>
                    <span className="cfg-switch mt-0.5 shrink-0" aria-checked={activo} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Fila>
  );
};

// ── Servidor de correo (SMTP) ────────────────────────────────────────────

const PRESETS = [
  { id: 'hosting', host: '', puerto: 465, seguridad: 'ssl' },
  { id: 'gmail', host: 'smtp.gmail.com', puerto: 587, seguridad: 'starttls' },
  { id: 'outlook', host: 'smtp.office365.com', puerto: 587, seguridad: 'starttls' },
  { id: 'zoho', host: 'smtp.zoho.com', puerto: 465, seguridad: 'ssl' },
];

export const ServidorCorreo = ({ correo, reglas, cambiar, nombreSistema, onQuitar }) => {
  const { t } = usePreferences();
  const [verPassword, setVerPassword] = useState(false);
  const [prueba, setPrueba] = useState(null); // { ok, mensaje, detalle } | 'probando'
  const set = (campo) => (valor) => { cambiar('correo', campo, valor); setPrueba(null); };
  const preset = PRESETS.find((p) => p.host && p.host === correo.host);

  const aplicarPreset = (p) => {
    cambiar('correo', 'puerto', p.puerto);
    cambiar('correo', 'seguridad', p.seguridad);
    if (p.host || preset) cambiar('correo', 'host', p.host || '');
    setPrueba(null);
    if (!p.host) document.getElementById('smtp-host')?.focus();
  };

  const probar = async () => {
    setPrueba('probando');
    try {
      const r = await configuracionService.verificarCorreo({
        host: correo.host, puerto: correo.puerto, seguridad: correo.seguridad, usuario: correo.usuario, password: correo.password || '',
      });
      setPrueba({ ok: true, mensaje: r.mensaje });
    } catch (err) {
      setPrueba({ ok: false, mensaje: err.message, detalle: err.data?.detalle });
    }
  };

  return (
    <Fila
      titulo={t('smtpTitle')}
      descripcion={t('smtpHint')}
      extra={correo.host && onQuitar && <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" onClick={onQuitar}><Minus size={13} /> {t('smtpRemove')}</button>}
    >
      <p className="cfg-label">{t('smtpProvider')}</p>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t('smtpProvider')}>
        {PRESETS.map((p) => {
          const elegido = p.host ? preset?.id === p.id : Boolean(correo.host) && !preset;
          return (
            <button key={p.id} type="button" aria-pressed={elegido} onClick={() => aplicarPreset(p)} className={`cfg-chip ${elegido ? 'cfg-chip-activo' : ''}`}>
              {t(`smtpPreset_${p.id}`)}
            </button>
          );
        })}
      </div>
      {preset && <p className="mb-4 flex items-start gap-2 rounded-[8px] bg-[var(--color-surface-3)] p-3 text-[12.5px] leading-snug text-[var(--color-text-dim)]"><TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" /> {t(`smtpPresetNote_${preset.id}`)}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem_10rem]">
        <Campo etiqueta={t('smtpHost')} htmlFor="smtp-host">
          <input id="smtp-host" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="cfg-input font-mono text-[13.5px]" maxLength={253} placeholder="mail.tuempresa.com" value={correo.host || ''} onChange={(e) => set('host')(e.target.value.trim())} autoComplete="off" spellCheck={false} />
        </Campo>
        <Campo etiqueta={t('smtpPort')} htmlFor="smtp-puerto">
          <input id="smtp-puerto" type="number" inputMode="numeric" min={1} max={65535} className="cfg-input tabular-nums" value={correo.puerto} onChange={(e) => set('puerto')(Number(e.target.value) || '')} />
        </Campo>
        <Campo etiqueta={t('smtpSecurity')} htmlFor="smtp-seguridad">
          <SelectorSimple
            id="smtp-seguridad"
            valor={correo.seguridad}
            onCambio={set('seguridad')}
            opciones={[
              { valor: 'ssl', etiqueta: 'SSL/TLS' },
              { valor: 'starttls', etiqueta: 'STARTTLS' },
              { valor: 'ninguna', etiqueta: t('smtpSecurityNone') },
            ]}
          />
        </Campo>
        <Campo etiqueta={t('smtpUser')} htmlFor="smtp-usuario">
          <input id="smtp-usuario" autoCapitalize="none" className="cfg-input" maxLength={160} placeholder="crm@tuempresa.com" value={correo.usuario || ''} onChange={(e) => set('usuario')(e.target.value.trim())} autoComplete="off" spellCheck={false} />
        </Campo>
        <Campo etiqueta={t('smtpPassword')} htmlFor="smtp-password" className="sm:col-span-2" ayuda={correo.passwordGuardada && !correo.password ? t('smtpPasswordSaved') : t('smtpPasswordHint')}>
          <div className="relative">
            <input
              id="smtp-password"
              type={verPassword ? 'text' : 'password'}
              className="cfg-input !pr-10"
              maxLength={200}
              placeholder={correo.passwordGuardada ? '••••••••••' : ''}
              value={correo.password || ''}
              onChange={(e) => set('password')(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]" onClick={() => setVerPassword((v) => !v)} aria-label={verPassword ? t('hidePassword') : t('showPassword')}>
              {verPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Campo>
        <Campo etiqueta={t('smtpFromEmail')} ayuda={t('smtpFromEmailHint')} htmlFor="smtp-remitente">
          <input id="smtp-remitente" type="email" className="cfg-input" maxLength={160} placeholder={correo.usuario || 'crm@tuempresa.com'} value={correo.remitenteEmail || ''} onChange={(e) => set('remitenteEmail')(e.target.value.trim())} />
        </Campo>
        <Campo etiqueta={t('mailSender')} ayuda={t('cfgSenderHint')} htmlFor="cfg-remitente" zona="remitente" className="sm:col-span-2">
          <input id="cfg-remitente" className="cfg-input" maxLength={60} placeholder={nombreSistema} value={reglas.remitenteCorreo || ''} onChange={(e) => cambiar('reglas', 'remitenteCorreo', e.target.value)} />
        </Campo>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--cfg-linea)] pt-4">
        <button type="button" className="cfg-btn" onClick={probar} disabled={!correo.host || prueba === 'probando'}>
          {prueba === 'probando' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {t('smtpVerify')}
        </button>
        {prueba && prueba !== 'probando' && (
          <span className={`flex min-w-0 flex-1 items-start gap-1.5 text-[12.5px] ${prueba.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
            {prueba.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <TriangleAlert size={14} className="mt-0.5 shrink-0" />}
            <span>{prueba.mensaje}{prueba.detalle && <span className="block font-mono text-[11px] opacity-75">{prueba.detalle}</span>}</span>
          </span>
        )}
        {!prueba && <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)]"><Server size={13} /> {t('smtpVerifyHint')}</span>}
      </div>
    </Fila>
  );
};
