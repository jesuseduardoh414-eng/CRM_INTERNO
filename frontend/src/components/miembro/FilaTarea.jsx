import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CircleDashed, CirclePlay, AlertCircle } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { getEstadoTarea, getPrioridadTarea, siguienteEstadoTarea } from '../../utils/estadosTarea';
import { claveDesdeISO, claveDiaLocal, compararConHoy, fechaLocalDesdeISO } from '../../utils/fechasLocales';

const ICONO_ESTADO = { PENDIENTE: CircleDashed, EN_PROGRESO: CirclePlay, HECHO: Check };

/**
 * Una tarea del miembro en una fila: botón de estado a la izquierda (avanza
 * Por hacer → En curso → Hecha), título, proyecto y vencimiento. La fila entera
 * abre la tarea dentro de su proyecto (?tarea=ID).
 */
const FilaTarea = ({ tarea, onCambiarEstado, puedeCambiar = true, mostrarProyecto = true }) => {
  const { t, locale } = usePreferences();
  const navigate = useNavigate();
  const [guardando, setGuardando] = useState(false);

  const estado = getEstadoTarea(tarea.estado);
  const prioridad = getPrioridadTarea(tarea.prioridad);
  const siguiente = siguienteEstadoTarea(tarea.estado);
  const IconoEstado = ICONO_ESTADO[tarea.estado] || CircleDashed;
  const proyectoId = tarea.proyectoId || tarea.proyecto?.id;

  const clave = claveDesdeISO(tarea.venceEn);
  const comparacion = clave ? compararConHoy(clave) : null;
  const hecha = tarea.estado === 'HECHO';
  let vence = null;
  if (clave) {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const texto = !hecha && comparacion === 0
      ? t('taskDueToday')
      : !hecha && clave === claveDiaLocal(manana)
        ? t('miDueTomorrow')
        : fechaLocalDesdeISO(tarea.venceEn)?.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    vence = {
      texto,
      tono: hecha ? 'normal' : comparacion < 0 ? 'vencida' : comparacion === 0 ? 'hoy' : 'normal',
    };
  }

  const alCambiar = async (event) => {
    event.stopPropagation();
    if (guardando) return;
    setGuardando(true);
    try {
      await onCambiarEstado?.(tarea, siguiente);
    } finally {
      setGuardando(false);
    }
  };

  const etiquetaBoton = hecha
    ? t('miReopen')
    : t('miAdvanceTo', { estado: t(getEstadoTarea(siguiente).labelKey) });

  // Sin proyecto no hay a dónde ir: antes navegaba a /proyectos/undefined
  const abrir = () => { if (proyectoId) navigate(`/proyectos/${proyectoId}?tarea=${tarea.id}`); };

  return (
    <div
      role="link"
      tabIndex={0}
      className="mi-tarea"
      data-estado={tarea.estado}
      onClick={abrir}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') abrir();
      }}
    >
      {puedeCambiar ? (
        <button
          type="button"
          className="mi-tarea-estado"
          onClick={alCambiar}
          disabled={guardando}
          aria-label={`${etiquetaBoton}: ${tarea.titulo}`}
          title={etiquetaBoton}
          style={{ color: estado.color }}
        >
          <IconoEstado size={18} strokeWidth={2} />
        </button>
      ) : (
        <span className="mi-tarea-estado" style={{ color: estado.color }} title={t(estado.labelKey)}>
          <IconoEstado size={18} strokeWidth={2} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="mi-tarea-titulo">{tarea.titulo}</p>
        <p className="mi-tarea-meta">
          {mostrarProyecto && tarea.proyecto?.nombre && <span className="truncate">{tarea.proyecto.nombre}</span>}
          {tarea.estado === 'EN_PROGRESO' && (
            <span style={{ color: estado.color }}>{t(estado.labelKey)}</span>
          )}
          {vence && (
            <span className="mi-tarea-vence" data-tono={vence.tono}>
              {vence.tono === 'vencida' && <AlertCircle size={12} />}
              {vence.texto}
              {vence.tono === 'vencida' && ` · ${t('taskOverdue')}`}
            </span>
          )}
        </p>
      </div>

      {tarea.prioridad === 'ALTA' && !hecha && (
        <span className="mi-tarea-prioridad" style={{ background: prioridad.bg, color: prioridad.fg }}>
          {t(prioridad.labelKey)}
        </span>
      )}
    </div>
  );
};

export default FilaTarea;
