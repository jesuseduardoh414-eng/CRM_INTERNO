// Guía paso a paso para crear la llave de Google (un cliente OAuth) que usan
// Google Drive y Google Calendar, sin ayuda técnica: qué hacer en cada pantalla
// de Google Cloud (enlaces directos y valores listos para copiar), dónde pegar
// la llave y cómo conectar y comprobar. Sale en "Google Drive y respaldos"
// (variante "drive") y en "Google Calendar" (variante "calendar"); solo cambian
// los dos últimos pasos. Los textos salieron de recorrer Google Cloud de verdad
// (2026-10-20, con una cuenta Gmail: app Externa) y cubren también la cuenta de
// Google Workspace (app Interna). La llave vive en config.google y se guarda con
// el guardado normal del panel.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, Eye, EyeOff, Loader2, Save } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { Paso, Rico, SubPasos, Valor } from './PiezasConfiguracion';

const REGEX_CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/;

const ENLACES = {
  consola: 'https://console.cloud.google.com/',
  proyecto: 'https://console.cloud.google.com/projectcreate',
  apiDrive: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  apiCalendar: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  permisos: 'https://console.cloud.google.com/auth/overview',
  marca: 'https://console.cloud.google.com/auth/branding',
  publico: 'https://console.cloud.google.com/auth/audience',
  clientes: 'https://console.cloud.google.com/auth/clients',
  accesos: 'https://myaccount.google.com/permissions',
};

const PROBLEMAS = ['Origen', 'Interno', 'Publicar', 'Verificada', 'Organizacion', 'Api', 'Secreto', 'Ventana', 'Permanente', 'Calendar'];

/** crm.empresa.com -> empresa.com: el "dominio autorizado" que pide Google. */
const dominioRaiz = (host) => {
  const partes = host.split('.');
  return partes.length > 2 ? partes.slice(1).join('.') : host;
};

/**
 * variante: 'drive' | 'calendar'. google: borrador.google ({ clientId, secret });
 * guardado: lo del servidor ({ clientId, secretGuardado }); cambiar(grupo,
 * campo, valor); onGuardar(): guarda el panel; credencialesListas / conectado:
 * para marcar los pasos; botonConectar: el botón de la sección (solo Drive).
 */
const GuiaGoogleCloud = ({
  variante, google, guardado, cambiar, onGuardar, guardando, nombreSistema, credencialesListas, conectado, botonConectar,
}) => {
  const { t } = usePreferences();
  const [verSecreto, setVerSecreto] = useState(false);
  const [problemas, setProblemas] = useState(false);
  const origen = window.location.origin;
  const app = nombreSistema || 'CRM';
  const clientId = google?.clientId || '';
  const idValido = !clientId || REGEX_CLIENT_ID.test(clientId.trim());
  const cambioLlave = (clientId || null) !== (guardado?.clientId || null) || Boolean(google?.secret);
  const llaveLista = credencialesListas && !cambioLlave;
  const set = (campo) => (e) => cambiar('google', campo, e.target.value.trim());
  const abrir = t('gcgAbrir');

  return (
    <div>
      <Rico texto={t('gcgIntro')} />
      <div className="mt-2 rounded-[8px] bg-[var(--color-surface-3)] p-3 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">
        <Rico texto={t('gcgCuentas')} />
        <Rico texto={t('gcgYaTienes')} />
      </div>

      <ol className="mt-2 divide-y divide-[var(--cfg-linea)]">
        <Paso numero={1} titulo={t('gcgP1')} enlaces={[{ href: ENLACES.consola, texto: abrir }]}>
          <Rico texto={t('gcgP1a')} />
          <Rico texto={t('gcgP1b')} />
          <Rico texto={t('gcgP1c')} />
        </Paso>

        <Paso numero={2} titulo={t('gcgP2')} enlaces={[{ href: ENLACES.proyecto, texto: abrir }]}>
          <Rico texto={t('gcgP2a')} />
          <Valor etiqueta={t('gcgNombreProyecto')} valor="CRM" />
          <Rico texto={t('gcgP2b')} />
          <Rico texto={t('gcgP2c')} />
          <Rico texto={t('gcgP2d')} />
        </Paso>

        <Paso
          numero={3}
          titulo={t('gcgP3')}
          enlaces={[{ href: ENLACES.apiDrive, texto: 'Google Drive API' }, { href: ENLACES.apiCalendar, texto: 'Google Calendar API' }]}
        >
          <Rico texto={t('gcgP3a')} />
          <Rico texto={t('gcgP3b')} />
        </Paso>

        <Paso numero={4} titulo={t('gcgP4')} enlaces={[{ href: ENLACES.permisos, texto: abrir }]}>
          <Rico texto={t('gcgP4a')} />
          <SubPasos textos={[t('gcgP4Info'), t('gcgP4Publico'), t('gcgP4Contacto'), t('gcgP4Final')]} />
          <Valor etiqueta={t('gcgNombreApp')} valor={app} />
          <Rico texto={t('gcgP4b')} />
        </Paso>

        <Paso
          numero={5}
          titulo={t('gcgP5')}
          enlaces={[{ href: ENLACES.marca, texto: t('gcgAbrirMarca') }, { href: ENLACES.publico, texto: t('gcgAbrirPublico') }]}
        >
          <Rico texto={t('gcgP5Interno')} />
          <Rico texto={t('gcgP5a')} />
          <Valor etiqueta={t('gcgPaginaPrincipal')} valor={origen} />
          <Valor etiqueta={t('gcgPrivacidad')} valor={`${origen}/privacidad`} />
          <p className="cfg-ayuda">
            <Link to="/privacidad" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">{t('gcgVerPrivacidad')}</Link>
          </p>
          <Valor etiqueta={t('gcgDominio')} valor={dominioRaiz(window.location.hostname)} />
          <Rico texto={t('gcgP5b')} />
          <Rico texto={t('gcgP5c')} />
        </Paso>

        <Paso numero={6} titulo={t('gcgP6')} enlaces={[{ href: ENLACES.clientes, texto: abrir }]}>
          <Rico texto={t('gcgP6a')} />
          <Rico texto={t('gcgP6b')} />
          <Valor etiqueta={t('gcgOrigen')} valor={origen} />
          <Rico texto={t('gcgP6c')} />
          <Rico texto={t('gcgP6d')} />
          <p className="cfg-ayuda">{t('gcgP6e')}</p>
        </Paso>

        <Paso numero={7} hecho={llaveLista} titulo={t('gcgP7')}>
          <Rico texto={t('gcgP7a')} />
          <Rico texto={t('gcgP7b')} />
          <div className="mt-2 grid grid-cols-1 gap-3">
            <div>
              <label className="cfg-label !mb-1 text-[12px]" htmlFor={`gcg-id-${variante}`}>{t('gcalClientId')}</label>
              <input
                id={`gcg-id-${variante}`}
                className="cfg-input font-mono text-[13px]"
                maxLength={200}
                placeholder="123456789012-abc123.apps.googleusercontent.com"
                value={clientId}
                onChange={set('clientId')}
                aria-invalid={!idValido}
                autoComplete="off"
                spellCheck={false}
              />
              {!idValido && <p className="cfg-ayuda !text-[var(--color-error)]">{t('gcalClientIdInvalid')}</p>}
            </div>
            <div>
              <label className="cfg-label !mb-1 text-[12px]" htmlFor={`gcg-secreto-${variante}`}>{t('gcalSecret')}</label>
              <div className="relative">
                <input
                  id={`gcg-secreto-${variante}`}
                  type={verSecreto ? 'text' : 'password'}
                  className="cfg-input !pr-10 font-mono text-[13px]"
                  maxLength={200}
                  placeholder={guardado?.secretGuardado ? '••••••••••' : 'GOCSPX-…'}
                  value={google?.secret || ''}
                  onChange={set('secret')}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]"
                  onClick={() => setVerSecreto((v) => !v)}
                  aria-label={verSecreto ? t('hidePassword') : t('showPassword')}
                >
                  {verSecreto ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="cfg-ayuda">{guardado?.secretGuardado && !google?.secret ? t('gcalSecretSaved') : t('gcgP7Secreto')}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="cfg-btn cfg-btn-primario"
              onClick={onGuardar}
              disabled={!cambioLlave || !idValido || !clientId || guardando}
            >
              {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('gcgGuardarLlave')}
            </button>
            {llaveLista && <span className="text-[12.5px] font-medium text-[var(--color-success)]">{t('gcgLlaveLista')}</span>}
          </div>
        </Paso>

        {variante === 'drive' ? (
          <>
            <Paso numero={8} hecho={conectado} titulo={t('gcgP8Drive')}>
              <Rico texto={t('gcgP8DriveTexto')} />
              <p className="cfg-ayuda">{t('drvCuentaRecomendada')}</p>
              {!conectado && (
                <div className="mt-2">
                  {llaveLista ? botonConectar : <p className="text-[12.5px] text-[var(--color-text-muted)]">{t('gcgP8Antes')}</p>}
                </div>
              )}
            </Paso>
            <Paso numero={9} titulo={t('gcgP9')}>
              <Rico texto={t('gcgP9Drive')} />
            </Paso>
          </>
        ) : (
          <>
            <Paso numero={8} titulo={t('gcgP8Cal')}>
              <Rico texto={t('gcgP8CalTexto')} />
              <Rico texto={t('gcgP8CalExterno', { app })} />
              <Rico texto={t('gcgP8CalCambio')} />
              <div className="mt-2">
                <Link to="/agenda" className="cfg-btn"><CalendarDays size={14} /> {t('gcgIrAgenda')}</Link>
              </div>
            </Paso>
            <Paso numero={9} titulo={t('gcgP9')}>
              <Rico texto={t('gcgP9Cal')} />
            </Paso>
          </>
        )}
      </ol>

      <div className="mt-2 rounded-[8px] border border-[var(--cfg-linea-fuerte)]">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13.5px] font-semibold text-[var(--color-text)]"
          onClick={() => setProblemas((v) => !v)}
          aria-expanded={problemas}
        >
          {t('gcgProblemas')}
          <ChevronDown size={16} className={`shrink-0 transition-transform ${problemas ? 'rotate-180' : ''}`} />
        </button>
        {problemas && (
          <dl className="space-y-3 border-t border-[var(--cfg-linea)] px-4 py-3 text-[13px]">
            {PROBLEMAS.map((clave) => (
              <div key={clave}>
                <dt className="font-semibold text-[var(--color-text)]">{t(`gcgProblema${clave}`)}</dt>
                <dd className="mt-0.5 leading-relaxed text-[var(--color-text-dim)]">
                  {t(`gcgProblema${clave}Texto`, { origen, app })}
                  {clave === 'Permanente' && (
                    <>
                      {' '}
                      <a href={ENLACES.accesos} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">myaccount.google.com/permissions</a>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
};

export default GuiaGoogleCloud;
