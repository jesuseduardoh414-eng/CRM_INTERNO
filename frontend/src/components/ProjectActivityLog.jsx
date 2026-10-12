import useSWR from 'swr';
import { logsService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import { claveDiaLocal } from '../utils/fechasLocales';
import Tooltip from './Tooltip';
import {
  PlusCircle,
  Pencil,
  Zap,
  MessageSquare,
  Trash2,
  History,
  RotateCw,
  Inbox,
  Paperclip,
} from 'lucide-react';
import { PanelSkeleton } from './Skeleton';

// Etiqueta legible de cada accion del historial. Las que no esten aqui se
// muestran tal cual vienen, con los guiones bajos convertidos en espacios.
const ACCIONES = {
  CREAR_TAREA:      { labelKey: 'activityActionCreateTask',   icono: PlusCircle,    tono: 'success' },
  EDITAR_TAREA:     { labelKey: 'activityActionEditTask',     icono: Pencil,        tono: 'neutral' },
  CAMBIO_ESTADO:    { labelKey: 'activityActionStatusChange', icono: Zap,           tono: 'info' },
  NUEVO_COMENTARIO: { labelKey: 'activityActionComment',      icono: MessageSquare, tono: 'neutral' },
  ELIMINAR_TAREA:   { labelKey: 'activityActionDeleteTask',   icono: Trash2,        tono: 'danger' },
  NUEVO_ADJUNTO:    { labelKey: 'activityActionAttachment',   icono: Paperclip,     tono: 'neutral' },
};

const TONOS = {
  success: { bg: 'var(--badge-success-bg)', fg: 'var(--badge-success-fg)' },
  info:    { bg: 'var(--badge-info-bg)',    fg: 'var(--badge-info-fg)' },
  danger:  { bg: 'var(--badge-danger-bg)',  fg: 'var(--badge-danger-fg)' },
  neutral: { bg: 'var(--badge-neutral-bg)', fg: 'var(--badge-neutral-fg)' },
};

const describirAccion = (accion = '') => {
  if (ACCIONES[accion]) return ACCIONES[accion];
  if (accion.includes('ELIMINAR')) return { icono: Trash2, tono: 'danger' };
  if (accion.includes('CREAR')) return { icono: PlusCircle, tono: 'success' };
  if (accion.includes('ESTADO')) return { icono: Zap, tono: 'info' };
  return { icono: History, tono: 'neutral' };
};

const humanizar = (accion = '') => {
  const texto = String(accion).replace(/_/g, ' ').toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** "Hace 5 min", "hace 3 h"... y a partir de un dia, la hora del registro. */
const tiempoRelativo = (fecha, locale, textoAhora) => {
  const segundos = Math.round((Date.now() - fecha.getTime()) / 1000);
  if (segundos < 60) return textoAhora;
  const formato = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (segundos < 3600) return formato.format(-Math.floor(segundos / 60), 'minute');
  if (segundos < 86400) return formato.format(-Math.floor(segundos / 3600), 'hour');
  return fecha.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
};

/**
 * Historial de actividad de un proyecto (GET /proyectos/:id/logs).
 *
 * Va por SWR: se cachea por proyecto, el boton "Actualizar" revalida y no hay
 * que mantener a mano un estado de carga dentro de un efecto.
 *
 * Linea de tiempo compacta agrupada por dia: icono pequeño, quien y que hizo,
 * y la hora a la derecha (la fecha completa va en el title).
 */
const ProjectActivityLog = ({ proyectoId }) => {
  const { t, locale } = usePreferences();
  const tx = useTextoProyectos();
  const { nombreArea } = useConfiguracion();

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    proyectoId ? ['proyecto-logs', proyectoId] : null,
    async ([, id]) => {
      const respuesta = await logsService.listarPorProyecto(id);
      return respuesta.logs || [];
    },
  );

  const logs = data || [];

  if (isLoading && !data) return <PanelSkeleton rows={5} titleWidth="210px" />;

  // Agrupar por dia local, en el orden en que llegan (mas reciente primero)
  const hoy = claveDiaLocal();
  const ayer = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return claveDiaLocal(d); })();
  const grupos = [];
  logs.forEach((log) => {
    const clave = claveDiaLocal(new Date(log.creadoEn));
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.clave === clave) ultimo.logs.push(log);
    else grupos.push({ clave, logs: [log] });
  });
  const tituloDia = (clave) => {
    if (clave === hoy) return tx('det_hoy');
    if (clave === ayer) return tx('det_ayer');
    return new Date(`${clave}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <section className="det-panel">
      <header className="det-panel-cabecera">
        <h2 className="det-etiqueta">
          <History size={13} aria-hidden="true" />
          {t('activityLogTitle')}
          {logs.length > 0 && (
            <span className="cli-conteo">{logs.length === 1 ? tx('det_registro') : tx('det_registros', { n: logs.length })}</span>
          )}
        </h2>
        <Tooltip label={t('refresh')}>
          <button type="button" onClick={() => mutate()} disabled={isValidating} className="dash-icono">
            <RotateCw size={15} className={isValidating ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </header>

      <div className="max-h-[560px] overflow-y-auto">
        {error ? (
          <div className="p-4">
            <div className="alert-error text-[13px]" style={{ justifyContent: 'space-between' }}>
              <span>{error.message}</span>
              <button type="button" onClick={() => mutate()} className="font-semibold">
                {t('retry')}
              </button>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
              <Inbox size={18} />
            </span>
            <p className="text-[13.5px] text-[var(--color-text-muted)]">{t('activityLogEmpty')}</p>
          </div>
        ) : (
          grupos.map((grupo) => (
            <div key={grupo.clave}>
              <p className="det-log-dia">{tituloDia(grupo.clave)}</p>
              <ol className="det-log">
                {grupo.logs.map((log) => {
                  const accion = describirAccion(log.accion);
                  const tono = TONOS[accion.tono] || TONOS.neutral;
                  // Las acciones sin traduccion llegan como "EDITAR_PROYECTO": se muestran
                  // como frase ("Editar proyecto") y no en mayusculas.
                  const etiqueta = accion.labelKey ? t(accion.labelKey) : humanizar(log.accion);
                  const fecha = new Date(log.creadoEn);
                  return (
                    <li key={log.id} className="det-log-fila">
                      <span className="det-log-icono" style={{ background: tono.bg, color: tono.fg }}>
                        <accion.icono size={13} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-[var(--color-text-muted)]">
                          {log.usuario && (
                            <span className="font-medium text-[var(--color-text)]">{log.usuario.nombre}</span>
                          )}
                          {log.usuario?.area && <span> · {nombreArea(log.usuario.area)}</span>}
                          <span className="font-medium" style={{ color: tono.fg }}>{log.usuario ? ' · ' : ''}{etiqueta}</span>
                        </p>
                        <p className="mt-0.5 text-[13.5px] leading-snug text-[var(--color-text)]">{log.descripcion}</p>
                      </div>
                      <time
                        dateTime={log.creadoEn}
                        title={fecha.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                        className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--color-text-muted)]"
                      >
                        {tiempoRelativo(fecha, locale, tx('det_ahora'))}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default ProjectActivityLog;
