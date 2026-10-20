// Guía paso a paso para conectar Google Drive sin ayuda técnica: qué hacer en
// Google Cloud (con enlaces directos a cada pantalla y los valores listos
// para copiar), dónde pegar la llave (ID de cliente y secreto) y el botón de
// conectar. La llave es la misma que usa Google Calendar (config.google):
// se edita en el borrador del panel y se guarda con el guardado normal.
import { useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, Loader2, Save } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { BotonCopiar } from './SeccionesSistema';

const REGEX_CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/;

const ENLACES = {
  consola: 'https://console.cloud.google.com/',
  proyecto: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  permisos: 'https://console.cloud.google.com/auth/overview',
  publico: 'https://console.cloud.google.com/auth/audience',
  clientes: 'https://console.cloud.google.com/auth/clients',
  accesos: 'https://myaccount.google.com/permissions',
};

/** Un valor para copiar tal cual en Google Cloud. */
const Valor = ({ etiqueta, valor }) => (
  <div className="mt-2">
    {etiqueta && <p className="cfg-label !mb-1 text-[12px]">{etiqueta}</p>}
    <div className="flex gap-2">
      <input readOnly value={valor} aria-label={etiqueta} className="cfg-input font-mono text-[12.5px]" onFocus={(e) => e.target.select()} />
      <BotonCopiar texto={valor} />
    </div>
  </div>
);

const Enlace = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="cfg-btn shrink-0 !h-8 text-[12.5px]">
    {children} <ExternalLink size={12} />
  </a>
);

const Paso = ({ numero, hecho, titulo, enlace, textoEnlace, children }) => (
  <li className="flex gap-3 py-4 first:pt-1">
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold tabular-nums ${hecho
        ? 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]'
        : 'bg-[var(--color-primary-10)] text-[var(--color-primary)]'}`}
      aria-hidden="true"
    >
      {hecho ? <CheckCircle2 size={15} /> : numero}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-[var(--color-text)]">{titulo}</p>
        {enlace && <Enlace href={enlace}>{textoEnlace}</Enlace>}
      </div>
      <div className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-[var(--color-text-dim)]">{children}</div>
    </div>
  </li>
);

/** Texto con **negritas** marcadas así en los textos traducidos. */
const Rico = ({ texto }) => (
  <p>
    {String(texto).split(/(\*\*[^*]+\*\*)/g).map((parte, i) => (
      parte.startsWith('**') && parte.endsWith('**')
        ? <strong key={i} className="font-semibold text-[var(--color-text)]">{parte.slice(2, -2)}</strong>
        : <span key={i}>{parte}</span>
    ))}
  </p>
);

/**
 * google: borrador.google ({ clientId, secret }); guardado: lo del servidor
 * ({ clientId, secretGuardado }); cambiar(grupo, campo, valor); onGuardar():
 * guarda el panel; credencialesListas / conectado: para marcar los pasos;
 * botonConectar: el botón de la sección.
 */
const GuiaGoogleDrive = ({
  google, guardado, cambiar, onGuardar, guardando, nombreSistema, credencialesListas, conectado, botonConectar,
}) => {
  const { t } = usePreferences();
  const [verSecreto, setVerSecreto] = useState(false);
  const [problemas, setProblemas] = useState(false);
  const origen = window.location.origin;
  const clientId = google?.clientId || '';
  const idValido = !clientId || REGEX_CLIENT_ID.test(clientId.trim());
  const cambioLlave = (clientId || null) !== (guardado?.clientId || null) || Boolean(google?.secret);
  const set = (campo) => (e) => cambiar('google', campo, e.target.value.trim());

  return (
    <div>
      <p className="mb-2 text-[13px] leading-relaxed text-[var(--color-text-dim)]">{t('drvGuiaIntro')}</p>
      <p className="cfg-ayuda mb-2">{t('drvGuiaYaTienes')}</p>

      <ol className="divide-y divide-[var(--cfg-linea)]">
        <Paso numero={1} titulo={t('drvPaso1')} enlace={ENLACES.consola} textoEnlace={t('drvAbrirGoogle')}>
          <Rico texto={t('drvPaso1Texto')} />
        </Paso>

        <Paso numero={2} titulo={t('drvPaso2')} enlace={ENLACES.proyecto} textoEnlace={t('drvAbrirGoogle')}>
          <Rico texto={t('drvPaso2Texto')} />
          <Valor etiqueta={t('drvNombreProyecto')} valor="CRM" />
          <Rico texto={t('drvPaso2Fin')} />
        </Paso>

        <Paso numero={3} titulo={t('drvPaso3')} enlace={ENLACES.api} textoEnlace={t('drvAbrirGoogle')}>
          <Rico texto={t('drvPaso3Texto')} />
        </Paso>

        <Paso numero={4} titulo={t('drvPaso4')} enlace={ENLACES.permisos} textoEnlace={t('drvAbrirGoogle')}>
          <Rico texto={t('drvPaso4Texto')} />
          <Valor etiqueta={t('drvNombreApp')} valor={nombreSistema || 'CRM'} />
          <Rico texto={t('drvPaso4Publico')} />
          <p className="cfg-ayuda">
            {t('drvPaso4Externo')}{' '}
            <a href={ENLACES.publico} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">{t('drvPaso4VerPublico')}</a>
          </p>
        </Paso>

        <Paso numero={5} titulo={t('drvPaso5')} enlace={ENLACES.clientes} textoEnlace={t('drvAbrirGoogle')}>
          <Rico texto={t('drvPaso5Texto')} />
          <Valor etiqueta={t('drvOrigen')} valor={origen} />
          <Rico texto={t('drvPaso5Fin')} />
        </Paso>

        <Paso numero={6} hecho={credencialesListas && !cambioLlave} titulo={t('drvPaso6')}>
          <Rico texto={t('drvPaso6Texto')} />
          <div className="mt-2 grid grid-cols-1 gap-3">
            <div>
              <label className="cfg-label !mb-1 text-[12px]" htmlFor="drv-client-id">{t('gcalClientId')}</label>
              <input
                id="drv-client-id"
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
              <label className="cfg-label !mb-1 text-[12px]" htmlFor="drv-secreto">{t('gcalSecret')}</label>
              <div className="relative">
                <input
                  id="drv-secreto"
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
              <p className="cfg-ayuda">{guardado?.secretGuardado && !google?.secret ? t('gcalSecretSaved') : t('drvPaso6Secreto')}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="cfg-btn cfg-btn-primario"
              onClick={onGuardar}
              disabled={!cambioLlave || !idValido || !clientId || guardando}
            >
              {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('drvGuardarLlave')}
            </button>
            {credencialesListas && !cambioLlave && <span className="text-[12.5px] font-medium text-[var(--color-success)]">{t('drvLlaveLista')}</span>}
          </div>
        </Paso>

        <Paso numero={7} hecho={conectado} titulo={t('drvPaso7')}>
          <Rico texto={t('drvPaso7Texto')} />
          <p className="cfg-ayuda">{t('drvCuentaRecomendada')}</p>
          {!conectado && (
            <div className="mt-2">
              {credencialesListas && !cambioLlave ? botonConectar : <p className="text-[12.5px] text-[var(--color-text-muted)]">{t('drvPaso7Antes')}</p>}
            </div>
          )}
        </Paso>
      </ol>

      <div className="mt-2 rounded-[8px] border border-[var(--cfg-linea-fuerte)]">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13.5px] font-semibold text-[var(--color-text)]"
          onClick={() => setProblemas((v) => !v)}
          aria-expanded={problemas}
        >
          {t('drvProblemas')}
          <ChevronDown size={16} className={`shrink-0 transition-transform ${problemas ? 'rotate-180' : ''}`} />
        </button>
        {problemas && (
          <dl className="space-y-3 border-t border-[var(--cfg-linea)] px-4 py-3 text-[13px]">
            {['Origen', 'Organizacion', 'Verificada', 'Api', 'Secreto', 'Ventana', 'Permanente'].map((clave) => (
              <div key={clave}>
                <dt className="font-semibold text-[var(--color-text)]">{t(`drvProblema${clave}`)}</dt>
                <dd className="mt-0.5 leading-relaxed text-[var(--color-text-dim)]">
                  {t(`drvProblema${clave}Texto`, { origen })}
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

export default GuiaGoogleDrive;
