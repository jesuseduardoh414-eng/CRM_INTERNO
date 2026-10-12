// Todos los documentos que el equipo compartió con el cliente, con buscador.
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { FileText, Search } from 'lucide-react';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import { ListaDocumentos } from '../../components/portal/ListasPortal';
import { CabeceraPortal, ErrorPortal, PanelPortal, VacioPortal } from '../../components/portal/PiezasPortal';
import { ListSkeleton } from '../../components/Skeleton';

const normalizar = (texto = '') => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PortalDocumentosPage = () => {
  const tp = useTextoPortal();
  const [busqueda, setBusqueda] = useState('');
  const { data, error, isLoading, mutate } = useSWR(['portal', 'documentos'], portalService.documentos);

  const documentos = useMemo(() => {
    const lista = data?.documentos || [];
    const q = normalizar(busqueda.trim());
    return q ? lista.filter((d) => normalizar(`${d.nombre} ${d.proyecto?.nombre || ''}`).includes(q)) : lista;
  }, [data, busqueda]);

  const hayDocumentos = (data?.documentos || []).length > 0;

  return (
    <div>
      <CabeceraPortal titulo={tp('ptlDocsTitulo')} subtitulo={tp('ptlDocsSubtitulo')}>
        {hayDocumentos && (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">{tp('ptlBuscarDoc')}</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={tp('ptlBuscarDoc')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-[16px] outline-none focus:border-[var(--color-primary)] sm:text-[14px]"
            />
          </label>
        )}
      </CabeceraPortal>

      {isLoading && !data ? <ListSkeleton rows={5} header={false} />
        : error && !data ? <ErrorPortal error={error} onReintentar={() => mutate()} />
          : (
            <PanelPortal>
              {!hayDocumentos ? <VacioPortal icono={FileText} texto={tp('ptlSinDocs')} />
                : documentos.length === 0 ? <VacioPortal icono={Search} texto={tp('ptlSinResultados')} />
                  : <ListaDocumentos documentos={documentos} mostrarProyecto />}
            </PanelPortal>
          )}
    </div>
  );
};

export default PortalDocumentosPage;
