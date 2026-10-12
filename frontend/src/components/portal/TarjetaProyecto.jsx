// Tarjeta de un proyecto en el portal: estado, avance, fechas y contacto.
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import UserAvatar from '../UserAvatar';
import { fechaDia } from '../../utils/portal';
import {
  BarraAvance, EstadoProyectoPortal,
} from './PiezasPortal';

const TarjetaProyecto = ({ proyecto: p }) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const corta = { day: 'numeric', month: 'short' };
  return (
    <Link to={`/portal/proyectos/${p.id}`} className="ptl-proyecto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <EstadoProyectoPortal estado={p.estado} />
          <h3 className="ptl-proyecto-nombre mt-1.5">{p.nombre}</h3>
        </div>
        <ArrowUpRight size={16} className="mt-1 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      </div>

      <div>
        <BarraAvance valor={p.avance} etiqueta={tp('ptlAvance')} />
        <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">
          {p.tareas ? tp('ptlActividades', { hechas: p.tareasHechas, total: p.tareas }) : tp('ptlSinActividades')}
        </p>
      </div>

      <div className="ptl-proyecto-pie">
        {p.cerrado ? (
          p.ultimaEntrega && <span>{tp('ptlUltimaEntrega')}: <strong>{fechaDia(p.ultimaEntrega, locale, corta)}</strong></span>
        ) : (
          <span>{tp('ptlProximaFecha')}: <strong>{p.proximaFecha ? fechaDia(p.proximaFecha, locale, corta) : tp('ptlSinFecha')}</strong></span>
        )}
        {p.fechaFin && <span>{tp('ptlFin')}: <strong>{fechaDia(p.fechaFin, locale, corta)}</strong></span>}
        {p.responsable && (
          <span className="ml-auto inline-flex items-center gap-1.5" title={tp('ptlResponsable')}>
            <UserAvatar nombre={p.responsable.nombre} fotoPerfilUrl={p.responsable.fotoPerfilUrl} size={20} radius={999} fontSize="0.55rem" />
            <strong>{p.responsable.nombre}</strong>
          </span>
        )}
      </div>
    </Link>
  );
};

export default TarjetaProyecto;
