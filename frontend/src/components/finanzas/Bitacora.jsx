// Bitácora de un registro de finanzas: quién hizo qué y cuándo.
import useSWR from 'swr';
import { finanzasService } from '../../services/api';
import { OPCIONES_SWR_FINANZAS } from '../../utils/finanzas';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';

const Bitacora = ({ entidad, entidadId }) => {
  const tf = useTextoFinanzas();
  const { fechaHora } = useFormatoFinanzas();
  const { data, error } = useSWR(['finanzas-bitacora', entidad, entidadId], () => finanzasService.bitacora({ entidad, entidadId }), OPCIONES_SWR_FINANZAS);
  const entradas = data?.entradas || [];
  if (error) return <p className="mt-2 text-[12.5px] text-[var(--color-error)]">{error.message}</p>;
  if (!data) return <p className="mt-2 text-[12.5px] text-[var(--color-text-muted)]">…</p>;
  if (entradas.length === 0) return <p className="mt-2 text-[12.5px] text-[var(--color-text-muted)]">{tf('finBitacoraVacia')}</p>;
  return (
    <ol className="mt-2 space-y-2 border-l-2 border-[var(--color-border)] pl-3">
      {entradas.map((e) => (
        <li key={e.id} className="text-[12.5px]">
          <div className="text-[var(--color-text)]">{e.descripcion}</div>
          <div className="text-[var(--color-text-muted)]">{e.usuarioNombre || '—'} · {fechaHora(e.creadoEn)}</div>
        </li>
      ))}
    </ol>
  );
};

export default Bitacora;
