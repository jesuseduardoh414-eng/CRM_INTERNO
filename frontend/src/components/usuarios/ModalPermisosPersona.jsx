// Ajustes de permisos de una persona (solo el administrador general).
//
// La persona hereda la tabla de su área y rol (Configuración → Permisos);
// aquí se cambian solo las casillas que deban ser distintas para ella. Cada
// fila ofrece "Como su área (valor)" o un valor propio. Al guardar, los
// permisos de finanzas del sistema anterior quedan reemplazados.
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { RotateCcw, Search } from 'lucide-react';
import Modal from '../Modal';
import SelectorSimple from '../SelectorSimple';
import { Button } from '../ui/button';
import { ListSkeleton } from '../Skeleton';
import { usuariosService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoPermisos } from '../../hooks/useTextoPermisos';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import {
  agruparCatalogo, ayudaPermiso, etiquetaPermiso, etiquetaRecurso, normalizarBusqueda, opcionesPermiso, textoValor,
} from '../../utils/catalogoPermisos';

const HEREDA = '__area__';

const ModalPermisosPersona = ({ usuarioId, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tp = useTextoPermisos();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const { nombreArea } = useConfiguracion();
  const { data, error } = useSWR(['usuario-permisos', usuarioId], () => usuariosService.obtenerPermisos(usuarioId), { revalidateOnFocus: false });
  // null = aún sin tocar: se muestran los guardados.
  const [editados, setEditados] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const secciones = useMemo(() => agruparCatalogo(data?.catalogo), [data?.catalogo]);

  const ajustes = editados ?? data?.ajustes ?? {};
  const heredados = data?.heredados || {};
  const totalAjustes = Object.keys(ajustes).length;

  const poner = (permiso, valor) => {
    const siguiente = { ...ajustes };
    if (valor === HEREDA) delete siguiente[permiso.clave];
    else siguiente[permiso.clave] = permiso.tipo === 'bool' ? valor === 'true' : valor;
    setEditados(siguiente);
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await usuariosService.guardarPermisos(usuarioId, ajustes);
      showToast(tp('permGuardado'), 'success');
      onGuardado?.();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const filtro = normalizarBusqueda(busqueda);
  const visibles = secciones
    .map((s) => ({
      ...s,
      grupos: s.grupos
        .map((g) => ({
          ...g,
          permisos: g.permisos.filter((p) => !filtro || [
            tp(`sec.${s.seccion}`), g.conTitulo ? etiquetaRecurso(g.recurso, tp, tf) : '', etiquetaPermiso(p, tp), ayudaPermiso(p, tp) || '',
          ].some((x) => normalizarBusqueda(x).includes(filtro))),
        }))
        .filter((g) => g.permisos.length),
    }))
    .filter((s) => s.grupos.length);

  const persona = data?.usuario;
  const rol = persona?.rol === 'ADMIN' ? tp('permRolAdmin') : tp('permRolMiembro');

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="760px"
      title={persona ? tp('permPersonaTitulo', { nombre: persona.nombre }) : tp('permPersonaBoton')}
      subtitle={persona ? tp('permPersonaTexto', { area: nombreArea(persona.area), rol }) : undefined}
      footer={data && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setEditados({})} disabled={!totalAjustes || guardando}>
            <RotateCcw size={15} /> {tp('permQuitarAjustes')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="button" onClick={guardar} disabled={guardando || editados === null}>
              {guardando ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}
    >
      {error && <div className="alert-error">{error.message}</div>}
      {!data && !error && <ListSkeleton rows={6} header={false} />}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
              <input
                type="search"
                className="form-input !pl-9"
                placeholder={tp('permBuscar')}
                aria-label={tp('permBuscar')}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </label>
            <span className={totalAjustes ? 'badge-info shrink-0' : 'badge-neutral shrink-0'}>
              {totalAjustes ? tp('permAjustes', { n: totalAjustes }) : tp('permSinAjustes')}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)]">{tp('permLeyenda')}</p>

          {visibles.length === 0 && <p className="text-[13px] text-[var(--color-text-muted)]">{tp('permSinResultados')}</p>}
          {visibles.map(({ seccion, grupos }) => (
            <section key={seccion} className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <h3 className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-text)]">
                {tp(`sec.${seccion}`)}
              </h3>
              {grupos.map((grupo) => (
                <div key={grupo.recurso}>
                  {grupo.conTitulo && (
                    <p className="border-t border-[var(--color-border-light)] px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] first:border-t-0">
                      {etiquetaRecurso(grupo.recurso, tp, tf)}
                    </p>
                  )}
                  {grupo.permisos.map((permiso) => {
                    const etiqueta = etiquetaPermiso(permiso, tp);
                    const ayuda = ayudaPermiso(permiso, tp);
                    const propio = Object.prototype.hasOwnProperty.call(ajustes, permiso.clave);
                    return (
                      <div key={permiso.clave} className="grid grid-cols-1 items-center gap-2 border-t border-[var(--color-border-light)] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_16.5rem]">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--color-text)]">
                            {etiqueta}
                            {propio && <span className="badge-info !px-1.5 !py-0 text-[10.5px]">{tp('permCambiado')}</span>}
                          </p>
                          {ayuda && <p className="text-[12px] leading-snug text-[var(--color-text-dim)]">{ayuda}</p>}
                        </div>
                        <SelectorSimple
                          valor={propio ? String(ajustes[permiso.clave]) : HEREDA}
                          onCambio={(v) => poner(permiso, v)}
                          aria-label={etiqueta}
                          opciones={[
                            { valor: HEREDA, etiqueta: tp('permComoArea', { valor: textoValor(permiso, heredados[permiso.clave], tp) }) },
                            ...opcionesPermiso(permiso, tp),
                          ]}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default ModalPermisosPersona;
