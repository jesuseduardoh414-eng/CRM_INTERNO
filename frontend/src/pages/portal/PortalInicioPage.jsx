// Inicio del portal de clientes. Responde, en este orden, lo que el cliente
// busca al entrar: qué sigue (reunión, entrega, último documento), cómo van
// sus proyectos (avance contra tiempo transcurrido) y qué ha pasado.
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, CalendarDays, FileSignature, FileText, FolderKanban, Mail, MapPin,
  MessagesSquare, PackageCheck, Video,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService, getPublicAssetUrl } from '../../services/api';
import UserAvatar from '../../components/UserAvatar';
import { EstadoProyectoPortal, ErrorPortal, PanelPortal, VacioPortal } from '../../components/portal/PiezasPortal';
import { PageSkeleton } from '../../components/Skeleton';
import { CLAVE_RESUMEN, fechaDia, fechaHora, mismoDia } from '../../utils/portal';

const DIA_MS = 24 * 60 * 60 * 1000;

// "hace 2 días", "en 3 horas"
const relativo = (valor, locale) => {
  const diff = new Date(valor).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60 * 60 * 1000) return rtf.format(Math.round(diff / 60000), 'minute');
  if (abs < DIA_MS) return rtf.format(Math.round(diff / 3600000), 'hour');
  if (abs < 30 * DIA_MS) return rtf.format(Math.round(diff / DIA_MS), 'day');
  return rtf.format(Math.round(diff / (30 * DIA_MS)), 'month');
};

// Fechas "solo día" (entregas): días de calendario entre hoy y esa fecha.
const diasHasta = (valor) => {
  const [y, m, d] = String(valor).slice(0, 10).split('-').map(Number);
  const hoy = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / DIA_MS);
};

/** Porcentaje del plan (inicio → fin) que ya pasó; null sin fecha de fin. */
const tiempoTranscurrido = (p) => {
  if (!p.fechaFin || !p.fechaInicio) return null;
  const ini = new Date(p.fechaInicio).getTime();
  const fin = new Date(p.fechaFin).getTime();
  if (fin <= ini) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - ini) / (fin - ini)) * 100)));
};

const ritmoDe = (p, tiempo) => {
  if (tiempo === null || !p.tareas) return null;
  if (tiempo >= 100 && p.avance < 100) return 'atrasado';
  if (p.tareasVencidas > 0 || p.avance + 15 < tiempo) return 'atencion';
  return 'bien';
};

const saludoKey = () => {
  const h = new Date().getHours();
  if (h < 12) return 'ptlBuenosDias';
  if (h < 19) return 'ptlBuenasTardes';
  return 'ptlBuenasNoches';
};

// ── Tarjetas de "Lo que sigue" ─────────────────────────────────────────────

const TarjetaSigue = ({ icono: Icono, etiqueta, children, pie, vacio }) => (
  <article className={`ptl-sigue-tarjeta ${vacio ? 'is-vacia' : ''}`}>
    <p className="ptl-sigue-etiqueta"><Icono size={14} aria-hidden="true" /> {etiqueta}</p>
    <div className="ptl-sigue-cuerpo">{children}</div>
    {pie && <div className="ptl-sigue-pie">{pie}</div>}
  </article>
);

const SigueReunion = ({ reunion, locale, tp }) => {
  if (!reunion) {
    return <TarjetaSigue icono={CalendarDays} etiqueta={tp('ptlSigReunion')} vacio><p className="ptl-sigue-vacio">{tp('ptlSinProximaReunion')}</p></TarjetaSigue>;
  }
  const inicio = new Date(reunion.fechaInicio);
  const hoy = new Date();
  const manana = new Date(hoy.getTime() + DIA_MS);
  const dia = mismoDia(inicio, hoy) ? tp('ptlHoy') : mismoDia(inicio, manana) ? tp('ptlManana')
    : fechaHora(inicio, locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const hora = reunion.todoElDia ? tp('ptlTodoElDia') : fechaHora(inicio, locale, { hour: '2-digit', minute: '2-digit' });
  const enLinea = reunion.urlReunion && reunion.modalidad !== 'presencial';
  return (
    <TarjetaSigue
      icono={CalendarDays}
      etiqueta={tp('ptlSigReunion')}
      pie={enLinea ? (
        <a href={reunion.urlReunion} target="_blank" rel="noopener noreferrer" className="ptl-boton-primario"><Video size={14} aria-hidden="true" /> {tp('ptlUnirse')}</a>
      ) : (
        <Link to="/portal/reuniones" className="ptl-enlace">{tp('ptlVerDetalles')} <ArrowRight size={13} aria-hidden="true" /></Link>
      )}
    >
      <p className="ptl-sigue-grande"><span className="first-letter:uppercase inline-block">{dia}</span></p>
      <p className="ptl-sigue-detalle">{hora} · {relativo(inicio, locale)}</p>
      <p className="ptl-sigue-titulo">{reunion.titulo}</p>
      <p className="ptl-sigue-meta">
        {enLinea ? <Video size={13} aria-hidden="true" /> : <MapPin size={13} aria-hidden="true" />}
        <span className="truncate">{reunion.ubicacion || tp(`ptlModalidad${reunion.modalidad}`)}</span>
      </p>
    </TarjetaSigue>
  );
};

const SigueEntrega = ({ proyectos, locale, tp }) => {
  const siguiente = proyectos
    .filter((p) => p.proximaFecha)
    .sort((a, b) => new Date(a.proximaFecha) - new Date(b.proximaFecha))[0];
  if (!siguiente) {
    return <TarjetaSigue icono={PackageCheck} etiqueta={tp('ptlSigEntrega')} vacio><p className="ptl-sigue-vacio">{tp('ptlSinProximaEntrega')}</p></TarjetaSigue>;
  }
  const dias = diasHasta(siguiente.proximaFecha);
  const cuando = dias === 0 ? tp('ptlHoy') : dias === 1 ? tp('ptlManana')
    : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(dias, 'day');
  return (
    <TarjetaSigue
      icono={PackageCheck}
      etiqueta={tp('ptlSigEntrega')}
      pie={<Link to={`/portal/proyectos/${siguiente.id}`} className="ptl-enlace">{tp('ptlVerDetalles')} <ArrowRight size={13} aria-hidden="true" /></Link>}
    >
      <p className="ptl-sigue-grande"><span className="first-letter:uppercase inline-block">{cuando}</span></p>
      <p className="ptl-sigue-detalle">{fechaDia(siguiente.proximaFecha, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <p className="ptl-sigue-titulo">{siguiente.nombre}</p>
      <p className="ptl-sigue-meta"><FolderKanban size={13} aria-hidden="true" /> {tp('ptlConteoPendientes', { n: siguiente.tareas - siguiente.tareasHechas })}</p>
    </TarjetaSigue>
  );
};

const SigueDocumento = ({ documento, locale, tp }) => {
  if (!documento) {
    return <TarjetaSigue icono={FileText} etiqueta={tp('ptlSigDocumento')} vacio><p className="ptl-sigue-vacio">{tp('ptlSinDocumento')}</p></TarjetaSigue>;
  }
  return (
    <TarjetaSigue
      icono={FileText}
      etiqueta={tp('ptlSigDocumento')}
      pie={<a href={getPublicAssetUrl(documento.url)} target="_blank" rel="noopener noreferrer" className="ptl-enlace">{tp('ptlAbrir')} <ArrowUpRight size={13} aria-hidden="true" /></a>}
    >
      <p className="ptl-sigue-grande"><span className="first-letter:uppercase inline-block">{relativo(documento.creadoEn, locale)}</span></p>
      <p className="ptl-sigue-detalle">{fechaHora(documento.creadoEn, locale, { day: 'numeric', month: 'long' })}</p>
      <p className="ptl-sigue-titulo" title={documento.nombre}>{documento.nombre}</p>
      <p className="ptl-sigue-meta"><FolderKanban size={13} aria-hidden="true" /> <span className="truncate">{documento.proyecto?.nombre}</span></p>
    </TarjetaSigue>
  );
};

// ── Proyecto en curso: avance contra tiempo ────────────────────────────────

const Medidor = ({ etiqueta, valor, tono }) => (
  <div className="ptl-medidor">
    <div className="ptl-medidor-cabecera">
      <span>{etiqueta}</span>
      <strong>{valor}%</strong>
    </div>
    <div className={`ptl-medidor-barra is-${tono}`} role="progressbar" aria-valuenow={valor} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
      <span style={{ width: `${valor}%` }} />
    </div>
  </div>
);

const FilaProyecto = ({ proyecto: p, locale, tp }) => {
  const tiempo = tiempoTranscurrido(p);
  const ritmo = ritmoDe(p, tiempo);
  const pendientes = Math.max(0, p.tareas - p.tareasHechas - p.tareasEnCurso);
  const ritmoTexto = { bien: 'ptlRitmoBien', atencion: 'ptlRitmoAtencion', atrasado: 'ptlRitmoAtrasado' };
  return (
    <Link to={`/portal/proyectos/${p.id}`} className="ptl-fila-proyecto">
      <div className="ptl-fila-proyecto-info">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <EstadoProyectoPortal estado={p.estado} />
          {ritmo && <span className={`ptl-ritmo is-${ritmo}`} title={tp('ptlRitmoAyuda')}>{tp(ritmoTexto[ritmo])}</span>}
        </div>
        <h3 className="ptl-fila-proyecto-nombre">{p.nombre}</h3>
        {p.descripcion && <p className="ptl-fila-proyecto-desc">{p.descripcion}</p>}
      </div>

      <div className="ptl-fila-proyecto-medidores">
        <Medidor etiqueta={tp('ptlAvanceReal')} valor={p.avance} tono="avance" />
        {tiempo !== null && <Medidor etiqueta={tp('ptlTiempoTranscurrido')} valor={tiempo} tono="tiempo" />}
        {p.tareas ? (
          <p className="ptl-conteos">
            <span><i className="is-hecha" />{tp('ptlConteoHechas', { n: p.tareasHechas })}</span>
            {p.tareasEnCurso > 0 && <span><i className="is-curso" />{tp('ptlConteoEnCurso', { n: p.tareasEnCurso })}</span>}
            {pendientes > 0 && <span><i className="is-pendiente" />{tp('ptlConteoPendientes', { n: pendientes })}</span>}
            {p.tareasVencidas > 0 && <span className="is-alerta">{tp('ptlConteoVencidas', { n: p.tareasVencidas })}</span>}
          </p>
        ) : <p className="ptl-conteos">{tp('ptlSinActividades')}</p>}
      </div>

      <dl className="ptl-fila-proyecto-fechas">
        <div>
          <dt>{tp('ptlSigEntrega')}</dt>
          <dd>{p.proximaFecha ? fechaDia(p.proximaFecha, locale, { day: 'numeric', month: 'short' }) : tp('ptlSinFecha')}</dd>
        </div>
        <div>
          <dt>{tp('ptlEntregaFinal')}</dt>
          <dd>{p.fechaFin ? fechaDia(p.fechaFin, locale, { day: 'numeric', month: 'short' }) : tp('ptlSinFecha')}</dd>
        </div>
        <ArrowUpRight size={16} className="ptl-fila-proyecto-flecha" aria-hidden="true" />
      </dl>
    </Link>
  );
};

// ── Actividad reciente: mensajes y documentos en una sola línea de tiempo ──

const Actividad = ({ mensajes, documentos, locale, tp }) => {
  const eventos = [
    ...mensajes.map((m) => ({ tipo: 'mensaje', id: `m${m.id}`, fecha: m.creadoEn, autor: m.autor?.nombre, proyecto: m.proyecto, texto: m.contenido })),
    ...documentos.map((d) => ({ tipo: 'documento', id: `d${d.id}`, fecha: d.creadoEn, autor: d.usuario?.nombre, proyecto: d.proyecto, texto: d.nombre, url: d.url })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);

  if (!eventos.length) return <VacioPortal icono={MessagesSquare} texto={tp('ptlSinActividad')} />;
  return (
    <ol className="ptl-linea">
      {eventos.map((e) => {
        const autor = e.autor || tp('ptlEquipo');
        const contenido = (
          <>
            <span className={`ptl-linea-punto is-${e.tipo}`} aria-hidden="true">
              {e.tipo === 'mensaje' ? <MessagesSquare size={13} /> : <FileText size={13} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="ptl-linea-cabecera">
                <strong>{tp(e.tipo === 'mensaje' ? 'ptlActMensaje' : 'ptlActDocumento', { autor })}</strong>
                <time dateTime={e.fecha} title={fechaHora(e.fecha, locale)}>{relativo(e.fecha, locale)}</time>
              </span>
              {e.tipo === 'mensaje'
                ? <span className="ptl-linea-cita">{e.texto}</span>
                : <span className="ptl-linea-archivo"><FileText size={13} aria-hidden="true" /> <span className="truncate">{e.texto}</span></span>}
              {e.proyecto && <span className="ptl-linea-proyecto">{e.proyecto.nombre}</span>}
            </span>
          </>
        );
        return (
          <li key={e.id}>
            {e.tipo === 'mensaje'
              ? <Link to={`/portal/proyectos/${e.proyecto.id}?vista=mensajes`} className="ptl-linea-item">{contenido}</Link>
              : <a href={getPublicAssetUrl(e.url)} target="_blank" rel="noopener noreferrer" className="ptl-linea-item">{contenido}</a>}
          </li>
        );
      })}
    </ol>
  );
};

// ── Página ─────────────────────────────────────────────────────────────────

const PortalInicioPage = () => {
  const { usuario } = useAuth();
  const { locale } = usePreferences();
  const { moduloActivo } = useConfiguracion();
  const tp = useTextoPortal();
  const { data, error, isLoading, mutate } = useSWR(CLAVE_RESUMEN, portalService.resumen);
  // Hora de referencia fija por visita (el render debe ser puro).
  const [ahora] = useState(() => Date.now());

  if (isLoading && !data) return <PageSkeleton cards={3} showSidebar={false} />;
  if (error && !data) return <ErrorPortal error={error} onReintentar={() => mutate()} />;

  const { empresa, totales, proyectos, proximasReuniones, documentosRecientes, mensajesRecientes, contratosActivos } = data;
  const agenda = moduloActivo('agenda');
  const conContratos = contratosActivos && moduloActivo('contratos');
  const abiertos = proyectos.filter((p) => !p.cerrado);
  const nombreCorto = (usuario?.nombre || '').split(' ')[0];
  const futuras = proximasReuniones.filter((r) => new Date(r.fechaInicio).getTime() >= ahora - 60 * 60 * 1000);

  const nProy = abiertos.length === 1 ? tp('ptlNProyecto') : tp('ptlNProyectos', { n: abiertos.length });
  const nReu = futuras.length === 1 ? tp('ptlNReunion') : tp('ptlNReuniones', { n: futuras.length });
  const resumen = abiertos.length
    ? tp('ptlIniResumen', { proyectos: nProy, reuniones: agenda && futuras.length ? tp('ptlIniResumenReuniones', { reuniones: nReu }) : '' })
    : tp('ptlIniTodoListo');

  // El contacto es quien lleva el proyecto activo más reciente.
  const conContacto = abiertos.find((p) => p.responsable) || proyectos.find((p) => p.responsable);
  const contacto = conContacto?.responsable;
  const fechaHoy = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="ptl-inicio">
      <header className="ptl-ini-cabecera">
        <div className="min-w-0">
          <p className="ptl-ini-fecha"><span className="first-letter:uppercase inline-block">{fechaHoy}</span><span aria-hidden="true">·</span>{empresa.nombre}</p>
          <h1 className="ptl-ini-saludo">{tp(saludoKey(), { nombre: nombreCorto })}</h1>
          <p className="ptl-ini-resumen">{resumen}</p>
        </div>

        {contacto && (
          <aside className="ptl-contacto" aria-label={tp('ptlTuContacto')}>
            <UserAvatar nombre={contacto.nombre} fotoPerfilUrl={contacto.fotoPerfilUrl} size={44} radius={999} fontSize="0.8rem" />
            <div className="min-w-0 flex-1">
              <p className="ptl-contacto-etiqueta">{tp('ptlTuContacto')}</p>
              <p className="ptl-contacto-nombre" title={contacto.nombre}>{contacto.nombre}</p>
              {contacto.puesto && <p className="ptl-contacto-puesto">{contacto.puesto}</p>}
            </div>
            <div className="flex shrink-0 gap-1.5">
              {contacto.email && (
                <a href={`mailto:${contacto.email}`} className="ptl-boton-icono" title={tp('ptlEscribirCorreo')} aria-label={tp('ptlEscribirCorreo')}><Mail size={16} /></a>
              )}
              <Link to={`/portal/proyectos/${conContacto.id}?vista=mensajes`} className="ptl-boton-icono" title={tp('ptlEscribir')} aria-label={tp('ptlEscribir')}><MessagesSquare size={16} /></Link>
            </div>
          </aside>
        )}
      </header>

      <section aria-labelledby="ptl-sigue-titulo">
        <h2 id="ptl-sigue-titulo" className="ptl-seccion-titulo">{tp('ptlLoQueSigue')}</h2>
        <div className="ptl-sigue">
          {agenda && <SigueReunion reunion={futuras[0]} locale={locale} tp={tp} />}
          <SigueEntrega proyectos={abiertos} locale={locale} tp={tp} />
          <SigueDocumento documento={documentosRecientes[0]} locale={locale} tp={tp} />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="ptl-seccion-titulo">{tp('ptlTusProyectos')} <span>{abiertos.length}</span></h2>
          <Link to="/portal/proyectos" className="ptl-enlace">{tp('ptlVerTodo')} <ArrowRight size={13} aria-hidden="true" /></Link>
        </div>
        {abiertos.length === 0 ? (
          <div className="ptl-panel">
            <VacioPortal icono={FolderKanban} texto={tp('ptlSinProyectos')} ayuda={tp('ptlSinProyectosAyuda')} />
          </div>
        ) : (
          <div className="ptl-lista-proyectos">
            {abiertos.map((p) => <FilaProyecto key={p.id} proyecto={p} locale={locale} tp={tp} />)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <PanelPortal titulo={tp('ptlActividadReciente')}>
          <Actividad mensajes={mensajesRecientes} documentos={documentosRecientes} locale={locale} tp={tp} />
        </PanelPortal>

        <div className="flex min-w-0 flex-col gap-6">
          {agenda && (
            <PanelPortal
              titulo={tp('ptlAgenda')}
              accion={<Link to="/portal/reuniones" className="ptl-enlace">{tp('ptlVerTodo')}</Link>}
            >
              {futuras.length === 0 ? <VacioPortal icono={CalendarDays} texto={tp('ptlSinReuniones')} /> : (
                <ul className="ptl-agenda">
                  {futuras.map((r) => (
                    <li key={r.id}>
                      <Link to="/portal/reuniones" className="ptl-agenda-item">
                        <span className="ptl-agenda-dia">
                          <small>{fechaHora(r.fechaInicio, locale, { weekday: 'short' }).replace('.', '')}</small>
                          <strong>{new Date(r.fechaInicio).getDate()}</strong>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{r.titulo}</span>
                          <span className="block truncate text-[12px] text-[var(--color-text-muted)]">
                            {r.todoElDia ? tp('ptlTodoElDia') : fechaHora(r.fechaInicio, locale, { hour: '2-digit', minute: '2-digit' })}
                            {' · '}{tp(`ptlModalidad${r.modalidad}`)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </PanelPortal>
          )}

          {conContratos && (
            <Link to="/portal/contratos" className="ptl-mini-dato">
              <span className="ptl-icono"><FileSignature size={16} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <strong>{totales.contratosVigentes}</strong>
                <span>{tp('ptlContratosVigentes')}</span>
              </span>
              <ArrowRight size={15} className="text-[var(--color-text-muted)]" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortalInicioPage;
