/**
 * Vista de mes: rejilla compacta de semanas (lunes a domingo) con el detalle
 * real de cada día: hasta tres elementos como filas pequeñas, los proyectos
 * como barras continuas, los días de la empresa como etiqueta de color y los
 * días personales como marca. Pulsar un día abre su panel; doble clic (o el
 * "+" al pasar el ratón) crea un evento ese día. Los eventos sueltos y las
 * tareas se pueden arrastrar a otro día.
 * En el móvil la celda solo enseña el número y puntos de color: tocarla abre el
 * panel del día, que tiene la lista completa y el botón para crear ahí.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import { IconoTipo, InsigniaEmpresa, ItemDiaMes } from './ElementosAgenda';
import {
  COLORES_TIPO,
  clavesItem,
  colorBloque,
  colorTipo,
  diasDesde,
  esEventoRecurrente,
  estiloDiaEmpresa,
  estiloDiaPersonal,
  formatHora,
  formatHoraCorta,
  getDateKey,
  getDayDiff,
  getDiasSemana,
  getTipoAgenda,
  inicioDeSemana,
  itemAgendaOcurreEnFecha,
  ordenarItemsDia,
  propsClicable,
  sumarDias,
  tenue,
  tituloLimpio,
} from './agendaComun';

const MAX_CARRILES = 2;

/** Proyectos activos en la semana, cada uno en un carril fijo para que la barra sea continua. */
const carrilesDeSemana = (proyectos, dias) => {
  const k0 = getDateKey(dias[0]);
  const k6 = getDateKey(dias[6]);
  const activos = proyectos
    .map((proyecto) => ({ proyecto, ...clavesItem(proyecto) }))
    .filter(({ inicio, fin }) => inicio <= k6 && fin >= k0)
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || b.fin.localeCompare(a.fin));
  const finesCarril = [];
  activos.forEach((entrada) => {
    let carril = finesCarril.findIndex((fin) => fin < entrada.inicio);
    if (carril === -1) { carril = finesCarril.length; finesCarril.push(entrada.fin); } else finesCarril[carril] = entrada.fin;
    entrada.carril = carril;
  });
  return { activos, carriles: Math.min(finesCarril.length, MAX_CARRILES) };
};

const VistaMes = ({
  fecha,
  items,
  estadoDe,
  esLaborable,
  mostrarDias = true,
  diaSeleccionado,
  onSeleccionarDia,
  onNuevo,
  onAbrir,
  onMoverItem,
}) => {
  const { locale } = usePreferences();
  const ta = useTextoAgenda();
  const [arrastre, setArrastre] = useState(null);
  const [destino, setDestino] = useState(null);

  const mes = fecha.getMonth();
  const primero = new Date(fecha.getFullYear(), mes, 1, 12);
  const ultimo = new Date(fecha.getFullYear(), mes + 1, 0, 12);
  const inicio = inicioDeSemana(primero);
  const nSemanas = Math.ceil((getDayDiff(inicio, ultimo) + 1) / 7);
  const semanas = Array.from({ length: nSemanas }, (_, s) => diasDesde(sumarDias(inicio, s * 7), 7));
  const nombresDias = getDiasSemana(locale, 'short');
  const hoyKey = getDateKey(new Date());

  const proyectos = items.filter((item) => getTipoAgenda(item) === 'proyecto');
  const resto = items.filter((item) => getTipoAgenda(item) !== 'proyecto');

  const soltar = (ev, dia) => {
    if (!arrastre) return;
    ev.preventDefault();
    const dias = getDayDiff(arrastre.origen, dia);
    const item = arrastre.item;
    setArrastre(null);
    setDestino(null);
    if (dias) onMoverItem(item, dias);
  };

  return (
    <div className="ag-mes" role="grid" aria-label={fecha.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}>
      <div className="ag-mes-cabecera" role="row">
        {nombresDias.map((nombre, i) => (
          <div key={nombre} role="columnheader" data-finde={i >= 5}>{nombre.replace('.', '')}</div>
        ))}
      </div>

      {semanas.map((dias) => {
        const { activos, carriles } = carrilesDeSemana(proyectos, dias);
        const maxFilas = carriles >= 2 ? 2 : 3;

        return (
          <div key={getDateKey(dias[0])} className="ag-mes-semana" role="row">
            {dias.map((dia, col) => {
              const clave = getDateKey(dia);
              const estado = estadoDe(dia);
              const fuera = dia.getMonth() !== mes;
              const delDia = ordenarItemsDia(resto.filter((item) => itemAgendaOcurreEnFecha(item, dia, esLaborable)));
              const visibles = delDia.slice(0, maxFilas);
              const proyectosDia = activos.filter(({ inicio: i0, fin }) => clave >= i0 && clave <= fin);
              const proyectosOcultos = proyectosDia.filter(({ carril }) => carril >= MAX_CARRILES).length;
              const ocultos = delDia.length - visibles.length + proyectosOcultos;
              const cierre = mostrarDias ? estado.cierreEmpresa : null;
              const fechaLarga = dia.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
              // Móvil: en vez de renglones diminutos, puntos de color (hasta
              // tres) y "+n" con el resto. Días personales, proyectos y elementos.
              const colores = [
                ...(mostrarDias ? estado.personal.map((d) => estiloDiaPersonal(d.tipo).fg) : []),
                ...proyectosDia.map(() => COLORES_TIPO.proyecto),
                ...delDia.map(colorTipo),
              ];

              return (
                // La celda entera responde al ratón y al dedo (tocar en
                // cualquier parte abre el día). Para el teclado y los lectores
                // de pantalla el control es el número: así la celda no es un
                // botón que contiene otros botones.
                <div
                  key={clave}
                  role="gridcell"
                  className="ag-mes-celda"
                  data-fuera={fuera}
                  data-hoy={clave === hoyKey}
                  data-sel={clave === diaSeleccionado}
                  data-nolaboral={!estado.laboralPorHorario || !!estado.ausente}
                  data-destino={destino === clave}
                  aria-selected={clave === diaSeleccionado}
                  style={cierre ? { background: tenue(estiloDiaEmpresa(cierre.tipo).fg, 7) } : undefined}
                  onClick={() => onSeleccionarDia(clave)}
                  // Con el dedo no: dos toques seguidos para elegir el día
                  // abrían "nuevo evento" (en táctil se crea desde el panel).
                  onDoubleClick={() => { if (!window.matchMedia?.('(hover: none)').matches) onNuevo(dia); }}
                  onDragOver={(ev) => {
                    if (!arrastre) return;
                    ev.preventDefault();
                    if (destino !== clave) setDestino(clave);
                  }}
                  onDrop={(ev) => soltar(ev, dia)}
                >
                  <div className="ag-mes-cab">
                    <button
                      type="button"
                      className="ag-mes-num"
                      aria-label={ta('pag_diaAria', { fecha: fechaLarga, n: delDia.length + proyectosDia.length })}
                      aria-pressed={clave === diaSeleccionado}
                      aria-current={clave === hoyKey ? 'date' : undefined}
                      onClick={(ev) => { ev.stopPropagation(); onSeleccionarDia(clave); }}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                    >
                      {dia.getDate()}
                    </button>
                    <button
                      type="button"
                      className="ag-mes-crear"
                      aria-label={ta('pag_crearEn', { fecha: fechaLarga })}
                      title={ta('pag_crearEn', { fecha: fechaLarga })}
                      onClick={(ev) => { ev.stopPropagation(); onNuevo(dia); }}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  {/* Días de la empresa: etiqueta de color a todo lo ancho, bajo el número */}
                  {mostrarDias && estado.empresa.length > 0 && (
                    <div className="ag-mes-empresa">
                      {estado.empresa.slice(0, 1).map((d) => <InsigniaEmpresa key={d.id} dia={d} compacta />)}
                    </div>
                  )}

                  {Array.from({ length: carriles }, (_, carril) => {
                    const entrada = proyectosDia.find((p) => p.carril === carril);
                    if (!entrada) return <div key={`c-${carril}`} className="ag-mes-barra-hueco" aria-hidden="true" />;
                    const empieza = entrada.inicio === clave || col === 0;
                    const termina = entrada.fin === clave || col === 6;
                    const nombre = tituloLimpio(entrada.proyecto);
                    return (
                      <div
                        key={`c-${carril}`}
                        className="ag-mes-barra"
                        data-empieza={empieza}
                        data-termina={termina}
                        title={nombre}
                        {...propsClicable((ev) => { ev.stopPropagation(); onAbrir(entrada.proyecto); })}
                        onDoubleClick={(ev) => ev.stopPropagation()}
                      >
                        {empieza && <span>{nombre}</span>}
                      </div>
                    );
                  })}

                  <div className="ag-mes-items">
                    {/* Home office, permisos, vacaciones...: renglón como las tareas */}
                    {mostrarDias && estado.personal.slice(0, 2).map((d) => <ItemDiaMes key={`p-${d.id}`} dia={d} clase="personal" />)}
                    {visibles.map((item) => {
                      const tipo = getTipoAgenda(item);
                      const diaCompleto = item.todoElDia || tipo === 'tarea';
                      const movible = tipo === 'tarea' || (!esEventoRecurrente(item) && !item.esLectura);
                      const titulo = tituloLimpio(item);
                      return (
                        <div
                          key={`${item.id}-${item.fechaInicio}`}
                          className="ag-mes-item"
                          data-tipo={tipo}
                          data-dia-completo={diaCompleto}
                          style={{ '--ag-color': colorTipo(item) }}
                          title={diaCompleto ? titulo : `${formatHora(item.fechaInicio, locale)} ${titulo}`}
                          draggable={movible}
                          onDragStart={(ev) => {
                            ev.stopPropagation();
                            ev.dataTransfer.effectAllowed = 'move';
                            ev.dataTransfer.setData('text/plain', String(item.id));
                            setArrastre({ item, origen: dia });
                          }}
                          onDragEnd={() => { setArrastre(null); setDestino(null); }}
                          onDoubleClick={(ev) => ev.stopPropagation()}
                          {...propsClicable((ev) => { ev.stopPropagation(); onAbrir(item); })}
                        >
                          {tipo === 'evento' && !diaCompleto
                            ? <span className="ag-punto" style={{ background: colorBloque(item) }} aria-hidden="true" />
                            : <IconoTipo item={item} size={11} />}
                          {!diaCompleto && <span className="ag-mes-hora">{formatHoraCorta(item.fechaInicio, locale)}</span>}
                          <span className="ag-mes-titulo">{titulo}</span>
                        </div>
                      );
                    })}
                    {ocultos > 0 && (
                      <button
                        type="button"
                        className="ag-mes-mas"
                        onClick={(ev) => { ev.stopPropagation(); onSeleccionarDia(clave); }}
                        onDoubleClick={(ev) => ev.stopPropagation()}
                      >
                        {ta('pag_mas', { n: ocultos })}
                      </button>
                    )}
                  </div>

                  {/* Solo en el móvil (CSS): resumen en puntos; el detalle va en el panel del día */}
                  {colores.length > 0 && (
                    <div className="ag-mes-puntos" aria-hidden="true">
                      {colores.slice(0, 3).map((color, i) => <i key={i} style={{ background: color }} />)}
                      {colores.length > 3 && <span>+{colores.length - 3}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default VistaMes;
