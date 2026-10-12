// Registro de cuenta. Según la configuración del backend (REGISTRO_MODO):
//  - cerrado:    solo se explica que el acceso es por invitación.
//  - aprobacion: datos -> verificar correo -> aprobación de un admin.
//  - abierto:    datos -> verificar correo -> entra directamente.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, LockKeyhole, Mail, MailPlus, User } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { authService } from '../services/api';
import { evaluarPassword } from '../utils/politicaPassword';
import AuthLayout from '../components/auth/AuthLayout';
import { AuthAlert, AuthHeader, BotonAuth, CampoPassword, CampoTexto, MedidorPassword, PasosRegistro } from '../components/auth/AuthUI';
import { enfocarAlCargar } from '../utils/dispositivo';
import { AuthSkeleton } from '../components/Skeleton';
import SelectorSimple from '../components/SelectorSimple';

const RegisterPage = () => {
  const { t } = usePreferences();
  const { areas, nombreArea } = useConfiguracion();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '', area: '', password: '', confirmar: '' });
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [error, setError] = useState(null); // { texto, detalles }
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = `${t('authRegisterTitle')} · ${t('appName')}`;
    return () => { document.title = t('appName'); };
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    authService.config()
      .then((datos) => { if (!cancelado) setConfig(datos); })
      // Sin respuesta: las áreas salen de la configuración pública (ver el selector de área).
      .catch(() => { if (!cancelado) setConfig({ registro: 'cerrado', dominios: [] }); });
    return () => { cancelado = true; };
  }, []);

  const contexto = useMemo(() => ({ email: form.email, nombre: form.nombre }), [form.email, form.nombre]);
  const evaluacion = evaluarPassword(form.password, contexto);
  const coinciden = form.confirmar.length > 0 && form.confirmar === form.password;

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.email.trim() || !form.area) {
      setError({ texto: t('authFillAll') });
      return;
    }
    if (!evaluacion.valida) {
      setError({ texto: t('authPasswordRequirementsError') });
      return;
    }
    if (!coinciden) {
      setError({ texto: t('authPasswordsMismatch') });
      return;
    }
    if (!aceptaTerminos) {
      setError({ texto: t('authMustAcceptTerms') });
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const data = await authService.register({
        nombre: form.nombre.trim(),
        email: form.email.trim(),
        area: form.area,
        password: form.password,
        aceptaTerminos: true,
      });
      navigate('/verificar-correo', { state: { email: data.email || form.email.trim().toLowerCase(), recienRegistrado: true } });
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setEnviando(false);
    }
  };

  if (!config) return <AuthSkeleton />;

  if (config.registro === 'cerrado') {
    return (
      <AuthLayout>
        <AuthHeader icono={MailPlus} titulo={t('authRegisterClosedTitle')} subtitulo={t('authRegisterClosedText')} />
        <Link to="/login" className="auth-btn">{t('authGoToLogin')}</Link>
      </AuthLayout>
    );
  }

  const abierto = config.registro === 'abierto';
  const dominios = (config.dominios || []).map((d) => `@${d}`).join(', ');

  return (
    <AuthLayout>
      <PasosRegistro actual={0} pasos={[t('authStepData'), t('authStepVerify'), abierto ? t('authStepAccess') : t('authStepApproval')]} />
      <AuthHeader titulo={t('authRegisterTitle')} subtitulo={abierto ? t('authRegisterSubtitleOpen') : t('authRegisterSubtitle')} />

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AuthAlert tono="error" detalles={error.detalles}>{error.texto}</AuthAlert>}

        <CampoTexto
          name="nombre"
          label={t('authFullName')}
          icono={User}
          autoComplete="name"
          placeholder={t('authFullNamePlaceholder')}
          value={form.nombre}
          onChange={handleChange}
          maxLength={100}
          autoFocus={enfocarAlCargar()}
          required
        />

        <div>
          <CampoTexto
            name="email"
            type="email"
            label={t('authEmail')}
            icono={Mail}
            autoComplete="email"
            inputMode="email"
            placeholder={t('authEmailPlaceholder')}
            value={form.email}
            onChange={handleChange}
            maxLength={191}
            required
          />
          {dominios && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{t('authDomainsHint', { dominios })}</p>}
        </div>

        <div>
          <label className="auth-label" htmlFor="registro-area">{t('authArea')}</label>
          <div className="auth-field">
            <Briefcase size={18} className="auth-field-icon" aria-hidden="true" />
            {/* Sin `required` nativo: el envío ya exige el área (authFillAll) */}
            <SelectorSimple
              id="registro-area"
              valor={form.area}
              onCambio={(v) => handleChange({ target: { name: 'area', value: v } })}
              placeholder={t('authSelectArea')}
              opciones={(config.areas || areas.map((a) => a.clave)).map((area) => ({ valor: area, etiqueta: nombreArea(area) }))}
            />
          </div>
        </div>

        <div>
          <CampoPassword
            name="password"
            label={t('authCreatePassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            maxLength={128}
            describedBy="registro-medidor"
            required
          />
          <MedidorPassword id="registro-medidor" password={form.password} contexto={contexto} />
        </div>

        <div>
          <CampoPassword
            name="confirmar"
            label={t('authConfirmPassword')}
            icono={LockKeyhole}
            autoComplete="new-password"
            placeholder={t('authRepeatPasswordPlaceholder')}
            value={form.confirmar}
            onChange={handleChange}
            maxLength={128}
            aria-invalid={form.confirmar.length > 0 && !coinciden}
            required
          />
          {form.confirmar.length > 0 && (
            <p className={`mt-1.5 text-xs font-medium ${coinciden ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`} aria-live="polite">
              {coinciden ? t('authPwMatch') : t('authPasswordsMismatch')}
            </p>
          )}
        </div>

        <label className="auth-check text-sm text-[var(--color-text-dim)]">
          <input type="checkbox" checked={aceptaTerminos} onChange={(e) => { setAceptaTerminos(e.target.checked); setError(null); }} />
          <span>{t('authAcceptTerms')}</span>
        </label>

        <BotonAuth cargando={enviando} textoCargando={t('authCreatingAccount')}>
          {t('authCreateAccount')}
        </BotonAuth>
        <p className="text-center text-xs text-[var(--color-text-muted)]">{t('authPwBreachNote')}</p>
      </form>

      <p className="mt-8 border-t border-[var(--color-border)] pt-6 text-center text-sm text-[var(--color-text-muted)]">
        {t('authHaveAccount')} <Link to="/login" className="auth-link">{t('authLogin')}</Link>
      </p>
    </AuthLayout>
  );
};

export default RegisterPage;
