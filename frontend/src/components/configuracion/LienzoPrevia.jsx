// Lienzo de vista previa del panel de configuración. Dibuja, con el borrador
// sin guardar, tres pantallas reales en miniatura dentro de un navegador:
// el CRM, la pantalla de inicio de sesión y un correo del sistema.
//
// Interacción: `enfoque` es la zona que el configurador está editando (campo
// con foco o bajo el ratón); los elementos con el mismo `data-zona-previa` se
// resaltan con un contorno ámbar que late. Así se ve qué controla cada campo.
import { useState } from 'react';
import { Bell, CalendarDays, FileSignature, FolderKanban, LayoutDashboard, Mail, Monitor, Moon, Search, ShieldCheck, Smartphone, Sun, Users } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { generarVariables } from '../../utils/temaMarca';
import { ICONOS_BENEFICIO } from '../../utils/iconosMarca';
import { AREA_GENERAL, CLAVE_TRADUCCION_AREA, nombreDesdeClave } from '../../utils/areas';

const FABRICA = {
  logoClaro: '/brand/omnis-horizontal-azul.png',
  logoOscuro: '/brand/omnis-horizontal-blanco.png',
  favicon: '/brand/favicon.svg',
};
const BASE_CLARA = {
  '--color-bg-base': '#f8fafc', '--color-surface': '#ffffff', '--color-surface-2': '#ffffff', '--color-surface-3': '#f1f5f9',
  '--color-text': '#0f172a', '--color-text-dim': '#475569', '--color-text-muted': '#5b6b84', '--color-border': '#e2e8f0',
};
const ICONOS_FABRICA = ['proyectos', 'agenda', 'seguridad'];

// Una zona se resalta si su id es el enfocado o una variante suya
// ('primario-boton' responde a 'primario').
const coincide = (id, enfoque) => Boolean(id && enfoque) && (id === enfoque || id.startsWith(`${enfoque}-`));

const Zona = ({ id, enfoque, as: Etiqueta = 'div', className = '', style, children, ...resto }) => (
  <Etiqueta data-zona-previa={id} data-resaltada={coincide(id, enfoque) || undefined} className={className} style={style} {...resto}>
    {children}
  </Etiqueta>
);

/** Logo para la vista previa: el subido, el de fábrica o el nombre corto en texto. */
const LogoPrevia = ({ archivos, marca, fondo, className = '', texto = 'text-[11px]' }) => {
  const propio = fondo === 'oscuro' ? (archivos.logoOscuro || archivos.logoClaro) : (archivos.logoClaro || archivos.logoOscuro);
  const fabrica = marca.nombreCorto === 'OMNIS' && !archivos.logoClaro && !archivos.logoOscuro && !archivos.isotipo ? FABRICA[fondo === 'oscuro' ? 'logoOscuro' : 'logoClaro'] : null;
  const src = propio || fabrica;
  if (src) return <img src={src} alt="" className={`object-contain ${className}`} />;
  return (
    <span className={`font-bold uppercase tracking-[0.28em] ${texto}`} style={{ color: fondo === 'oscuro' ? '#fffcf0' : 'var(--color-text)' }}>
      {marca.nombreCorto || marca.nombreSistema}
    </span>
  );
};

// ── CRM ──────────────────────────────────────────────────────────────────
const PantallaCrm = ({ borrador, archivos, enfoque, movil }) => {
  const { t, tBase } = usePreferences();
  const { marca, modulos, reglas } = borrador;
  const nav = [
    { icono: LayoutDashboard, texto: t('home'), activo: true },
    { icono: FolderKanban, texto: t('projects') },
    modulos.agenda && { icono: CalendarDays, texto: t('agenda') },
    { icono: Users, texto: t('users') },
    modulos.contratos && { icono: FileSignature, texto: t('contracts') },
  ].filter(Boolean);
  const miembros = [
    { nombre: 'Ana López', avance: 0.82 },
    { nombre: 'Luis Ortega', avance: 0.56 },
    { nombre: 'Marta Ruiz', avance: 0.34 },
  ];
  // Las tres primeras áreas del borrador (las de fábrica sin nombre usan su traducción).
  const areasPrevia = (reglas.areas || []).filter((a) => a.clave !== AREA_GENERAL || reglas.areas.length < 4);
  const nombreAreaPrevia = (i) => {
    const a = areasPrevia[i % Math.max(areasPrevia.length, 1)];
    if (!a) return '';
    return a.nombre || (CLAVE_TRADUCCION_AREA[a.clave] ? tBase(CLAVE_TRADUCCION_AREA[a.clave]) : nombreDesdeClave(a.clave));
  };

  const menu = (
    <Zona id="primario" enfoque={enfoque} className="flex w-[34%] shrink-0 flex-col gap-1 p-2.5" style={{ background: 'var(--color-sidebar)' }}>
      <Zona id="logoOscuro" enfoque={enfoque} className="flex h-7 items-center rounded-[3px] px-1">
        <LogoPrevia archivos={archivos} marca={marca} fondo="oscuro" className="max-h-5 w-auto max-w-full" />
      </Zona>
      <Zona id="eslogan" enfoque={enfoque} className="mb-1.5 rounded-[3px] px-1 text-[7px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--color-gold)' }}>
        {marca.eslogan || tBase('internalPanel')}
      </Zona>
      <Zona id="modulos" enfoque={enfoque} className="flex flex-col gap-0.5 rounded-[3px]">
        {nav.map(({ icono: Icono, texto, activo }) => (
          <Zona
            key={texto}
            id={activo ? 'acento' : undefined}
            enfoque={enfoque}
            className="flex items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-[8.5px] font-medium"
            style={activo ? { background: 'rgb(255 255 255 / 0.09)', color: '#fff', boxShadow: 'inset 2px 0 0 var(--color-gold)' } : { color: 'rgb(255 255 255 / 0.55)' }}
          >
            <Icono size={9} /> <span className="truncate">{texto}</span>
          </Zona>
        ))}
      </Zona>
      <div className="mt-auto flex items-center gap-1.5 rounded-[4px] border border-white/10 p-1">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-[6px] font-bold text-white">AL</span>
        <span className="truncate text-[7.5px] font-medium text-white/80">Ana López</span>
      </div>
    </Zona>
  );

  return (
    <div className="flex h-[300px]" style={{ background: 'var(--color-bg-base)' }}>
      {!movil && menu}
      <Zona id="tenir" enfoque={enfoque} className="min-w-0 flex-1 overflow-hidden p-3" style={{ background: 'var(--color-bg-base)' }}>
        {movil && (
          <div className="-mx-3 -mt-3 mb-3 flex h-8 items-center justify-between px-3" style={{ background: 'var(--color-sidebar)' }}>
            <LogoPrevia archivos={archivos} marca={marca} fondo="oscuro" className="max-h-4 w-auto" texto="text-[9px]" />
            <Bell size={10} className="text-white/70" />
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{t('home')}</p>
            <p className="text-[7.5px]" style={{ color: 'var(--color-text-muted)' }}>{t('dashboardAdminSubtitle')}</p>
          </div>
          {!movil && <Search size={10} style={{ color: 'var(--color-text-muted)' }} />}
        </div>
        <div className={`mt-2.5 grid gap-1.5 ${movil ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {[['29', t('projects')], ['104', 'Pendientes'], ['12', 'Hoy']].slice(0, movil ? 2 : 3).map(([n, e], i) => (
            <div key={e} className="rounded-[4px] border p-1.5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <p className="text-[11px] font-semibold" style={{ color: i === 0 ? 'var(--color-primary)' : 'var(--color-text)' }}>{n}</p>
              <p className="truncate text-[7px]" style={{ color: 'var(--color-text-muted)' }}>{e}</p>
            </div>
          ))}
        </div>
        <Zona id="areas" enfoque={enfoque} className="mt-2.5 rounded-[4px] border p-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <p className="mb-1.5 text-[8.5px] font-semibold" style={{ color: 'var(--color-text)' }}>Actividad del equipo</p>
          {miembros.map((m, i) => (
            <div key={m.nombre} className="flex items-center gap-1.5 py-[3px]">
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[5.5px] font-bold" style={{ background: 'var(--color-surface-3)', color: 'var(--color-text-dim)' }}>{m.nombre[0]}</span>
              <span className="w-16 shrink-0">
                <span className="block truncate text-[7.5px] font-medium" style={{ color: 'var(--color-text)' }}>{m.nombre}</span>
                <span className="block truncate text-[6.5px]" style={{ color: 'var(--color-text-muted)' }}>{nombreAreaPrevia(i)}</span>
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-3)' }}>
                <span className="block h-full rounded-full" style={{ width: `${m.avance * 100}%`, background: 'var(--color-primary)' }} />
              </span>
            </div>
          ))}
        </Zona>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Zona id="primario-boton" enfoque={enfoque} className="rounded-[3px] px-2 py-1 text-[8px] font-semibold" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{t('ctrNew')}</Zona>
          <span className="rounded-[3px] px-1.5 py-0.5 text-[7px] font-semibold" style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-fg)' }}>Info</span>
          <span className="text-[7.5px] font-semibold" style={{ color: 'var(--color-primary)' }}>{t('ctrDetail')}</span>
        </div>
      </Zona>
    </div>
  );
};

// ── Inicio de sesión ─────────────────────────────────────────────────────
const AnilloMini = () => (
  <svg className="pointer-events-none absolute -right-16 top-1/2 h-56 w-56 -translate-y-1/2" viewBox="0 0 400 400" fill="none" aria-hidden="true">
    <circle cx="200" cy="200" r="150" stroke="rgb(255 252 240 / 0.14)" strokeWidth="2" />
    <circle cx="200" cy="200" r="150" stroke="var(--marca-a)" strokeWidth="4" strokeLinecap="round" strokeDasharray="150 793" className="auth-ring-arc" />
  </svg>
);

const PantallaLogin = ({ borrador, archivos, enfoque, movil, vars }) => {
  const { t, tBase } = usePreferences();
  const { marca, login } = borrador;
  const fondo = archivos.fondoLogin;
  const beneficios = [0, 1, 2].map((i) => ({
    Icono: ICONOS_BENEFICIO[login.beneficios?.[i]?.icono] || ICONOS_BENEFICIO[ICONOS_FABRICA[i]],
    titulo: login.beneficios?.[i]?.titulo || tBase(`authBrandFeat${i + 1}Title`),
  }));

  return (
    <div className="flex h-[300px]" style={{ background: 'var(--color-bg-base)' }}>
      {!movil && (
        <Zona
          id={fondo ? 'fondoLogin' : 'primario'}
          enfoque={enfoque}
          className={`auth-brand !relative !flex !h-full w-[54%] shrink-0 flex-col justify-between overflow-hidden p-3.5 ${fondo ? 'con-fondo' : ''}`}
          style={{ '--marca-primario': vars.claro['--marca-primario'], '--marca-acento': borrador.colores.acento, ...(fondo ? { '--auth-fondo': `url("${fondo}")` } : {}) }}
        >
          {!fondo && login.mostrarAnillo && <Zona id="anillo" enfoque={enfoque} className="absolute inset-0"><AnilloMini /></Zona>}
          <Zona id="logoOscuro" enfoque={enfoque} className="relative self-start rounded-[3px]">
            <LogoPrevia archivos={archivos} marca={marca} fondo="oscuro" className="h-5 w-auto" />
          </Zona>
          <div className="relative">
            <Zona id="loginEtiqueta" enfoque={enfoque} className="auth-brand-eyebrow mb-1 inline-block rounded-[2px] text-[6.5px] font-semibold uppercase tracking-[0.25em]">
              {login.etiqueta || tBase('authBrandEyebrow')}
            </Zona>
            <Zona id="loginTitulo" enfoque={enfoque} className="whitespace-pre-line rounded-[2px] text-[14px] font-semibold leading-[1.15]">
              {login.titulo || tBase('authBrandHeadline')}
            </Zona>
            <Zona id="loginTexto" enfoque={enfoque} className="mt-1.5 rounded-[2px] text-[7px] leading-snug text-[rgb(255_252_240/0.7)]">
              {login.texto || tBase('authBrandText')}
            </Zona>
            {login.mostrarBeneficios && (
              <Zona id="beneficios" enfoque={enfoque} className="mt-2.5 space-y-1 rounded-[3px]">
                {beneficios.map(({ Icono, titulo }) => (
                  <div key={titulo} className="flex items-center gap-1.5 text-[7px] font-medium">
                    <span className="auth-feature-icon !h-4 !w-4 !rounded-[3px]"><Icono size={8} /></span>
                    {titulo}
                  </div>
                ))}
              </Zona>
            )}
          </div>
          <span />
        </Zona>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-4" style={{ background: 'var(--color-bg-base)' }}>
        {movil && (
          <Zona id="logoClaro" enfoque={enfoque} className="mb-4 self-start rounded-[3px]">
            <LogoPrevia archivos={archivos} marca={marca} fondo="claro" className="h-4 w-auto" texto="text-[9px]" />
          </Zona>
        )}
        <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{t('authWelcomeBack')}</p>
        <p className="mb-3 text-[7.5px]" style={{ color: 'var(--color-text-muted)' }}>{t('authLoginSubtitle')}</p>
        {[t('authEmail'), t('authPassword')].map((e) => (
          <div key={e} className="mb-2">
            <p className="mb-0.5 text-[7px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{e}</p>
            <div className="h-5 rounded-[4px] border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} />
          </div>
        ))}
        <Zona id="primario-boton" enfoque={enfoque} className="mt-1 flex h-5 items-center justify-center rounded-[4px] text-[8px] font-semibold" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {t('authLogin')}
        </Zona>
        <Zona id="nombreEmpresa" enfoque={enfoque} className="mt-4 self-center rounded-[2px] text-[6.5px]" style={{ color: 'var(--color-text-muted)' }}>
          © {new Date().getFullYear()} {marca.nombreEmpresa}
        </Zona>
      </div>
    </div>
  );
};

// ── Correo ───────────────────────────────────────────────────────────────
const PantallaCorreo = ({ borrador, enfoque, movil }) => {
  const { marca, colores, reglas } = borrador;
  return (
    <div className="h-[300px] overflow-hidden bg-[#f3f5f9] text-[#334155]">
      <div className="flex items-center gap-2 border-b border-[#e2e8f0] bg-white px-3 py-1.5 text-[7.5px]">
        <Mail size={10} className="text-[#64748b]" />
        <div className="min-w-0">
          <Zona id="remitente" enfoque={enfoque} className="inline-block rounded-[2px] font-semibold text-[#0f172a]">
            {reglas.remitenteCorreo || marca.nombreSistema}
          </Zona>
          <p className="truncate text-[#64748b]">482913 es tu código de verificación · <Zona id="nombreSistema" enfoque={enfoque} as="span" className="rounded-[2px]">{marca.nombreSistema}</Zona></p>
        </div>
      </div>
      <div className={`mx-auto mt-3 overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white ${movil ? 'mx-2' : 'w-[78%]'}`}>
        <Zona id="primario" enfoque={enfoque} className="px-3 py-2" style={{ background: colores.primario }}>
          <Zona id="nombreCorto" enfoque={enfoque} as="span" className="rounded-[2px] text-[10px] font-bold tracking-[0.38em] text-[#fffcf0]">{marca.nombreCorto.toUpperCase()}</Zona>
          <Zona id="nombreEmpresa" enfoque={enfoque} className="mt-0.5 rounded-[2px] text-[5.5px] tracking-[0.3em]" style={{ color: colores.acento }}>{marca.nombreEmpresa.toUpperCase()}</Zona>
        </Zona>
        <Zona id="acento" enfoque={enfoque} className="h-[2px]" style={{ background: colores.acento }} />
        <div className="p-3">
          <p className="text-[10px] font-semibold" style={{ color: colores.primario }}>Hola Ana, confirma tu correo</p>
          <p className="mt-1 text-[7px] leading-snug">Escribe este código en la pantalla de verificación. Caduca en 15 minutos.</p>
          <div className="mt-2 flex justify-center">
            <span className="rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 font-mono text-[13px] font-bold tracking-[0.35em]" style={{ color: colores.primario }}>482913</span>
          </div>
          <div className="mt-2.5 flex justify-center">
            <span className="rounded-[4px] px-3 py-1 text-[7.5px] font-semibold text-white" style={{ background: colores.primario }}>Iniciar sesión</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[6px] text-[#94a3b8]">Correo automático de {marca.nombreSistema}. No respondas a este mensaje.</p>
    </div>
  );
};

/**
 * Lienzo completo. `vistaSugerida` cambia la pestaña al cambiar de sección
 * (Inicio de sesión abre la vista del login), sin impedir elegir otra.
 */
const LienzoPrevia = ({ borrador, archivos, enfoque, vistaSugerida = 'crm' }) => {
  const { t } = usePreferences();
  const [vista, setVista] = useState(vistaSugerida);
  const [ultimaSugerida, setUltimaSugerida] = useState(vistaSugerida);
  const [tema, setTema] = useState('claro');
  // En un teléfono el "escritorio" en miniatura no se lee: arranca en móvil.
  const [movil, setMovil] = useState(() => window.matchMedia?.('(max-width: 639px)').matches ?? false);
  if (vistaSugerida !== ultimaSugerida) {
    setUltimaSugerida(vistaSugerida);
    setVista(vistaSugerida);
  }

  const vars = generarVariables(borrador.colores);
  const estilo = { ...(tema === 'claro' ? { ...BASE_CLARA, ...vars.claro } : vars.oscuro), '--cfg-resalte': '#f59e0b' };
  const favicon = archivos.favicon || archivos.isotipo || (borrador.marca.nombreCorto === 'OMNIS' ? FABRICA.favicon : null);
  const ruta = { crm: 'dashboard', login: 'login', correo: '' }[vista];

  const VISTAS = [
    { id: 'crm', texto: 'CRM', icono: LayoutDashboard },
    { id: 'login', texto: t('cfgSecLogin'), icono: ShieldCheck },
    { id: 'correo', texto: t('cfgPreviewEmail'), icono: Mail },
  ];

  return (
    <div className="cfg-previa">
      <div className="cfg-previa-cabecera">
        <div className="cfg-segmento" role="tablist" aria-label={t('cfgPreview')}>
          {VISTAS.map(({ id, texto, icono: Icono }) => (
            <button key={id} type="button" role="tab" aria-selected={vista === id} aria-pressed={vista === id} onClick={() => setVista(id)} aria-label={texto} title={texto} className="inline-flex items-center justify-center gap-1.5">
              {/* Sin texto en las no elegidas en teléfono y en la columna estrecha
                  de xl (≈430px junto a los ajustes); con todo el ancho, completas. */}
              <Icono size={13} aria-hidden="true" /> <span className={vista === id ? '' : 'hidden sm:inline xl:hidden 2xl:inline'}>{texto}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="cfg-segmento">
            <button type="button" aria-pressed={!movil} onClick={() => setMovil(false)} aria-label={t('cfgDesktop')} title={t('cfgDesktop')}><Monitor size={13} /></button>
            <button type="button" aria-pressed={movil} onClick={() => setMovil(true)} aria-label={t('cfgMobile')} title={t('cfgMobile')}><Smartphone size={13} /></button>
          </div>
          <div className="cfg-segmento" aria-hidden={vista === 'correo' || undefined}>
            <button type="button" aria-pressed={tema === 'claro'} disabled={vista === 'correo'} onClick={() => setTema('claro')} aria-label={t('cfgPreviewLight')} title={t('cfgPreviewLight')}><Sun size={13} /></button>
            <button type="button" aria-pressed={tema === 'oscuro'} disabled={vista === 'correo'} onClick={() => setTema('oscuro')} aria-label={t('cfgPreviewDark')} title={t('cfgPreviewDark')}><Moon size={13} /></button>
          </div>
        </div>
      </div>

      <div className="cfg-lienzo">
        {/* El escritorio en miniatura está pensado para ~400-640px: en tableta,
            donde la vista previa ocupa todo el ancho, se limita y se centra
            en vez de estirarse con letra diminuta. */}
        <div className="cfg-navegador mx-auto max-w-full" style={{ width: movil ? '230px' : 'min(100%, 640px)' }}>
          <div className="cfg-navegador-barra !h-auto flex-col !items-stretch !gap-0 !px-0">
            <div className="flex items-end gap-2 px-2">
              <span className="cfg-navegador-puntos mb-2"><span /><span /><span /></span>
              <Zona id="nombreSistema" enfoque={enfoque} className="cfg-pestana">
                <Zona id="favicon" enfoque={enfoque} as="span" className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px]">
                  {favicon
                    ? <img src={favicon} alt="" className="h-3 w-3 object-contain" />
                    : <span className="h-2.5 w-2.5 rounded-full" style={{ background: borrador.colores.primario }} />}
                </Zona>
                <span className="truncate">{borrador.marca.nombreSistema}</span>
              </Zona>
            </div>
            <div className="flex items-center gap-1.5 bg-white px-2 py-1">
              <span className="cfg-url">{vista === 'correo' ? 'mail.empresa.com/inbox' : `crm.${(borrador.marca.nombreCorto || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '')}.com/${ruta}`}</span>
            </div>
          </div>
          <div style={estilo}>
            {vista === 'crm' && <PantallaCrm borrador={borrador} archivos={archivos} enfoque={enfoque} movil={movil} />}
            {vista === 'login' && <PantallaLogin borrador={borrador} archivos={archivos} enfoque={enfoque} movil={movil} vars={vars} />}
            {vista === 'correo' && <PantallaCorreo borrador={borrador} enfoque={enfoque} movil={movil} />}
          </div>
        </div>
      </div>
      <p className="flex items-center gap-1.5 border-t border-[var(--cfg-linea)] px-4 py-2.5 text-[12px] text-[var(--color-text-dim)]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#f59e0b]" aria-hidden="true" /> {t('cfgPreviewHint')}
      </p>
    </div>
  );
};

export default LienzoPrevia;
