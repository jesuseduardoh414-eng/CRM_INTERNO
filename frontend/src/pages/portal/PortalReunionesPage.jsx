// Reuniones con la empresa del cliente: próximas y de los últimos meses.
import useSWR from 'swr';
import { CalendarDays } from 'lucide-react';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import { FilaReunion } from '../../components/portal/ListasPortal';
import { CabeceraPortal, ErrorPortal, PanelPortal, VacioPortal } from '../../components/portal/PiezasPortal';
import { ListSkeleton } from '../../components/Skeleton';

const PortalReunionesPage = () => {
  const tp = useTextoPortal();
  const { data, error, isLoading, mutate } = useSWR(['portal', 'reuniones'], portalService.reuniones);

  return (
    <div>
      <CabeceraPortal titulo={tp('ptlReunionesTitulo')} subtitulo={tp('ptlReunionesSubtitulo')} />
      {isLoading && !data ? <ListSkeleton rows={4} header={false} />
        : error && !data ? <ErrorPortal error={error} onReintentar={() => mutate()} />
          : (
            <div className="flex flex-col gap-6">
              <PanelPortal titulo={tp('ptlProximas')}>
                {data.proximas.length === 0
                  ? <VacioPortal icono={CalendarDays} texto={tp('ptlSinReuniones')} />
                  : <ul>{data.proximas.map((r) => <FilaReunion key={r.id} reunion={r} />)}</ul>}
              </PanelPortal>
              <PanelPortal titulo={tp('ptlPasadas')}>
                {data.pasadas.length === 0
                  ? <VacioPortal texto={tp('ptlSinPasadas')} />
                  : <ul>{data.pasadas.map((r) => <FilaReunion key={r.id} reunion={r} pasada />)}</ul>}
              </PanelPortal>
            </div>
          )}
    </div>
  );
};

export default PortalReunionesPage;
