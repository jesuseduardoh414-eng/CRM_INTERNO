// Cuenta del cliente: portada con su foto y datos, y dos pestañas.
//  - Perfil: edita nombre, cargo, teléfono y foto (el correo es su acceso y
//    lo cambia el equipo); a un lado, su actividad, su empresa y su equipo.
//  - Seguridad: contraseña, verificación en dos pasos y sesiones (#seguridad).
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import {
  Briefcase, Building2, Camera, CalendarDays, FileText, FolderKanban, Globe, LockKeyhole, Mail,
  MessagesSquare, Phone, ShieldCheck, Trash2, UserRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import UserAvatar from '../../components/UserAvatar';
import SeguridadCuenta from '../../components/SeguridadCuenta';
import { PageSkeleton } from '../../components/Skeleton';
import { ErrorPortal, PanelPortal, VacioPortal } from '../../components/portal/PiezasPortal';
import { CLAVE_RESUMEN, fechaHora } from '../../utils/portal';

const CLAVE_PERFIL = ['portal', 'perfil'];
const TIPOS_FOTO = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FOTO = 2 * 1024 * 1024;

const formDe = (u) => ({ nombre: u?.nombre || '', puesto: u?.puesto || '', telefono: u?.telefono || '' });

const relativo = (valor, locale) => {
  const dias = Math.round((new Date(valor).getTime() - Date.now()) / 86400000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(dias) >= 1) return rtf.format(dias, 'day');
  const horas = Math.round((new Date(valor).getTime() - Date.now()) / 3600000);
  return Math.abs(horas) >= 1 ? rtf.format(horas, 'hour') : rtf.format(Math.round((new Date(valor).getTime() - Date.now()) / 60000), 'minute');
};

const Campo = ({ id, etiqueta, icono: Icono, ayuda, children }) => (
  <div className="ptl-campo">
    <label htmlFor={id} className="ptl-campo-etiqueta">{etiqueta}</label>
    <div className="ptl-campo-control">
      {Icono && <Icono size={16} aria-hidden="true" />}
      {children}
    </div>
    {ayuda && <p className="ptl-campo-ayuda">{ayuda}</p>}
  </div>
);

// ── Pestaña Perfil: formulario ─────────────────────────────────────────────

const FormularioPerfil = ({ usuario, onGuardado, tp }) => {
  const { showToast } = useToast();
  const [form, setForm] = useState(() => formDe(usuario));
  const [foto, setFoto] = useState(null); // { archivo, vista } | 'quitar' | null
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const archivoRef = useRef(null);

  useEffect(() => () => { if (foto?.vista) URL.revokeObjectURL(foto.vista); }, [foto]);

  const original = formDe(usuario);
  const cambiado = foto !== null || Object.keys(original).some((k) => form[k].trim() !== original[k]);
  const vistaFoto = foto === 'quitar' ? null : foto?.vista || usuario.fotoPerfilUrl || null;

  const elegirFoto = (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (!TIPOS_FOTO.includes(archivo.type)) { setError(tp('ptlFotoTipo')); return; }
    if (archivo.size > MAX_FOTO) { setError(tp('ptlFotoPeso')); return; }
    setError('');
    setFoto({ archivo, vista: URL.createObjectURL(archivo) });
  };

  const descartar = () => {
    setForm(formDe(usuario));
    setFoto(null);
    setError('');
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError(tp('ptlNombre')); return; }
    setGuardando(true);
    setError('');
    try {
      const datos = new FormData();
      Object.entries(form).forEach(([k, v]) => datos.append(k, v.trim()));
      if (foto?.archivo) datos.append('fotoPerfil', foto.archivo);
      if (foto === 'quitar') datos.append('removeFoto', 'true');
      const res = await portalService.actualizarPerfil(datos);
      setFoto(null);
      setForm(formDe(res.usuario));
      onGuardado(res.usuario);
      showToast(tp('ptlGuardado'), 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="ptl-panel">
      <header className="ptl-perfil-seccion">
        <h2 className="text-[15px] font-semibold">{tp('ptlTusDatos')}</h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-text-muted)]">{tp('ptlTusDatosAyuda')}</p>
      </header>

      <div className="ptl-perfil-seccion ptl-perfil-foto">
        <UserAvatar nombre={form.nombre || usuario.nombre} fotoPerfilUrl={vistaFoto} size={64} radius={999} fontSize="1.1rem" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{tp('ptlFoto')}</p>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">{tp('ptlFotoAyuda')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={archivoRef} type="file" accept={TIPOS_FOTO.join(',')} className="sr-only" onChange={elegirFoto} tabIndex={-1} aria-hidden="true" />
          <button type="button" className="ptl-boton-secundario" onClick={() => archivoRef.current?.click()}>
            <Camera size={15} aria-hidden="true" /> {vistaFoto ? tp('ptlFotoCambiar') : tp('ptlFotoSubir')}
          </button>
          {vistaFoto && (
            <button type="button" className="ptl-boton-secundario is-peligro" onClick={() => setFoto(usuario.fotoPerfilUrl ? 'quitar' : null)}>
              <Trash2 size={15} aria-hidden="true" /> {tp('ptlFotoQuitar')}
            </button>
          )}
        </div>
      </div>

      <div className="ptl-perfil-seccion grid gap-5 sm:grid-cols-2">
        <Campo id="pf-nombre" etiqueta={tp('ptlNombre')} icono={UserRound}>
          <input id="pf-nombre" value={form.nombre} maxLength={255} required autoComplete="name" onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </Campo>
        <Campo id="pf-puesto" etiqueta={tp('ptlCargo')} icono={Briefcase}>
          <input id="pf-puesto" value={form.puesto} maxLength={255} placeholder={tp('ptlCargoEj')} autoComplete="organization-title" onChange={(e) => setForm({ ...form, puesto: e.target.value })} />
        </Campo>
        <Campo id="pf-telefono" etiqueta={tp('ptlTelefono')} icono={Phone}>
          <input id="pf-telefono" type="tel" value={form.telefono} maxLength={40} autoComplete="tel" onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        </Campo>
        <Campo id="pf-correo" etiqueta={tp('ptlCuentaCorreo')} icono={LockKeyhole} ayuda={tp('ptlCorreoBloqueado')}>
          <input id="pf-correo" value={usuario.email} readOnly aria-readonly="true" className="is-bloqueado" />
        </Campo>
      </div>

      <footer className="ptl-perfil-pie">
        <p className={`min-w-0 flex-1 text-[13px] ${error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-muted)]'}`} role={error ? 'alert' : undefined}>
          {error || (cambiado ? '' : tp('ptlSinCambios'))}
        </p>
        {cambiado && <button type="button" className="ptl-boton-secundario" onClick={descartar} disabled={guardando}>{tp('ptlDescartar')}</button>}
        <button type="submit" className="ptl-boton-primario" disabled={!cambiado || guardando} aria-busy={guardando || undefined}>
          {guardando ? tp('ptlGuardando') : tp('ptlGuardar')}
        </button>
      </footer>
    </form>
  );
};

// ── Columna lateral ────────────────────────────────────────────────────────

const Lateral = ({ empresa, equipo, cifras, tp }) => {
  const datosEmpresa = [
    empresa?.rfc && { icono: FileText, etiqueta: tp('ptlRfc'), valor: empresa.rfc },
    empresa?.ciudad && { icono: Building2, etiqueta: tp('ptlCiudad'), valor: empresa.ciudad },
    empresa?.telefono && { icono: Phone, etiqueta: tp('ptlTelefono'), valor: empresa.telefono },
    empresa?.sitioWeb && { icono: Globe, etiqueta: tp('ptlSitioWeb'), valor: empresa.sitioWeb, url: /^https?:\/\//.test(empresa.sitioWeb) ? empresa.sitioWeb : `https://${empresa.sitioWeb}` },
  ].filter(Boolean);
  const listaCifras = [
    { icono: FolderKanban, valor: cifras.proyectos, etiqueta: tp('ptlCifraProyectos') },
    { icono: FileText, valor: cifras.documentos, etiqueta: tp('ptlCifraDocumentos') },
    { icono: MessagesSquare, valor: cifras.mensajesEnviados, etiqueta: tp('ptlCifraMensajes') },
    { icono: CalendarDays, valor: cifras.reuniones, etiqueta: tp('ptlCifraReuniones') },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelPortal titulo={tp('ptlTuActividad')}>
        <div className="ptl-cifras">
          {listaCifras.map(({ icono: Icono, valor, etiqueta }) => (
            <div key={etiqueta}>
              <Icono size={15} aria-hidden="true" />
              <strong>{valor}</strong>
              <span>{etiqueta}</span>
            </div>
          ))}
        </div>
      </PanelPortal>

      <PanelPortal titulo={tp('ptlTuEquipo')}>
        {equipo.length === 0 ? <VacioPortal icono={UserRound} texto={tp('ptlSinEquipo')} /> : (
          <ul>
            {equipo.map((p) => (
              <li key={p.email || p.nombre} className="ptl-persona">
                <UserAvatar nombre={p.nombre} fotoPerfilUrl={p.fotoPerfilUrl} size={38} radius={999} fontSize="0.7rem" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold" title={p.nombre}>{p.nombre}</p>
                  <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                    {p.puesto || tp('ptlLleva', { proyectos: p.proyectos.map((x) => x.nombre).join(', ') })}
                  </p>
                </div>
                {p.email && (
                  <a href={`mailto:${p.email}`} className="ptl-boton-icono" title={p.email} aria-label={`${tp('ptlEscribirCorreo')}: ${p.nombre}`}>
                    <Mail size={15} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelPortal>

      <PanelPortal titulo={tp('ptlTuEmpresa')}>
        <div className="px-4 pb-2 pt-4">
          <p className="text-[14px] font-semibold">{empresa?.nombreComercial || empresa?.nombre}</p>
          {empresa?.nombreComercial && <p className="text-[12.5px] text-[var(--color-text-muted)]">{empresa.nombre}</p>}
        </div>
        {datosEmpresa.length > 0 && (
          <dl className="ptl-datos">
            {datosEmpresa.map(({ icono: Icono, etiqueta, valor, url }) => (
              <div key={etiqueta}>
                <dt><Icono size={14} aria-hidden="true" /> {etiqueta}</dt>
                <dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{valor}</a> : valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </PanelPortal>
    </div>
  );
};

// ── Página ─────────────────────────────────────────────────────────────────

const PESTANAS = [
  { id: 'perfil', hash: '', icono: UserRound, etiqueta: 'ptlPerfilTab' },
  { id: 'seguridad', hash: '#seguridad', icono: ShieldCheck, etiqueta: 'ptlSeguridadTab' },
];

const PortalCuentaPage = () => {
  const { updateUsuario } = useAuth();
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const location = useLocation();
  const navigate = useNavigate();
  const { mutate: mutateGlobal } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR(CLAVE_PERFIL, portalService.perfil);
  const pestana = location.hash === '#seguridad' ? 'seguridad' : 'perfil';

  if (isLoading && !data) return <PageSkeleton cards={2} showSidebar={false} />;
  if (error && !data) return <ErrorPortal error={error} onReintentar={() => mutate()} />;

  const { usuario, empresa, equipo, cifras } = data;
  const alGuardar = (nuevo) => {
    mutate({ ...data, usuario: nuevo }, { revalidate: false });
    updateUsuario({ nombre: nuevo.nombre, puesto: nuevo.puesto, telefono: nuevo.telefono, fotoPerfilUrl: nuevo.fotoPerfilUrl });
    mutateGlobal(CLAVE_RESUMEN);
  };
  const nombreEmpresa = empresa?.nombreComercial || empresa?.nombre;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <section className="ptl-portada">
        <div className="ptl-portada-fondo" aria-hidden="true" />
        <div className="ptl-portada-cuerpo">
          <div className="ptl-portada-avatar">
            <UserAvatar nombre={usuario.nombre} fotoPerfilUrl={usuario.fotoPerfilUrl} size={96} radius={999} fontSize="1.6rem" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="ptl-portada-nombre">{usuario.nombre}</h1>
            <p className="ptl-portada-cargo">{[usuario.puesto, nombreEmpresa].filter(Boolean).join(' · ')}</p>
            <ul className="ptl-portada-datos">
              <li><Mail size={14} aria-hidden="true" /> {usuario.email}</li>
              {usuario.telefono && <li><Phone size={14} aria-hidden="true" /> {usuario.telefono}</li>}
              <li><CalendarDays size={14} aria-hidden="true" /> {tp('ptlMiembroDesde', { fecha: fechaHora(usuario.creadoEn, locale, { month: 'long', year: 'numeric' }) })}</li>
              {usuario.ultimoLoginEn && <li><ShieldCheck size={14} aria-hidden="true" /> {tp('ptlUltimoAcceso', { cuando: relativo(usuario.ultimoLoginEn, locale) })}</li>}
            </ul>
          </div>
        </div>
        <nav className="ptl-pestanas" aria-label={tp('ptlCuentaTitulo')}>
          {PESTANAS.map(({ id, hash, icono: Icono, etiqueta }) => (
            <button
              key={id}
              type="button"
              className={pestana === id ? 'is-activa' : ''}
              aria-current={pestana === id ? 'page' : undefined}
              onClick={() => navigate({ pathname: location.pathname, hash }, { replace: true })}
            >
              <Icono size={15} aria-hidden="true" /> {tp(etiqueta)}
            </button>
          ))}
        </nav>
      </section>

      {pestana === 'perfil' ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <FormularioPerfil key={usuario.id} usuario={usuario} onGuardado={alGuardar} tp={tp} />
          <Lateral empresa={empresa} equipo={equipo} cifras={cifras} tp={tp} />
        </div>
      ) : (
        <SeguridadCuenta />
      )}
    </div>
  );
};

export default PortalCuentaPage;
