import { X, AlertTriangle } from 'lucide-react';
import UserAvatar from '../../UserAvatar';
import { usePreferences } from '../../../context/PreferencesContext';
import { useTextoAgenda } from '../../../hooks/useTextoAgenda';

// Respuesta de cada invitado -> clase de insignia y texto
const RSVP = {
  aceptado: { clase: 'badge-success', textoKey: 'mod_rsvpAceptado' },
  pendiente: { clase: 'badge-warning', textoKey: 'mod_rsvpPendiente' },
  rechazado: { clase: 'badge-danger', textoKey: 'mod_rsvpRechazado' },
  nuevo: { clase: 'badge-neutral', textoKey: 'mod_rsvpNuevo' },
};

/**
 * Lista de participantes con su foto y su respuesta (RSVP). El organizador va
 * primero. Un invitado que aun no esta guardado sale como "Se invitara"; si
 * choca con el horario elegido, lleva el aviso a su lado.
 */
const ParticipantesEvento = ({
  organizador,
  invitadosIds = [],
  usuarios = [],
  estados = {},
  ocupados = new Set(),
  onQuitar,
}) => {
  const { t } = usePreferences();
  const tx = useTextoAgenda();

  const filas = invitadosIds
    .map((id) => {
      const u = usuarios.find((x) => x.id === id) || { id, nombre: `#${id}` };
      return { usuario: u, estado: estados[id] || 'nuevo' };
    });

  const cuenta = (estado) => filas.filter((f) => f.estado === estado).length;
  const resumen = [
    ['aceptado', cuenta('aceptado')],
    ['pendiente', cuenta('pendiente') + cuenta('nuevo')],
    ['rechazado', cuenta('rechazado')],
  ].filter(([, n]) => n > 0);

  return (
    <div className="agm-caja !p-0">
      <div className="agm-caja-cabecera">
        <span className="agm-etiqueta">{tx('mod_participantes', { n: filas.length + (organizador ? 1 : 0) })}</span>
        <span className="flex flex-wrap gap-1">
          {resumen.map(([estado, n]) => (
            <span key={estado} className={RSVP[estado].clase}>{tx(`${RSVP[estado].textoKey}Corto`, { n })}</span>
          ))}
        </span>
      </div>

      <ul className="agm-lista">
        {organizador && (
          <li className="agm-fila">
            <UserAvatar usuario={organizador} size={28} radius={999} fontSize="11px" />
            <span className="agm-fila-texto">{organizador.nombre}</span>
            <span className="badge-info">{tx('mod_organiza')}</span>
          </li>
        )}
        {filas.map(({ usuario: u, estado }) => (
          <li key={u.id} className="agm-fila">
            <UserAvatar usuario={u} size={28} radius={999} fontSize="11px" />
            <span className="agm-fila-texto">{u.nombre}</span>
            {ocupados.has(u.id) && (
              <span className="badge-warning inline-flex items-center gap-1" title={tx('mod_ocupadoAyuda')}>
                <AlertTriangle size={11} aria-hidden="true" /> {tx('mod_ocupado')}
              </span>
            )}
            <span className={RSVP[estado].clase}>{tx(RSVP[estado].textoKey)}</span>
            {onQuitar && (
              <button
                type="button"
                className="agm-icono"
                onClick={() => onQuitar(u.id)}
                aria-label={`${t('delete')}: ${u.nombre}`}
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ParticipantesEvento;
