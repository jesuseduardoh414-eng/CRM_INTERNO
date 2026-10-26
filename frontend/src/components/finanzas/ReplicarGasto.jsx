// Replicar un gasto en los meses siguientes (renta, nómina, servicios): elige
// cuántos meses, de 1 a 12, con atajos. El servidor crea una copia pendiente
// por mes y salta los meses que ya tienen ese mismo gasto.
import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { moverMes, nombreMesAnio } from '../../utils/finanzas';

const MAXIMO = 12;

const ReplicarGasto = ({ gasto, onClose, onHecho }) => {
  const { t, locale } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const [anioGasto, mesGasto] = String(gasto.fecha).split('-').map(Number);
  const hastaDiciembre = 12 - mesGasto;
  const [meses, setMeses] = useState(hastaDiciembre > 0 ? hastaDiciembre : 1);
  const [enviando, setEnviando] = useState(false);

  const atajos = [...new Set([1, 3, 6, hastaDiciembre, 12])].filter((n) => n >= 1 && n <= MAXIMO).sort((a, b) => a - b);
  const etiqueta = (n) => (n === hastaDiciembre ? tf('finReplicarHastaDic', { n }) : n === 1 ? tf('finReplicarUnMes') : tf('finReplicarMeses', { n }));
  const mesDe = (delta) => {
    const m = moverMes({ anio: anioGasto, mes: mesGasto }, delta);
    return nombreMesAnio(m.anio, m.mes, locale);
  };

  const replicar = async () => {
    setEnviando(true);
    try {
      const data = await finanzasService.gastos.duplicar(gasto.id, meses);
      showToast(data.mensaje, data.creados ? 'success' : 'info');
      onHecho(data);
    } catch (err) {
      showToast(err.message, 'error');
      setEnviando(false);
    }
  };

  return (
    <Modal
      open
      compacto
      maxWidth="480px"
      onClose={onClose}
      title={tf('finReplicarTitulo')}
      subtitle={`${gasto.folio} · ${gasto.concepto}`}
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={enviando}>{t('cancel')}</Button>
          <Button onClick={replicar} disabled={enviando}>
            {enviando ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
            {meses === 1 ? tf('finReplicarBotonUno') : tf('finReplicarBoton', { n: meses })}
          </Button>
        </div>
      )}
    >
      <p className="text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">{tf('finReplicarTexto', { concepto: gasto.concepto })}</p>
      <p className="mb-2 mt-4 text-[13px] font-semibold text-[var(--color-text)]">{tf('finReplicarCuantos')}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tf('finReplicarCuantos')}>
        {atajos.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={meses === n}
            onClick={() => setMeses(n)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${meses === n
              ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)] text-[var(--color-text)]'
              : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]'}`}
          >
            {etiqueta(n)}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-[var(--color-text-dim)]">
        {tf('finReplicarOtro')}
        <input
          type="number"
          min={1}
          max={MAXIMO}
          value={meses}
          onChange={(e) => setMeses(Math.max(1, Math.min(MAXIMO, Number.parseInt(e.target.value, 10) || 1)))}
          className="h-9 w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-center text-[13.5px] tabular-nums text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
      </label>
      <p className="mt-4 rounded-lg bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] px-3 py-2.5 text-[13px] text-[var(--color-text)]">
        {meses === 1 ? tf('finReplicarUno', { desde: mesDe(1) }) : tf('finReplicarRango', { n: meses, desde: mesDe(1), hasta: mesDe(meses) })}
      </p>
    </Modal>
  );
};

export default ReplicarGasto;
