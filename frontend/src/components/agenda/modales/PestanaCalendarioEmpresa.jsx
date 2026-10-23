import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CalendarX2, CalendarCheck, Info, Repeat, CalendarSync, Landmark, Infinity as IconoSinFin } from 'lucide-react';
import { agendaService } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { useConfiguracion } from '../../../context/ConfiguracionContext';
import { useTextoAgenda } from '../../../hooks/useTextoAgenda';
import { alcanceDe, areasDelAlcance, puede } from '../../../utils/permisos';
import { claveDiaLocal, fechaDesdeClave } from '../../../utils/fechasLocales';
import SelectorRangoFechas from '../../SelectorRangoFechas';
import Tooltip from '../../Tooltip';
import SelectorSimple from '../../SelectorSimple';
import { Switch } from '../../ui/switch';
import {
  TIPOS_DIA_EMPRESA,
  agruparEnTramos,
  clavesDelRango,
  diaSemanaClave,
  diasSemanaLocale,
  sumarDiasClave,
  textoDiasSemana,
} from './catalogos';

const tipoDe = (id) => TIPOS_DIA_EMPRESA.find((x) => x.id === id) || TIPOS_DIA_EMPRESA[0];

const NUEVO_VACIO = () => {
  const hoy = claveDiaLocal();
  return {
    fechaInicio: hoy, fechaFin: hoy, tipo: 'festivo', nombre: '', descripcion: '', repetirAnual: false, area: '',
    // Repeticion semanal dentro del periodo (1 = lunes); vacia = todos los dias
    repetirSemanal: false, diasSemana: [],
    // Con dias de la semana: todas las semanas sin fecha de fin (lo normal)
    sinFin: true,
  };
};

/**
 * Calendario de la empresa: festivos, dias no laborables, cierres, puentes y
 * dias especiales que aplican a todos (o a un area). Lo editan los
 * administradores; el resto ve los proximos doce meses en solo lectura.
 *
 * Un administrador de area solo puede marcar dias de su area (el servidor lo
 * fuerza); el general elige "Toda la empresa" o un area.
 */
const PestanaCalendarioEmpresa = ({ showToast, onCambio }) => {
  const { locale } = usePreferences();
  const tx = useTextoAgenda();
  const { usuario } = useAuth();
  const { areas, nombreArea } = useConfiguracion();
  // "agenda.diasEmpresa": con alcance "area" solo se marcan días de la propia
  // área; con "todos", de la empresa o de cualquier área.
  const esAdmin = puede(usuario, 'agenda.diasEmpresa');
  const esAdminDeArea = esAdmin && Boolean(usuario?.area) && alcanceDe(usuario, 'agenda.diasEmpresa') !== 'todos';
  // Áreas cuyos días marca y quita un admin de área (con varias, elige una).
  const misAreasDias = esAdminDeArea ? areasDelAlcance(usuario, 'agenda.diasEmpresa') : [];

  const [registros, setRegistros] = useState([]);
  const [proximos, setProximos] = useState([]);
  const [feriadosOficiales, setFeriadosOficiales] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState(null);
  const [nuevo, setNuevo] = useState(NUEVO_VACIO);
  const areaPropia = misAreasDias.includes(nuevo.area) ? nuevo.area : misAreasDias[0];
  const [errorNombre, setErrorNombre] = useState(false);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  // Admin: registros para administrar. Todos: proximos doce meses (incluye los
  // feriados oficiales, marcados con `oficial`).
  useEffect(() => {
    let activo = true;
    const hoy = claveDiaLocal();
    Promise.all([
      esAdmin ? agendaService.registrosDiasEmpresa() : Promise.resolve(null),
      agendaService.diasEmpresa(hoy, sumarDiasClave(hoy, 365)),
    ])
      .then(([resRegistros, resDias]) => {
        if (!activo) return;
        if (resRegistros) {
          setRegistros(resRegistros.registros || []);
          setFeriadosOficiales(resRegistros.feriadosOficiales !== false);
        }
        setProximos(resDias?.dias || []);
      })
      .catch((err) => { if (activo) showToast(err.message || tx('mod_errorCargar'), 'error'); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [esAdmin, version, showToast, tx]);

  // Los dias llegan sueltos: se juntan los seguidos del mismo registro. Los de
  // repeticion semanal ("cada viernes") no son seguidos: van en una fila por mes.
  const proximosPorMes = useMemo(() => {
    const semanales = new Map();
    proximos.filter((d) => d.diasSemana?.length).forEach((d) => {
      const clave = `${d.id}|${d.fecha.slice(0, 7)}`;
      const tramo = semanales.get(clave);
      if (tramo) { tramo.hasta = d.fecha; tramo.dias.push(d); } else semanales.set(clave, { desde: d.fecha, hasta: d.fecha, dias: [d], semanal: true });
    });
    const tramos = [
      ...agruparEnTramos(proximos.filter((d) => !d.diasSemana?.length), (d) => d.fecha, (a, b) => a.id === b.id),
      ...semanales.values(),
    ].sort((a, b) => a.desde.localeCompare(b.desde));
    const grupos = [];
    tramos.forEach((tramo) => {
      const mes = tramo.desde.slice(0, 7);
      let grupo = grupos.find((g) => g.mes === mes);
      if (!grupo) {
        grupo = { mes, tramos: [] };
        grupos.push(grupo);
      }
      grupo.tramos.push(tramo);
    });
    return grupos;
  }, [proximos]);

  const formatoCorto = { day: 'numeric', month: 'short' };
  const textoRango = (desde, hasta, conAnio = true) => {
    const formato = conAnio ? { ...formatoCorto, year: 'numeric' } : formatoCorto;
    const a = fechaDesdeClave(desde)?.toLocaleDateString(locale, formato) || desde;
    if (!hasta || hasta === desde) return a;
    const b = fechaDesdeClave(hasta)?.toLocaleDateString(locale, formato) || hasta;
    return `${a} – ${b}`;
  };
  const semana = useMemo(() => diasSemanaLocale(locale), [locale]);
  // "Cada viernes · 1 nov – 31 dic"
  const textoPatron = (diasSemana, desde, hasta, conAnio = true) =>
    `${tx('mod_cadaDias', { dias: textoDiasSemana(diasSemana, locale) })} · ${textoRango(desde, hasta, conAnio)}`;
  const textoArea = (clave) => (clave ? nombreArea(clave) : tx('mod_todaEmpresa'));

  // Vista previa de la repeticion semanal: cuantos dias caen en el periodo
  const finNuevo = nuevo.fechaFin || nuevo.fechaInicio;
  // Semanal sin fecha de fin: "todas las semanas" desde la fecha de inicio
  const semanalSinFin = nuevo.repetirSemanal && nuevo.sinFin;
  const vistaPrevia = (() => {
    if (!nuevo.repetirSemanal || !nuevo.fechaInicio) return null;
    if (!nuevo.diasSemana.length) return { aviso: true, texto: tx('mod_eligeDiasSemana') };
    if (semanalSinFin) {
      return {
        aviso: false,
        texto: tx('mod_previewSinFin', { dias: textoDiasSemana(nuevo.diasSemana, locale), desde: textoRango(nuevo.fechaInicio, null, true) }),
      };
    }
    const claves = clavesDelRango(nuevo.fechaInicio, finNuevo, nuevo.diasSemana);
    const n = claves.length;
    if (!n) return { aviso: true, texto: tx('mod_ningunDia') };
    if (n === 1) return { aviso: false, texto: tx('mod_previewUno', { fecha: textoRango(claves[0], null, true) }) };
    return {
      aviso: false,
      texto: tx('mod_previewSemanal', {
        n,
        dias: textoDiasSemana(nuevo.diasSemana, locale),
        desde: textoRango(nuevo.fechaInicio, null, false),
        hasta: textoRango(finNuevo, null, true),
      }),
    };
  })();

  const toggleDiaSemana = (id) => setNuevo((prev) => ({
    ...prev,
    diasSemana: prev.diasSemana.includes(id) ? prev.diasSemana.filter((x) => x !== id) : [...prev.diasSemana, id].sort((a, b) => a - b),
  }));

  const agregar = async () => {
    if (nuevo.nombre.trim().length < 2) {
      setErrorNombre(true);
      showToast(tx('mod_empNombreRequerido'), 'error');
      return;
    }
    if (!nuevo.fechaInicio) {
      showToast(tx('mod_eligeFechas'), 'error');
      return;
    }
    if (vistaPrevia?.aviso) {
      showToast(vistaPrevia.texto, 'error');
      return;
    }
    setGuardando(true);
    try {
      await agendaService.crearDiaEmpresa({
        fechaInicio: nuevo.fechaInicio,
        // Sin fin: el servidor lo repite todas las semanas desde el inicio
        fechaFin: semanalSinFin ? undefined : (nuevo.fechaFin || nuevo.fechaInicio),
        tipo: nuevo.tipo,
        nombre: nuevo.nombre.trim(),
        descripcion: nuevo.descripcion.trim() || undefined,
        // "Cada año" no aplica a lo semanal (el servidor lo ignora)
        repetirAnual: nuevo.repetirSemanal ? false : nuevo.repetirAnual,
        ...(nuevo.repetirSemanal ? { diasSemana: nuevo.diasSemana, sinFin: nuevo.sinFin } : {}),
        // Un admin de área solo marca días de sus áreas (el servidor lo revisa)
        area: esAdminDeArea ? areaPropia : (nuevo.area || null),
      });
      showToast(tx('mod_empAgregado'));
      setNuevo((prev) => ({ ...NUEVO_VACIO(), tipo: prev.tipo, area: prev.area }));
      recargar();
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id) => {
    setEliminandoId(id);
    try {
      await agendaService.eliminarDiaEmpresa(id);
      showToast(tx('mod_empEliminado'));
      recargar();
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setEliminandoId(null);
    }
  };

  const listaProximos = (
    <section aria-labelledby="agm-emp-proximos">
      <h3 id="agm-emp-proximos" className="agm-etiqueta mb-2">{tx('mod_empProximos')}</h3>
      {cargando ? (
        <p className="agm-vacio">{tx('mod_cargando')}</p>
      ) : proximosPorMes.length === 0 ? (
        <p className="agm-vacio"><CalendarX2 size={16} aria-hidden="true" /> {tx('mod_empSinProximos')}</p>
      ) : (
        <div className="agm-caja overflow-hidden !p-0">
          {proximosPorMes.map((grupo) => (
            <div key={grupo.mes}>
              <div className="agm-mes">
                <span>
                  {fechaDesdeClave(`${grupo.mes}-01`)?.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                </span>
              </div>
              <ul className="agm-lista">
                {grupo.tramos.map((tramo) => {
                  const dia = tramo.dias[0];
                  const tipo = tipoDe(dia.tipo);
                  const Icono = dia.oficial ? Landmark : tipo.icono;
                  return (
                    <li key={`${dia.id}-${tramo.desde}`} className="agm-fila">
                      <span className="agm-icono-tipo" style={{ '--agm-color': tipo.color }} aria-hidden="true"><Icono size={14} /></span>
                      <span className="agm-fila-texto">
                        <span className="block truncate">{dia.nombre}</span>
                        <span className="agm-ayuda block truncate">
                          {tramo.semanal ? textoPatron(dia.diasSemana, tramo.desde, tramo.hasta, false) : textoRango(tramo.desde, tramo.hasta, false)} · {tx(tipo.textoKey)}
                          {dia.oficial && ` · ${tx('mod_empOficial')}`}
                        </span>
                      </span>
                      {dia.area && <span className="badge-neutral shrink-0">{textoArea(dia.area)}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  // Sin permisos: solo la lista
  if (!esAdmin) {
    return (
      <div className="agm-seccion !gap-4">
        <p className="agm-nota agm-nota-info"><Info size={14} /> {tx('mod_empSoloLectura')}</p>
        {listaProximos}
      </div>
    );
  }

  return (
    <div className="agm-seccion !gap-5">
      <section className="agm-caja agm-seccion" aria-labelledby="agm-emp-nuevo">
        <h3 id="agm-emp-nuevo" className="agm-subtitulo">{tx('mod_empNuevo')}</h3>

        <div className="form-group !mb-0">
          <span className="form-label" id="agm-emp-tipo">{tx('mod_tipoDia')}</span>
          <div className="agm-chips" role="group" aria-labelledby="agm-emp-tipo">
            {TIPOS_DIA_EMPRESA.map((tipo) => {
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
          <p className="agm-ayuda">{tx(`${tipoDe(nuevo.tipo).textoKey}Ayuda`)}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="form-group !mb-0">
            <label className="form-label" htmlFor="agm-emp-nombre">{tx('mod_nombre')}</label>
            <input
              id="agm-emp-nombre"
              className="form-input"
              value={nuevo.nombre}
              maxLength={120}
              aria-invalid={errorNombre}
              placeholder={tx('mod_empNombrePlaceholder')}
              onChange={(e) => { setNuevo({ ...nuevo, nombre: e.target.value }); if (errorNombre) setErrorNombre(false); }}
            />
            {errorNombre && <p className="agm-error">{tx('mod_empNombreRequerido')}</p>}
          </div>
          <div className="form-group !mb-0">
            <label className="form-label" htmlFor="agm-emp-area">{tx('mod_aplicaA')}</label>
            {esAdminDeArea && misAreasDias.length > 1 ? (
              <SelectorSimple
                id="agm-emp-area"
                valor={areaPropia}
                onCambio={(v) => setNuevo({ ...nuevo, area: v })}
                opciones={misAreasDias.map((clave) => ({ valor: clave, etiqueta: nombreArea(clave) }))}
              />
            ) : esAdminDeArea ? (
              <div id="agm-emp-area" className="agm-campo agm-campo-lectura">{nombreArea(areaPropia)}</div>
            ) : (
              <SelectorSimple
                id="agm-emp-area"
                valor={nuevo.area}
                onCambio={(v) => setNuevo({ ...nuevo, area: v })}
                opcionVacia={tx('mod_todaEmpresa')}
                opciones={areas.map((a) => ({ valor: a.clave, etiqueta: nombreArea(a.clave) }))}
              />
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="form-group !mb-0">
            <label className="form-label" htmlFor="agm-emp-rango">{semanalSinFin ? tx('mod_desde') : tx('mod_fechas')}</label>
            <SelectorRangoFechas
              id="agm-emp-rango"
              plegable
              conLeyenda={false}
              desde={nuevo.fechaInicio}
              hasta={!semanalSinFin && nuevo.fechaFin && nuevo.fechaFin !== nuevo.fechaInicio ? nuevo.fechaFin : ''}
              onChange={({ desde, hasta }) => setNuevo((prev) => {
                if (!semanalSinFin) return { ...prev, fechaInicio: desde, fechaFin: hasta || desde };
                // Sin fin solo cuenta el inicio: el calendario es de rango, asi
                // que el dia nuevo es el que no coincide con el inicio actual
                const elegido = [desde, hasta].find((c) => c && c !== prev.fechaInicio) || desde || prev.fechaInicio;
                return { ...prev, fechaInicio: elegido, fechaFin: elegido };
              })}
            />
          </div>
          <div className="form-group !mb-0">
            <label className="form-label" htmlFor="agm-emp-descripcion">
              {tx('mod_nota')} <span className="text-[12px] font-normal text-[var(--color-text-muted)]">· {tx('mod_opcional')}</span>
            </label>
            <input
              id="agm-emp-descripcion"
              className="form-input"
              value={nuevo.descripcion}
              placeholder={tx('mod_empNotaPlaceholder')}
              onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
            />
          </div>
        </div>

        {/* "Cada año" no aplica a la repeticion semanal */}
        {!nuevo.repetirSemanal && (
          <label className="agm-interruptor">
            <span>
              <span className="agm-interruptor-titulo flex items-center gap-1.5"><Repeat size={14} /> {tx('mod_repetirAnual')}</span>
              <span className="agm-ayuda">{tx('mod_repetirAnualAyuda')}</span>
            </span>
            <Switch checked={nuevo.repetirAnual} onCheckedChange={(valor) => setNuevo((prev) => ({ ...prev, repetirAnual: valor }))} />
          </label>
        )}

        <div className="agm-interruptor-grupo">
          <label className="agm-interruptor">
            <span>
              <span className="agm-interruptor-titulo flex items-center gap-1.5"><CalendarSync size={14} /> {tx('mod_repetirSemanal')}</span>
              <span className="agm-ayuda">{tx('mod_empSemanalElige')}</span>
            </span>
            <Switch
              checked={nuevo.repetirSemanal}
              onCheckedChange={(valor) => setNuevo((prev) => ({
                ...prev,
                repetirSemanal: valor,
                // Se propone el dia de la semana de la fecha inicial
                diasSemana: valor && !prev.diasSemana.length && prev.fechaInicio ? [diaSemanaClave(prev.fechaInicio)] : prev.diasSemana,
              }))}
            />
          </label>
          {nuevo.repetirSemanal && (
            <div role="group" aria-label={tx('mod_repetirSemanal')} className="agm-dias-semana agm-dias-semana-ancho">
              {semana.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={nuevo.diasSemana.includes(d.id)}
                  aria-label={d.nombre}
                  title={d.nombre}
                  onClick={() => toggleDiaSemana(d.id)}
                >
                  {d.inicial}
                </button>
              ))}
            </div>
          )}
          {nuevo.repetirSemanal && (
            <label className="agm-interruptor">
              <span>
                <span className="agm-interruptor-titulo flex items-center gap-1.5"><IconoSinFin size={14} /> {tx('mod_empSinFin')}</span>
                <span className="agm-ayuda">{nuevo.sinFin ? tx('mod_empSinFinAyuda') : tx('mod_empSemanalAyuda')}</span>
              </span>
              <Switch checked={nuevo.sinFin} onCheckedChange={(valor) => setNuevo((prev) => ({ ...prev, sinFin: valor }))} />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {vistaPrevia && (
            <p className={`agm-nota mr-auto min-w-0 flex-1 ${vistaPrevia.aviso ? 'agm-nota-aviso' : 'agm-nota-info'}`} role="status" aria-live="polite">
              <CalendarCheck size={14} /> <span>{vistaPrevia.texto}</span>
            </p>
          )}
          <button type="button" onClick={agregar} disabled={guardando || !!vistaPrevia?.aviso} className="btn-primary h-9 shrink-0 !py-0 text-[13.5px]">
            <Plus size={15} /> {guardando ? tx('mod_guardando') : tx('mod_empAgregar')}
          </button>
        </div>
      </section>

      <p className="agm-nota agm-nota-info">
        <Landmark size={14} />
        <span>{feriadosOficiales ? tx('mod_empOficialesSi') : tx('mod_empOficialesNo')}</span>
      </p>

      <section aria-labelledby="agm-emp-registrados">
        <h3 id="agm-emp-registrados" className="agm-etiqueta mb-2">{tx('mod_empRegistrados', { n: registros.length })}</h3>
        {cargando ? (
          <p className="agm-vacio">{tx('mod_cargando')}</p>
        ) : registros.length === 0 ? (
          <p className="agm-vacio"><CalendarX2 size={16} aria-hidden="true" /> {tx('mod_empSinRegistros')}</p>
        ) : (
          <div className="agm-caja !p-0">
            <ul className="agm-lista">
              {registros.map((r) => {
                const tipo = tipoDe(r.tipo);
                const Icono = tipo.icono;
                // Un admin de area solo puede quitar los de sus areas
                const puedeQuitar = !esAdminDeArea || misAreasDias.includes(r.area);
                return (
                  <li key={r.id} className="agm-fila">
                    <span className="agm-icono-tipo" style={{ '--agm-color': tipo.color }} aria-hidden="true"><Icono size={14} /></span>
                    <span className="agm-fila-texto">
                      <span className="block truncate">{r.nombre}</span>
                      <span className="agm-ayuda block truncate">
                        {Array.isArray(r.diasSemana) && r.diasSemana.length
                          ? (r.sinFin || !r.fechaFin
                            // "Cada martes y sábado · desde 13 oct" (año solo si no es el actual)
                            ? tx('mod_cadaDiasDesde', {
                              dias: textoDiasSemana(r.diasSemana, locale),
                              desde: textoRango(r.fechaInicio, null, String(r.fechaInicio).slice(0, 4) !== claveDiaLocal().slice(0, 4)),
                            })
                            : textoPatron(r.diasSemana, r.fechaInicio, r.fechaFin, !r.repetirAnual))
                          : textoRango(r.fechaInicio, r.fechaFin, !r.repetirAnual)} · {tx(tipo.textoKey)}
                        {r.repetirAnual && ` · ${tx('mod_cadaAnio')}`}
                      </span>
                    </span>
                    <span className="badge-neutral shrink-0">{textoArea(r.area)}</span>
                    {puedeQuitar && (
                      <Tooltip label={tx('mod_quitar')}>
                        <button
                          type="button"
                          className="agm-icono agm-icono-peligro"
                          onClick={() => eliminar(r.id)}
                          disabled={eliminandoId === r.id}
                          aria-label={`${tx('mod_quitar')}: ${r.nombre}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {listaProximos}
    </div>
  );
};

export default PestanaCalendarioEmpresa;
