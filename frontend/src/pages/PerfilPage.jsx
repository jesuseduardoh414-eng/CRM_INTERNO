import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AtSign,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  ImagePlus,
  Info,
  KeyRound,
  LockKeyhole,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import { PageSkeleton } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getPublicAssetUrl, usuariosService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { getEstadoProyecto } from '../utils/estadosProyecto';
import { areasDeTexto } from '../utils/areas';
import SeguridadCuenta, { CambiarPassword } from '../components/SeguridadCuenta';
import { AuthAlert, BotonAuth, CampoPassword, CampoTexto } from '../components/auth/AuthUI';
import '../perfil.css';

const getInitials = (nombre = '') => (
  nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('') || 'U'
);

// Foto de perfil: formatos aceptados y peso máximo (se valida en el cliente
// antes de subir, con mensaje claro)
const TIPOS_FOTO = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MAX_BIO = 500;

// Pestañas del perfil; el hash de la URL (#acceso, #seguridad) abre la que toca
const PESTANAS = [
  { id: 'perfil', hash: '', icono: UserRound, etiqueta: 'pfTabProfile' },
  { id: 'acceso', hash: '#acceso', icono: KeyRound, etiqueta: 'pfTabAccess' },
  { id: 'seguridad', hash: '#seguridad', icono: ShieldCheck, etiqueta: 'pfTabSecurity' },
];
const pestanaDesdeHash = (hash) => PESTANAS.find((p) => p.hash && p.hash === hash)?.id || 'perfil';

const formDesdePerfil = (perfil) => ({
  nombre: perfil.nombre || '',
  telefono: perfil.telefono || '',
  puesto: perfil.puesto || '',
  biografia: perfil.biografia || '',
});

// Fila de formulario estilo "ajustes": etiqueta y ayuda a la izquierda, control a la derecha
const Fila = ({ etiqueta, ayuda, htmlFor, children }) => (
  <div className="pf-fila">
    <div>
      {htmlFor
        ? <label htmlFor={htmlFor} className="pf-fila-etiqueta">{etiqueta}</label>
        : <span className="pf-fila-etiqueta">{etiqueta}</span>}
      {ayuda && <p className="pf-fila-ayuda">{ayuda}</p>}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

const Campo = ({ icono: Icono, ...props }) => (
  <div className="relative">
    <Icono size={16} className="pf-campo-icono" aria-hidden="true" />
    <input className="pf-campo" {...props} />
  </div>
);

// ── Cambio del correo de acceso (pide la contraseña actual) ──────────────
const CambiarCorreo = ({ perfil, onActualizado }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    const nuevo = email.trim().toLowerCase();
    if (nuevo === String(perfil.email || '').toLowerCase()) { setError(t('pfEmailSame')); return; }
    setCargando(true); setError('');
    try {
      // El endpoint de perfil exige nombre y correo; el resto se reenvía tal cual
      // para no tocar lo que ya está guardado
      const payload = new FormData();
      payload.append('nombre', perfil.nombre || '');
      payload.append('email', nuevo);
      payload.append('passwordActual', password);
      const data = await usuariosService.actualizarPerfil(payload);
      setEmail(''); setPassword('');
      onActualizado(data.perfil);
      showToast(t('pfEmailUpdated'), 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="pf-panel flex flex-col" noValidate>
      <div className="pf-panel-cabecera">
        <span className="pf-panel-icono" aria-hidden="true"><AtSign size={18} /></span>
        <div>
          <h2 className="pf-panel-titulo">{t('pfEmailTitle')}</h2>
          <p className="pf-panel-ayuda">{t('pfEmailHint')}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('pfEmailCurrent')}</p>
          <p className="mt-0.5 break-all text-sm font-semibold text-[var(--color-text)]">{perfil.email}</p>
        </div>
        {error && <AuthAlert>{error}</AuthAlert>}
        <CampoTexto
          label={t('pfEmailNew')}
          icono={Mail}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          maxLength={191}
          required
        />
        <CampoPassword
          label={t('perfilCurrentPassword')}
          icono={LockKeyhole}
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          maxLength={200}
          required
        />
        <div className="mt-auto pt-2">
          <BotonAuth cargando={cargando} textoCargando={t('saving')} disabled={!email.trim() || !password}>
            {t('pfEmailSubmit')}
          </BotonAuth>
        </div>
      </div>
    </form>
  );
};

const PerfilPage = () => {
  const { t, locale } = usePreferences();
  const { nombreArea } = useConfiguracion();
  const { usuario, updateUsuario } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // Nombre del área (o áreas, en proyectos: "DESARROLLO,VENTAS").
  const etiquetaArea = (valor) => {
    const lista = areasDeTexto(valor);
    return lista.length ? lista.map(nombreArea).join(', ') : t('areaGeneral');
  };
  const inputFotoRef = useRef(null);
  const urlPreviaRef = useRef(''); // object URL vigente, para liberarla al cambiar o salir
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [archivoFoto, setArchivoFoto] = useState(null);
  const [previewFoto, setPreviewFoto] = useState('');
  const [removeFoto, setRemoveFoto] = useState(false);
  const [form, setForm] = useState({ nombre: '', telefono: '', puesto: '', biografia: '' });
  const pestana = pestanaDesdeHash(location.hash);

  useEffect(() => {
    document.title = `${t('profileTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    const cargarPerfil = async () => {
      try {
        setCargando(true);
        const data = await usuariosService.perfil();
        setPerfil(data.perfil);
        setForm(formDesdePerfil(data.perfil));
        setPreviewFoto(getPublicAssetUrl(data.perfil.fotoPerfilUrl));
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setCargando(false);
      }
    };

    cargarPerfil();
  }, [showToast]);

  // Al salir de la página se libera la vista previa local, si la hubiera
  useEffect(() => () => {
    if (urlPreviaRef.current) URL.revokeObjectURL(urlPreviaRef.current);
  }, []);

  const liberarPrevia = () => {
    if (urlPreviaRef.current) {
      URL.revokeObjectURL(urlPreviaRef.current);
      urlPreviaRef.current = '';
    }
  };

  const cambiarPestana = (id) => {
    const destino = PESTANAS.find((p) => p.id === id);
    navigate({ hash: destino.hash }, { replace: true });
  };

  const seleccionarFoto = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = ''; // permite volver a elegir el mismo archivo tras un error
    if (!file) return;
    if (!TIPOS_FOTO.includes(file.type)) {
      showToast(t('perfilPhotoInvalidType'), 'error');
      return;
    }
    if (file.size > MAX_FOTO_BYTES) {
      showToast(t('perfilPhotoTooBig'), 'error');
      return;
    }
    liberarPrevia();
    const url = URL.createObjectURL(file);
    urlPreviaRef.current = url;
    setArchivoFoto(file);
    setPreviewFoto(url);
    setRemoveFoto(false);
    if (pestana !== 'perfil') cambiarPestana('perfil');
  };

  const quitarFoto = () => {
    liberarPrevia();
    setArchivoFoto(null);
    setPreviewFoto('');
    setRemoveFoto(true);
  };

  const aplicarPerfil = (nuevo) => {
    setPerfil(nuevo);
    updateUsuario(nuevo);
  };

  const formatDate = (value) => {
    if (!value) return t('perfilNoData');
    return new Date(value).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const proyectosDestacados = useMemo(() => {
    if (!perfil) return [];
    const combinados = new Map();
    [...(perfil.proyectosMiembro || []), ...(perfil.proyectosCreados || [])].forEach((proyecto) => {
      combinados.set(proyecto.id, proyecto);
    });
    return [...combinados.values()].slice(0, 8);
  }, [perfil]);

  const hayCambios = Boolean(perfil) && (
    archivoFoto !== null
    || removeFoto
    || Object.entries(formDesdePerfil(perfil)).some(([k, v]) => form[k] !== v)
  );

  const descartar = () => {
    liberarPrevia();
    setForm(formDesdePerfil(perfil));
    setArchivoFoto(null);
    setRemoveFoto(false);
    setPreviewFoto(getPublicAssetUrl(perfil.fotoPerfilUrl));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setGuardando(true);
      const payload = new FormData();
      payload.append('nombre', form.nombre);
      payload.append('email', perfil.email); // el correo se cambia en su propia pestaña
      payload.append('telefono', form.telefono);
      payload.append('puesto', form.puesto);
      payload.append('biografia', form.biografia);
      payload.append('removeFoto', String(removeFoto));
      if (archivoFoto) payload.append('fotoPerfil', archivoFoto);

      const data = await usuariosService.actualizarPerfil(payload);
      liberarPrevia();
      setArchivoFoto(null);
      setRemoveFoto(false);
      setForm(formDesdePerfil(data.perfil));
      setPreviewFoto(getPublicAssetUrl(data.perfil.fotoPerfilUrl));
      aplicarPerfil(data.perfil);
      showToast(t('perfilUpdated'));
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <PageSkeleton cards={4} />;
  if (!perfil) {
    return (
      <div className="pf-panel mx-auto max-w-3xl p-8">
        <div className="badge-warning">
          <Sparkles size={12} aria-hidden="true" />
          {t('profileNotAvailable')}
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--color-text)]">{t('profileLoadError')}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {t('perfilErrorHint')}
        </p>
      </div>
    );
  }

  // Chip de estado de la cuenta: color según el estado real, no siempre verde
  const chipEstado = {
    activo: { clase: 'badge-success', texto: t('profileActive') },
    pendiente: { clase: 'badge-warning', texto: t('profilePending') },
  }[perfil.estado] || { clase: 'badge-neutral', texto: t('usersStatusInactive') };
  const rolTexto = t(perfil.rol === 'ADMIN' ? 'roleAdmin' : 'roleMember');

  const cifras = [
    { label: t('profileStatsActive'), value: perfil.resumen?.proyectosActivos ?? 0, icon: FolderKanban },
    { label: t('profileStatsTasks'), value: perfil.resumen?.tareasAsignadas ?? 0, icon: ClipboardList },
    { label: t('profileStatsCreated'), value: perfil.resumen?.tareasCreadas ?? 0, icon: CheckCircle2 },
    { label: t('profileStatsPending'), value: perfil.resumen?.notificacionesPendientes ?? 0, icon: Bell },
  ];

  const datosCuenta = [
    { label: t('fieldRole'), value: rolTexto, icon: ShieldCheck },
    { label: t('fieldArea'), value: etiquetaArea(perfil.area), icon: Building2 },
    { label: t('fieldRegistration'), value: formatDate(perfil.creadoEn), icon: CalendarDays },
    { label: t('fieldGoogleCalendar'), value: perfil.googleCalendarEmail || t('fieldNotConnected'), icon: CalendarDays, apagado: !perfil.googleCalendarEmail },
  ];

  const avatar = (tamano) => (
    previewFoto
      ? <img src={previewFoto} alt="" className="h-full w-full object-cover" />
      : <span aria-hidden="true" style={{ fontSize: tamano }}>{getInitials(form.nombre || perfil.nombre)}</span>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Un único <input type="file"> para todos los botones de foto */}
      <input
        ref={inputFotoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={seleccionarFoto}
      />

      {/* ── Cabecera: portada, identidad y cifras ── */}
      <header className="pf-panel overflow-hidden">
        <div className="pf-portada" aria-hidden="true" />
        <div className="px-6 pb-6 lg:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative -mt-14 w-fit shrink-0">
                <div className="pf-avatar h-28 w-28">{avatar('2rem')}</div>
                <button
                  type="button"
                  onClick={() => inputFotoRef.current?.click()}
                  aria-label={t('perfilChangePhotoAria')}
                  title={t('perfilChangePhotoAria')}
                  className="pf-avatar-boton"
                >
                  <Camera size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-[var(--color-text)] lg:text-[1.75rem]">{perfil.nombre}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase size={14} aria-hidden="true" />
                    {perfil.puesto || t('pfNoTitle')}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Mail size={14} aria-hidden="true" />
                    <span className="truncate">{perfil.email}</span>
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pb-1 sm:justify-end">
              <span className="badge-info">{rolTexto}</span>
              <span className="badge-neutral">{etiquetaArea(perfil.area)}</span>
              <span className={chipEstado.clase}>{chipEstado.texto}</span>
            </div>
          </div>
        </div>

        <dl className="pf-cifras">
          {cifras.map(({ label, value, icon: Icono }) => (
            <div key={label} className="pf-cifra">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
                <Icono size={14} aria-hidden="true" />
                {label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* ── Pestañas ── */}
      <div role="tablist" aria-label={t('pfTabsAria')} className="pf-pestanas">
        {PESTANAS.map(({ id, icono: Icono, etiqueta }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`pf-tab-${id}`}
            aria-controls={`pf-panel-${id}`}
            aria-selected={pestana === id}
            onClick={() => cambiarPestana(id)}
          >
            <Icono size={16} aria-hidden="true" />
            {t(etiqueta)}
          </button>
        ))}
      </div>

      {pestana === 'perfil' && (
        <div role="tabpanel" id="pf-panel-perfil" aria-labelledby="pf-tab-perfil" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={handleSubmit} className="pf-panel">
            <div className="pf-panel-cabecera">
              <span className="pf-panel-icono" aria-hidden="true"><UserRound size={18} /></span>
              <div>
                <h2 className="pf-panel-titulo">{t('profilePersonalInfo')}</h2>
                <p className="pf-panel-ayuda">{t('pfPersonalHint')}</p>
              </div>
            </div>

            <div className="divide-y divide-[var(--color-border)]">
              <Fila etiqueta={t('pfPhoto')} ayuda={t('pfPhotoHint')}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="pf-avatar h-16 w-16 border-2">{avatar('1.15rem')}</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => inputFotoRef.current?.click()} className="pf-boton">
                      <ImagePlus size={15} aria-hidden="true" />
                      {t('profileChangePhoto')}
                    </button>
                    {previewFoto && (
                      <button type="button" onClick={quitarFoto} className="pf-boton pf-boton-peligro">
                        <Trash2 size={15} aria-hidden="true" />
                        {t('profileRemovePhoto')}
                      </button>
                    )}
                  </div>
                </div>
              </Fila>

              <Fila etiqueta={t('fieldName')} htmlFor="perfil-nombre">
                <Campo
                  icono={UserRound}
                  id="perfil-nombre"
                  name="nombre"
                  autoComplete="name"
                  value={form.nombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                  maxLength={120}
                  required
                />
              </Fila>

              <Fila etiqueta={t('fieldPosition')} htmlFor="perfil-puesto">
                <Campo
                  icono={Briefcase}
                  id="perfil-puesto"
                  name="puesto"
                  autoComplete="organization-title"
                  value={form.puesto}
                  onChange={(e) => setForm((prev) => ({ ...prev, puesto: e.target.value }))}
                  placeholder={t('fieldPositionPlaceholder')}
                  maxLength={255}
                />
              </Fila>

              <Fila etiqueta={t('fieldPhone')} htmlFor="perfil-telefono">
                <Campo
                  icono={Phone}
                  id="perfil-telefono"
                  name="telefono"
                  type="tel"
                  autoComplete="tel"
                  value={form.telefono}
                  onChange={(e) => setForm((prev) => ({ ...prev, telefono: e.target.value }))}
                  placeholder={t('fieldPhonePlaceholder')}
                  maxLength={40}
                />
              </Fila>

              <Fila etiqueta={t('fieldEmail')} ayuda={t('pfEmailHint')}>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border)] px-3.5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-text)]">
                    <Mail size={16} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                    <span className="truncate">{perfil.email}</span>
                  </span>
                  <button type="button" className="auth-link shrink-0 text-sm" onClick={() => cambiarPestana('acceso')}>
                    {t('pfEmailManage')}
                  </button>
                </div>
              </Fila>

              <Fila etiqueta={t('fieldBio')} htmlFor="perfil-biografia">
                <textarea
                  id="perfil-biografia"
                  name="biografia"
                  rows={4}
                  maxLength={MAX_BIO}
                  value={form.biografia}
                  onChange={(e) => setForm((prev) => ({ ...prev, biografia: e.target.value }))}
                  className="pf-campo resize-none !pl-3.5"
                  placeholder={t('fieldBioPlaceholder')}
                  aria-describedby="perfil-biografia-conteo"
                />
                <p id="perfil-biografia-conteo" className="mt-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                  {t('pfBioCount', { n: form.biografia.length })}
                </p>
              </Fila>
            </div>

            <div className="pf-panel-pie">
              <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]" aria-live="polite">
                <span className={`h-2 w-2 rounded-full ${hayCambios ? 'bg-[var(--color-accent-warning)]' : 'bg-[var(--color-success)]'}`} aria-hidden="true" />
                {hayCambios ? t('pfUnsaved') : t('pfAllSaved')}
              </p>
              <div className="flex gap-2">
                {hayCambios && (
                  <button type="button" onClick={descartar} className="pf-boton" disabled={guardando}>
                    {t('pfDiscard')}
                  </button>
                )}
                <button type="submit" disabled={guardando || !hayCambios || !form.nombre.trim()} aria-busy={guardando} className="btn-primary">
                  <Save size={16} aria-hidden="true" />
                  {guardando ? t('saving') : t('profileSave')}
                </button>
              </div>
            </div>
          </form>

          {/* Columna de 320px solo desde xl: con el menu lateral de una tableta
              (1024px) el formulario quedaba en ~360px. Entre md y xl va debajo,
              con sus dos tarjetas lado a lado. */}
          <aside className="grid content-start gap-6 md:grid-cols-2 md:items-start xl:grid-cols-1">
            <section className="pf-panel">
              <div className="pf-panel-cabecera">
                <div>
                  <h2 className="pf-panel-titulo">{t('profileAccountData')}</h2>
                  <p className="pf-panel-ayuda">{t('pfAccountHint')}</p>
                </div>
              </div>
              <dl className="divide-y divide-[var(--color-border)]">
                {datosCuenta.map(({ label, value, icon: Icono, apagado }) => (
                  <div key={label} className="flex items-center gap-3 px-5 py-3.5">
                    <Icono size={16} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                    <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
                    <dd className={`ml-auto min-w-0 truncate text-right text-sm font-medium ${apagado ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`} title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="pf-panel">
              <div className="pf-panel-cabecera">
                <div>
                  <h2 className="pf-panel-titulo">{t('profileRelatedProjects')}</h2>
                  <p className="pf-panel-ayuda">{t('perfilRelatedHint')}</p>
                </div>
              </div>
              {proyectosDestacados.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
                  <FolderKanban size={22} aria-hidden="true" />
                  {t('profileNoProjects')}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {proyectosDestacados.map((proyecto) => {
                    const estado = getEstadoProyecto(proyecto.estado);
                    return (
                      <li key={proyecto.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/proyectos/${proyecto.id}`)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-surface-3)]"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true">
                            <FolderKanban size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[var(--color-text)]">{proyecto.nombre}</span>
                            <span className="block truncate text-xs text-[var(--color-text-muted)]">{etiquetaArea(proyecto.area)}</span>
                          </span>
                          <span className={`${estado.badgeClass} shrink-0`}>{t(estado.labelKey)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {pestana === 'acceso' && (
        <div role="tabpanel" id="pf-panel-acceso" aria-labelledby="pf-tab-acceso" className="space-y-6">
          <p className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-dim)]">
            <Info size={16} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
            {t('pfAccessNote')}
          </p>
          <div className="grid items-stretch gap-6 xl:grid-cols-2">
            <CambiarCorreo perfil={perfil} onActualizado={aplicarPerfil} />
            <CambiarPassword usuario={{ ...usuario, email: perfil.email, nombre: perfil.nombre }} />
          </div>
        </div>
      )}

      {pestana === 'seguridad' && (
        <div role="tabpanel" id="pf-panel-seguridad" aria-labelledby="pf-tab-seguridad">
          <SeguridadCuenta />
        </div>
      )}
    </div>
  );
};

export default PerfilPage;
