/**
 * Vista "Agenda": lista cronológica del periodo visible (30 días desde la
 * fecha elegida), agrupada por día con cabeceras fijas ("Hoy", "Mañana"...).
 * Los días sin nada se saltan. Las tareas salen el día que vencen y los
 * proyectos el día que empiezan y el que terminan, para no repetirlos en
 * cada día del rango.
 */
import { CalendarDays, Plus } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoAgenda } from '../../hooks/useTextoAgenda';
import Tooltip from '../Tooltip';
import { FilaItem, InsigniaEmpresa, InsigniaPersonal } from './ElementosAgenda';
import { useNombreDia } from './useEtiquetaHora';
import {
  capitalizar,
  clavesItem,
  getDateKey,
  getTipoAgenda,
  itemAgendaOcurreEnFecha,
  ordenarItemsDia,
} from './agendaComun';

const VistaAgenda = ({ dias, items, estadoDe, esLaborable, mostrarDias = true, currentUserId, onAbrir, onNuevo }) => {
  const { locale } = usePreferences();
  const ta = useTextoAgenda();
  const nombreDia = useNombreDia();
  const hoyKey = getDateKey(new Date());

  const grupos = dias.map((dia) => {
    const clave = getDateKey(dia);
    const delDia = items.filter((item) => {
      const tipo = getTipoAgenda(item);
      const { inicio, fin } = clavesItem(item);
      if (tipo === 'tarea') return fin === clave;
      if (tipo === 'proyecto') return inicio === clave || fin === clave;
      return itemAgendaOcurreEnFecha(item, dia, esLaborable);
    });
    const estado = estadoDe(dia);
    const conMarcas = mostrarDias && (estado.empresa.length > 0 || estado.personal.length > 0);
    return { dia, clave, items: ordenarItemsDia(delDia), estado, conMarcas };
  }).filter((grupo) => grupo.items.length > 0 || grupo.conMarcas);

  if (grupos.length === 0) {
    return (
      <div className="ag-vacio">
        <CalendarDays size={22} aria-hidden="true" />
        <p>{ta('pag_listaVacia')}</p>
        <span>{ta('pag_listaVaciaSub')}</span>
      </div>
    );
  }

  return (
    <div className="ag-lista">
      {grupos.map(({ dia, clave, items: delDia, estado, conMarcas }) => (
        <section key={clave} className="ag-lista-grupo" data-hoy={clave === hoyKey} aria-label={dia.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <header className="ag-lista-dia" data-nolaboral={!estado.esLaboral}>
            <span className="ag-lista-num">{dia.getDate()}</span>
            <span className="ag-lista-fecha">
              <b>{nombreDia(dia)}</b>
              <span>{capitalizar(dia.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }))}</span>
            </span>
            {conMarcas && (
              <span className="ag-lista-marcas">
                {estado.empresa.map((d) => <InsigniaEmpresa key={`e-${d.id}`} dia={d} />)}
                {estado.personal.map((d) => <InsigniaPersonal key={`p-${d.id}`} dia={d} />)}
              </span>
            )}
            <Tooltip label={ta('pag_crearEn', { fecha: dia.toLocaleDateString(locale, { day: 'numeric', month: 'long' }) })}>
              <button type="button" className="dash-icono ag-lista-crear" onClick={() => onNuevo(dia)} aria-label={ta('pag_crearEn', { fecha: dia.toLocaleDateString(locale, { day: 'numeric', month: 'long' }) })}>
                <Plus size={15} />
              </button>
            </Tooltip>
          </header>
          {delDia.length > 0 && (
            <div className="ag-lista-items">
              {delDia.map((item) => (
                <FilaItem key={`${item.id}-${item.fechaInicio}`} item={item} clave={clave} onAbrir={onAbrir} currentUserId={currentUserId} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
};

export default VistaAgenda;
