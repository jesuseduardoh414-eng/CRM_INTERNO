// Guía paso a paso para sacar la "contraseña de aplicación" de Gmail o Google
// Workspace: es lo que pide el servidor de correo cuando el proveedor es Gmail,
// porque Google no acepta la contraseña normal de la cuenta por SMTP. Sale en
// "Correo y avisos" debajo del aviso del proveedor, abierta si todavía no hay
// contraseña guardada. Escrita a partir de myaccount.google.com (2026-10), sin
// capturas.
import { useState } from 'react';
import { ChevronDown, KeyRound } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { Paso, Rico, Valor } from './PiezasConfiguracion';

const ENLACES = {
  dosPasos: 'https://myaccount.google.com/signinoptions/twosv',
  contrasenas: 'https://myaccount.google.com/apppasswords',
};

const PROBLEMAS = ['NoAparece', 'Rechazo', 'Conexion', 'Spam'];

const GuiaGmail = ({ abiertaAlInicio = false, nombreSistema }) => {
  const { t } = usePreferences();
  const [abierta, setAbierta] = useState(abiertaAlInicio);
  const [problemas, setProblemas] = useState(false);
  const abrir = t('gcgAbrir');

  return (
    <div className="mb-5 rounded-[8px] border border-[var(--cfg-linea-fuerte)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13.5px] font-semibold text-[var(--color-text)]"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
      >
        <span className="flex items-center gap-2"><KeyRound size={15} className="shrink-0 text-[var(--color-primary)]" /> {t('gmlTitulo')}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>

      {abierta && (
        <div className="border-t border-[var(--cfg-linea)] px-4 pb-4 pt-3">
          <div className="text-[13px] leading-relaxed text-[var(--color-text-dim)]"><Rico texto={t('gmlIntro')} /></div>

          <ol className="mt-1 divide-y divide-[var(--cfg-linea)]">
            <Paso numero={1} titulo={t('gmlP1')}>
              <Rico texto={t('gmlP1a')} />
            </Paso>

            <Paso numero={2} titulo={t('gmlP2')} enlaces={[{ href: ENLACES.dosPasos, texto: abrir }]}>
              <Rico texto={t('gmlP2a')} />
              <Rico texto={t('gmlP2b')} />
            </Paso>

            <Paso numero={3} titulo={t('gmlP3')} enlaces={[{ href: ENLACES.contrasenas, texto: abrir }]}>
              <Rico texto={t('gmlP3a')} />
              <Valor etiqueta={t('gmlNombreApp')} valor={nombreSistema || 'CRM'} />
              <Rico texto={t('gmlP3b')} />
            </Paso>

            <Paso numero={4} titulo={t('gmlP4')}>
              <Rico texto={t('gmlP4a')} />
              <Rico texto={t('gmlP4b')} />
              <p className="cfg-ayuda">{t('gmlP4c')}</p>
            </Paso>

            <Paso numero={5} titulo={t('gmlP5')}>
              <Rico texto={t('gmlP5a')} />
            </Paso>
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
                    <dt className="font-semibold text-[var(--color-text)]">{t(`gmlProblema${clave}`)}</dt>
                    <dd className="mt-0.5 leading-relaxed text-[var(--color-text-dim)]"><Rico como="span" texto={t(`gmlProblema${clave}Texto`)} /></dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GuiaGmail;
