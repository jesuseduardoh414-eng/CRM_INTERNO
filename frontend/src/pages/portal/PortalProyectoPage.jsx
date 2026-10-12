// Detalle de un proyecto en el portal: resumen de avance y pestañas
// Avance / Documentos / Mensajes / Reuniones (?vista= para enlazar directo).
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, FileText, Mail } from 'lucide-react';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import UserAvatar from '../../components/UserAvatar';
import ConversacionPortal from '../../components/portal/ConversacionPortal';
import { FilaReunion, ListaDocumentos } from '../../components/portal/ListasPortal';
import {
  AnilloAvance, ErrorPortal, EstadoProyectoPortal, PanelPortal, VacioPortal,
} from '../../components/portal/PiezasPortal';
import { PageSkeleton } from '../../components/Skeleton';
import { fechaDia } from '../../utils/portal';

const VISTAS = ['avance', 'documentos', 'mensajes', 'reuniones'];

const Actividad = ({ actividad: a }) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const corta = { day: 'numeric', month: 'short' };
  let fecha = null;
  if (a.estado === 'HECHO') fecha = a.completadoEn && tp('ptlCompletada', { fecha: fechaDia(a.completadoEn, locale, corta) });
  else if (a.venceEn) fecha = tp('ptlVence', { fecha: fechaDia(a.venceEn, locale, corta) });
  return (
    <li className="ptl-actividad" data-estado={a.estado}>
      <span className="ptl-check" data-estado={a.estado} aria-hidden="true">
        {a.estado === 'HECHO' && <Check size={12} strokeWidth={3} />}
      </span>
      <span className="ptl-actividad-titulo">{a.titulo}</span>
      <span className="ptl-actividad-fecha">{fecha}</span>
    </li>
  );
};

const GrupoActividades = ({ titulo, actividades, total = actividades.length, children }) => (
  <PanelPortal titulo={<>{titulo} <span className="ml-1 font-normal text-[var(--color-text-muted)]">{total}</span></>}>
    <ul>{actividades.map((a) => <Actividad key={a.id} actividad={a} />)}</ul>
    {children}
  </PanelPortal>
);

const PortalProyectoPage = () => {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { locale } = usePreferences();
  const { moduloActivo } = useConfiguracion();
  const { showToast } = useToast();
  const tp = useTextoPortal();
  const [verHechas, setVerHechas] = useState(false);

  const vistasVisibles = VISTAS.filter((v) => v !== 'reuniones' || moduloActivo('agenda'));
  const vista = vistasVisibles.includes(params.get('vista')) ? params.get('vista') : 'avance';
  const cambiarVista = (v) => setParams(v === 'avance' ? {} : { vista: v }, { replace: true });

  const { data, error, isLoading, mutate } = useSWR(['portal', 'proyecto', id], () => portalService.proyecto(id));
  const { data: chat, error: errorChat, mutate: mutateChat } = useSWR(
    vista === 'mensajes' ? ['portal', 'mensajes', id] : null,
    () => portalService.mensajes(id),
    { refreshInterval: 20000, revalidateOnFocus: true },
  );

  const proyecto = data?.proyecto;
  const grupos = useMemo(() => {
    const lista = proyecto?.actividades || [];
    return {
      enCurso: lista.filter((a) => a.estado === 'EN_PROGRESO'),
      pendientes: lista.filter((a) => a.estado === 'PENDIENTE'),
      hechas: lista.filter((a) => a.estado === 'HECHO').sort((a, b) => String(b.completadoEn || '').localeCompare(String(a.completadoEn || ''))),
    };
  }, [proyecto]);

  const volver = (
    <Link to="/portal/proyectos" className="ptl-enlace mb-4"><ArrowLeft size={14} aria-hidden="true" /> {tp('ptlMenuProyectos')}</Link>
  );

  if (isLoading && !data) return <PageSkeleton cards={2} showSidebar={false} />;
  if (error && !data) {
    return (
      <div>
        {volver}
        {error.status === 404
          ? <div className="ptl-panel"><VacioPortal icono={FileText} texto={tp('ptlNoEncontrado')} /></div>
          : <ErrorPortal error={error} onReintentar={() => mutate()} />}
      </div>
    );
  }

  const enviar = async (texto) => {
    try {
      const { mensaje } = await portalService.enviarMensaje(id, texto);
      mutateChat((prev) => ({ mensajes: [...(prev?.mensajes || []), mensaje] }), { revalidate: false });
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  const corta = { day: 'numeric', month: 'long', year: 'numeric' };
  const conteos = {
    documentos: proyecto.documentos.length,
    reuniones: proyecto.reuniones.length,
  };

  return (
    <div>
      {volver}

      {/* Resumen */}
      <section className="ptl-panel mb-6 p-5 md:p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <AnilloAvance valor={proyecto.avance} etiqueta={tp('ptlAvance')} />
          <div className="min-w-0 flex-1">
            <EstadoProyectoPortal estado={proyecto.estado} />
            <h1 className="ptl-titulo mt-1">{proyecto.nombre}</h1>
            {proyecto.descripcion && <p className="mt-2 max-w-2xl whitespace-pre-line text-[14px] text-[var(--color-text-dim)]">{proyecto.descripcion}</p>}
            <div className="ptl-contrato-cifras mt-4">
              <div className="ptl-dato"><small>{tp('ptlInicio')}</small><strong>{fechaDia(proyecto.fechaInicio, locale, corta)}</strong></div>
              <div className="ptl-dato"><small>{tp('ptlFin')}</small><strong>{proyecto.fechaFin ? fechaDia(proyecto.fechaFin, locale, corta) : tp('ptlSinFecha')}</strong></div>
              <div className="ptl-dato">
                <small>{tp('ptlColActividades')}</small>
                <strong>{proyecto.tareas ? tp('ptlActividades', { hechas: proyecto.tareasHechas, total: proyecto.tareas }) : tp('ptlSinActividades')}</strong>
              </div>
            </div>
          </div>
          {proyecto.responsable && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3 md:w-64 md:shrink-0">
              <UserAvatar nombre={proyecto.responsable.nombre} fotoPerfilUrl={proyecto.responsable.fotoPerfilUrl} size={40} radius={999} fontSize="0.8rem" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[var(--color-text-muted)]">{tp('ptlResponsable')}</p>
                <p className="truncate text-[13.5px] font-semibold">{proyecto.responsable.nombre}</p>
                {proyecto.responsable.email && (
                  <a href={`mailto:${proyecto.responsable.email}`} className="inline-flex max-w-full items-center gap-1 truncate text-[12px] text-[var(--color-text-dim)] hover:underline">
                    <Mail size={12} aria-hidden="true" /> <span className="truncate">{proyecto.responsable.email}</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Pestañas */}
      <div className="ptl-pestanas" role="tablist" aria-label={proyecto.nombre}>
        {vistasVisibles.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => cambiarVista(v)}>
            {tp(`ptlTab${v.charAt(0).toUpperCase()}${v.slice(1)}`)}
            {conteos[v] > 0 && <span className="ptl-cuenta-tab">{conteos[v]}</span>}
          </button>
        ))}
      </div>

      {vista === 'avance' && (
        proyecto.actividades.length === 0
          ? <div className="ptl-panel"><VacioPortal icono={FileText} texto={tp('ptlSinActividades')} /></div>
          : (
            <div className="flex flex-col gap-5">
              {grupos.enCurso.length > 0 && <GrupoActividades titulo={tp('ptlGrupoEnCurso')} actividades={grupos.enCurso} />}
              {grupos.pendientes.length > 0 && <GrupoActividades titulo={tp('ptlGrupoPendientes')} actividades={grupos.pendientes} />}
              {grupos.hechas.length > 0 && (
                <GrupoActividades titulo={tp('ptlGrupoHechas')} total={grupos.hechas.length} actividades={verHechas ? grupos.hechas : grupos.hechas.slice(0, 5)}>
                  {grupos.hechas.length > 5 && (
                    <button type="button" onClick={() => setVerHechas((v) => !v)} className="w-full border-t border-[var(--color-border-light)] px-4 py-2.5 text-[12.5px] font-medium text-[var(--color-text-dim)] hover:bg-[var(--color-surface-3)]">
                      {verHechas ? tp('ptlOcultarHechas') : tp('ptlMostrarHechas', { n: grupos.hechas.length })}
                    </button>
                  )}
                </GrupoActividades>
              )}
            </div>
          )
      )}

      {vista === 'documentos' && (
        <PanelPortal>
          {proyecto.documentos.length === 0
            ? <VacioPortal icono={FileText} texto={tp('ptlSinDocs')} />
            : <ListaDocumentos documentos={proyecto.documentos} />}
        </PanelPortal>
      )}

      {vista === 'mensajes' && errorChat && !chat && <ErrorPortal error={errorChat} onReintentar={() => mutateChat()} />}
      {vista === 'mensajes' && !(errorChat && !chat) && (
        <ConversacionPortal
          key={id}
          ladoCliente
          cargando={!chat}
          mensajes={chat?.mensajes || []}
          onEnviar={enviar}
          etiquetaOtros={tp('ptlEquipo')}
          cabecera={(
            <header className="ptl-panel-cabecera">
              <div className="min-w-0">
                <h2 className="ptl-panel-titulo">{tp('ptlConversacion')}</h2>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{tp('ptlConversacionAyuda')}</p>
              </div>
            </header>
          )}
        />
      )}

      {vista === 'reuniones' && (
        <PanelPortal>
          {proyecto.reuniones.length === 0
            ? <VacioPortal icono={CalendarDays} texto={tp('ptlSinReuniones')} />
            : <ul>{proyecto.reuniones.map((r) => <FilaReunion key={r.id} reunion={r} pasada={new Date(r.fechaFin || r.fechaInicio) < new Date()} />)}</ul>}
        </PanelPortal>
      )}
    </div>
  );
};

export default PortalProyectoPage;
