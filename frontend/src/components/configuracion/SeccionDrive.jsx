// Sección "Google Drive y respaldos" del panel de configuración.
//
// Conecta una cuenta de Google de la empresa (ventana de Google, mismo cliente
// OAuth que Google Calendar) para que los archivos del CRM se guarden en su
// Drive y cada noche se suba ahí un respaldo de la base. El permiso que se
// pide es "drive.file": el CRM solo ve lo que él mismo crea. Todo pasa por
// /api/configuracion/drive (backend/src/services/drive.service.js).
import { useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle, BookOpen, CheckCircle2, CloudUpload, DatabaseBackup, ExternalLink, HardDrive, Loader2, RefreshCw, Unplug,
} from 'lucide-react';
import { configuracionService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmacion } from '../ConfirmDialog';
import { pedirCodigoGoogle } from '../../utils/googleIdentity';
import { formatearTamano } from '../../utils/contratos';
import { Fila } from './PiezasConfiguracion';
import GuiaGoogleCloud from './GuiaGoogleCloud';

const TONOS = {
  success: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
  warning: 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]',
  neutral: 'bg-[var(--color-surface-3)] text-[var(--color-text-dim)]',
};

/** 1.5 GB, 2 TB… (formatearTamano llega solo hasta MB). */
const tamanoGrande = (bytes) => {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(bytes % 1024 ** 4 ? 1 : 0)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return formatearTamano(bytes);
};

const Aviso = ({ tono, icono: Icono, titulo, texto, children }) => (
  <div className={`flex items-start gap-3 rounded-[8px] p-3.5 ${TONOS[tono]}`}>
    <Icono size={18} className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 text-[13.5px]">
      <p className="font-semibold">{titulo}</p>
      {texto && <p className="mt-0.5 opacity-90">{texto}</p>}
      {children}
    </div>
  </div>
);

/**
 * google / guardado / cambiar / onGuardar / guardando: la llave de Google
 * (la misma de Google Calendar) en el borrador del panel, para la guía.
 */
const SeccionDrive = ({ google, guardado, cambiar, onGuardar, guardando, nombreSistema }) => {
  const { t, locale } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { data: estado, error: errorCarga, mutate } = useSWR('config-drive', () => configuracionService.drive.estado(), { revalidateOnFocus: false });
  const error = errorCarga?.message;
  const cargar = () => mutate();
  const [ocupado, setOcupado] = useState(null); // 'conectar' | 'respaldo' | 'pendientes' | 'desconectar'
  const [verGuia, setVerGuia] = useState(false);

  const fecha = (iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  const MENSAJES_GOOGLE = {
    'google-script': 'drvSinScript',
    'sin-codigo': 'drvSinCodigo',
    'popup-bloqueado': 'gcgProblemaVentanaTexto',
  };
  const conectar = async () => {
    setOcupado('conectar');
    try {
      const codigo = await pedirCodigoGoogle({ clientId: estado.clientId, scope: estado.scope, elegirCuenta: true });
      await mutate(await configuracionService.drive.conectar(codigo), { revalidate: false });
      showToast(t('drvConectado'), 'success');
    } catch (err) {
      if (err.code === 'cancelado') return;
      showToast(MENSAJES_GOOGLE[err.code] ? t(MENSAJES_GOOGLE[err.code]) : err.message, 'error');
    } finally {
      setOcupado(null);
    }
  };

  // Guarda la llave con el guardado del panel y vuelve a leer el estado de Drive.
  const guardarLlave = async () => {
    await onGuardar();
    await mutate();
  };

  const accion = async (clave, fn, exito) => {
    setOcupado(clave);
    try {
      const resultado = await fn();
      showToast(exito(resultado), 'success');
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
      await cargar();
    } finally {
      setOcupado(null);
    }
  };

  const desconectar = async () => {
    const ok = await confirmar({
      titulo: t('drvDesconectarConfirm'),
      descripcion: t('drvDesconectarTexto', { cuenta: estado.cuenta }),
      textoConfirmar: t('drvDesconectar'),
      peligro: true,
    });
    if (!ok) return;
    accion('desconectar', () => configuracionService.drive.desconectar(), () => t('drvDesconectado'));
  };

  if (error && !estado) {
    return (
      <Fila titulo={t('drvTitulo')} descripcion={t('drvTexto')}>
        <Aviso tono="warning" icono={AlertTriangle} titulo={t('drvErrorCarga')} texto={error}>
          <button type="button" className="cfg-btn mt-3" onClick={cargar}><RefreshCw size={13} /> {t('retry')}</button>
        </Aviso>
      </Fila>
    );
  }
  if (!estado) {
    return (
      <Fila titulo={t('drvTitulo')} descripcion={t('drvTexto')}>
        <p className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> {t('loading')}</p>
      </Fila>
    );
  }

  const revocada = estado.conectado && estado.estado === 'revocada';
  const botonConectar = (texto) => (
    <button type="button" className="cfg-btn cfg-btn-primario" onClick={conectar} disabled={Boolean(ocupado)}>
      {ocupado === 'conectar' ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />} {texto}
    </button>
  );
  const guia = (
    <GuiaGoogleCloud
      variante="drive"
      google={google}
      guardado={guardado}
      cambiar={cambiar}
      onGuardar={guardarLlave}
      guardando={guardando}
      nombreSistema={nombreSistema}
      credencialesListas={estado.credenciales}
      conectado={estado.conectado && !revocada}
      botonConectar={botonConectar(revocada ? t('drvReconectar') : t('drvConectar'))}
    />
  );
  // Sin conectar (o con el permiso retirado) la guía va abierta; conectado,
  // se puede abrir para consultarla.
  const guiaAbierta = !estado.conectado || revocada;

  return (
    <>
      {dialogo}
      <Fila
        titulo={t('drvTitulo')}
        descripcion={t('drvTexto')}
        extra={estado.conectado && (
          <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" onClick={desconectar} disabled={Boolean(ocupado)}>
            <Unplug size={13} /> {t('drvDesconectar')}
          </button>
        )}
      >
        {!estado.conectado && (
          <ul className="space-y-2 text-[13px] leading-relaxed text-[var(--color-text-dim)]">
            <li>• {t('drvPunto1')}</li>
            <li>• {t('drvPunto2')}</li>
            <li>• {t('drvPunto3')}</li>
          </ul>
        )}

        {estado.conectado && (
          <div className="space-y-4">
            {revocada ? (
              <Aviso tono="warning" icono={AlertTriangle} titulo={t('drvRevocada')} texto={estado.ultimoError || t('drvRevocadaTexto')}>
                <div className="mt-3">{botonConectar(t('drvReconectar'))}</div>
              </Aviso>
            ) : (
              <Aviso tono="success" icono={CheckCircle2} titulo={t('drvActivo', { cuenta: estado.cuenta })} texto={t('drvActivoTexto')} />
            )}

            <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="cfg-label">{t('drvCuenta')}</dt>
                <dd className="text-[var(--color-text)]">{estado.cuenta}</dd>
              </div>
              <div>
                <dt className="cfg-label">{t('drvCarpeta')}</dt>
                <dd>
                  {estado.carpetaUrl ? (
                    <a href={estado.carpetaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">
                      {t('drvAbrirCarpeta')} <ExternalLink size={12} />
                    </a>
                  ) : '—'}
                </dd>
              </div>
              {estado.espacio && (
                <div>
                  <dt className="cfg-label">{t('drvEspacio')}</dt>
                  <dd className="text-[var(--color-text)]">
                    {estado.espacio.limite
                      ? t('drvEspacioDe', { usado: tamanoGrande(estado.espacio.usado), limite: tamanoGrande(estado.espacio.limite) })
                      : tamanoGrande(estado.espacio.usado)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="cfg-label">{t('drvEnDisco')}</dt>
                <dd className="text-[var(--color-text)]">{estado.enDisco ? t('drvEnDiscoN', { n: estado.enDisco }) : t('drvEnDiscoCero')}</dd>
              </div>
            </dl>

            {estado.errorConsulta && <p className="text-[12.5px] text-[var(--color-error)]">{estado.errorConsulta}</p>}
            {estado.ultimoError && !revocada && <p className="text-[12.5px] text-[var(--color-error)]">{estado.ultimoError}</p>}

            {estado.enDisco > 0 && !revocada && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="cfg-btn"
                  disabled={Boolean(ocupado)}
                  onClick={() => accion('pendientes', () => configuracionService.drive.subirPendientes(), (r) => t('drvPendientesListo', { n: r.subidos + r.yaEstaban, fallidos: r.fallidos }))}
                >
                  {ocupado === 'pendientes' ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} {t('drvSubirPendientes')}
                </button>
                <span className="cfg-ayuda">{t('drvSubirPendientesTexto')}</span>
              </div>
            )}
          </div>
        )}
      </Fila>

      <Fila
        titulo={t('gcgTitulo')}
        descripcion={t('gcgTexto')}
        extra={!guiaAbierta && (
          <button type="button" className="cfg-btn" onClick={() => setVerGuia((v) => !v)} aria-expanded={verGuia}>
            <BookOpen size={14} /> {verGuia ? t('drvGuiaOcultar') : t('drvGuiaVer')}
          </button>
        )}
      >
        {guiaAbierta || verGuia ? guia : <p className="cfg-ayuda">{t('drvGuiaCerrada')}</p>}
      </Fila>

      {estado.conectado && (
        <Fila
          titulo={t('drvRespaldos')}
          descripcion={t('drvRespaldosTexto', { n: estado.conservar || 30 })}
          extra={!revocada && (
            <button
              type="button"
              className="cfg-btn"
              disabled={Boolean(ocupado)}
              onClick={() => accion('respaldo', () => configuracionService.drive.respaldar(), (r) => t('drvRespaldoListo', { nombre: r.nombre, tamano: formatearTamano(r.bytes) }))}
            >
              {ocupado === 'respaldo' ? <Loader2 size={14} className="animate-spin" /> : <DatabaseBackup size={14} />} {t('drvRespaldarAhora')}
            </button>
          )}
        >
          {estado.ultimoRespaldo ? (
            <p className="text-[13.5px] text-[var(--color-text)]">
              {t('drvUltimoRespaldo', { fecha: fecha(estado.ultimoRespaldo.en), tamano: formatearTamano(estado.ultimoRespaldo.bytes || 0) })}
            </p>
          ) : (
            <p className="text-[13.5px] text-[var(--color-text-muted)]">{t('drvSinRespaldos')}</p>
          )}
          {estado.respaldos?.length > 0 && (
            <ul className="cfg-lista mt-3">
              {estado.respaldos.map((r) => (
                <li key={r.nombre} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-[var(--color-text)]">{r.nombre}</span>
                  <span className="flex shrink-0 items-center gap-3 text-[var(--color-text-muted)]">
                    {formatearTamano(r.bytes)}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline" aria-label={t('drvAbrirRespaldo', { nombre: r.nombre })}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="cfg-ayuda mt-4">{t('drvRestaurar')}</p>
        </Fila>
      )}
    </>
  );
};

export default SeccionDrive;
