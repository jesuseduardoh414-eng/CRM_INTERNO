import { useState } from 'react';
import useSWR from 'swr';
import { useNavigate, Link } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ListTodo,
  PartyPopper,
  PlayCircle,
  RefreshCw,
  Video,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { agendaService } from '../../services/api';
import { useMisTareas } from '../../hooks/useMisTareas';
import { useCambioConAviso } from '../../hooks/useCambioConAviso';
import { getEstadoProyecto } from '../../utils/estadosProyecto';
import { puedeGestionarTarea } from '../../utils/estadosTarea';
import { claveDiaLocal } from '../../utils/fechasLocales';
import { PageSkeleton } from '../Skeleton';
import { Button } from '../ui/button';
import FilaTarea from './FilaTarea';

const capitalizar = (texto = '') => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

const saludo = (t) => {
  const h = new Date().getHours();
  if (h < 12) return t('dashboardGoodMorning');
  if (h < 19) return t('dashboardGoodAfternoon');
  return t('dashboardGoodEvening');
};

// Cuántas filas enseña cada grupo en el Inicio; el resto vive en Mis tareas.
const MAX_POR_GRUPO = 5;

const GRUPOS_INICIO = [
  { id: 'vencidas', labelKey: 'miGroupOverdue', tono: 'vencida' },
  { id: 'hoy', labelKey: 'miGroupToday', tono: 'hoy' },
  { id: 'semana', labelKey: 'miGroupWeek', tono: 'normal' },
];

// Eventos de hoy en la agenda propia. Las tareas y los bloques de proyecto que
// también devuelve /agenda se quitan: ya están en la lista de tareas.
const AgendaHoy = () => {
  const { t, locale } = usePreferences();
  const { usuario } = useAuth();
  const hoy = claveDiaLocal();
  const { data, error, isLoading } = useSWR(['agenda-hoy', usuario?.id, hoy], async () => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date();
    fin.setHours(23, 59, 59, 999);
    const respuesta = await agendaService.listar(inicio.toISOString(), fin.toISOString());
    return (respuesta.eventos || []).filter((e) => e.tipo !== 'tarea' && e.tipo !== 'proyecto');
  });

  const eventos = data || [];
  const hora = (iso) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="mi-bloque">
      <header className="mi-bloque-cabecera">
        <h2><CalendarDays size={16} /> {t('miAgendaToday')}</h2>
        <Link to="/agenda" className="mi-enlace">{t('miAgendaOpen')}</Link>
      </header>
      {isLoading && !data ? (
        <div className="space-y-2 p-4">
          <div className="h-10 animate-pulse rounded-lg bg-[var(--color-surface-3)]" />
          <div className="h-10 animate-pulse rounded-lg bg-[var(--color-surface-3)]" />
        </div>
      ) : error && !data ? (
        <p className="mi-vacio">{t('miAgendaError')}</p>
      ) : eventos.length === 0 ? (
        <p className="mi-vacio">{t('miAgendaEmpty')}</p>
      ) : (
        <ul className="mi-agenda">
          {eventos.map((evento) => (
            <li key={`${evento.id}-${evento.fechaInicio}`}>
              <Link to="/agenda" className="mi-evento">
                <span className="mi-evento-hora">
                  {evento.todoElDia ? t('miAllDay') : hora(evento.fechaInicio)}
                </span>
                <span className="mi-evento-barra" style={{ background: evento.color || 'var(--color-primary)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{evento.titulo}</span>
                  {!evento.todoElDia && evento.fechaFin && (
                    <span className="block text-[12px] text-[var(--color-text-muted)]">
                      {hora(evento.fechaInicio)} – {hora(evento.fechaFin)}
                    </span>
                  )}
                </span>
                {(evento.urlReunion || evento.url_reunion) && <Video size={14} className="shrink-0 text-[var(--color-text-muted)]" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const MisProyectos = ({ proyectos, abiertasPorProyecto }) => {
  const { t } = usePreferences();
  const navigate = useNavigate();

  return (
    <section className="mi-bloque">
      <header className="mi-bloque-cabecera">
        <h2><ListTodo size={16} /> {t('miProjectsTitle')}</h2>
        <Link to="/proyectos" className="mi-enlace">{t('miSeeAllProjects')}</Link>
      </header>
      {proyectos.length === 0 ? (
        <p className="mi-vacio">{t('dashboardNoProjectsMember')}</p>
      ) : (
        <ul className="mi-proyectos">
          {proyectos.slice(0, 6).map((p) => {
            const estado = getEstadoProyecto(p.estado);
            const pendientes = abiertasPorProyecto[p.id] || 0;
            const hechasMias = Math.round(((p.progresoMiembro || 0) / 100) * (p.tareasMiembro || 0));
            return (
              <li key={p.id}>
                <button type="button" className="mi-proyecto" onClick={() => navigate(`/proyectos/${p.id}`)}>
                  <span className="mi-proyecto-punto" style={{ background: estado.dot }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{p.nombre}</span>
                      {pendientes > 0 && <span className="mi-proyecto-pendientes">{t('miProjectPending', { n: pendientes })}</span>}
                    </span>
                    {p.tareasMiembro > 0 ? (
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="dash-barra"><span style={{ width: `${p.progresoMiembro || 0}%`, background: 'var(--color-primary)' }} /></span>
                        <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--color-text-muted)]">
                          {t('miProjectsMine', { hechas: hechasMias, total: p.tareasMiembro })}
                        </span>
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[12px] text-[var(--color-text-muted)]">{t('miProjectsNoTasks')}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

const InicioMiembro = () => {
  const { t, locale } = usePreferences();
  const { usuario } = useAuth();
  const { moduloActivo, puede } = useConfiguracion();
  const {
    cargando, error, recargar, cambiarEstado, grupos, resumen, proyectos, proyectosAbiertos, abiertasPorProyecto,
  } = useMisTareas();
  const cambiarConAviso = useCambioConAviso(cambiarEstado);
  // Grupos desplegados con "Ver N más" (por defecto se ven cinco por grupo).
  const [abiertos, setAbiertos] = useState({});

  if (cargando) return <PageSkeleton cards={4} />;
  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
        <p className="font-medium text-[var(--color-text)]">{t('miLoadError')}</p>
        <Button onClick={() => recargar()}><RefreshCw size={15} /> {t('retry')}</Button>
      </div>
    );
  }

  const puedeEditar = puede(usuario, 'editarTareas');
  const proyectoDe = (tarea) => proyectos.find((p) => p.id === (tarea.proyectoId || tarea.proyecto?.id));
  const hayAlgo = GRUPOS_INICIO.some((g) => grupos[g.id].length > 0);

  // Frase de resumen bajo el saludo: solo lo que hay, sin "0 vencidas".
  const partes = [];
  if (resumen.hoy) partes.push(t('miSummaryToday', { n: resumen.hoy }));
  if (resumen.vencidas) partes.push(t('miSummaryOverdue', { n: resumen.vencidas }));
  const frase = partes.length ? t('miSummary', { detalle: partes.join(t('miSummaryAnd')) }) : t('miSummaryClear');

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            {capitalizar(new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }))}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">
            {saludo(t)}, {usuario?.nombre?.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{frase}</p>
        </div>
      </header>

      <dl className="dash-cifras mb-6">
        <div>
          <dt><CalendarClock size={14} style={{ color: 'var(--color-warning)' }} /> {t('miKpiToday')}</dt>
          <dd>
            <strong>{resumen.hoy}</strong>
            <span style={resumen.vencidas ? { color: 'var(--color-error)' } : undefined}>
              {resumen.vencidas ? t('miKpiTodaySub', { n: resumen.vencidas }) : t('miKpiTodayClear')}
            </span>
          </dd>
        </div>
        <div>
          <dt><PlayCircle size={14} style={{ color: 'var(--color-accent-blue)' }} /> {t('miKpiDoing')}</dt>
          <dd><strong>{resumen.enCurso}</strong> <span>{t('miKpiDoingSub', { total: resumen.abiertas })}</span></dd>
        </div>
        <div>
          <dt><AlertCircle size={14} /> {t('miKpiWeek')}</dt>
          <dd><strong>{resumen.semana}</strong> <span>{t('miKpiWeekSub')}</span></dd>
        </div>
        <div>
          <dt><CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} /> {t('miKpiDone')}</dt>
          <dd><strong>{resumen.hechasSemana}</strong> <span>{t('miKpiDoneSub')}</span></dd>
        </div>
      </dl>

      <div className="mi-rejilla">
        <section className="mi-bloque">
          <header className="mi-bloque-cabecera">
            <h2><ListTodo size={16} /> {t('miTasksTitle')}</h2>
          </header>

          {!hayAlgo ? (
            <div className="mi-todo-listo">
              <PartyPopper size={22} />
              <p className="font-medium text-[var(--color-text)]">{t('miAllClear')}</p>
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('miAllClearSub')}</p>
            </div>
          ) : (
            <div className="mi-grupos">
              {GRUPOS_INICIO.filter((g) => grupos[g.id].length > 0).map((g) => {
                const lista = grupos[g.id];
                const visibles = abiertos[g.id] ? lista : lista.slice(0, MAX_POR_GRUPO);
                return (
                  <div key={g.id}>
                    <h3 className="mi-grupo-titulo" data-tono={g.tono}>
                      {t(g.labelKey)} <span>{lista.length}</span>
                    </h3>
                    <div className="flex flex-col">
                      {visibles.map((tarea) => (
                        <FilaTarea
                          key={tarea.id}
                          tarea={tarea}
                          onCambiarEstado={cambiarConAviso}
                          puedeCambiar={puedeEditar && puedeGestionarTarea(tarea, usuario, proyectoDe(tarea))}
                        />
                      ))}
                    </div>
                    {lista.length > MAX_POR_GRUPO && (
                      <button
                        type="button"
                        className="mi-ver-mas"
                        aria-expanded={Boolean(abiertos[g.id])}
                        onClick={() => setAbiertos((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                      >
                        {abiertos[g.id] ? t('miSeeLess') : t('miSeeMore', { n: lista.length - MAX_POR_GRUPO })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Agenda y proyectos: a la derecha en escritorio; en una tableta,
            debajo de las tareas y lado a lado (.mi-lateral). */}
        <div className="mi-lateral">
          {moduloActivo('agenda') && <AgendaHoy />}
          <MisProyectos proyectos={proyectosAbiertos.length ? proyectosAbiertos : proyectos} abiertasPorProyecto={abiertasPorProyecto} />
        </div>
      </div>
    </div>
  );
};

export default InicioMiembro;
