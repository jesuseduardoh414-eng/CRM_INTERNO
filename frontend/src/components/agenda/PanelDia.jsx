/**
 * Panel lateral con la agenda de un día: estado del día (laboral, festivo,
 * vacaciones...), los elementos agrupados y un botón para crear un evento ese
 * día. Lo usan la vista de mes (al pulsar un día) y la vista de día.
 */
import { ChevronRight, Edit2, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import ActionMenu from '../ActionMenu';
import Tooltip from '../Tooltip';
import { FilaItem, FilaDia } from './ElementosAgenda';
import { useNombreDia } from './useEtiquetaHora';
import {
  capitalizar,
  esEventoRecurrente,
  getDateKey,
  getTipoAgenda,
  ordenarItemsDia,
} from './agendaComun';

const Seccion = ({ titulo, cuenta, accion, children }) => (
  <section className="ag-panel-seccion">
    <header>
      <h4>{titulo} <span>{cuenta}</span></h4>
      {accion}
    </header>
    <div className="ag-panel-lista">{children}</div>
  </section>
);

const PanelDia = ({
  fecha,
  items,
  estado,
  mostrarDias = true,
  currentUserId,
  onCerrar,
  onNuevo,
  onAbrir,
  onEliminar,
  onMover,
  onMoverPersonalizado,
  onMoverBloque,
  className = '',
  // React 19: `ref` llega como prop; la página lo usa para acercar el panel
  // cuando va debajo de la rejilla del mes (móvil y tablet).
  ref,
}) => {
  const { t, locale } = usePreferences();
  const ta = useTextoAgenda();
  const nombreDia = useNombreDia();
  const clave = getDateKey(fecha);

  const ordenados = ordenarItemsDia(items);
  const proyectos = ordenados.filter((item) => getTipoAgenda(item) === 'proyecto');
  const tareas = ordenados.filter((item) => getTipoAgenda(item) === 'tarea');
  const todoElDia = ordenados.filter((item) => item.todoElDia && item.tipo !== 'tarea' && getTipoAgenda(item) !== 'proyecto');
  const conHora = ordenados.filter((item) => !item.todoElDia && item.tipo !== 'tarea' && getTipoAgenda(item) !== 'proyecto');

  // Acciones de cada fila: las mismas que tenía la ventana del día.
  const accionesDe = (item) => {
    const tipo = getTipoAgenda(item);
    if (tipo === 'proyecto') {
      return (
        <Tooltip label={ta('pag_abrirProyecto')}>
          <button type="button" className="dash-icono" onClick={() => onAbrir(item)} aria-label={ta('pag_abrirProyecto')}>
            <ExternalLink size={14} />
          </button>
        </Tooltip>
      );
    }
    const movible = tipo === 'tarea' || !esEventoRecurrente(item);
    const editable = tipo !== 'tarea' && !item.esLectura;
    return (
      <ActionMenu
        size={15}
        items={[
          editable && { label: t('edit'), icon: <Edit2 size={14} />, onSelect: () => onAbrir(item) },
          movible && onMover && { label: t('agendaMoveOneDay'), icon: <ChevronRight size={14} />, onSelect: () => onMover(item, 1) },
          movible && onMover && { label: t('agendaMoveTwoDays'), icon: <ChevronRight size={14} />, onSelect: () => onMover(item, 2) },
          movible && onMoverPersonalizado && { label: t('agendaMoveCustom'), icon: <Edit2 size={14} />, onSelect: () => onMoverPersonalizado(item) },
          editable && onEliminar && { separator: true },
          editable && onEliminar && { label: t('delete'), icon: <Trash2 size={14} />, onSelect: () => onEliminar(item), danger: true },
        ]}
      />
    );
  };

  const fila = (item) => (
    <FilaItem
      key={`${item.id}-${item.fechaInicio}`}
      item={item}
      clave={clave}
      onAbrir={onAbrir}
      currentUserId={currentUserId}
      compacta
      acciones={accionesDe(item)}
    />
  );

  return (
    <aside ref={ref} className={`ag-panel-dia ${className}`} aria-label={fecha.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}>
      <header className="ag-panel-cab">
        <div className="min-w-0">
          <p className="ag-panel-eyebrow">{nombreDia(fecha)}</p>
          <h3>{capitalizar(fecha.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }))}</h3>
          <p className="ag-panel-estado" data-laboral={estado.esLaboral}>
            <span aria-hidden="true" />
            {estado.esLaboral ? ta('pag_diaLaboral') : ta('pag_diaNoLaboral')}
          </p>
        </div>
        {onCerrar && (
          <Tooltip label={ta('pag_cerrarPanel')}>
            <button type="button" className="dash-icono" onClick={onCerrar} aria-label={ta('pag_cerrarPanel')}><X size={16} /></button>
          </Tooltip>
        )}
      </header>

      <button type="button" className="ag-panel-crear" onClick={() => onNuevo(fecha)}>
        <Plus size={14} /> {ta('pag_panelCrear')}
      </button>

      <div className="ag-panel-cuerpo">
        {ordenados.length === 0 && !(mostrarDias && (estado.empresa.length || estado.personal.length)) && <p className="ag-panel-vacio">{ta('pag_panelVacio')}</p>}
        {mostrarDias && (estado.empresa.length > 0 || estado.personal.length > 0) && (
          <Seccion titulo={ta('pag_secDias')} cuenta={estado.empresa.length + estado.personal.length}>
            {estado.empresa.map((dia) => <FilaDia key={`e-${dia.id}-${dia.fecha}`} dia={dia} clase="empresa" />)}
            {estado.personal.map((dia) => <FilaDia key={`p-${dia.id}`} dia={dia} clase="personal" />)}
          </Seccion>
        )}
        {conHora.length > 0 && <Seccion titulo={ta('pag_secHorario')} cuenta={conHora.length}>{conHora.map(fila)}</Seccion>}
        {todoElDia.length > 0 && <Seccion titulo={ta('pag_secTodoDia')} cuenta={todoElDia.length}>{todoElDia.map(fila)}</Seccion>}
        {tareas.length > 0 && (
          <Seccion
            titulo={ta('pag_secTareas')}
            cuenta={tareas.length}
            accion={onMoverBloque && (
              <ActionMenu size={14} items={[{ label: ta('pag_moverBloque'), icon: <ChevronRight size={14} />, onSelect: () => onMoverBloque(fecha) }]} />
            )}
          >
            {tareas.map(fila)}
          </Seccion>
        )}
        {proyectos.length > 0 && <Seccion titulo={ta('pag_secProyectos')} cuenta={proyectos.length}>{proyectos.map(fila)}</Seccion>}
      </div>
    </aside>
  );
};

export default PanelDia;
