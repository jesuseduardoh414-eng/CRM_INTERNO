// Editor de permisos de finanzas de un usuario: nivel (ninguno / ver /
// editar) en Ventas, Tesorería, Informe y cada categoría de gastos. Lo usa
// la ventana de editar usuario (solo el administrador global).
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { CATEGORIAS_GASTO, NIVELES, permisosVacios } from '../../utils/finanzas';

const Fila = ({ id, etiqueta, nivel, onCambio, tf }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span id={id} className="text-[13px] text-[var(--color-text)]">{etiqueta}</span>
    <div className="dash-segmento h-8 shrink-0 items-center text-[12px]" role="radiogroup" aria-labelledby={id}>
      {NIVELES.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={nivel === n} onClick={() => onCambio(n)}>{tf(`finNivel_${n}`)}</button>
      ))}
    </div>
  </div>
);

const PermisosFinanzas = ({ valor, onCambio }) => {
  const tf = useTextoFinanzas();
  const permisos = valor || permisosVacios();
  const poner = (recurso, nivel) => onCambio({ ...permisos, [recurso]: nivel });
  const ponerGasto = (categoria, nivel) => onCambio({ ...permisos, gastos: { ...permisos.gastos, [categoria]: nivel } });
  const todo = (nivel) => onCambio({ ventas: nivel, tesoreria: nivel, informe: nivel, gastos: Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, nivel])) });

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-text)]">{tf('finPermisosTitulo')}</div>
          <div className="text-[12px] text-[var(--color-text-muted)]">{tf('finPermisosAyuda')}</div>
        </div>
        <div className="flex gap-1 text-[12px]">
          <button type="button" className="cli-enlace" onClick={() => todo('ninguno')}>{tf('finPermisosNada')}</button>
          <span className="text-[var(--color-text-muted)]">·</span>
          <button type="button" className="cli-enlace" onClick={() => todo('ver')}>{tf('finPermisosTodoVer')}</button>
          <span className="text-[var(--color-text-muted)]">·</span>
          <button type="button" className="cli-enlace" onClick={() => todo('editar')}>{tf('finPermisosTodoEditar')}</button>
        </div>
      </div>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        <Fila id="perm-ventas" etiqueta={tf('finVentasTitulo')} nivel={permisos.ventas} onCambio={(n) => poner('ventas', n)} tf={tf} />
        <Fila id="perm-tesoreria" etiqueta={tf('finTesoreriaTitulo')} nivel={permisos.tesoreria} onCambio={(n) => poner('tesoreria', n)} tf={tf} />
        <Fila id="perm-informe" etiqueta={tf('finInformeTitulo')} nivel={permisos.informe} onCambio={(n) => poner('informe', n)} tf={tf} />
        <div className="pt-2">
          <div className="pb-1 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{tf('finGastosTitulo')}</div>
          {CATEGORIAS_GASTO.map((c) => (
            <Fila key={c} id={`perm-gastos-${c}`} etiqueta={tf(`finCat${c}`)} nivel={permisos.gastos[c]} onCambio={(n) => ponerGasto(c, n)} tf={tf} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default PermisosFinanzas;
