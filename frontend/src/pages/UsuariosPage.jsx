// Página de Gestión de Usuarios (Solo Admin)
import { useState } from 'react';
import useSWR from 'swr';
import { useSearchParams } from 'react-router-dom';
import { usuariosService } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { AREA_GENERAL, areasDeTexto } from '../utils/areas';
import { PageSkeleton } from '../components/Skeleton';
import UserAvatar from '../components/UserAvatar';
import Modal from '../components/Modal';
import Tooltip from '../components/Tooltip';
import ActionMenu from '../components/ActionMenu';
import CampoFiltro from '../components/CampoFiltro';
import SelectorSimple from '../components/SelectorSimple';
import SelectorMultiple from '../components/SelectorMultiple';
import { useConfirmacion } from '../components/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useDebounce } from '../utils/useDebounce';
import ModalPermisosPersona from '../components/usuarios/ModalPermisosPersona';
import {
  alcanceDe, areasDe, areasDelAlcance, esAdminGeneral, puede,
} from '../utils/permisos';
import { useTextoPermisos } from '../hooks/useTextoPermisos';
import {
  KeyRound,
  Pencil,
  UserPlus,
  Mail,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCcw,
  RefreshCw,
  UserX,
  UserCheck,
  Ban,
  Search,
  X
} from 'lucide-react';

const ROLES = ['MIEMBRO', 'ADMIN'];
// Mismos valores que guarda el backend (usuarios.controller normaliza a minusculas)
// 'pendiente' = se registro solo y verifico su correo: espera aprobacion.
const ESTADOS_USUARIO = ['activo', 'pendiente', 'inactivo'];
const esRegistroPendiente = (estado) => estado === 'pendiente' || estado === 'pendiente_verificacion';

const ROL_LABEL_KEY = { ADMIN: 'roleAdmin', MIEMBRO: 'roleMember' };

// Etiquetas legibles: antes se mostraba el valor crudo ("DESARROLLO", "ADMIN").
// El nombre del area sale de la configuracion (nombreArea de useConfiguracion).
const etiquetaArea = (t, nombreArea, area) => (area ? nombreArea(String(area).toUpperCase()) : t('areaGeneral'));
const etiquetaRol = (t, rol) => t(ROL_LABEL_KEY[String(rol || '').toUpperCase()] || 'roleMember');
const ETIQUETA_ESTADO = {
  activo: 'usersStatusActive',
  pendiente: 'usersStatusPendingApproval',
  pendiente_verificacion: 'usersStatusPendingVerification',
};
const etiquetaEstadoUsuario = (t, estado) => t(ETIQUETA_ESTADO[estado] || 'usersStatusInactive');

const ESTILO_ROL = {
  ADMIN:   { background: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)' },
  MIEMBRO: { background: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)' },
};
const ESTILO_INVITACION = {
  pendiente: { background: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    Icon: Clock,         labelKey: 'usersStatusPending' },
  aceptada:  { background: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', Icon: CheckCircle2,  labelKey: 'usersStatusAccepted' },
  expirada:  { background: 'var(--badge-danger-bg)',  color: 'var(--badge-danger-fg)',  Icon: AlertTriangle, labelKey: 'usersStatusExpired' },
};

const formatearFecha = (valor, locale) => {
  if (!valor) return '—';
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleDateString(locale);
};

const UsuariosPage = () => {
  const { t } = usePreferences();
  const { areas, nombreArea } = useConfiguracion();
  const { usuario: usuarioActual } = useAuth();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('activos');
  const [modalInvitar, setModalInvitar] = useState(false);
  const [modalEditar, setModalEditar] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  // Persona cuyos permisos se ajustan (solo el administrador general).
  const [permisosDe, setPermisosDe] = useState(null);
  // Lo que puede hacer quien mira la sección (utils/permisos.js); el
  // servidor revisa además el área y que no se toque a otros administradores.
  const puedeInvitar = puede(usuarioActual, 'usuarios.invitar');
  const acciones = {
    editar: puede(usuarioActual, 'usuarios.editar'),
    desactivar: puede(usuarioActual, 'usuarios.desactivar'),
    general: esAdminGeneral(usuarioActual),
  };
  // El buscador global (Ctrl+K) llega aqui con ?q=nombre. Si ya estabamos en
  // esta pantalla el componente no se vuelve a montar, asi que el parametro se
  // sigue como estado derivado ("ultimo aplicado"), igual que ?fecha= en Agenda.
  const qParam = searchParams.get('q') || '';
  const [busqueda, setBusqueda] = useState(qParam);
  const [qAplicado, setQAplicado] = useState(qParam);
  if (qParam !== qAplicado) {
    setQAplicado(qParam);
    if (qParam) setBusqueda(qParam);
  }
  const [filtroArea, setFiltroArea] = useState('TODAS');
  const [filtroRol, setFiltroRol] = useState('TODOS');
  const [filtroEstado, setFiltroEstado] = useState('TODOS');
  const busquedaDiferida = useDebounce(busqueda, 350);

  // Una peticion por pestaña, cada una con su propia clave. Antes las dos
  // compartian un hook y, con keepPreviousData, al pasar a invitaciones se
  // pintaba un instante la lista de usuarios como si fueran invitaciones
  // ("Expira: Invalid Date"). Los filtros van en la clave para que cada
  // combinacion se cachee aparte y el servidor haga el filtrado.
  const {
    data: usuarios,
    error: errorUsuarios,
    isLoading: cargandoUsuarios,
    mutate: recargarUsuarios,
  } = useSWR(
    tab === 'activos' ? ['usuarios', busquedaDiferida, filtroArea, filtroRol, filtroEstado] : null,
    async ([, q, area, rol, estado]) => {
      const res = await usuariosService.listar({
        q,
        ...(area !== 'TODAS' && { area }),
        ...(rol !== 'TODOS' && { rol }),
        ...(estado !== 'TODOS' && { estado }),
      });
      return res.usuarios || [];
    },
    { dedupingInterval: 5000, onError: (error) => showToast(error.message, 'error') },
  );

  const {
    data: invitaciones,
    error: errorInvitaciones,
    isLoading: cargandoInvitaciones,
    mutate: recargarInvitaciones,
  } = useSWR(
    tab === 'invitaciones' ? 'invitaciones' : null,
    async () => {
      const res = await usuariosService.listarInvitaciones();
      return Array.isArray(res) ? res : (res.invitaciones || []);
    },
    { keepPreviousData: false, dedupingInterval: 5000, onError: (error) => showToast(error.message, 'error') },
  );

  const handleToggleEstado = async (u) => {
    // Nadie se desactiva a si mismo desde aqui: se quedaria fuera del sistema
    if (u.id === usuarioActual?.id) return;

    if (u.estado === 'activo') {
      const ok = await confirmar({
        titulo: t('usersDeactivateConfirm', { name: u.nombre }),
        textoConfirmar: t('usersDeactivate'),
        peligro: true,
      });
      if (!ok) return;
      try {
        // DELETE /usuarios/:id ya no borra: desactiva y conserva el historial
        await usuariosService.desactivar(u.id);
        recargarUsuarios();
        showToast(t('usersDeactivated'));
      } catch (error) { showToast(error.message, 'error'); }
      return;
    }

    try {
      await usuariosService.toggleEstado(u.id, 'activo');
      recargarUsuarios();
      showToast(esRegistroPendiente(u.estado) ? t('usersApproved') : t('usersActivated'));
    } catch (error) { showToast(error.message, 'error'); }
  };

  const handleReenviarInvitacion = async (email) => {
    try {
      const res = await usuariosService.reenviarInvitacion(email);
      if (res?.advertencia) showToast(res.advertencia, 'info', { duration: 8000 });
      else showToast(t('usersInvitationResent'));
      recargarInvitaciones();
    } catch (error) { showToast(error.message, 'error'); }
  };

  const handleEliminarInvitacion = async (invitacion) => {
    if (invitacion.estado === 'aceptada') {
      showToast(t('usersInvitationAcceptedKept'), 'info');
      return;
    }

    const ok = await confirmar({
      titulo: t('usersInvitationDeleteConfirm', { name: invitacion.nombre }),
      descripcion: invitacion.email,
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;

    try {
      await usuariosService.eliminarInvitacion(invitacion.id);
      showToast(t('usersInvitationDeleted'));
      recargarInvitaciones();
    } catch (error) { showToast(error.message, 'error'); }
  };

  const hayFiltros = Boolean(busqueda) || filtroArea !== 'TODAS' || filtroRol !== 'TODOS' || filtroEstado !== 'TODOS';
  const limpiarFiltros = () => {
    setBusqueda('');
    setFiltroArea('TODAS');
    setFiltroRol('TODOS');
    setFiltroEstado('TODOS');
  };

  const cargandoPestana = tab === 'activos' ? (cargandoUsuarios && !usuarios) : (cargandoInvitaciones && !invitaciones);
  const errorPestana = tab === 'activos' ? (errorUsuarios && !usuarios) : (errorInvitaciones && !invitaciones);
  const reintentar = () => (tab === 'activos' ? recargarUsuarios() : recargarInvitaciones());

  return (
    // Sin padding propio: el Layout ya pone el suyo y aqui se sumaba otro
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-semibold text-[var(--color-text)] tracking-tight">{t('usersManageTitle')}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('usersManageSubtitle')}</p>
        </div>
        {puedeInvitar && (
          <Button size="lg" className="w-full md:w-auto" onClick={() => setModalInvitar(true)}>
            <UserPlus size={18} />
            {t('usersInvite')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="activos" className="text-sm font-normal data-[state=active]:font-medium">
            {t('usersActiveMembers')}
          </TabsTrigger>
          {puedeInvitar && (
            <TabsTrigger value="invitaciones" className="text-sm font-normal data-[state=active]:font-medium">
              {t('usersInvitationsTab')}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {/* Buscador y filtros en una sola fila — solo aplican a miembros. Los
          cuatro van al servidor (la API ya aceptaba area, rol y estado). */}
      {tab === 'activos' && (
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <CampoFiltro label={t('search')} htmlFor="usuarios-buscar" className="w-full sm:w-auto sm:min-w-[240px] flex-1 max-w-xl">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none">
                <Search size={18} />
              </span>
              <input
                id="usuarios-buscar"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={t('usersSearchPlaceholder')}
                className="w-full h-11 pl-11 pr-11 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-normal text-[var(--color-text)] outline-none transition-all focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-40)]"
              />
              {busqueda && (
                <Tooltip label={t('clearSearch')}>
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                  >
                    <X size={16} />
                  </button>
                </Tooltip>
              )}
            </div>
          </CampoFiltro>

          {/* En móvil: Área a lo ancho y Rol/Estado a medias. Con anchos fijos
              cada selector caía en su propia fila con hueco a la derecha. */}
          <CampoFiltro label={t('fieldArea')} className="w-full sm:w-auto">
            <Select value={filtroArea} onValueChange={setFiltroArea}>
              <SelectTrigger className="h-11 w-full text-sm font-normal sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODAS" className="text-sm font-normal">{t('usersAllAreas')}</SelectItem>
                {areas.map(({ clave: area }) => (
                  <SelectItem key={area} value={area} className="text-sm font-normal">{etiquetaArea(t, nombreArea, area)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>

          <CampoFiltro label={t('fieldRole')} className="min-w-0 flex-1 sm:flex-none">
            <Select value={filtroRol} onValueChange={setFiltroRol}>
              <SelectTrigger className="h-11 w-full text-sm font-normal sm:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODOS" className="text-sm font-normal">{t('usersAllRoles')}</SelectItem>
                {ROLES.map((rol) => (
                  <SelectItem key={rol} value={rol} className="text-sm font-normal">{etiquetaRol(t, rol)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>

          <CampoFiltro label={t('usersFilterStatus')} className="min-w-0 flex-1 sm:flex-none">
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="h-11 w-full text-sm font-normal sm:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[1500]">
                <SelectItem value="TODOS" className="text-sm font-normal">{t('usersAllStatuses')}</SelectItem>
                {ESTADOS_USUARIO.map((estado) => (
                  <SelectItem key={estado} value={estado} className="text-sm font-normal">{etiquetaEstadoUsuario(t, estado)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoFiltro>

          {hayFiltros && (
            <Button variant="ghost" className="h-11 w-full sm:w-auto" onClick={limpiarFiltros}>
              <X size={16} /> {t('clearFilters')}
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        {cargandoPestana ? (
          <div className="p-6"><PageSkeleton cards={3} showSidebar={false} /></div>
        ) : errorPestana ? (
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-[var(--color-error)]">{errorPestana.message}</p>
            <Button variant="outline" onClick={reintentar}><RefreshCw size={15} /> {t('retry')}</Button>
          </div>
        ) : tab === 'activos' ? (
          <TablaActivos
            usuarios={usuarios || []}
            usuarioActualId={usuarioActual?.id}
            hayFiltros={hayFiltros}
            onLimpiarFiltros={limpiarFiltros}
            acciones={acciones}
            onEdit={(u) => { setUsuarioEditando(u); setModalEditar(true); }}
            onPermisos={(u) => setPermisosDe(u)}
            onToggleStatus={handleToggleEstado}
          />
        ) : (
          <TablaInvitaciones
            invitaciones={invitaciones || []}
            onResend={handleReenviarInvitacion}
            onDelete={handleEliminarInvitacion}
          />
        )}
      </div>

      {/* Modales */}
      {modalInvitar && (
        <ModalInvitar
          usuarioActual={usuarioActual}
          onClose={() => setModalInvitar(false)}
          onSuccess={() => { setModalInvitar(false); setTab('invitaciones'); recargarInvitaciones(); }}
        />
      )}

      {modalEditar && (
        <ModalEditar
          usuarioActual={usuarioActual}
          usuario={usuarioEditando}
          onClose={() => { setModalEditar(false); setUsuarioEditando(null); }}
          onSuccess={() => { setModalEditar(false); setUsuarioEditando(null); recargarUsuarios(); }}
        />
      )}

      {permisosDe && (
        <ModalPermisosPersona usuarioId={permisosDe.id} onClose={() => setPermisosDe(null)} />
      )}

      {dialogo}
    </div>
  );
};

const CeldaCabecera = ({ children, alineacion = 'left' }) => (
  <th className={`px-6 py-4 text-${alineacion} text-xs font-medium text-[var(--color-text-muted)] tracking-wider`}>{children}</th>
);

const EtiquetaRol = ({ rol, t }) => (
  <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg" style={ESTILO_ROL[String(rol || '').toUpperCase()] || ESTILO_ROL.MIEMBRO}>
    {etiquetaRol(t, rol)}
  </span>
);

const colorEstado = (estado) => {
  if (estado === 'activo') return 'var(--color-success)';
  if (esRegistroPendiente(estado)) return 'var(--color-warning)';
  return 'var(--color-text-muted)';
};

const EstadoUsuario = ({ estado, t }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: colorEstado(estado) }}>
    <span
      className={`w-1.5 h-1.5 rounded-full ${estado === 'activo' || esRegistroPendiente(estado) ? 'animate-pulse' : ''}`}
      style={{ background: colorEstado(estado) }}
    />
    {etiquetaEstadoUsuario(t, estado)}
  </span>
);

const TablaActivos = ({ usuarios, usuarioActualId, hayFiltros, onLimpiarFiltros, acciones = {}, onEdit, onPermisos, onToggleStatus }) => {
  const { t, locale } = usePreferences();
  const tp = useTextoPermisos();
  const { nombreArea } = useConfiguracion();

  if (usuarios.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center gap-4 text-center text-[var(--color-text-muted)]">
        <span>{hayFiltros ? t('searchNoResults') : t('usersNoActiveMembers')}</span>
        {hayFiltros && (
          <Button variant="outline" onClick={onLimpiarFiltros}><X size={15} /> {t('clearFilters')}</Button>
        )}
      </div>
    );
  }

  // Sin "Eliminar" por decision del usuario: las cuentas se desactivan y
  // conservan su historial. Nadie puede desactivarse a si mismo desde aqui.
  // A otros administradores solo los toca el administrador general; los
  // permisos por persona tambien son solo suyos (y no aplican a otro general).
  const accionesDe = (u) => {
    const tocable = acciones.general || u.rol !== 'ADMIN';
    return [
      acciones.desactivar && tocable && u.id !== usuarioActualId && {
        label: u.estado === 'activo' ? t('usersDeactivate') : esRegistroPendiente(u.estado) ? t('usersApprove') : t('usersActivate'),
        icon: u.estado === 'activo' ? <UserX size={15} /> : <UserCheck size={15} />,
        onSelect: () => onToggleStatus(u),
      },
      acciones.editar && tocable && { label: t('edit'), icon: <Pencil size={15} />, onSelect: () => onEdit(u) },
      acciones.general && !esAdminGeneral(u) && { label: tp('permPersonaBoton'), icon: <KeyRound size={15} />, onSelect: () => onPermisos(u) },
    ].filter(Boolean);
  };

  return (
    <div className="overflow-x-auto">
      {/* Desktop Table View */}
      <table className="usr-tabla hidden md:table w-full">
        <thead className="bg-[var(--color-surface-3)] border-b border-[var(--color-border)]">
          <tr>
            <CeldaCabecera>{t('usersTableMember')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableArea')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableRole')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableRegister')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableStatus')}</CeldaCabecera>
            <CeldaCabecera alineacion="right">{t('usersTableActions')}</CeldaCabecera>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-light)]">
          {usuarios.map(u => (
            <tr key={u.id} className="hover:bg-[var(--color-surface-3)] transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    usuario={u}
                    size={40}
                    radius={12}
                    fontSize="0.9rem"
                    color="var(--color-primary)"
                    background="var(--color-primary-10)"
                    borderColor="var(--color-primary-20)"
                  />
                  <div>
                    <div className="font-medium text-[var(--color-text)]">{u.nombre}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{u.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg" style={{ background: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }}>
                  {etiquetaArea(t, nombreArea, u.area)}
                </span>
              </td>
              <td className="px-6 py-4"><EtiquetaRol rol={u.rol} t={t} /></td>
              <td className="px-6 py-4 text-sm text-[var(--color-text-dim)] font-medium">
                {formatearFecha(u.creadoEn, locale)}
              </td>
              <td className="px-6 py-4"><EstadoUsuario estado={u.estado} t={t} /></td>
              <td className="px-6 py-4 text-right">
                <div className="flex justify-end items-center gap-2">
                  {accionesDe(u).length > 0 && <ActionMenu size={18} className="h-10 w-10" items={accionesDe(u)} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-4 p-4">
        {usuarios.map(u => (
          <div key={u.id} className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col gap-4">
            {/* min-w-0 + truncate: un correo largo empujaba la tarjeta fuera
                de la pantalla en 360px. */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  usuario={u}
                  size={40}
                  radius={12}
                  fontSize="0.9rem"
                  color="var(--color-on-primary)"
                  background="var(--color-primary)"
                  borderColor="transparent"
                />
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--color-text)]">{u.nombre}</div>
                  <div className="truncate text-xs text-[var(--color-text-muted)]" title={u.email}>{u.email}</div>
                </div>
              </div>
              <span className="shrink-0"><EtiquetaRol rol={u.rol} t={t} /></span>
            </div>

            <div className="grid grid-cols-2 gap-4 py-3 border-y border-[var(--color-border-light)]">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{t('usersTableArea')}</span>
                <span className="text-xs font-medium text-[var(--color-text-dim)]">{etiquetaArea(t, nombreArea, u.area)}</span>
              </div>
              <div className="flex flex-col gap-1 items-end text-right">
                <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{t('usersTableStatus')}</span>
                <EstadoUsuario estado={u.estado} t={t} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[var(--color-text-muted)]">
                {t('usersRegShort')} {formatearFecha(u.creadoEn, locale)}
              </div>
              {/* 44px: es la única forma de llegar a editar/desactivar en móvil */}
              {accionesDe(u).length > 0 && (
                <ActionMenu
                  size={18}
                  className="h-11 w-11 border border-[var(--color-border)]"
                  items={accionesDe(u)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EstadoInvitacion = ({ estado, t, compacto = false }) => {
  const conf = ESTILO_INVITACION[estado] || ESTILO_INVITACION.pendiente;
  const { Icon } = conf;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium ${compacto ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ background: conf.background, color: conf.color }}
    >
      <Icon size={compacto ? 10 : 12} /> {t(conf.labelKey)}
    </span>
  );
};

const TablaInvitaciones = ({ invitaciones, onResend, onDelete }) => {
  const { t, locale } = usePreferences();
  const { nombreArea } = useConfiguracion();
  if (invitaciones.length === 0) return <div className="p-12 text-center text-[var(--color-text-muted)]">{t('usersNoInvitations')}</div>;

  return (
    <div className="overflow-x-auto">
      {/* Desktop Table View */}
      <table className="usr-tabla hidden md:table w-full">
        <thead className="bg-[var(--color-surface-3)] border-b border-[var(--color-border)]">
          <tr>
            <CeldaCabecera>{t('usersTableMember')}</CeldaCabecera>
            <CeldaCabecera>{t('usersAreaRole')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableStatus')}</CeldaCabecera>
            <CeldaCabecera>{t('usersTableRegister')}</CeldaCabecera>
            <CeldaCabecera alineacion="right">{t('usersTableActions')}</CeldaCabecera>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-light)]">
          {invitaciones.map(inv => (
            <tr key={inv.id} className="hover:bg-[var(--color-surface-3)] transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-3)] text-[var(--color-text-muted)] flex items-center justify-center">
                    <Mail size={18} />
                  </div>
                  <div>
                    <div className="font-medium text-[var(--color-text)]">{inv.nombre}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{inv.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-[var(--color-text-dim)]">{etiquetaArea(t, nombreArea, inv.area)}</span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">{etiquetaRol(t, inv.rol)}</span>
                </div>
              </td>
              <td className="px-6 py-4"><EstadoInvitacion estado={inv.estado} t={t} /></td>
              <td className="px-6 py-4">
                <div className="text-xs font-medium text-[var(--color-text-dim)]">{t('usersSent')}: {formatearFecha(inv.creadoEn, locale)}</div>
                <div className="text-[11px] text-[var(--color-text-muted)]">{t('usersExpires')}: {formatearFecha(inv.expiraEn, locale)}</div>
              </td>
              <td className="px-6 py-4 text-right">
                {inv.estado !== 'aceptada' && (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onResend(inv.email)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
                      style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-fg)' }}
                    >
                      <RefreshCcw size={12} /> {t('usersResend')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(inv)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
                      style={{ background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-fg)' }}
                    >
                      <Ban size={12} /> {t('cancel')}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-4 p-4">
        {invitaciones.map(inv => (
          <div key={inv.id} className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-3)] text-[var(--color-text-muted)] flex items-center justify-center">
                <Mail size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--color-text)] leading-tight truncate">{inv.nombre}</div>
                <div className="text-xs text-[var(--color-text-muted)] truncate" title={inv.email}>{inv.email}</div>
              </div>
              <EstadoInvitacion estado={inv.estado} t={t} compacto />
            </div>

            <div className="grid grid-cols-2 gap-4 py-3 border-y border-[var(--color-border-light)]">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{t('usersAreaRole')}</span>
                <span className="text-xs font-medium text-[var(--color-text-dim)]">{etiquetaArea(t, nombreArea, inv.area)} / {etiquetaRol(t, inv.rol)}</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{t('usersExpires')}</span>
                <span className="text-xs font-medium text-[var(--color-text-dim)]">{formatearFecha(inv.expiraEn, locale)}</span>
              </div>
            </div>

            {inv.estado !== 'aceptada' && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onResend(inv.email)}
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium py-3 rounded-xl transition-all"
                  style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-fg)' }}
                >
                  <RefreshCcw size={14} /> {t('usersResendInvitation')}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(inv)}
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium py-3 rounded-xl transition-all"
                  style={{ background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-fg)' }}
                >
                  <Ban size={14} /> {t('usersCancelInvitation')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Sin "usuarios.ver" = todos, solo se gestionan sus áreas. */
const soloSuArea = (usuario) => !esAdminGeneral(usuario) && alcanceDe(usuario, 'usuarios.ver') !== 'todos';
/** Áreas que puede dar o quitar quien no gestiona todas (mismo criterio que el servidor). */
const areasQueGestiona = (usuario) => (alcanceDe(usuario, 'usuarios.ver') === 'area' ? areasDelAlcance(usuario, 'usuarios.ver') : areasDe(usuario));
/** Solo el administrador general da el rol de administrador. */
const rolesQueAsigna = (usuario) => (esAdminGeneral(usuario) ? ROLES : ['MIEMBRO']);

/**
 * Selector de una o varias áreas. `bloqueadas` son las que la persona ya
 * tiene y quien edita no administra: se ven elegidas pero no se pueden quitar.
 */
const SelectorAreas = ({ id, disponibles, elegidas, bloqueadas = [], onCambio }) => {
  const { t } = usePreferences();
  const { nombreArea } = useConfiguracion();
  const opciones = [...disponibles, ...bloqueadas.filter((a) => !disponibles.includes(a))]
    .map((a) => ({ valor: a, etiqueta: etiquetaArea(t, nombreArea, a), deshabilitada: bloqueadas.includes(a) }));
  const alternar = (clave) => onCambio(elegidas.includes(clave) ? elegidas.filter((a) => a !== clave) : [...elegidas, clave]);
  return (
    <div id={id}>
      <SelectorMultiple
        opciones={opciones}
        seleccionados={elegidas}
        onToggle={alternar}
        placeholder={t('usersAreasPlaceholder')}
        disabled={opciones.length === 1 && elegidas.length === 1}
      />
      {bloqueadas.length > 0 && <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{t('usersAreasOtherHint')}</p>}
    </div>
  );
};

const ModalInvitar = ({ usuarioActual, onClose, onSuccess }) => {
  const { t } = usePreferences();
  const { areas } = useConfiguracion();
  const esAdminArea = soloSuArea(usuarioActual);
  const areasDisponibles = esAdminArea ? areasQueGestiona(usuarioActual) : areas.map((a) => a.clave);
  const [form, setForm] = useState({ nombre: '', email: '', areas: [areasDisponibles[0] || AREA_GENERAL], rol: 'MIEMBRO' });
  const [cargando, setCargando] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.areas.length) { showToast(t('usersAreasRequired'), 'error'); return; }
    setCargando(true);
    try {
      const { areas: elegidas, ...datos } = form;
      const res = await usuariosService.invitar({ ...datos, area: elegidas.join(',') });
      // El backend puede crear la invitacion pero no lograr enviar el correo:
      // lo dice en `advertencia` y hay que mostrarlo, no darlo por enviado.
      if (res?.advertencia) showToast(res.advertencia, 'info', { duration: 8000 });
      else showToast(t('usersInvitationSent'));
      onSuccess();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="448px"
      title={(
        <span className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-fg)' }}>
            <Mail size={20} />
          </span>
          {t('usersInviteTitle')}
        </span>
      )}
      subtitle={t('usersInviteSubtitle')}
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="invitar-nombre" className="text-xs font-medium text-[var(--color-text-muted)]">{t('usersInviteNameLabel')}</label>
            <input
              id="invitar-nombre"
              // Son datos de otra persona: sin autocompletar con los del propio admin
              autoComplete="off"
              required
              className="form-input"
              value={form.nombre}
              onChange={e => setForm({...form, nombre: e.target.value})}
              placeholder={t('usersInviteNamePlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="invitar-email" className="text-xs font-medium text-[var(--color-text-muted)]">{t('usersInviteEmailLabel')}</label>
            <input
              id="invitar-email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              type="email"
              className="form-input"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              placeholder={t('usersInviteEmailPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="invitar-area" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldAreas')}</label>
              <SelectorAreas
                id="invitar-area"
                disponibles={areasDisponibles}
                elegidas={form.areas}
                onCambio={v => setForm({...form, areas: v})}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="invitar-rol" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldRole')}</label>
              <SelectorSimple
                id="invitar-rol"
                disabled={rolesQueAsigna(usuarioActual).length === 1}
                valor={form.rol}
                onCambio={v => setForm({...form, rol: v})}
                opciones={rolesQueAsigna(usuarioActual).map(r => ({ valor: r, etiqueta: etiquetaRol(t, r) }))}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-xl font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-3)] transition-all"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={cargando}
              className="flex-[1.5] btn-primary"
            >
              {cargando ? t('usersInviteSending') : <><Send size={18} /> {t('usersInviteSend')}</>}
            </button>
          </div>
        </form>
    </Modal>
  );
};

const ModalEditar = ({ usuarioActual, usuario, onClose, onSuccess }) => {
  const { t } = usePreferences();
  const { areas } = useConfiguracion();
  const esAdminArea = soloSuArea(usuarioActual);
  const areasConfiguradas = areas.map((a) => a.clave);
  const areasActuales = areasDeTexto(usuario?.area);
  // Quien administra solo algunas áreas da o quita esas; las demás de la
  // persona se ven pero no se tocan (el servidor las conserva). Si un área
  // de la persona ya no existe (la quitó el configurador) se sigue
  // ofreciendo, para no quitársela sin querer al guardar.
  const areasDisponibles = esAdminArea
    ? areasQueGestiona(usuarioActual)
    : [...areasConfiguradas, ...areasActuales.filter((a) => !areasConfiguradas.includes(a))];
  const bloqueadas = areasActuales.filter((a) => !areasDisponibles.includes(a));
  const [form, setForm] = useState({
    nombre: usuario?.nombre || '',
    email: usuario?.email || '',
    areas: areasActuales.length ? areasActuales : [areasDisponibles[0] || AREA_GENERAL],
    rol: usuario?.rol || 'MIEMBRO',
  });
  const [cargando, setCargando] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.areas.length) { showToast(t('usersAreasRequired'), 'error'); return; }
    setCargando(true);
    try {
      const { areas: elegidas, ...datos } = form;
      await usuariosService.editar(usuario.id, { ...datos, area: elegidas.join(',') });
      showToast(t('usersUpdated'));
      onSuccess();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="448px"
      title={t('usersEditTitle')}
      subtitle={t('usersEditSubtitle')}
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="editar-nombre" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldName')}</label>
            <input
              id="editar-nombre"
              autoComplete="off"
              required
              className="form-input"
              value={form.nombre}
              onChange={e => setForm({...form, nombre: e.target.value})}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="editar-email" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldEmail')}</label>
            <input
              id="editar-email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              type="email"
              className="form-input"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="editar-area" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldAreas')}</label>
              <SelectorAreas
                id="editar-area"
                disponibles={areasDisponibles}
                elegidas={form.areas}
                bloqueadas={bloqueadas}
                onCambio={v => setForm({...form, areas: v})}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="editar-rol" className="text-xs font-medium text-[var(--color-text-muted)]">{t('fieldRole')}</label>
              <SelectorSimple
                id="editar-rol"
                disabled={rolesQueAsigna(usuarioActual).length === 1}
                valor={form.rol}
                onCambio={v => setForm({...form, rol: v})}
                opciones={rolesQueAsigna(usuarioActual).map(r => ({ valor: r, etiqueta: etiquetaRol(t, r) }))}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-6 py-3 rounded-xl font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-3)] transition-all">{t('cancel')}</button>
            <button type="submit" disabled={cargando} className="flex-[1.5] btn-primary">
              {cargando ? t('saving') : t('save')}
            </button>
          </div>
        </form>
    </Modal>
  );
};

export default UsuariosPage;
