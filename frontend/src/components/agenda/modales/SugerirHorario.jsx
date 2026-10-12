import { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, ChevronRight } from 'lucide-react';
import { agendaService } from '../../../services/api';
import { usePreferences } from '../../../context/PreferencesContext';
import { useTextoAgenda } from '../../../hooks/useTextoAgenda';
import { claveDiaLocal, fechaDesdeClave } from '../../../utils/fechasLocales';
import { DURACIONES_REUNION, sumarDiasClave } from './catalogos';

const dosDigitos = (n) => String(n).padStart(2, '0');
const horaDe = (iso) => {
  const d = new Date(iso);
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
};

// Minutos entre dos 'HH:mm' del mismo dia; sirve para proponer la duracion que
// ya tiene el evento si coincide con una de las opciones.
const minutosEntre = (inicio, fin) => {
  const [hi, mi] = String(inicio || '').split(':').map(Number);
  const [hf, mf] = String(fin || '').split(':').map(Number);
  if ([hi, mi, hf, mf].some(Number.isNaN)) return null;
  return (hf * 60 + mf) - (hi * 60 + mi);
};

// Dias por consulta. El servidor corta en `max` huecos, asi que con una
// jornada muy libre pueden no llegar los siete: "Ver mas dias" sigue desde el
// ultimo dia que llego.
const DIAS_POR_CONSULTA = 7;
const MAX_HUECOS = 20;

/**
 * "Sugerir horario": huecos libres comunes del organizador y los invitados,
 * dentro de su horario laboral y sin comidas, reuniones, ausencias ni cierres
 * de la empresa (lo calcula el servidor). Al pulsar uno se rellenan la fecha y
 * las horas del evento.
 */
const SugerirHorario = ({
  invitadosIds = [],
  fechaDesde,
  horaInicio,
  horaFin,
  fechaElegida,
  excluirId,
  onElegir,
}) => {
  const { locale } = usePreferences();
  const tx = useTextoAgenda();
  const [duracion, setDuracion] = useState(() => {
    const actual = minutosEntre(horaInicio, horaFin);
    return DURACIONES_REUNION.includes(actual) ? actual : 60;
  });
  // No se consulta hasta que el usuario lo pide: abrir la ventana no debe
  // lanzar una busqueda que quiza no quiere.
  const [pedido, setPedido] = useState(false);
  // Dia desde el que se busca. Se fija al pedir la busqueda: si siguiera a la
  // fecha del evento, elegir un hueco reordenaria la lista bajo el cursor.
  const [base, setBase] = useState(null);
  const [desde, setDesde] = useState(null);
  // Ultima respuesta y la consulta a la que corresponde: mientras no coincida
  // con la consulta actual, se esta cargando.
  const [resultado, setResultado] = useState({ consulta: '', slots: [], participantes: [], error: '' });

  // Nunca antes de hoy: el servidor tambien lo corrige, pero asi el texto cuadra.
  const hoy = claveDiaLocal();
  const desdeBase = fechaDesde && fechaDesde > hoy ? fechaDesde : hoy;
  const desdeConsulta = desde || base || desdeBase;
  const idsClave = [...invitadosIds].sort((a, b) => a - b).join(',');
  const consulta = `${idsClave}|${desdeConsulta}|${duracion}`;
  const estado = { ...resultado, cargando: pedido && resultado.consulta !== consulta };

  useEffect(() => {
    if (!pedido) return undefined;
    let activo = true;
    agendaService.sugerirHorarios({
      usuariosIds: idsClave ? idsClave.split(',').map(Number) : [],
      desde: desdeConsulta,
      dias: DIAS_POR_CONSULTA,
      duracion,
      excluirId,
      max: MAX_HUECOS,
    })
      .then((res) => {
        if (activo) setResultado({ consulta, slots: res.slots || [], participantes: res.participantes || [], error: '' });
      })
      .catch((err) => {
        if (activo) setResultado({ consulta, slots: [], participantes: [], error: err.message || tx('mod_sugerirError') });
      });
    return () => { activo = false; };
  }, [pedido, consulta, idsClave, desdeConsulta, duracion, excluirId, tx]);

  // Agrupados por dia, en el orden en que llegan
  const porDia = useMemo(() => {
    const grupos = [];
    estado.slots.forEach((slot) => {
      let grupo = grupos.find((g) => g.fecha === slot.fecha);
      if (!grupo) {
        grupo = { fecha: slot.fecha, slots: [] };
        grupos.push(grupo);
      }
      grupo.slots.push(slot);
    });
    return grupos;
  }, [estado.slots]);

  const ultimoDia = porDia.length ? porDia[porDia.length - 1].fecha : null;
  const otros = invitadosIds.length;

  const etiquetaDia = (clave) => {
    const fecha = fechaDesdeClave(clave);
    if (!fecha) return clave;
    if (clave === hoy) return tx('mod_hoy');
    if (clave === sumarDiasClave(hoy, 1)) return tx('mod_manana');
    return fecha.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <section className="agm-caja agm-caja-suave agm-seccion" aria-labelledby="agm-sugerir-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id="agm-sugerir-titulo" className="agm-subtitulo">
            <Sparkles size={15} aria-hidden="true" /> {tx('mod_sugerirTitulo')}
          </h3>
          <p className="agm-ayuda">
            {otros > 0 ? tx('mod_sugerirAyudaCon', { n: otros }) : tx('mod_sugerirAyuda')}
          </p>
        </div>
        {!pedido && (
          <button type="button" className="agm-boton agm-boton-primario" onClick={() => { setBase(desdeBase); setPedido(true); }}>
            <Sparkles size={14} aria-hidden="true" /> {tx('mod_sugerirBoton')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="agm-ayuda" id="agm-duracion-label">{tx('mod_duracion')}</span>
        <div className="agm-chips" role="group" aria-labelledby="agm-duracion-label">
          {DURACIONES_REUNION.map((min) => (
            <button
              key={min}
              type="button"
              className="agm-chip agm-chip-sm"
              aria-pressed={duracion === min}
              onClick={() => setDuracion(min)}
            >
              {min < 60 ? tx('mod_minutos', { n: min }) : min === 60 ? tx('mod_unaHora') : tx('mod_horaYMedia')}
            </button>
          ))}
        </div>
      </div>

      {pedido && (
        <div aria-live="polite" className="agm-seccion">
          {estado.cargando ? (
            <p className="agm-ayuda flex items-center gap-2"><RefreshCw size={13} className="animate-spin" aria-hidden="true" /> {tx('mod_buscandoHuecos')}</p>
          ) : estado.error ? (
            <p className="agm-nota agm-nota-peligro">{estado.error}</p>
          ) : porDia.length === 0 ? (
            <p className="agm-nota">{tx('mod_sinHuecos')}</p>
          ) : (
            <div className="agm-slots">
              {porDia.map((grupo) => (
                <div key={grupo.fecha} className="agm-slots-dia">
                  <span className="agm-slots-fecha">{etiquetaDia(grupo.fecha)}</span>
                  <div className="agm-chips">
                    {grupo.slots.map((slot) => {
                      const ini = horaDe(slot.inicio);
                      const fin = horaDe(slot.fin);
                      const elegido = fechaElegida === slot.fecha && horaInicio === ini && horaFin === fin;
                      return (
                        <button
                          key={slot.inicio}
                          type="button"
                          className="agm-slot"
                          aria-pressed={elegido}
                          aria-label={`${etiquetaDia(grupo.fecha)} ${ini}–${fin}`}
                          onClick={() => onElegir?.({ fecha: slot.fecha, horaInicio: ini, horaFin: fin })}
                        >
                          {ini}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!estado.cargando && (
            <div className="flex flex-wrap gap-2">
              {desde && (
                <button type="button" className="agm-boton" onClick={() => setDesde(null)}>
                  {tx('mod_volverInicio')}
                </button>
              )}
              <button
                type="button"
                className="agm-boton"
                onClick={() => setDesde(sumarDiasClave(ultimoDia || sumarDiasClave(desdeConsulta, DIAS_POR_CONSULTA - 1), 1))}
              >
                {tx('mod_masDias')} <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default SugerirHorario;
