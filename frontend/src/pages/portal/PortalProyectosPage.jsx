// Proyectos del cliente: en curso y terminados.
import useSWR from 'swr';
import { FolderKanban } from 'lucide-react';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import TarjetaProyecto from '../../components/portal/TarjetaProyecto';
import { CabeceraPortal, ErrorPortal, VacioPortal } from '../../components/portal/PiezasPortal';
import { GridSkeleton } from '../../components/Skeleton';

const PortalProyectosPage = () => {
  const tp = useTextoPortal();
  const { data, error, isLoading, mutate } = useSWR(['portal', 'proyectos'], portalService.proyectos);

  const proyectos = data?.proyectos || [];
  const abiertos = proyectos.filter((p) => !p.cerrado);
  const cerrados = proyectos.filter((p) => p.cerrado);

  return (
    <div>
      <CabeceraPortal titulo={tp('ptlMenuProyectos')} />
      {isLoading && !data ? <GridSkeleton cards={3} header={false} />
        : error && !data ? <ErrorPortal error={error} onReintentar={() => mutate()} />
          : proyectos.length === 0 ? (
            <div className="ptl-panel"><VacioPortal icono={FolderKanban} texto={tp('ptlSinProyectos')} ayuda={tp('ptlSinProyectosAyuda')} /></div>
          ) : (
            <div className="flex flex-col gap-10">
              {abiertos.length > 0 && (
                <section>
                  <h2 className="ptl-seccion-titulo">{tp('ptlProyectosActivos')} <span>{abiertos.length}</span></h2>
                  <div className="ptl-proyectos">{abiertos.map((p) => <TarjetaProyecto key={p.id} proyecto={p} />)}</div>
                </section>
              )}
              {cerrados.length > 0 && (
                <section>
                  <h2 className="ptl-seccion-titulo">{tp('ptlProyectosCerrados')} <span>{cerrados.length}</span></h2>
                  <div className="ptl-proyectos">{cerrados.map((p) => <TarjetaProyecto key={p.id} proyecto={p} />)}</div>
                </section>
              )}
            </div>
          )}
    </div>
  );
};

export default PortalProyectosPage;
