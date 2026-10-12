// Selector de empresa del directorio para el formulario de contratos. Lista
// los clientes o los proveedores según el tipo del contrato y, al elegir una,
// pide su ficha completa para que el formulario llene la contraparte con ella
// y con su contacto principal. Permite registrar una empresa nueva al vuelo.
import { useRef, useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, Plus } from 'lucide-react';
import { empresasService } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useTextoClientes } from '../../hooks/useTextoClientes';
import SelectorSimple from '../SelectorSimple';
import FormularioEmpresa from './FormularioEmpresa';

const SelectorEmpresa = ({ id = 'selector-empresa', tipo, valor, onChange }) => {
  const tc = useTextoClientes();
  const { showToast } = useToast();
  const [cargando, setCargando] = useState(false);
  const [nueva, setNueva] = useState(null); // clave de apertura del formulario
  const { data, mutate } = useSWR(['empresas-catalogo', tipo], () => empresasService.catalogo(tipo));
  // Si se cambia de empresa antes de que llegue la ficha anterior, solo cuenta
  // la última elegida (si no, una respuesta lenta pisaba la contraparte).
  const ultimaPedida = useRef(0);

  // Las inactivas no se ofrecen, salvo la que ya tenga el contrato.
  const opciones = (data?.empresas || []).filter((e) => e.estado === 'ACTIVO' || String(e.id) === String(valor));

  const elegir = async (nuevoId) => {
    const pedido = ++ultimaPedida.current;
    if (!nuevoId) { setCargando(false); onChange('', null); return; }
    setCargando(true);
    try {
      const { empresa } = await empresasService.obtener(nuevoId);
      if (pedido === ultimaPedida.current) onChange(String(nuevoId), empresa);
    } catch (err) {
      if (pedido !== ultimaPedida.current) return;
      showToast(err.message, 'error');
      onChange(String(nuevoId), null);
    } finally {
      if (pedido === ultimaPedida.current) setCargando(false);
    }
  };

  return (
    <div className="form-group sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <label className="form-label" htmlFor={id}>{tc('cliCtrEmpresa')}</label>
        <div className="mb-1 flex items-center gap-3 text-xs">
          {valor && (
            <Link to={`/clientes/${valor}`} target="_blank" rel="noopener noreferrer" className="cli-enlace">
              {tc('cliCtrVerFicha')} <ArrowUpRight size={12} />
            </Link>
          )}
          <button type="button" className="cli-enlace" onClick={() => setNueva(Date.now())}>
            <Plus size={13} /> {tc('cliCtrNuevaEmpresa')}
          </button>
        </div>
      </div>
      <SelectorSimple
        id={id}
        valor={valor}
        onCambio={elegir}
        disabled={cargando}
        opcionVacia={tc('cliCtrEmpresaNinguna')}
        opciones={opciones.map((e) => ({
          valor: String(e.id),
          etiqueta: `${e.nombre}${e.nombreComercial ? ` (${e.nombreComercial})` : ''}${e.rfc ? ` · ${e.rfc}` : ''}`,
        }))}
      />
      <p className="ml-1 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        {cargando && <Loader2 size={12} className="animate-spin" />}
        {cargando ? tc('cliCtrCargando') : tc('cliCtrEmpresaAyuda')}
      </p>

      {nueva && (
        <FormularioEmpresa
          key={nueva}
          open
          tipoInicial={tipo}
          onClose={() => setNueva(null)}
          onGuardado={(empresa) => { setNueva(null); mutate(); elegir(empresa.id); }}
        />
      )}
    </div>
  );
};

export default SelectorEmpresa;
