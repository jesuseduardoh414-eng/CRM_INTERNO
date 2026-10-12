// Marco común de las pantallas públicas: panel de marca a la izquierda
// (solo en escritorio) y columna del formulario a la derecha, con cambio de
// tema e idioma arriba y una nota de ayuda abajo. Los estilos viven en
// src/auth.css.
import { Moon, Sun } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { ICONOS_BENEFICIO } from '../../utils/iconosMarca';
import LogoMarca from '../LogoMarca';

const ICONOS_FABRICA = ['proyectos', 'agenda', 'seguridad'];

// Anillo del logotipo a gran escala: círculo crema fino y dos arcos del color
// de acento que giran muy despacio (se detienen con "reducir movimiento").
const AnilloMarca = () => (
  <svg className="auth-ring" viewBox="0 0 400 400" fill="none" aria-hidden="true">
    <circle cx="200" cy="200" r="150" stroke="rgb(255 252 240 / 0.14)" strokeWidth="1.5" />
    <circle cx="200" cy="200" r="182" stroke="rgb(255 252 240 / 0.06)" strokeWidth="1" strokeDasharray="2 10" />
    <g className="auth-ring-arc">
      <circle cx="200" cy="200" r="150" stroke="var(--marca-a)" strokeWidth="3" strokeLinecap="round" strokeDasharray="150 793" />
    </g>
    <g className="auth-ring-arc-slow">
      <circle cx="200" cy="200" r="182" stroke="color-mix(in srgb, var(--marca-a) 45%, transparent)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="60 1084" />
    </g>
  </svg>
);

const PanelMarca = () => {
  const { t } = usePreferences();
  const { login, imagen } = useConfiguracion();
  const fondo = imagen('fondoLogin');
  const mostrarBeneficios = login?.mostrarBeneficios !== false;
  const beneficios = [0, 1, 2].map((i) => ({
    Icono: ICONOS_BENEFICIO[login?.beneficios?.[i]?.icono] || ICONOS_BENEFICIO[ICONOS_FABRICA[i]],
    titulo: `authBrandFeat${i + 1}Title`,
    texto: `authBrandFeat${i + 1}Text`,
  }));
  return (
    <aside
      className={`auth-brand flex-col justify-between p-10 xl:p-14 ${fondo ? 'con-fondo' : ''}`}
      style={fondo ? { '--auth-fondo': `url("${fondo}")` } : undefined}
    >
      {login?.mostrarAnillo !== false && !fondo && <AnilloMarca />}

      <span className="self-start"><LogoMarca fondo="oscuro" className="h-14 w-auto" textoClassName="text-2xl" /></span>

      <div className="max-w-md">
        <p className="auth-brand-eyebrow mb-4 text-xs font-semibold uppercase tracking-[0.28em]">{t('authBrandEyebrow')}</p>
        <h2 className="whitespace-pre-line text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
          {t('authBrandHeadline')}
        </h2>
        <p className="mt-5 text-base leading-relaxed text-[rgb(255_252_240/0.72)]">{t('authBrandText')}</p>

        {mostrarBeneficios && <ul className="auth-brand-beneficios mt-10 space-y-5">
          {beneficios.map(({ Icono, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-4">
              <span className="auth-feature-icon"><Icono size={19} aria-hidden="true" /></span>
              <span>
                <span className="block text-sm font-semibold">{t(titulo)}</span>
                <span className="block text-sm text-[rgb(255_252_240/0.62)]">{t(texto)}</span>
              </span>
            </li>
          ))}
        </ul>}
      </div>

      {/* Hueco del mismo alto que el logo: mantiene el texto centrado en el panel */}
      <span className="h-14" aria-hidden="true" />
    </aside>
  );
};

const BarraSuperior = () => {
  const { t, theme, setTheme, language, setLanguage } = usePreferences();
  const oscuro = theme === 'dark';
  // h-10 (40px): tamaño minimo comodo para el dedo
  const botonCls = 'inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-semibold text-[var(--color-text-dim)] transition-colors hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]';

  return (
    <header className="relative z-10 flex items-center justify-between gap-3">
      {/* Logo solo en móvil/tablet: en escritorio ya está en el panel de marca */}
      <div className="w-[150px] lg:invisible">
        <LogoMarca fondo="auto" className="h-auto w-full" textoClassName="text-xl" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={botonCls}
          onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
          aria-label={t('language')}
          title={t('language')}
        >
          {language === 'es' ? 'EN' : 'ES'}
        </button>
        <button
          type="button"
          className={`${botonCls} w-10 px-0`}
          onClick={() => setTheme(oscuro ? 'light' : 'dark')}
          aria-label={t('authToggleTheme')}
          title={oscuro ? t('lightMode') : t('darkMode')}
        >
          {oscuro ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
};

const AuthLayout = ({ children }) => {
  const { t } = usePreferences();
  return (
    <div className="auth-shell">
      <PanelMarca />
      <main className="auth-main">
        <BarraSuperior />
        <div className="auth-content">
          <div className="auth-enter">{children}</div>
        </div>
        {/* En lg la columna del formulario mide ~420px (la otra mitad es la
            marca): las dos notas en fila se partian en dos renglones cada una. */}
        <footer className="relative flex flex-col items-center justify-between gap-1 text-center text-xs text-[var(--color-text-muted)] sm:flex-row sm:text-left lg:flex-col lg:text-center xl:flex-row xl:text-left">
          <span>{t('authHelpFooter')}</span>
          <span>{t('authRights', { year: new Date().getFullYear() })}</span>
        </footer>
      </main>
    </div>
  );
};

export default AuthLayout;
