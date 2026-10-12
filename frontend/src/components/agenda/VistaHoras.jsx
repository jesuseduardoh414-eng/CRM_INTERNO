/**
 * Rejilla de horas para la semana (7 columnas) y el día (1 columna): franja
 * "Todo el día" con proyectos, eventos de día completo y tareas; horas del
 * horario laboral (ampliadas si un evento cae fuera), la comida rayada, las
 * horas fuera de horario tenues y una línea con la hora actual.
 * Pulsar un hueco crea un evento a esa hora; pulsar un bloque lo abre.
 */
import { useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import { IconoTipo, InsigniaEmpresa, InsigniaPersonal } from './ElementosAgenda';
import {
  colorBloque,
  colorTipo,
  estiloDiaEmpresa,
  fechaConHora,
  formatHora,
  getDateKey,
  getRangoHorasVisible,
  getTipoAgenda,
  horarioLaboralDeFecha,
  itemAgendaOcurreEnFecha,
  ordenarItemsDia,
  propsClicable,
  repartirSolapes,
  tenue,
  tituloLimpio,
} from './agendaComun';

const MAX_TODO_EL_DIA = 3;

/** Hora actual en horas decimales; se refresca cada minuto para mover la línea. */
const useAhora = () => {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);
  return ahora;
};

const VistaHoras = ({
  dias,
  items,
  configLaboral,
  estadoDe,
  esLaborable,
  mostrarDias = true,
  currentUserId,
  onAbrir,
  onNuevo,
  onVerDia,
}) => {
  const { t, locale } = usePreferences();
  const ta = useTextoAgenda();
  const ahora = useAhora();
  const unDia = dias.length === 1;
  const HORA_PX = unDia ? 56 : 46;

  const { inicio, finExclusivo } = getRangoHorasVisible(configLaboral, items, dias);
  const horas = Array.from({ length: finExclusivo - inicio }, (_, i) => inicio + i);
  const altoTotal = horas.length * HORA_PX;
  const aPx = (hora) => (Math.min(Math.max(hora, inicio), finExclusivo) - inicio) * HORA_PX;

  const hoyKey = getDateKey(ahora);
  const horaAhora = ahora.getHours() + ahora.getMinutes() / 60;
  const plantillaColumnas = { gridTemplateColumns: `3.5rem repeat(${dias.length}, minmax(0, 1fr))` };

  const porDia = dias.map((dia) => {
    const delDia = ordenarItemsDia(items.filter((item) => itemAgendaOcurreEnFecha(item, dia, esLaborable)));
    const franja = delDia.filter((item) => item.todoElDia || item.tipo === 'tarea' || getTipoAgenda(item) === 'proyecto');
    const clave = getDateKey(dia);
    const bloques = repartirSolapes(delDia
      .filter((item) => !item.todoElDia && item.tipo !== 'tarea' && getTipoAgenda(item) !== 'proyecto')
      .map((item) => {
        const start = new Date(item.fechaInicio);
        const end = item.fechaFin ? new Date(item.fechaFin) : new Date(start.getTime() + 3600000);
        const ini = getDateKey(start) === clave ? start.getHours() + start.getMinutes() / 60 : inicio;
        const fin = getDateKey(end) === clave ? end.getHours() + end.getMinutes() / 60 : finExclusivo;
        return { item, start, end, inicio: Math.max(ini, inicio), fin: Math.max(Math.min(fin, finExclusivo), Math.max(ini, inicio) + 0.25) };
      })
      .filter((bloque) => bloque.inicio < finExclusivo));
    // Horario de ese dia: un sabado de medio turno sombrea desde su salida
    return { dia, clave, franja, bloques, estado: estadoDe(dia), horario: horarioLaboralDeFecha(configLaboral, dia) };
  });

  return (
    <div className="ag-horas" data-un-dia={unDia}>
      {/* Cabecera de días */}
      <div className="ag-horas-fila ag-horas-cab" style={plantillaColumnas}>
        <div />
        {porDia.map(({ dia, clave, estado }) => {
          const cierre = mostrarDias ? estado.cierreEmpresa : null;
          return (
            <button
              key={clave}
              type="button"
              className="ag-horas-dia"
              data-hoy={clave === hoyKey}
              data-nolaboral={!estado.esLaboral}
              onClick={() => onVerDia?.(dia)}
              disabled={!onVerDia}
              style={cierre ? { background: tenue(estiloDiaEmpresa(cierre.tipo).fg, 7) } : undefined}
            >
              <span className="ag-horas-dia-nombre">{dia.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')}</span>
              <span className="ag-horas-dia-num">{dia.getDate()}</span>
              {mostrarDias && (estado.empresa.length > 0 || estado.personal.length > 0) && (
                <span className="ag-horas-dia-marcas">
                  {estado.empresa.slice(0, 1).map((d) => <InsigniaEmpresa key={d.id} dia={d} compacta />)}
                  {estado.personal.slice(0, 2).map((d) => <InsigniaPersonal key={d.id} dia={d} soloIcono={!unDia} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Franja "Todo el día" */}
      <div className="ag-horas-fila ag-horas-franja" style={plantillaColumnas}>
        <div className="ag-horas-gutter-texto">{t('agendaAllDay')}</div>
        {porDia.map(({ dia, clave, franja }) => {
          const visibles = unDia ? franja : franja.slice(0, MAX_TODO_EL_DIA);
          const ocultos = franja.length - visibles.length;
          return (
            <div key={clave} className="ag-horas-franja-dia">
              {visibles.map((item) => (
                <div
                  key={`${item.id}-${item.fechaInicio}`}
                  className="ag-chip-dia"
                  data-tipo={getTipoAgenda(item)}
                  style={{ '--ag-color': colorTipo(item) }}
                  title={tituloLimpio(item)}
                  {...propsClicable(() => onAbrir(item))}
                >
                  <IconoTipo item={item} size={11} />
                  <span>{tituloLimpio(item)}</span>
                </div>
              ))}
              {ocultos > 0 && (
                <button type="button" className="ag-mes-mas" onClick={() => onVerDia?.(dia)}>{ta('pag_mas', { n: ocultos })}</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Rejilla de horas */}
      <div className="ag-horas-scroll">
        <div className="ag-horas-fila" style={{ ...plantillaColumnas, height: altoTotal }}>
          <div className="ag-horas-gutter">
            {horas.map((hora) => (
              <span key={hora} style={{ top: (hora - inicio) * HORA_PX }}>{`${String(hora).padStart(2, '0')}:00`}</span>
            ))}
          </div>

          {porDia.map(({ dia, clave, bloques, estado, horario: { entrada, salida, comidaInicio, comidaFin, hayComida } }) => (
            <div key={clave} className="ag-horas-col" data-nolaboral={!estado.esLaboral}>
              {/* Huecos de una hora: al pulsar se crea un evento a esa hora */}
              {horas.map((hora) => (
                <button
                  key={hora}
                  type="button"
                  className="ag-horas-hueco"
                  style={{ height: HORA_PX }}
                  aria-label={`${dia.toLocaleDateString(locale, { weekday: 'long', day: 'numeric' })} ${String(hora).padStart(2, '0')}:00`}
                  onClick={() => onNuevo({ fechaInicio: fechaConHora(dia, hora) })}
                />
              ))}

              {estado.esLaboral && entrada > inicio && <div className="ag-horas-fuera" style={{ top: 0, height: aPx(entrada) }} />}
              {estado.esLaboral && salida < finExclusivo && <div className="ag-horas-fuera" style={{ top: aPx(salida), height: altoTotal - aPx(salida) }} />}
              {estado.esLaboral && hayComida && comidaFin > inicio && comidaInicio < finExclusivo && (
                <div className="ag-horas-comida" style={{ top: aPx(comidaInicio), height: aPx(comidaFin) - aPx(comidaInicio) }} title={ta('pag_leyComida')} />
              )}

              {bloques.map(({ item, start, end, inicio: hIni, fin: hFin, columna, columnas }) => {
                const alto = Math.max((hFin - hIni) * HORA_PX, 20);
                const ajeno = item.usuarioId && currentUserId && item.usuarioId !== currentUserId;
                return (
                  <div
                    key={`${item.id}-${item.fechaInicio}`}
                    className="ag-bloque"
                    data-tipo={getTipoAgenda(item)}
                    data-ajeno={!!ajeno}
                    data-corto={alto < 36}
                    style={{
                      '--ag-color': colorBloque(item),
                      top: (hIni - inicio) * HORA_PX,
                      height: alto,
                      left: `calc(${(columna / columnas) * 100}% + 2px)`,
                      width: `calc(${100 / columnas}% - 4px)`,
                    }}
                    title={`${formatHora(start, locale)}–${formatHora(end, locale)} ${item.titulo}`}
                    {...propsClicable(() => onAbrir(item))}
                  >
                    <span className="ag-bloque-titulo">
                      <IconoTipo item={item} size={11} color="currentColor" />
                      {item.esOcurrencia && <Repeat size={10} aria-hidden="true" />}
                      <span>{item.titulo}</span>
                    </span>
                    {alto >= 36 && <span className="ag-bloque-hora">{formatHora(start, locale)}–{formatHora(end, locale)}</span>}
                    {unDia && alto >= 56 && item.ubicacion && <span className="ag-bloque-hora">{item.ubicacion}</span>}
                  </div>
                );
              })}

              {clave === hoyKey && horaAhora >= inicio && horaAhora <= finExclusivo && (
                <div className="ag-ahora" style={{ top: (horaAhora - inicio) * HORA_PX }} aria-label={ta('pag_ahora')} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VistaHoras;
