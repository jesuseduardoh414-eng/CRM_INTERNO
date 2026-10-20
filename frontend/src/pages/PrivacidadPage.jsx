// Política de privacidad pública (/privacidad). Google la pide para publicar
// la app de Google Cloud cuando la pantalla de permisos es "Externa" (guía
// del panel: components/configuracion/GuiaGoogleCloud.jsx, paso 5), y explica
// qué hace el CRM con Google Drive y Google Calendar. Se ve con o sin sesión.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthHeader } from '../components/auth/AuthUI';

const SECCIONES = [
  { titulo: 'privQueEs', parrafos: ['privQueEsTexto'] },
  { titulo: 'privDatos', parrafos: ['privDatosTexto'] },
  { titulo: 'privGoogle', parrafos: ['privGoogleTexto'], puntos: ['privGoogleDrive', 'privGoogleCalendar', 'privGoogleCuenta'], cierre: 'privUsoLimitado' },
  { titulo: 'privRetirar', parrafos: ['privRetirarTexto'] },
  { titulo: 'privContacto', parrafos: ['privContactoTexto'] },
];

const PrivacidadPage = () => {
  const { t } = usePreferences();

  useEffect(() => {
    document.title = `${t('privTitulo')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  return (
    <AuthLayout>
      <AuthHeader icono={ShieldCheck} titulo={t('privTitulo')} subtitulo={t('privSubtitulo')} />
      <div className="space-y-5 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
        {SECCIONES.map((s) => (
          <section key={s.titulo}>
            <h2 className="mb-1.5 text-[15px] font-semibold text-[var(--color-text)]">{t(s.titulo)}</h2>
            {s.parrafos.map((p) => <p key={p}>{t(p)}</p>)}
            {s.puntos && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                {s.puntos.map((p) => <li key={p}>{t(p)}</li>)}
              </ul>
            )}
            {s.cierre && <p className="mt-2">{t(s.cierre)}</p>}
          </section>
        ))}
        <p className="text-[12.5px] text-[var(--color-text-muted)]">{t('privActualizado')}</p>
      </div>
      <Link to="/login" className="auth-btn mt-6">{t('privVolver')}</Link>
    </AuthLayout>
  );
};

export default PrivacidadPage;
