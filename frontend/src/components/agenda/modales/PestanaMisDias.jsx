import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CalendarX2, CalendarCheck, Clock, Repeat, ChevronDown, X } from 'lucide-react';
import { agendaService } from '../../../services/api';
import { usePreferences } from '../../../context/PreferencesContext';
import { useTextoAgenda } from '../../../hooks/useTextoAgenda';
import { claveDesdeISO, claveDiaLocal, fechaDesdeClave } from '../../../utils/fechasLocales';
import SelectorRangoFechas from '../../SelectorRangoFechas';
import { SelectorRangoHoras } from '../../SelectorHora';
import { aMinutosHora, formatoHora } from '../../../utils/horas';
import Tooltip from '../../Tooltip';
import { Switch } from '../../ui/switch';
import {
  TIPOS_DIA_PERSONAL,
  TIPO_DIA_PERSONAL_ANTIGUO,
  clavesDelRango,
  diaSemanaClave,
  diasSemanaLocale,
  textoDiasSemana,
} from './catalogos';

const tipoDe = (id) => TIPOS_DIA_PERSONAL.find((x) => x.id === id) || (id === 'festivo' ? TIPO_DIA_PERSONAL_ANTIGUO : null);

// El servidor guarda cada dia a mediodia UTC (columna @db.Date): la parte de
// fecha del ISO ya es el dia correcto.
const claveDia = (dia) => (typeof dia?.fecha === 'string' ? claveDesdeISO(dia.fecha) : claveDiaLocal(dia?.fecha));

const DIA_MS = 24 * 60 * 60 * 1000;
const diasEntre = (a, b) => Math.round((fechaDesdeClave(b) - fechaDesdeClave(a)) / DIA_MS);

// Dos dias son de la misma serie si comparten tipo, motivo y horas
const firma = (d) => `${d.tipo}|${d.descripcion || ''}|${d.horaInicio || ''}|${d.horaFin || ''}`;

/**
 * Junta los dias en series: los del mismo tipo, motivo y horas separados por
 * una semana o menos. Asi unas vacaciones seguidas salen como un tramo y un
 * "home office cada lunes y miercoles" como una sola fila, no como veinte.
 */
const agruparEnSeries = (dias) => {
  const ordenados = [...dias].sort((a, b) => claveDia(a).localeCompare(claveDia(b)));
  const series = [];
  const abiertas = new Map();
  ordenados.forEach((dia) => {
    const clave = claveDia(dia);
    const f = firma(dia);
    const serie = abiertas.get(f);
    if (serie && diasEntre(serie.hasta, clave) <= 7) {
      serie.hasta = clave;
      serie.dias.push(dia);
    } else {
      const nueva = { desde: clave, hasta: clave, dias: [dia] };
      series.push(nueva);
      abiertas.set(f, nueva);
    }
  });
  // Seguida = sin huecos (un tramo normal); si no, se describe por dias de la semana
  return series.map((s) => ({ ...s, seguida: s.dias.length === diasEntre(s.desde, s.hasta) + 1 }));
};

/**
 * "Mis dias": ausencias y dias especiales propios (vacaciones, permisos,
 * home office...). Pueden ser del dia completo o de unas horas, y repetirse
 * ciertos dias de la semana dentro de un periodo. El servidor guarda un
 * registro por dia; aqui se muestran juntos los de la misma serie y borrar una
 * serie borra todos sus dias (o se despliega para quitar uno solo).
 */
const PestanaMisDias = ({ showToast, onCambio }) => {
  const { locale } = usePreferences();
  const tx = useTextoAgenda();
  const [dias, setDias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const [nuevo, setNuevo] = useState(() => {
    const hoy = claveDiaLocal();
    return {
      fecha_inicio: hoy,
      fecha_fin: hoy,
      tipo: 'vacacion',
      descripcion: '',
      porHoras: false,
      hora_inicio: '10:00',
      hora_fin: '12:00',
      repetir: false,
      dias_semana: [],
    };
  });
  const semana = useMemo(() => diasSemanaLocale(locale), [locale]);

  useEffect(() => {
    let activo = true;
    // Sin mes ni año el servidor devuelve todos los dias de la persona
    agendaService.listarDiasEspeciales()
      .then((res) => { if (activo) setDias(res.dias || []); })
      .catch((err) => { if (activo) showToast(err.message || tx('mod_errorCargar'), 'error'); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [version, showToast, tx]);

  // Proximas series (de hoy en adelante), agrupadas por mes de inicio
  const meses = useMemo(() => {
    const hoy = claveDiaLocal();
    const grupos = [];
    agruparEnSeries(dias.filter((d) => claveDia(d) >= hoy)).forEach((serie) => {
      const mes = serie.desde.slice(0, 7);
      let grupo = grupos.find((g) => g.mes === mes);
      if (!grupo) {
        grupo = { mes, series: [] };
        grupos.push(grupo);
      }
      grupo.series.push(serie);
    });
    return grupos;
  }, [dias]);

  const fechaCorta = useCallback(
    (clave, conDia = false) => fechaDesdeClave(clave)?.toLocaleDateString(locale, conDia ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }) || clave,
    [locale],
  );
  const textoHoras = useCallback(
    (desde, hasta) => `${formatoHora(desde, locale)} – ${formatoHora(hasta, locale)}`,
    [locale],
  );

  // Dias que se van a marcar con lo elegido (mismo criterio que el servidor)
  const fin = nuevo.fecha_fin || nuevo.fecha_inicio;
  const claves = nuevo.repetir && !nuevo.dias_semana.length
    ? []
    : clavesDelRango(nuevo.fecha_inicio, fin, nuevo.repetir ? nuevo.dias_semana : []);
  const horasValidas = !nuevo.porHoras || (aMinutosHora(nuevo.hora_fin) ?? 0) > (aMinutosHora(nuevo.hora_inicio) ?? 0);

  const vistaPrevia = (() => {
    if (!nuevo.fecha_inicio) return null;
    if (nuevo.repetir && !nuevo.dias_semana.length) return { aviso: true, texto: tx('mod_eligeDiasSemana') };
    if (!claves.length) return { aviso: true, texto: tx('mod_ningunDia') };
    let texto;
    // Un solo dia: se nombra el dia, repita o no
    if (nuevo.repetir && claves.length > 1) {
      texto = tx('mod_previewSemanal', {
        n: claves.length,
        dias: textoDiasSemana(nuevo.dias_semana, locale),
        desde: fechaCorta(nuevo.fecha_inicio),
        hasta: fechaCorta(fin),
      });
    } else if (claves.length === 1) {
      texto = tx('mod_previewUno', { fecha: fechaCorta(claves[0], true) });
    } else {
      texto = tx('mod_previewRango', { n: claves.length, desde: fechaCorta(nuevo.fecha_inicio, true), hasta: fechaCorta(fin, true) });
    }
    if (nuevo.porHoras && horasValidas) {
      texto += tx('mod_previewHoras', { desde: formatoHora(nuevo.hora_inicio, locale), hasta: formatoHora(nuevo.hora_fin, locale) });
    }
    return { aviso: false, texto };
  })();

  const toggleDiaSemana = (id) => setNuevo((prev) => ({
    ...prev,
    dias_semana: prev.dias_semana.includes(id) ? prev.dias_semana.filter((x) => x !== id) : [...prev.dias_semana, id].sort((a, b) => a - b),
  }));

  // Al activar la repeticion se propone el dia de la semana de la fecha inicial
  const cambiarRepetir = (valor) => setNuevo((prev) => ({
    ...prev,
    repetir: valor,
    dias_semana: valor && !prev.dias_semana.length && prev.fecha_inicio ? [diaSemanaClave(prev.fecha_inicio)] : prev.dias_semana,
  }));

  const agregar = async () => {
    if (!nuevo.fecha_inicio) {
      showToast(tx('mod_eligeFechas'), 'error');
      return;
    }
    if (!horasValidas) {
      showToast(tx('mod_horaInvalida'), 'error');
      return;
    }
    if (vistaPrevia?.aviso) {
      showToast(vistaPrevia.texto, 'error');
      return;
    }
    setGuardando(true);
    try {
      const res = await agendaService.crearDiaEspecial({
        fecha_inicio: nuevo.fecha_inicio,
        fecha_fin: fin,
        tipo: nuevo.tipo,
        descripcion: nuevo.descripcion.trim(),
        ...(nuevo.porHoras ? { hora_inicio: nuevo.hora_inicio, hora_fin: nuevo.hora_fin } : {}),
        ...(nuevo.repetir ? { dias_semana: nuevo.dias_semana } : {}),
      });
      const n = Number(res?.creados) || claves.length;
      showToast(n > 1 ? tx('mod_diasAgregadosN', { n }) : tx('mod_diaAgregado'));
      setNuevo((prev) => ({ ...prev, descripcion: '' }));
      recargar();
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const eliminarDias = async (lista, clave) => {
    setEliminando(clave);
    try {
      await Promise.all(lista.map((d) => agendaService.eliminarDiaEspecial(d.id)));
      showToast(tx('mod_diaEliminado'));
      recargar();
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
      recargar();
    } finally {
      setEliminando(null);
    }
  };

  const textoSerie = (serie) => {
    if (!serie.seguida) {
      const ids = [...new Set(serie.dias.map((d) => diaSemanaClave(claveDia(d))))];
      return `${tx('mod_cadaDias', { dias: textoDiasSemana(ids, locale, 'corto') })} · ${fechaCorta(serie.desde)} – ${fechaCorta(serie.hasta)}`;
    }
    const desde = fechaCorta(serie.desde, true);
    return serie.desde === serie.hasta ? desde : `${desde} – ${fechaCorta(serie.hasta, true)}`;
  };

  return (
    <div className="agm-seccion !gap-5">
      <section className="agm-caja agm-seccion" aria-labelledby="agm-misdias-nuevo">
        <h3 id="agm-misdias-nuevo" className="agm-subtitulo">{tx('mod_misDiasNuevo')}</h3>

        <div className="form-group !mb-0">
          <span className="form-label" id="agm-misdias-tipo">{tx('mod_tipoDia')}</span>
          <div className="agm-chips" role="group" aria-labelledby="agm-misdias-tipo">
            {TIPOS_DIA_PERSONAL.map((tipo) => {
              const Icono = tipo.icono;
              return (
                <button
                  key={tipo.id}
                  type="button"
                  className="agm-chip"
                  style={{ '--agm-color': tipo.color }}
                  aria-pressed={nuevo.tipo === tipo.id}
                  onClick={() => setNuevo({ ...nuevo, tipo: tipo.id })}
                >
                  <Icono size={14} className="agm-chip-icono" aria-hidden="true" /> {tx(tipo.textoKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="form-group !mb-0">
            <label className="form-label" htmlFor="agm-misdias-rango">{nuevo.repetir ? tx('mod_periodo') : tx('mod_fechas')}</label>
            <SelectorRangoFechas
              id="agm-misdias-rango"
              plegable
              conLeyenda={false}
              desde={nuevo.fecha_inicio}
              hasta={nuevo.fecha_fin && nuevo.fecha_fin !== nuevo.fecha_inicio ? nuevo.fecha_fin : ''}
              onChange={({ desde, hasta }) => setNuevo((prev) => ({ ...prev, fecha_inicio: desde, fecha_fin: hasta || desde }))}
            />
          </div>
          <div className="form-group !mb-0">
            <span className="form-label" id="agm-misdias-horario">{tx('mod_horario')}</span>
            <div className="agm-segmento agm-segmento-ancho" role="group" aria-labelledby="agm-misdias-horario">
              <button type="button" aria-pressed={!nuevo.porHoras} onClick={() => setNuevo({ ...nuevo, porHoras: false })}>
                <CalendarCheck size={14} aria-hidden="true" /> {tx('mod_todoElDiaCorto')}
              </button>
              <button type="button" aria-pressed={nuevo.porHoras} onClick={() => setNuevo({ ...nuevo, porHoras: true })}>
                <Clock size={14} aria-hidden="true" /> {tx('mod_porHoras')}
              </button>
            </div>
          </div>
        </div>

        {nuevo.porHoras && (
          <div className="form-group !mb-0">
            <SelectorRangoHoras
              id="agm-misdias-horas"
              inicio={nuevo.hora_inicio}
              fin={nuevo.hora_fin}
              onCambio={({ inicio, fin: horaFin }) => setNuevo((prev) => ({ ...prev, hora_inicio: inicio, hora_fin: horaFin }))}
            />
            <p className={horasValidas ? 'agm-ayuda' : 'agm-error'}>{horasValidas ? tx('mod_porHorasAyuda') : tx('mod_horaInvalida')}</p>
          </div>
        )}

        <div className="agm-interruptor-grupo">
          <label className="agm-interruptor">
            <span>
              <span className="agm-interruptor-titulo"><Repeat size={14} /> {tx('mod_repetirSemanal')}</span>
              <span className="agm-ayuda">{tx('mod_repetirSemanalAyuda')}</span>
            </span>
            <Switch checked={nuevo.repetir} onCheckedChange={cambiarRepetir} />
          </label>
          {nuevo.repetir && (
            <div role="group" aria-label={tx('mod_repetirSemanal')} className="agm-dias-semana agm-dias-semana-ancho">
              {semana.map((dia) => (
                <button
                  key={dia.id}
                  type="button"
                  aria-pressed={nuevo.dias_semana.includes(dia.id)}
                  aria-label={dia.nombre}
                  title={dia.nombre}
                  onClick={() => toggleDiaSemana(dia.id)}
                >
                  {dia.inicial}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="form-group !mb-0">
          <label className="form-label" htmlFor="agm-misdias-motivo">
            {tx('mod_motivo')} <span className="text-[12px] font-normal text-[var(--color-text-muted)]">· {tx('mod_opcional')}</span>
          </label>
          <input
            id="agm-misdias-motivo"
            className="form-input"
            placeholder={tx('mod_motivoPlaceholder')}
            value={nuevo.descripcion}
            onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {vistaPrevia && (
            <p className={`agm-nota mr-auto min-w-0 flex-1 ${vistaPrevia.aviso ? 'agm-nota-aviso' : 'agm-nota-info'}`} role="status" aria-live="polite">
              <CalendarCheck size={14} /> <span>{vistaPrevia.texto}</span>
            </p>
          )}
          <button type="button" onClick={agregar} disabled={guardando || !!vistaPrevia?.aviso || !horasValidas} className="btn-primary h-9 shrink-0 !py-0 text-[13.5px]">
            <Plus size={15} /> {guardando ? tx('mod_guardando') : tx('mod_marcarDias')}
          </button>
        </div>
      </section>

      <section aria-labelledby="agm-misdias-lista">
        <h3 id="agm-misdias-lista" className="agm-etiqueta mb-2">{tx('mod_proximosDias')}</h3>
        {cargando ? (
          <p className="agm-vacio">{tx('mod_cargando')}</p>
        ) : meses.length === 0 ? (
          <p className="agm-vacio"><CalendarX2 size={16} aria-hidden="true" /> {tx('mod_sinDiasPropios')}</p>
        ) : (
          <div className="agm-caja overflow-hidden !p-0">
            {meses.map((grupo) => (
              <div key={grupo.mes}>
                <div className="agm-mes">
                  <span>
                    {fechaDesdeClave(`${grupo.mes}-01`)?.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <ul className="agm-lista">
                  {grupo.series.map((serie) => {
                    const primero = serie.dias[0];
                    const tipo = tipoDe(primero.tipo);
                    const Icono = tipo?.icono;
                    const n = serie.dias.length;
                    const clave = `${serie.desde}-${primero.id}`;
                    const desplegada = abierta === clave;
                    return (
                      <li key={clave} className="agm-fila-serie">
                        <div className="agm-fila">
                          <span className="agm-icono-tipo" style={{ '--agm-color': tipo?.color || 'var(--color-text-muted)' }} aria-hidden="true">
                            {Icono && <Icono size={14} />}
                          </span>
                          <span className="agm-fila-texto">
                            <span className="block truncate">{textoSerie(serie)}</span>
                            <span className="agm-ayuda block truncate">
                              {tipo ? tx(tipo.textoKey) : primero.tipo}
                              {primero.horaInicio && primero.horaFin && ` · ${textoHoras(primero.horaInicio, primero.horaFin)}`}
                              {n > 1 && ` · ${tx('mod_nDias', { n })}`}
                              {primero.descripcion && ` · ${primero.descripcion}`}
                            </span>
                          </span>
                          {n > 1 && (
                            <Tooltip label={desplegada ? tx('mod_ocultarDias') : tx('mod_verDias', { n })}>
                              <button
                                type="button"
                                className="agm-icono"
                                aria-expanded={desplegada}
                                aria-label={desplegada ? tx('mod_ocultarDias') : tx('mod_verDias', { n })}
                                onClick={() => setAbierta(desplegada ? null : clave)}
                              >
                                <ChevronDown size={15} className={`transition-transform ${desplegada ? 'rotate-180' : ''}`} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip label={tx('mod_quitar')}>
                            <button
                              type="button"
                              className="agm-icono agm-icono-peligro"
                              onClick={() => eliminarDias(serie.dias, clave)}
                              disabled={eliminando === clave}
                              aria-label={`${tx('mod_quitar')}: ${textoSerie(serie)}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </Tooltip>
                        </div>
                        {/* Dias sueltos de la serie, para quitar solo uno */}
                        {desplegada && (
                          <ul className="agm-dias-serie">
                            {serie.dias.map((d) => (
                              <li key={d.id}>
                                <span>{fechaCorta(claveDia(d), true)}</span>
                                <button
                                  type="button"
                                  onClick={() => eliminarDias([d], d.id)}
                                  disabled={eliminando === d.id}
                                  aria-label={`${tx('mod_quitarDia')}: ${fechaCorta(claveDia(d), true)}`}
                                  title={tx('mod_quitarDia')}
                                >
                                  <X size={12} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PestanaMisDias;
