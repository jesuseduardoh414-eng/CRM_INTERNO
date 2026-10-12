/**
 * Horario laboral de la semana: un horario general (jornada y comida) y una
 * fila por dia (lunes a domingo) con su interruptor de laborable. Un dia puede
 * tener horario propio (p. ej. el sabado de 09:00 a 14:00 sin comida); los
 * demas siguen al general. "Aplicar a todos" quita los horarios propios.
 *
 * Lo usan "Mi horario" (ajustes de la agenda) y el horario por defecto de la
 * empresa en /configuracion. Trabaja con la forma camelCase de la
 * configuracion: { diasLaborales, horaEntrada, horaSalida, horaComidaInicio,
 * horaComidaFin, horariosPorDia } y devuelve `horariosPorDia` ya limpio
 * (solo los dias laborales que difieren del general; ver utils/horarioSemana).
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Coffee, Pencil, RotateCcw, CopyCheck } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import { useTextoAgenda } from '../hooks/useTextoAgenda';
import { formatoHora, aMinutosHora } from '../utils/horas';
import { DIAS_SEMANA_IDS, horarioDelDia, horarioGeneral, limpiarHorariosPorDia } from '../utils/horarioSemana';
import { diasSemanaLocale } from './agenda/modales/catalogos';
import { SelectorRangoHoras } from './SelectorHora';
import { Switch } from './ui/switch';
import { Checkbox } from './ui/checkbox';
import Tooltip from './Tooltip';

/** La comida cae fuera de la jornada (o al reves). */
const comidaFuera = ({ entrada, salida, comidaInicio, comidaFin }) => {
  if (!comidaInicio || !comidaFin) return false;
  const [e, s, ci, cf] = [entrada, salida, comidaInicio, comidaFin].map(aMinutosHora);
  if ([e, s, ci, cf].includes(null)) return false;
  return ci < e || cf > s;
};

const EditorHorarioSemana = ({
  valor,
  onCambio,
  idBase = 'hs',
  // Sin al menos un dia laboral la agenda no tiene con que trabajar
  minimoUnDia = true,
}) => {
  const { locale } = usePreferences();
  const tx = useTextoAgenda();
  const semana = useMemo(() => diasSemanaLocale(locale), [locale]);
  // Dia con el editor abierto (uno a la vez, para que la lista quede compacta)
  const [abierto, setAbierto] = useState(null);

  const general = horarioGeneral(valor);
  const laborales = (valor.diasLaborales || []).map(Number);
  const hayPropios = Object.keys(limpiarHorariosPorDia(valor)).length > 0;

  // Todo cambio pasa por aqui para devolver horariosPorDia limpio
  const emitir = (parcial) => {
    const siguiente = { ...valor, ...parcial };
    onCambio({ ...siguiente, horariosPorDia: limpiarHorariosPorDia(siguiente) });
  };

  const alternarDia = (dia) => {
    const activo = laborales.includes(dia);
    const nuevos = activo ? laborales.filter((x) => x !== dia) : [...laborales, dia].sort((a, b) => a - b);
    if (minimoUnDia && !nuevos.length) return;
    if (activo && abierto === dia) setAbierto(null);
    emitir({ diasLaborales: nuevos });
  };

  const cambiarDia = (dia, cambios) => {
    const { entrada, salida, comidaInicio, comidaFin } = horarioDelDia(valor, dia);
    emitir({ horariosPorDia: { ...(valor.horariosPorDia || {}), [String(dia)]: { entrada, salida, comidaInicio, comidaFin, ...cambios } } });
  };

  const usarGeneral = (dia) => {
    const resto = { ...(valor.horariosPorDia || {}) };
    delete resto[String(dia)];
    emitir({ horariosPorDia: resto });
  };

  const aplicarATodos = () => {
    setAbierto(null);
    emitir({ horariosPorDia: {} });
  };

  const rango = (ini, fin) => `${formatoHora(ini, locale)} – ${formatoHora(fin, locale)}`;
  const resumen = (h) => [
    rango(h.entrada, h.salida),
    h.comidaInicio && h.comidaFin ? tx('hs_comidaResumen', { rango: rango(h.comidaInicio, h.comidaFin) }) : tx('hs_sinComida'),
  ].join(' · ');

  return (
    <div className="hs-editor">
      {/* Horario general */}
      <div className="agm-caja agm-seccion">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="agm-subtitulo"><Clock size={14} aria-hidden="true" /> {tx('hs_general')}</span>
          {hayPropios && (
            <button type="button" className="agm-enlace" onClick={aplicarATodos}>
              <CopyCheck size={14} aria-hidden="true" /> {tx('hs_aplicarTodos')}
            </button>
          )}
        </div>
        <p className="agm-ayuda -mt-1">{hayPropios ? tx('hs_generalAyudaPropios') : tx('hs_generalAyuda')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="agm-ayuda flex items-center gap-1"><Clock size={12} aria-hidden="true" /> {tx('mod_jornada')}</span>
            <SelectorRangoHoras
              id={`${idBase}-jornada`}
              inicio={general.entrada}
              fin={general.salida}
              etiquetaInicio={tx('hs_entrada')}
              etiquetaFin={tx('hs_salida')}
              onCambio={({ inicio, fin }) => emitir({ horaEntrada: inicio, horaSalida: fin })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="agm-ayuda flex items-center gap-1"><Coffee size={12} aria-hidden="true" /> {tx('hs_comida')}</span>
            <SelectorRangoHoras
              id={`${idBase}-comida`}
              inicio={general.comidaInicio}
              fin={general.comidaFin}
              etiquetaInicio={tx('hs_comidaDesde')}
              etiquetaFin={tx('hs_comidaHasta')}
              onCambio={({ inicio, fin }) => emitir({ horaComidaInicio: inicio, horaComidaFin: fin })}
            />
          </div>
        </div>
        {comidaFuera(general) && (
          <p className="agm-nota agm-nota-aviso" role="status"><AlertTriangle size={14} /> {tx('hs_comidaFuera')}</p>
        )}
      </div>

      {/* Dia por dia */}
      <div className="agm-caja !p-0">
        <ul className="agm-lista" aria-label={tx('hs_porDia')}>
          {DIAS_SEMANA_IDS.map((dia) => {
            const nombre = semana[dia - 1]?.nombre || String(dia);
            const h = horarioDelDia(valor, dia);
            const editando = h.laboral && abierto === dia;
            const conComida = Boolean(h.comidaInicio && h.comidaFin);
            const idDia = `${idBase}-dia-${dia}`;
            return (
              <li key={dia} className="hs-dia" data-laboral={h.laboral}>
                <div className="hs-dia-fila">
                  <Switch
                    checked={h.laboral}
                    onCheckedChange={() => alternarDia(dia)}
                    disabled={minimoUnDia && h.laboral && laborales.length === 1}
                    aria-label={tx('hs_diaLaboral', { dia: nombre })}
                    className="hs-switch"
                  />
                  <span className="hs-dia-nombre">{nombre}</span>
                  <span className="hs-dia-resumen">
                    {h.laboral ? resumen(h) : tx('hs_noLaboral')}
                  </span>
                  {h.laboral && h.propio && <span className="badge-neutral hidden shrink-0 sm:inline-flex">{tx('hs_distinto')}</span>}
                  {h.laboral && h.propio && (
                    <Tooltip label={tx('hs_usarGeneral')}>
                      <button type="button" className="agm-icono" onClick={() => usarGeneral(dia)} aria-label={`${tx('hs_usarGeneral')}: ${nombre}`}>
                        <RotateCcw size={14} />
                      </button>
                    </Tooltip>
                  )}
                  {h.laboral && (
                    <Tooltip label={tx('hs_editar')}>
                      <button
                        type="button"
                        className="agm-icono"
                        aria-expanded={editando}
                        aria-controls={`${idDia}-editor`}
                        aria-label={`${tx('hs_editar')}: ${nombre}`}
                        onClick={() => setAbierto(editando ? null : dia)}
                        data-activo={editando || undefined}
                      >
                        <Pencil size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>

                {editando && (
                  <div id={`${idDia}-editor`} className="hs-dia-editor">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="agm-ayuda">{tx('mod_jornada')}</span>
                      <SelectorRangoHoras
                        id={`${idDia}-jornada`}
                        inicio={h.entrada}
                        fin={h.salida}
                        etiquetaInicio={tx('hs_entrada')}
                        etiquetaFin={tx('hs_salida')}
                        onCambio={({ inicio, fin }) => cambiarDia(dia, { entrada: inicio, salida: fin })}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <label className="agm-ayuda flex cursor-pointer items-center gap-1.5" htmlFor={`${idDia}-con-comida`}>
                        <Checkbox
                          id={`${idDia}-con-comida`}
                          checked={conComida}
                          onCheckedChange={(marcado) => cambiarDia(dia, marcado
                            ? { comidaInicio: general.comidaInicio, comidaFin: general.comidaFin }
                            : { comidaInicio: null, comidaFin: null })}
                        />
                        {tx('hs_conComida')}
                      </label>
                      {conComida ? (
                        <SelectorRangoHoras
                          id={`${idDia}-comida`}
                          inicio={h.comidaInicio}
                          fin={h.comidaFin}
                          etiquetaInicio={tx('hs_comidaDesde')}
                          etiquetaFin={tx('hs_comidaHasta')}
                          onCambio={({ inicio, fin }) => cambiarDia(dia, { comidaInicio: inicio, comidaFin: fin })}
                        />
                      ) : (
                        <span className="hs-sin-comida">{tx('hs_sinComidaLargo')}</span>
                      )}
                    </div>
                    {comidaFuera(h) && (
                      <p className="agm-nota agm-nota-aviso sm:col-span-2" role="status"><AlertTriangle size={14} /> {tx('hs_comidaFuera')}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default EditorHorarioSemana;
