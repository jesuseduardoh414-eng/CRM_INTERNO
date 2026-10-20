// Ventana para fijar el presupuesto de un mes en las seis categorías de
// gastos. Calcula al vuelo cuánto quedaría sin asignar en la bolsa con las
// mismas reglas del servidor (services/presupuestos.service.js): en un mes
// abierto cada categoría aparta max(presupuesto, lo ya usado); en uno
// cerrado el presupuesto no aparta nada.
import { useMemo, useState } from 'react';
import { CopyPlus, Loader2, Save } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, Seccion } from './piezas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { nombreMesAnio } from '../../utils/finanzas';

const centavos = (valor) => Math.round((Number(valor) || 0) * 100);
const texto = (n) => (n > 0 ? String(n) : '');

const FormularioPresupuesto = ({ open, presupuesto, anterior, sinAsignar, onClose, onGuardado }) => {
  const { t, locale } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto } = useFormatoFinanzas();
  const { showToast } = useToast();
  const { anio, mes, cerrado, categorias } = presupuesto;
  const [montos, setMontos] = useState(() => Object.fromEntries(categorias.map((c) => [c.categoria, texto(c.presupuesto)])));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const nombre = nombreMesAnio(anio, mes, locale);
  const nombreAnterior = nombreMesAnio(anterior.anio, anterior.mes, locale);
  const hayAnterior = Object.values(anterior.montos).some((v) => v > 0);

  // Lo que cambia lo apartado de la bolsa (centavos) y cómo quedaría.
  const { delta, total } = useMemo(() => categorias.reduce((acc, c) => {
    const usado = centavos(c.gastado) + centavos(c.comprometido);
    const nuevo = centavos(montos[c.categoria]);
    acc.total += nuevo;
    if (!cerrado) acc.delta += Math.max(nuevo, usado) - Math.max(centavos(c.presupuesto), usado);
    return acc;
  }, { delta: 0, total: 0 }), [categorias, montos, cerrado]);
  const quedaria = (centavos(sinAsignar) - delta) / 100;
  const noAlcanza = delta > 0 && quedaria < 0;

  const cambiar = (categoria) => (e) => { setMontos((p) => ({ ...p, [categoria]: e.target.value })); setError(null); };
  const copiarAnterior = () => { setMontos(Object.fromEntries(categorias.map((c) => [c.categoria, texto(anterior.montos[c.categoria])]))); setError(null); };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const data = await finanzasService.tesoreria.guardarPresupuestos({
        anio,
        mes,
        presupuestos: categorias.map((c) => ({ categoria: c.categoria, monto: montos[c.categoria] || 0 })),
      });
      showToast(data.cambios ? tf('finPresupuestoGuardado', { mes: nombre }) : tf('finSinCambios'), data.cambios ? 'success' : 'info');
      onGuardado(data);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="640px"
      title={tf('finPresupuestoDe', { mes: nombre })}
      subtitle={tf('finPresupuestoSubtitulo')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={copiarAnterior} disabled={guardando || !hayAnterior} title={hayAnterior ? undefined : tf('finCopiarDeNada', { mes: nombreAnterior })}>
            <CopyPlus size={16} /> {tf('finCopiarDe', { mes: nombreAnterior })}
          </Button>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
            <Button type="submit" form="form-presupuesto" disabled={guardando || noAlcanza}>
              {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {guardando ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}
    >
      <form id="form-presupuesto" onSubmit={guardar} noValidate>
        <AvisoError error={error} />
        {cerrado ? (
          <div className="alert-info mb-5">{tf('finMesCerradoForm')}</div>
        ) : (
          <dl className={`mb-5 grid grid-cols-2 gap-3 rounded-xl border px-4 py-3 text-sm ${noAlcanza ? 'border-[var(--color-error)]' : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'}`}>
            <div>
              <dt className="text-[12px] text-[var(--color-text-muted)]">{tf('finSinAsignarDisponible')}</dt>
              <dd className="font-semibold tabular-nums text-[var(--color-text)]">{monto(sinAsignar)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-[var(--color-text-muted)]">{tf('finQuedaria')}</dt>
              <dd className={`font-semibold tabular-nums ${quedaria < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'}`}>{monto(quedaria)}</dd>
            </div>
            {noAlcanza && <p role="alert" className="col-span-2 text-[12.5px] font-medium text-[var(--color-error)]">{tf('finNoAlcanza', { monto: monto(-quedaria) })}</p>}
          </dl>
        )}
        <Seccion>
          {categorias.map((c) => {
            const usado = c.gastado + c.comprometido;
            return (
              <Campo
                key={c.categoria}
                id={`presupuesto-${c.categoria}`}
                label={tf(`finCat${c.categoria}`)}
                ayuda={usado > 0 ? tf('finGastadoPendienteAyuda', { gastado: monto(c.gastado), pendiente: monto(c.comprometido) }) : undefined}
              >
                <input
                  id={`presupuesto-${c.categoria}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="form-input tabular-nums"
                  value={montos[c.categoria]}
                  onChange={cambiar(c.categoria)}
                  placeholder={tf('finPresupuestoMontoPh')}
                />
              </Campo>
            );
          })}
        </Seccion>
        <p className="flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-[13.5px] text-[var(--color-text)]">
          <span className="font-medium">{tf('finTotalMes')}</span>
          <strong className="tabular-nums">{monto(total / 100)}</strong>
        </p>
      </form>
    </Modal>
  );
};

export default FormularioPresupuesto;
