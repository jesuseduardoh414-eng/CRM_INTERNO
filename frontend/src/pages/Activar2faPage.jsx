// Pantalla obligatoria cuando la política de la instalación exige
// verificación en dos pasos y la persona aún no la activó. Hasta hacerlo, el
// servidor solo le deja usar su cuenta (/api/auth), así que aquí se configura.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck, Smartphone, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthHeader, BotonAuth } from '../components/auth/AuthUI';
import { ModalActivar2fa } from '../components/SeguridadCuenta';

const PASOS = [
  { icono: Smartphone, texto: 'req2faStep1' },
  { icono: ShieldCheck, texto: 'req2faStep2' },
  { icono: KeyRound, texto: 'req2faStep3' },
];

const Activar2faPage = () => {
  const { t } = usePreferences();
  const { usuario, refreshUsuario, logout } = useAuth();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    document.title = `${t('req2faTitle')} · ${t('appName')}`;
  }, [t]);

  const destino = usuario?.rol === 'CONFIGURADOR' ? '/configuracion' : usuario?.rol === 'CLIENTE' ? '/portal' : '/dashboard';

  // Si ya no le hace falta (otra pestaña la activó), sigue su camino.
  useEffect(() => {
    if (usuario && !usuario.debeActivar2FA) navigate(destino, { replace: true });
  }, [usuario, destino, navigate]);

  const alActivar = async () => {
    const actualizado = await refreshUsuario().catch(() => null);
    if (actualizado && !actualizado.debeActivar2FA) navigate(destino, { replace: true });
  };

  return (
    <AuthLayout>
      <AuthHeader icono={ShieldCheck} titulo={t('req2faTitle')} subtitulo={t('req2faText')} />
      <ol className="mb-7 space-y-3">
        {PASOS.map(({ icono: Icono, texto }, i) => (
          <li key={texto} className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-gold-10)] text-[var(--color-gold-text)]" aria-hidden="true"><Icono size={16} /></span>
            <span className="text-sm text-[var(--color-text)]"><strong className="mr-1 tabular-nums text-[var(--color-text-muted)]">{i + 1}.</strong>{t(texto)}</span>
          </li>
        ))}
      </ol>
      <BotonAuth type="button" onClick={() => setAbierto(true)}>
        <ShieldCheck size={18} aria-hidden="true" /> {t('req2faStart')}
      </BotonAuth>
      <button type="button" onClick={logout} className="mx-auto mt-5 flex min-h-10 items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <LogOut size={15} aria-hidden="true" /> {t('menuSignOut')}
      </button>
      <ModalActivar2fa open={abierto} onClose={() => setAbierto(false)} onActivado={alActivar} />
    </AuthLayout>
  );
};

export default Activar2faPage;
