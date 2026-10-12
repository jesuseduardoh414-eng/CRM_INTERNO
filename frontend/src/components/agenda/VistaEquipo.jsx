/**
 * Vista "Equipo" (solo administradores): una fila por persona y una columna
 * por día de la semana. Cada celda resume ese día de la persona: reuniones y
 * eventos, tareas que vencen o se terminaron, y si está ausente (vacaciones,
 * permiso...), si la empresa cierra o si no le toca trabajar según su horario.
 * Pulsar una celda abre un recuadro con el detalle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, CheckSquare, Search, Users, X } from 'lucide-react';
import { agendaService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import { areasDeTexto } from '../../utils/areas';
import { horarioDelDia } from '../../utils/horarioSemana';
import UserAvatar from '../UserAvatar';
import SelectorSimple from '../SelectorSimple';
import { IconoTipo, InsigniaEmpresa, InsigniaPersonal } from './ElementosAgenda';
import {
  TIPOS_EMPRESA_NO_LABORALES,
  TIPOS_PERSONALES_AUSENTE,
  agruparPorClave,
  claveDesdeISO,
  diaEmpresaAplica,
  diaSemanaLaboral,
  diasDesde,
  estiloDiaEmpresa,
  fechaDesdeClave,
  formatHora,
  getDateKey,
  inicioDeSemana,
  tenue,
} from './agendaComun';

const LABORALES_DEFAULT = [1, 2, 3, 4, 5];

/** Resumen de una persona en un día: lo que se pinta en la celda y en el recuadro. */
const resumenDia = (persona, dia, diasEmpresaPorClave) => {
  const clave = getDateKey(dia);
  const areas = areasDeTexto(persona.area);
  // Horario de ese dia de la semana (puede ser distinto al general: sabado medio turno)
  const horarioDia = horarioDelDia({ ...persona.horario, diasLaborales: persona.horario?.diasLaborales || LABORALES_DEFAULT }, diaSemanaLaboral(dia));
  const laboralHorario = horarioDia.laboral;
  const empresa = (diasEmpresaPorClave.get(clave) || []).filter((d) => diaEmpresaAplica(d, areas));
  const cierre = empresa.find((d) => TIPOS_EMPRESA_NO_LABORALES.includes(d.tipo)) || null;
  const personales = (persona.diasEspeciales || []).filter((d) => claveDesdeISO(d.fecha) === clave);
  // Solo cuenta como ausencia la de día completo; la de unas horas sale como marca
  const ausencia = personales.find((d) => TIPOS_PERSONALES_AUSENTE.includes(d.tipo) && !d.horaInicio) || null;
  const eventos = (persona.eventos || [])
    .filter((e) => e.estadoInvitacion !== 'rechazado')
    .filter((e) => {
      const ini = getDateKey(e.fechaInicio);
      const fin = getDateKey(e.fechaFin || e.fechaInicio);
      return clave >= ini && clave <= fin;
    })
    .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
  const vencen = (persona.tareas || []).filter((t) => t.estado !== 'HECHO' && claveDesdeISO(t.venceEn) === clave);
  const hechas = (persona.tareas || []).filter((t) => t.completadoEn && getDateKey(t.completadoEn) === clave);
  return {
    clave,
    laboralHorario,
    horarioDia,
    empresa,
    cierre,
    personales,
    ausencia,
    reuniones: eventos.filter((e) => e.tipo === 'reunion'),
    otros: eventos.filter((e) => e.tipo !== 'reunion'),
    eventos,
    vencen,
    hechas,
  };
};

const VistaEquipo = ({ fecha }) => {
  const { t, locale } = usePreferences();
  const { nombreArea } = useConfiguracion();
  const ta = useTextoAgenda();
  const navigate = useNavigate();

  const lunes = inicioDeSemana(fecha);
  const desde = getDateKey(lunes);
  const dias = useMemo(() => diasDesde(fechaDesdeClave(desde), 7), [desde]);
  const hasta = getDateKey(dias[6]);
  const hoyKey = getDateKey(new Date());

  const [datos, setDatos] = useState(null);
  const [claveCargada, setClaveCargada] = useState(null);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [area, setArea] = useState('');
  const [abierta, setAbierta] = useState(null);
  const solicitudRef = useRef(0);
  const recuadroRef = useRef(null);
  const claveConsulta = `${desde}-${intento}`;
  const cargando = claveCargada !== claveConsulta;

  useEffect(() => {
    const solicitud = ++solicitudRef.current;
    agendaService.equipo(desde, hasta)
      .then((res) => {
        if (solicitud !== solicitudRef.current) return;
        setDatos(res);
        setError(null);
      })
      .catch((err) => {
        if (solicitud !== solicitudRef.current) return;
        setError(err?.message || ta('pag_eqError'));
      })
      .finally(() => {
        if (solicitud === solicitudRef.current) setClaveCargada(`${desde}-${intento}`);
      });
  }, [desde, hasta, intento, ta]);

  // El recuadro se cierra con Escape, al pulsar fuera o al desplazar la página.
  // Desplazar DENTRO del recuadro (su lista es larga en el móvil) no lo cierra.
  useEffect(() => {
    if (!abierta) return undefined;
    const cerrar = () => setAbierta(null);
    const fuera = (ev) => !recuadroRef.current?.contains(ev.target);
    // La celda abierta se deja a su propio clic, que la cierra (si se cerrara
    // aquí, el clic que sigue la volvía a abrir).
    const alPulsar = (ev) => { if (fuera(ev) && !ev.target.closest?.('.ag-equipo-celda[data-sel="true"]')) cerrar(); };
    const alTeclear = (ev) => { if (ev.key === 'Escape') cerrar(); };
    const alDesplazar = (ev) => { if (fuera(ev)) cerrar(); };
    document.addEventListener('pointerdown', alPulsar);
    document.addEventListener('keydown', alTeclear);
    window.addEventListener('scroll', alDesplazar, true);
    return () => {
      document.removeEventListener('pointerdown', alPulsar);
      document.removeEventListener('keydown', alTeclear);
      window.removeEventListener('scroll', alDesplazar, true);
    };
  }, [abierta]);

  const diasEmpresaPorClave = useMemo(() => agruparPorClave(datos?.diasEmpresa || []), [datos]);
  const personas = useMemo(() => datos?.personas || [], [datos]);
  const areasDisponibles = useMemo(
    () => [...new Set(personas.flatMap((p) => areasDeTexto(p.area)))].sort(),
    [personas]
  );
  const texto = busqueda.trim().toLowerCase();
  const filtradas = personas.filter((p) => (
    (!texto || p.nombre.toLowerCase().includes(texto)) &&
    (!area || areasDeTexto(p.area).includes(area))
  ));

  const abrirCelda = (ev, persona, dia) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const ancho = 300;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - ancho - 8));
    const abajo = window.innerHeight - rect.bottom > 260;
    setAbierta({
      persona,
      dia,
      estilo: abajo ? { left, top: rect.bottom + 4 } : { left, bottom: window.innerHeight - rect.top + 4 },
    });
  };

  // Anchos en variables CSS: en el móvil la columna de personas se estrecha
  // para que quede sitio a los días (la tabla se desplaza dentro de su caja).
  const plantilla = { gridTemplateColumns: 'minmax(var(--ag-eq-persona, 15rem), 1.5fr) repeat(7, minmax(var(--ag-eq-dia, 6.75rem), 1fr))' };
  const detalle = abierta ? resumenDia(abierta.persona, abierta.dia, diasEmpresaPorClave) : null;

  return (
    <div className="ag-equipo">
      <div className="ag-equipo-barra">
        <label className="proy-control ag-equipo-buscar">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={busqueda} onChange={(ev) => setBusqueda(ev.target.value)} placeholder={ta('pag_eqBuscar')} aria-label={ta('pag_eqBuscar')} />
        </label>
        {areasDisponibles.length > 1 && (
          <SelectorSimple
            className="campo-select-compacto w-auto"
            valor={area}
            onCambio={setArea}
            aria-label={ta('pag_eqTodasAreas')}
            opcionVacia={ta('pag_eqTodasAreas')}
            opciones={areasDisponibles.map((clave) => ({ valor: clave, etiqueta: nombreArea?.(clave) || clave }))}
          />
        )}
        <span className="ag-equipo-cuenta"><Users size={14} aria-hidden="true" /> {ta('pag_eqPersonas', { n: filtradas.length })}</span>
      </div>

      {error && !cargando ? (
        <div className="ag-vacio">
          <p>{error}</p>
          <button type="button" className="proy-control proy-alternar" onClick={() => setIntento((n) => n + 1)}>{ta('pag_eqReintentar')}</button>
        </div>
      ) : (
        <div className="ag-equipo-scroll" aria-busy={cargando}>
          <div className="ag-equipo-tabla" role="grid" style={plantilla}>
            <div className="ag-equipo-cab ag-equipo-esquina" role="columnheader">{ta('pag_eqPersona')}</div>
            {dias.map((dia) => {
              const clave = getDateKey(dia);
              const empresa = diasEmpresaPorClave.get(clave) || [];
              return (
                <div key={clave} className="ag-equipo-cab" role="columnheader" data-hoy={clave === hoyKey}>
                  <span>{dia.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')} <b>{dia.getDate()}</b></span>
                  {empresa.slice(0, 1).map((d) => <InsigniaEmpresa key={d.id} dia={d} compacta />)}
                </div>
              );
            })}

            {cargando && !datos && Array.from({ length: 5 }, (_, fila) => (
              <div key={`esq-${fila}`} className="ag-equipo-fila-esqueleto" style={{ gridColumn: '1 / -1' }}>
                <span className="animate-pulse" />
              </div>
            ))}

            {!(cargando && !datos) && filtradas.length === 0 && (
              <div className="ag-vacio" style={{ gridColumn: '1 / -1' }}><p>{ta('pag_eqVacio')}</p></div>
            )}

            {filtradas.map((persona) => (
              <div key={persona.id} className="ag-equipo-fila" role="row" style={{ display: 'contents' }}>
                <div className="ag-equipo-persona" role="rowheader">
                  <UserAvatar usuario={persona} size={28} radius={999} fontSize="0.7rem" />
                  <span className="min-w-0">
                    <b>{persona.nombre}</b>
                    <span>
                      {areasDeTexto(persona.area).map((a) => nombreArea?.(a) || a).join(', ')}
                      {persona.horario?.horaEntrada && ` · ${ta('pag_eqHorario', { entrada: persona.horario.horaEntrada, salida: persona.horario.horaSalida })}`}
                    </span>
                  </span>
                </div>
                {dias.map((dia) => {
                  const r = resumenDia(persona, dia, diasEmpresaPorClave);
                  const libre = !r.cierre && !r.ausencia && r.laboralHorario;
                  const seleccionada = abierta?.persona.id === persona.id && getDateKey(abierta.dia) === r.clave;
                  return (
                    <button
                      key={r.clave}
                      type="button"
                      role="gridcell"
                      className="ag-equipo-celda"
                      data-hoy={r.clave === hoyKey}
                      data-nolaboral={!r.laboralHorario && !r.cierre && !r.ausencia}
                      data-sel={seleccionada}
                      style={r.cierre ? { background: tenue(estiloDiaEmpresa(r.cierre.tipo).fg, 8) } : undefined}
                      onClick={(ev) => (seleccionada ? setAbierta(null) : abrirCelda(ev, persona, dia))}
                      aria-label={`${persona.nombre}, ${dia.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                    >
                      {r.cierre && <InsigniaEmpresa dia={r.cierre} compacta />}
                      {r.ausencia && <InsigniaPersonal dia={r.ausencia} />}
                      {!r.cierre && !r.ausencia && !r.laboralHorario && <span className="ag-equipo-off">{ta('pag_eqNoLabora')}</span>}
                      {/* Dia con horario propio (sabado medio turno): se ve su horario */}
                      {!r.cierre && !r.ausencia && r.laboralHorario && r.horarioDia.propio && (
                        <span className="ag-equipo-off tabular-nums">{ta('pag_eqHorario', { entrada: r.horarioDia.entrada, salida: r.horarioDia.salida })}</span>
                      )}
                      {r.personales.filter((d) => d !== r.ausencia).map((d) => <InsigniaPersonal key={d.id} dia={d} />)}
                      {r.reuniones.length > 0 && (
                        <span className="ag-equipo-chip" data-tipo="reunion" title={r.reuniones.map((e) => e.titulo).join('\n')}>
                          <b>{r.reuniones.length === 1 ? ta('pag_eqReunion') : ta('pag_eqReuniones', { n: r.reuniones.length })}</b>
                          <span>{r.reuniones[0].todoElDia ? '' : `${formatHora(r.reuniones[0].fechaInicio, locale)} `}{r.reuniones[0].titulo}</span>
                        </span>
                      )}
                      {r.otros.length > 0 && (
                        <span className="ag-equipo-chip" data-tipo="evento" title={r.otros.map((e) => e.titulo).join('\n')}>
                          <b>{r.otros.length === 1 ? ta('pag_eqEvento') : ta('pag_eqEventos', { n: r.otros.length })}</b>
                          <span>{r.otros[0].titulo}</span>
                        </span>
                      )}
                      {r.vencen.length > 0 && (
                        <span className="ag-equipo-chip" data-tipo="tarea" title={r.vencen.map((tarea) => tarea.titulo).join('\n')}>
                          <CheckSquare size={11} aria-hidden="true" />
                          <b>{r.vencen.length === 1 ? ta('pag_eqVence') : ta('pag_eqVencen', { n: r.vencen.length })}</b>
                        </span>
                      )}
                      {r.hechas.length > 0 && (
                        <span className="ag-equipo-hechas"><CheckCircle2 size={11} aria-hidden="true" /> {r.hechas.length === 1 ? ta('pag_eqHecha') : ta('pag_eqHechas', { n: r.hechas.length })}</span>
                      )}
                      {libre && !r.eventos.length && !r.vencen.length && !r.hechas.length && <span className="ag-equipo-vacio" aria-hidden="true">·</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {abierta && detalle && (
        <div ref={recuadroRef} className="ag-recuadro" role="dialog" aria-label={abierta.persona.nombre} style={abierta.estilo}>
          <header>
            <UserAvatar usuario={abierta.persona} size={26} radius={999} fontSize="0.65rem" />
            <span className="min-w-0">
              <b>{abierta.persona.nombre}</b>
              <span>
                {abierta.dia.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                {detalle.laboralHorario && ` · ${ta('pag_eqHorario', { entrada: detalle.horarioDia.entrada, salida: detalle.horarioDia.salida })}`}
              </span>
            </span>
            <button type="button" className="dash-icono" onClick={() => setAbierta(null)} aria-label={t('close')}><X size={14} /></button>
          </header>
          {(detalle.empresa.length > 0 || detalle.personales.length > 0) && (
            <div className="ag-recuadro-dias">
              {detalle.empresa.map((d) => <InsigniaEmpresa key={d.id} dia={d} />)}
              {detalle.personales.map((d) => <InsigniaPersonal key={d.id} dia={d} />)}
            </div>
          )}
          {detalle.eventos.length > 0 && (
            <section>
              <h5>{ta('pag_eqEventosDia')}</h5>
              {detalle.eventos.map((e) => (
                <div key={e.id} className="ag-recuadro-fila">
                  <IconoTipo item={e} size={12} />
                  <span className="ag-recuadro-hora">{e.todoElDia ? '—' : formatHora(e.fechaInicio, locale)}</span>
                  <span className="ag-recuadro-texto">{e.titulo}</span>
                  {e.estadoInvitacion === 'pendiente' && <span className="ag-recuadro-nota">{ta('pag_eqPendiente')}</span>}
                </div>
              ))}
            </section>
          )}
          {detalle.vencen.length > 0 && (
            <section>
              <h5>{ta('pag_eqTareasDia')}</h5>
              {detalle.vencen.map((tarea) => (
                <button key={tarea.id} type="button" className="ag-recuadro-fila" onClick={() => tarea.proyecto?.id && navigate(`/proyectos/${tarea.proyecto.id}`)}>
                  <CheckSquare size={12} style={{ color: 'var(--color-accent-green)', flexShrink: 0 }} aria-hidden="true" />
                  <span className="ag-recuadro-texto">{tarea.titulo}</span>
                  {tarea.proyecto?.nombre && <span className="ag-recuadro-nota">{tarea.proyecto.nombre}</span>}
                </button>
              ))}
            </section>
          )}
          {detalle.hechas.length > 0 && (
            <section>
              <h5>{ta('pag_eqHechasDia')}</h5>
              {detalle.hechas.map((tarea) => (
                <button key={tarea.id} type="button" className="ag-recuadro-fila" onClick={() => tarea.proyecto?.id && navigate(`/proyectos/${tarea.proyecto.id}`)}>
                  <CheckCircle2 size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} aria-hidden="true" />
                  <span className="ag-recuadro-texto">{tarea.titulo}</span>
                  {tarea.proyecto?.nombre && <span className="ag-recuadro-nota">{tarea.proyecto.nombre}</span>}
                </button>
              ))}
            </section>
          )}
          {!detalle.eventos.length && !detalle.vencen.length && !detalle.hechas.length && !detalle.empresa.length && !detalle.personales.length && (
            <p className="ag-recuadro-vacio">{detalle.laboralHorario ? ta('pag_eqSinNada') : ta('pag_eqNoLabora')}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default VistaEquipo;
