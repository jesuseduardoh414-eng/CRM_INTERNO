/**
 * Piezas pequeñas que comparten las vistas de la agenda: el icono de cada
 * tipo, las insignias de días (empresa y personales), la pila de avatares y
 * la fila compacta que usan el panel del día y la vista de lista.
 */
import {
  Activity,
  Bell,
  CalendarDays,
  CalendarOff,
  Cake,
  Coffee,
  CheckSquare,
  FileClock,
  FolderKanban,
  Globe,
  House,
  MapPin,
  Repeat,
  Stethoscope,
  TreePalm,
  Users,
  Video,
} from 'lucide-react';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import UserAvatar from '../UserAvatar';
import { useEtiquetaHora } from './useEtiquetaHora';
import {
  colorTipo,
  estiloDiaEmpresa,
  estiloDiaPersonal,
  getTipoAgenda,
  horasDiaPersonal,
  participantesDe,
  propsClicable,
  tituloLimpio,
} from './agendaComun';

/** Icono según el tipo; las reuniones virtuales llevan cámara. */
export const IconoTipo = ({ item, size = 13, color }) => {
  const tipo = getTipoAgenda(item);
  const estilo = { color: color || colorTipo(item), flexShrink: 0 };
  if (tipo === 'tarea') return <CheckSquare size={size} style={estilo} aria-hidden="true" />;
  if (tipo === 'proyecto') return <FolderKanban size={size} style={estilo} aria-hidden="true" />;
  if (tipo === 'reunion') {
    return item?.modalidad === 'virtual' || item?.urlReunion
      ? <Video size={size} style={estilo} aria-hidden="true" />
      : <Users size={size} style={estilo} aria-hidden="true" />;
  }
  if (item?.tipo === 'recordatorio') return <Bell size={size} style={estilo} aria-hidden="true" />;
  if (item?.tipo === 'actividad') return <Activity size={size} style={estilo} aria-hidden="true" />;
  if (item?.esGlobal) return <Globe size={size} style={estilo} aria-hidden="true" />;
  return <CalendarDays size={size} style={estilo} aria-hidden="true" />;
};

const ICONO_PERSONAL = {
  vacacion: TreePalm,
  permiso: FileClock,
  descanso: Coffee,
  incapacidad: Stethoscope,
  homeoffice: House,
  cumpleanos: Cake,
  festivo: CalendarOff,
};

/** Icono del tipo de día personal (vacaciones, home office...). */
export const IconoDiaPersonal = ({ tipo, size = 11 }) => {
  const Icono = ICONO_PERSONAL[tipo] || CalendarOff;
  return <Icono size={size} aria-hidden="true" style={{ flexShrink: 0 }} />;
};

/**
 * Insignia de un día de la empresa ("Festivo · Navidad"). `compacta` deja
 * solo el nombre (las celdas del mes son estrechas).
 */
export const InsigniaEmpresa = ({ dia, compacta = false }) => {
  const ta = useTextoAgenda();
  const { nombreArea } = useConfiguracion();
  const estilo = estiloDiaEmpresa(dia.tipo);
  const tipoTexto = ta(`pag_emp_${dia.tipo}`);
  const detalle = [
    dia.nombre,
    dia.oficial ? ta('pag_oficial') : null,
    dia.area ? ta('pag_soloArea', { area: nombreArea?.(dia.area) || dia.area }) : null,
    dia.descripcion,
  ].filter(Boolean).join(' · ');

  return (
    <span className="ag-insignia" style={{ background: estilo.bg, color: estilo.fg }} title={`${tipoTexto}: ${detalle}`}>
      {compacta ? (dia.nombre || tipoTexto) : <><b>{tipoTexto}</b>{dia.nombre ? ` · ${dia.nombre}` : ''}</>}
    </span>
  );
};

/**
 * Insignia de un día personal (vacaciones, permiso, home office...). Si es
 * solo de unas horas las lleva al lado ("Permiso 10:00–12:00"); en la versión
 * de solo icono, compactas ("10–12").
 */
export const InsigniaPersonal = ({ dia, soloIcono = false }) => {
  const ta = useTextoAgenda();
  const estilo = estiloDiaPersonal(dia.tipo);
  const texto = ta(`pag_per_${dia.tipo}`);
  const horas = horasDiaPersonal(dia);
  const titulo = [horas ? `${texto} ${horas}` : texto, dia.descripcion].filter(Boolean).join(': ');

  return (
    <span
      className={soloIcono ? `ag-insignia ag-insignia-icono${horas ? ' ag-insignia-horas' : ''}` : 'ag-insignia'}
      style={{ background: estilo.bg, color: estilo.fg }}
      title={titulo}
      aria-label={soloIcono ? titulo : undefined}
      role={soloIcono ? 'img' : undefined}
    >
      <IconoDiaPersonal tipo={dia.tipo} />
      {!soloIcono && texto}
      {horas && <small>{soloIcono ? horasDiaPersonal(dia, true) : horas}</small>}
    </span>
  );
};

/**
 * Pila de avatares de participantes (máximo `max`, el resto como "+n").
 * Cada uno lleva un aro del color de la tarjeta para que no se encimen sus
 * bordes, y las iniciales a un tamaño legible.
 */
export const Avatares = ({ personas = [], max = 3, size = 24 }) => {
  if (!personas.length) return null;
  const visibles = personas.slice(0, max);
  const resto = personas.length - visibles.length;
  return (
    <span className="ag-avatares" title={personas.map((p) => p.nombre).join(', ')}>
      {visibles.map((persona) => (
        <span key={persona.id} className="ag-avatar">
          <UserAvatar
            usuario={persona}
            size={size}
            radius={999}
            fontSize={size >= 24 ? '0.62rem' : '0.56rem'}
            color="var(--color-text-dim)"
            background="var(--color-surface-3)"
            borderColor="transparent"
          />
        </span>
      ))}
      {resto > 0 && <span className="ag-avatar ag-avatares-resto" style={{ width: size, height: size }}>+{resto}</span>}
    </span>
  );
};

/**
 * Días especiales con el mismo aspecto que los eventos: `personal` (home
 * office, permiso, vacaciones...) o `empresa` (festivo, cierre...). En el
 * panel del día van como fila con su horario ("Todo el día" o las horas).
 */
export const FilaDia = ({ dia, clase }) => {
  const ta = useTextoAgenda();
  const { nombreArea } = useConfiguracion();
  const esPersonal = clase === 'personal';
  const estilo = esPersonal ? estiloDiaPersonal(dia.tipo) : estiloDiaEmpresa(dia.tipo);
  const tipoTexto = ta(esPersonal ? `pag_per_${dia.tipo}` : `pag_emp_${dia.tipo}`);
  const horas = esPersonal ? horasDiaPersonal(dia) : null;
  const titulo = esPersonal ? tipoTexto : (dia.nombre || tipoTexto);
  const meta = esPersonal
    ? [dia.descripcion]
    : [tipoTexto, dia.oficial ? ta('pag_oficial') : null, dia.area ? ta('pag_soloArea', { area: nombreArea?.(dia.area) || dia.area }) : null, dia.descripcion];
  return (
    <div className="ag-fila" data-tipo={esPersonal ? 'personal' : 'empresa'} style={{ '--ag-color': estilo.fg }}>
      <div className="ag-fila-cuerpo" style={{ cursor: 'default' }}>
        <span className="ag-fila-hora">
          <b>{horas ? horas.split('–')[0] : ta('pag_secTodoDia')}</b>
          {horas && <small>{horas.split('–')[1]}</small>}
        </span>
        <span className="ag-fila-texto">
          <span className="ag-fila-titulo">
            {esPersonal
              ? <IconoDiaPersonal tipo={dia.tipo} size={13} />
              : <CalendarOff size={13} aria-hidden="true" style={{ flexShrink: 0, color: estilo.fg }} />}
            <span>{titulo}</span>
          </span>
          <span className="ag-fila-meta">
            {meta.filter(Boolean).map((texto) => <span key={texto} title={texto}><span>{texto}</span></span>)}
          </span>
        </span>
      </div>
    </div>
  );
};

/** Lo mismo en una celda del mes: renglón teñido con icono, nombre y horas. */
export const ItemDiaMes = ({ dia, clase }) => {
  const ta = useTextoAgenda();
  const esPersonal = clase === 'personal';
  const estilo = esPersonal ? estiloDiaPersonal(dia.tipo) : estiloDiaEmpresa(dia.tipo);
  const tipoTexto = ta(esPersonal ? `pag_per_${dia.tipo}` : `pag_emp_${dia.tipo}`);
  const horas = esPersonal ? horasDiaPersonal(dia, true) : null;
  const texto = esPersonal ? tipoTexto : (dia.nombre || tipoTexto);
  return (
    <div
      className="ag-mes-item ag-mes-item-dia"
      data-dia-completo="true"
      style={{ '--ag-color': estilo.fg }}
      title={[texto, horas, dia.descripcion].filter(Boolean).join(' · ')}
    >
      {esPersonal
        ? <IconoDiaPersonal tipo={dia.tipo} size={11} />
        : <CalendarOff size={11} aria-hidden="true" style={{ flexShrink: 0 }} />}
      {horas && <span className="ag-mes-hora">{horas}</span>}
      <span className="ag-mes-titulo">{texto}</span>
    </div>
  );
};

/**
 * Fila compacta de un elemento, como tarjeta teñida del color de su tipo:
 * columna de hora (inicio y fin), icono, título con una línea de detalle
 * (modalidad, lugar o enlace, proyecto, quién organiza) y los participantes
 * alineados a la derecha. Cada dato del detalle va en una sola línea y se
 * recorta con "…" en vez de partirse ("Organiza Alvino / espinoza").
 * `compacta` (panel del día, que es estrecho): horas de 24 h ("9:00"), el icono
 * junto al título en vez de en su propia columna y avatares más pequeños.
 */
export const FilaItem = ({ item, clave, onAbrir, acciones = null, currentUserId, compacta = false }) => {
  const ta = useTextoAgenda();
  const etiquetaHora = useEtiquetaHora();
  const hora = etiquetaHora(item, clave, compacta);
  const tipo = getTipoAgenda(item);
  const personas = tipo === 'reunion' || tipo === 'evento' ? participantesDe(item) : [];
  const proyecto = tipo !== 'proyecto' ? item.proyecto?.nombre : null;
  const ajeno = item.creador?.id && currentUserId && item.creador.id !== currentUserId;

  return (
    <div className="ag-fila" data-tipo={tipo} data-todo-dia={!!item.todoElDia} style={{ '--ag-color': colorTipo(item) }}>
      <div className="ag-fila-cuerpo" {...propsClicable(() => onAbrir(item))}>
        <span className="ag-fila-hora">
          <b>{hora.texto}</b>
          {hora.sub && <small>{hora.sub}</small>}
        </span>
        {!compacta && <span className="ag-fila-icono"><IconoTipo item={item} size={14} /></span>}
        <span className="ag-fila-texto">
          <span className="ag-fila-titulo">
            {compacta && <IconoTipo item={item} size={13} />}
            <span>{tituloLimpio(item)}</span>
            {item.esOcurrencia && <Repeat size={11} aria-label={ta('pag_recurrente')} className="ag-fila-rep" />}
          </span>
          <span className="ag-fila-meta">
            {item.modalidad && tipo === 'reunion' && (
              <span>
                {item.modalidad === 'virtual' ? <Video size={11} aria-hidden="true" /> : <Users size={11} aria-hidden="true" />}
                <span>{item.modalidad === 'virtual' ? ta('pag_virtual') : ta('pag_presencial')}</span>
              </span>
            )}
            {item.urlReunion && (
              <a href={item.urlReunion} target="_blank" rel="noreferrer" className="ag-fila-enlace" onClick={(ev) => ev.stopPropagation()}>
                <Video size={11} aria-hidden="true" /> <span>{ta('pag_unirse')}</span>
              </a>
            )}
            {item.ubicacion && <span title={item.ubicacion}><MapPin size={11} aria-hidden="true" /> <span>{item.ubicacion}</span></span>}
            {proyecto && <span title={proyecto}><FolderKanban size={11} aria-hidden="true" /> <span>{proyecto}</span></span>}
            {ajeno && item.creador?.nombre && <span title={ta('pag_organiza', { nombre: item.creador.nombre })}><span>{ta('pag_organiza', { nombre: item.creador.nombre })}</span></span>}
          </span>
        </span>
        {personas.length > 1 && <Avatares personas={personas} max={3} size={compacta ? 22 : 24} />}
      </div>
      {acciones && <div className="ag-fila-acciones">{acciones}</div>}
    </div>
  );
};
