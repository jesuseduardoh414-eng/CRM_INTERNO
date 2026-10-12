// "Reunión con cliente" en la ventana de eventos de la agenda (solo
// administradores): la reunión aparece en el portal de ese cliente.
import useSWR from 'swr';
import { Building2 } from 'lucide-react';
import { empresasService } from '../../services/api';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import SelectorSimple from '../SelectorSimple';

const SelectorClienteEvento = ({ valor, onCambio }) => {
  const tp = useTextoPortal();
  const { data } = useSWR(['empresas-catalogo', 'CLIENTE'], () => empresasService.catalogo('CLIENTE'));
  // Las inactivas no se ofrecen, salvo la que ya tenga la reunión.
  const opciones = (data?.empresas || []).filter((e) => e.estado === 'ACTIVO' || String(e.id) === String(valor));

  return (
    <div className="form-group !mb-0">
      <label className="form-label flex items-center gap-1.5" htmlFor="evento-cliente">
        <Building2 size={14} aria-hidden="true" /> {tp('ptlReunionCliente')}
      </label>
      <SelectorSimple
        id="evento-cliente"
        valor={valor ? String(valor) : ''}
        onCambio={(v) => onCambio(v || '')}
        opcionVacia={tp('ptlSinClienteOpcion')}
        opciones={opciones.map((e) => ({ valor: String(e.id), etiqueta: e.nombreComercial || e.nombre }))}
      />
      <p className="ml-1 mt-1 text-xs text-[var(--color-text-muted)]">{tp('ptlReunionClienteAyuda')}</p>
    </div>
  );
};

export default SelectorClienteEvento;
