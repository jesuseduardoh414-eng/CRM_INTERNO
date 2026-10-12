// Pestaña "Cliente" del detalle de un proyecto (lado del equipo): la
// conversación con el cliente de su portal y un resumen de lo que ve.
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2, Eye, FileText, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalEquipoService } from '../../services/api';
import { PanelSkeleton } from '../Skeleton';
import ConversacionPortal from './ConversacionPortal';
import { ErrorPortal, VacioPortal } from './PiezasPortal';

const PanelClienteProyecto = ({ proyectoId }) => {
  const { usuario } = useAuth();
  const { showToast } = useToast();
  const tp = useTextoPortal();
  const { data, error, isLoading, mutate } = useSWR(
    ['proyecto-portal', proyectoId],
    () => portalEquipoService.proyecto(proyectoId),
    { refreshInterval: 20000, revalidateOnFocus: true },
  );

  if (isLoading && !data) return <PanelSkeleton rows={4} />;
  if (error && !data) return <ErrorPortal error={error} onReintentar={() => mutate()} />;

  const { cliente, accesos, documentosCompartidos, mensajes } = data;

  if (!cliente) {
    return (
      <div className="ptl-panel">
        <VacioPortal icono={Building2} texto={tp('ptlSinCliente')} ayuda={tp('ptlSinClienteAyuda')} />
      </div>
    );
  }

  const responder = async (texto) => {
    try {
      const respuesta = await portalEquipoService.responder(proyectoId, texto);
      mutate((prev) => ({ ...prev, mensajes: [...(prev?.mensajes || []), respuesta.mensaje] }), { revalidate: false });
      showToast(respuesta.avisados ? tp('ptlRespuestaEnviada') : tp('ptlNadieAvisado'), respuesta.avisados ? 'success' : 'info');
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <ConversacionPortal
        key={proyectoId}
        mensajes={mensajes}
        ladoCliente={false}
        onEnviar={responder}
        placeholder={tp('ptlResponder')}
        etiquetaOtros={cliente.nombre}
        vacioAyuda={tp('ptlConversacionAyuda')}
        cabecera={(
          <header className="ptl-panel-cabecera">
            <h2 className="ptl-panel-titulo">{tp('ptlConversacion')}</h2>
            <span className="ptl-chip-cliente">{cliente.nombre}</span>
          </header>
        )}
      />

      {/* Hasta xl el resumen va bajo la conversación, en dos columnas desde md */}
      <aside className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:sticky xl:top-6 xl:flex xl:flex-col xl:items-stretch xl:self-start">
        {!cliente.activo && <div className="alert-info text-[13px] md:col-span-2">{tp('ptlClienteInactivo')}</div>}

        <section className="ptl-panel p-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Eye size={15} aria-hidden="true" /> {tp('ptlVeEsto')}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">{tp('ptlVeEstoTexto')}</p>
        </section>

        <section className="ptl-panel">
          <div className="ptl-fila">
            <span className="ptl-icono"><Users size={16} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{accesos.length ? tp('ptlPersonasAcceso', { n: accesos.length }) : tp('ptlNadieAcceso')}</span>
              {accesos.length > 0 && <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{accesos.map((a) => a.nombre).join(', ')}</span>}
            </span>
          </div>
          <div className="ptl-fila">
            <span className="ptl-icono"><FileText size={16} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{tp('ptlDocsCompartidos', { n: documentosCompartidos })}</span>
              <span className="block text-[12px] text-[var(--color-text-muted)]">{tp('ptlCompartirAyuda')}</span>
            </span>
          </div>
          {usuario?.rol === 'ADMIN' && (
            <Link to={`/clientes/${cliente.id}`} className="ptl-fila">
              <span className="ptl-icono"><Building2 size={16} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1 text-[13px] font-medium">{tp('ptlGestionarAccesos')}</span>
              <ArrowUpRight size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
            </Link>
          )}
        </section>
      </aside>
    </div>
  );
};

export default PanelClienteProyecto;
