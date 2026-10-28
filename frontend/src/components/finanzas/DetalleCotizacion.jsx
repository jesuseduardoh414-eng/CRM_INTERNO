// Ficha de una cotización: datos, versiones (la 1 es la original y ninguna se
// reemplaza ni se borra), subida de una versión nueva, comparación lado a
// lado con la original y bitácora. Corregir datos, cambiar el estado,
// eliminar y elegir quién la ve son permisos aparte (de fábrica, solo del
// administrador general).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Columns2, Download, Edit2, Eye, FileUp, History, Loader2, Lock, RotateCcw, Save, Trash2, XCircle } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import ActionMenu from '../ActionMenu';
import { ListSkeleton } from '../Skeleton';
import Bitacora from './Bitacora';
import {
  AvisoError, Campo, Dato, OrigenArchivo, Panel, Seccion,
} from './piezas';
import { ZonaArchivo } from './FormularioCotizacion';
import { PanelArchivo } from '../ArchivoPrivado';
import { ModalAccesoCotizacion, ResumenAccesoCotizacion } from './AccesoCotizacion';
import { useVerArchivo } from '../../hooks/useVerArchivo';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useConfirmacion } from '../ConfirmDialog';
import { BADGE_ESTADO_COTIZACION, etiquetaEmpresa, formatearTamano } from '../../utils/finanzas';
import { accesoDe } from '../../utils/accesoConocimiento';

const servicio = finanzasService.cotizaciones;

/** "+$1,500.00" o "−$200.00". */
const conSigno = (valor, monto, moneda) => `${valor > 0 ? '+' : valor < 0 ? '−' : ''}${monto(Math.abs(valor), moneda)}`;

const FormularioVersion = ({ cotizacion, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const [archivo, setArchivo] = useState(null);
  const [form, setForm] = useState({ monto: '', nota: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const numero = cotizacion.versiones.length + 1;

  const guardar = async (e) => {
    e.preventDefault();
    if (!archivo) { setError({ texto: tf('finCotArchivoFalta') }); return; }
    setGuardando(true);
    setError(null);
    try {
      const data = await servicio.nuevaVersion(cotizacion.id, archivo, form);
      showToast(tf('finCotVersionSubida', { n: data.version.numero }), 'success');
      onGuardado();
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="620px"
      title={`${tf('finCotNuevaVersion')} · ${tf('finCotVersion', { n: numero })}`}
      subtitle={tf('finCotNuevaVersionSub')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-version" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <form id="form-version" onSubmit={guardar} noValidate>
        <AvisoError error={error} />
        <div className="mb-5">
          <ZonaArchivo archivo={archivo} onElegir={(f) => { setArchivo(f); setError(null); }} onQuitar={() => setArchivo(null)} onError={(texto) => setError({ texto })} tf={tf} t={t} />
        </div>
        <Seccion>
          <Campo id="ver-nota" label={tf('finCotQueCambio')} requerido ancho>
            <textarea id="ver-nota" rows={3} className="form-input" value={form.nota} onChange={(e) => setForm((p) => ({ ...p, nota: e.target.value }))} maxLength={2000} placeholder={tf('finCotQueCambioPh')} required autoFocus />
          </Campo>
          <Campo id="ver-monto" label={`${tf('finCotMonto')} (${cotizacion.moneda})`} ayuda={tf('finCotMontoAyuda')}>
            <input id="ver-monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={(e) => setForm((p) => ({ ...p, monto: e.target.value }))} />
          </Campo>
        </Seccion>
      </form>
    </Modal>
  );
};

const DetalleCotizacion = ({ cotizacionId, puedeSubir, permisos = {}, onClose, onEditar, onCambio }) => {
  const { t, locale } = usePreferences();
  const tf = useTextoFinanzas();
  const { monto, fecha, fechaHora } = useFormatoFinanzas();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [cotizacion, setCotizacion] = useState(null);
  const [error, setError] = useState(null);
  const [subiendoVersion, setSubiendoVersion] = useState(false);
  const [comparando, setComparando] = useState(null);
  const [verBitacora, setVerBitacora] = useState(false);
  const [cambiandoAcceso, setCambiandoAcceso] = useState(false);
  const textosArchivo = { soloDescarga: tf('finCotSoloDescarga'), descargar: tf('finCotDescargar'), abrir: tf('finCotVer') };
  const cargarArchivo = useCallback((id) => servicio.urlArchivo(id), []);
  const { ver, descargar, visor } = useVerArchivo({ cargar: cargarArchivo, descargarArchivo: servicio.descargarArchivo, textos: textosArchivo });

  const recargar = useCallback(async () => {
    const data = await servicio.obtener(cotizacionId);
    setCotizacion(data.cotizacion);
  }, [cotizacionId]);

  useEffect(() => {
    let cancelado = false;
    servicio.obtener(cotizacionId)
      .then((data) => { if (!cancelado) setCotizacion(data.cotizacion); })
      .catch((err) => { if (!cancelado) setError(err.message); });
    return () => { cancelado = true; };
  }, [cotizacionId]);

  const cambiarEstado = async (estado) => {
    try {
      await servicio.cambiarEstado(cotizacion.id, estado);
      showToast(tf('finCotEstadoCambiado'), 'success');
      await recargar();
      onCambio();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Si la persona se quitó a sí misma de la lista, ya no la ve: se cierra.
  const guardarAcceso = async (valor) => {
    const res = await servicio.cambiarAcceso(cotizacion.id, valor);
    onCambio();
    if (res.sinAcceso) {
      showToast(tf('finCotAccSinAcceso'), 'success');
      onClose();
      return;
    }
    setCotizacion(res.cotizacion);
    showToast(tf('finCotAccGuardado'), 'success');
  };

  const eliminar = async () => {
    const ok = await confirmar({
      titulo: tf('finCotEliminarConfirm', { folio: cotizacion.folio }),
      descripcion: tf('finCotEliminarTexto', { n: cotizacion.versiones.length }),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await servicio.eliminar(cotizacion.id);
      showToast(tf('finCotEliminada'), 'success');
      onCambio();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Cada acción con su casilla: editar (corregir datos), aprobar (estado) y
  // eliminar. La versión original nunca se toca.
  const gestiona = permisos.editar || permisos.aprobar || permisos.eliminar;
  const acciones = cotizacion && gestiona ? [
    permisos.editar && { label: tf('finCotCorregir'), icon: <Edit2 size={14} />, onSelect: () => onEditar(cotizacion) },
    permisos.editar && permisos.aprobar && { separator: true },
    permisos.aprobar && cotizacion.estado !== 'APROBADA' && { label: tf('finCotAprobar'), icon: <CheckCircle2 size={14} />, onSelect: () => cambiarEstado('APROBADA') },
    permisos.aprobar && cotizacion.estado !== 'RECHAZADA' && { label: tf('finCotRechazar'), icon: <XCircle size={14} />, onSelect: () => cambiarEstado('RECHAZADA') },
    permisos.aprobar && cotizacion.estado !== 'PENDIENTE' && { label: tf('finCotVolverPendiente'), icon: <RotateCcw size={14} />, onSelect: () => cambiarEstado('PENDIENTE') },
    permisos.eliminar && (permisos.editar || permisos.aprobar) && { separator: true },
    permisos.eliminar && { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onSelect: eliminar },
  ].filter(Boolean) : [];

  const versiones = cotizacion?.versiones || [];
  const original = versiones[0];
  // De la más nueva a la original.
  const ordenadas = [...versiones].reverse();
  const pct = (dif, base) => (base ? `${dif >= 0 ? '+' : '−'}${Math.abs(Math.round((dif / base) * 1000) / 10)}%` : '');

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="980px"
      title={cotizacion ? cotizacion.titulo : tf('finCotizacion')}
      subtitle={cotizacion ? `${cotizacion.folio} · ${tf(`finCotTipo${cotizacion.tipo}`)} · ${cotizacion.contraparteNombre || cotizacion.empresa?.nombre || '—'}` : undefined}
      headerExtra={cotizacion && (
        <div className="flex items-center gap-2">
          <span className={BADGE_ESTADO_COTIZACION[cotizacion.estado] || 'badge-neutral'}>{tf(`finCotEstado${cotizacion.estado}`)}</span>
          {acciones.length > 0 && <ActionMenu size={18} className="h-10 w-10" items={acciones} />}
        </div>
      )}
    >
      {dialogo}
      {visor}
      {error && <div className="alert-error">{error}</div>}
      {!cotizacion && !error && <ListSkeleton rows={4} header={false} />}
      {cotizacion && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-6">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4">
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{tf('finCotMontoVigente')}</div>
              <div className="mt-1 text-[28px] font-semibold tabular-nums text-[var(--color-text)]">{cotizacion.montoActual !== null ? monto(cotizacion.montoActual, cotizacion.moneda) : tf('finCotSinMonto')}</div>
              {cotizacion.totalVersiones > 1 && cotizacion.diferencia !== null && (
                <div className={`mt-1 text-[12.5px] font-medium ${cotizacion.diferencia > 0 ? 'text-[var(--color-error)]' : cotizacion.diferencia < 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
                  {tf('finCotVsOriginal', { dif: conSigno(cotizacion.diferencia, monto, cotizacion.moneda), pct: pct(cotizacion.diferencia, cotizacion.montoOriginal) })}
                </div>
              )}
              {cotizacion.totalVersiones > 1 && cotizacion.montoOriginal !== null && (
                <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{tf('finCotMontoOriginalDe', { monto: monto(cotizacion.montoOriginal, cotizacion.moneda) })}</div>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <Dato etiqueta={tf(`finCotContraparte${cotizacion.tipo}`)}>{cotizacion.contraparteNombre || cotizacion.empresa?.nombre}</Dato>
              {cotizacion.cliente && cotizacion.tipo === 'RECIBIDA' && <Dato etiqueta={tf('finClienteDe')}><Link to={`/clientes/${cotizacion.cliente.id}`} className="hover:underline">{etiquetaEmpresa(cotizacion.cliente)}</Link></Dato>}
              <Dato etiqueta={tf('finCotFecha')}>{fecha(cotizacion.fecha)}</Dato>
              <Dato etiqueta={tf('finRegistradoPor')}>{cotizacion.creadoPor?.nombre}</Dato>
              <Dato etiqueta={tf('finRegistradoEl')}>{fechaHora(cotizacion.creadoEn)}</Dato>
              {cotizacion.descripcion && <Dato etiqueta={tf('finDescripcion')} ancho><span className="whitespace-pre-wrap">{cotizacion.descripcion}</span></Dato>}
            </dl>
            {permisos.acceso && (
              <Panel titulo={tf('finCotAccQuienVe')} extra={<Button variant="ghost" size="sm" onClick={() => setCambiandoAcceso(true)}>{tf('finCotAccCambiar')}</Button>}>
                <div className="px-4 pb-4 pt-1"><ResumenAccesoCotizacion acceso={accesoDe(cotizacion)} creadorId={cotizacion.creadoPorId} /></div>
              </Panel>
            )}
            {!permisos.acceso && cotizacion.restringido && (
              <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)]"><Lock size={13} className="shrink-0" aria-hidden="true" />{tf('finCotAccRestringida')}</p>
            )}
            {!gestiona && <p className="text-[12px] text-[var(--color-text-muted)]">{tf('finCotSoloAdmin')}</p>}
            <div>
              <Button variant="ghost" size="sm" className="text-[var(--color-text-dim)]" onClick={() => setVerBitacora((v) => !v)}>
                <History size={15} /> {verBitacora ? tf('finOcultarBitacora') : tf('finVerBitacora')}
              </Button>
              {verBitacora && <Bitacora entidad="cotizacion" entidadId={cotizacion.id} />}
            </div>
          </div>

          <Panel
            titulo={tf('finCotVersiones')}
            conteo={versiones.length}
            extra={puedeSubir && <Button size="sm" onClick={() => setSubiendoVersion(true)}><FileUp size={15} /> {tf('finCotNuevaVersion')}</Button>}
          >
            <ol className="divide-y divide-[var(--color-border)]">
              {ordenadas.map((v) => {
                const anterior = versiones.find((x) => x.numero === v.numero - 1);
                const difAnterior = anterior && anterior.monto !== null && v.monto !== null ? Math.round((v.monto - anterior.monto) * 100) / 100 : null;
                const esUltima = v.numero === versiones.length;
                return (
                  <li key={v.id} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-[var(--color-text)]">{tf('finCotVersion', { n: v.numero })}</span>
                      {v.numero === 1 && <span className="badge-neutral">{tf('finCotOriginal')}</span>}
                      {esUltima && versiones.length > 1 && <span className="badge-info">{tf('finCotVigente')}</span>}
                      <span className="ml-auto text-[13.5px] font-semibold tabular-nums text-[var(--color-text)]">{v.monto !== null ? monto(v.monto, cotizacion.moneda) : <span className="font-normal text-[var(--color-text-muted)]">{tf('finCotSinMonto')}</span>}</span>
                    </div>
                    {difAnterior !== null && difAnterior !== 0 && (
                      <div className={`mt-0.5 text-right text-[12px] ${difAnterior > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>{tf('finCotVsAnterior', { dif: conSigno(difAnterior, monto, cotizacion.moneda) })}</div>
                    )}
                    {v.nota && <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-[var(--color-text)]">{v.nota}</p>}
                    <OrigenArchivo item={v} texto={tf('finOrigenDesde')} />
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button type="button" className="min-w-0 max-w-full truncate text-left text-[12.5px] font-medium text-[var(--color-text)] hover:underline" onClick={() => ver(v)}>{v.nombreOriginal}</button>
                      <span className="text-[12px] text-[var(--color-text-muted)]">{formatearTamano(v.tamano)} · {tf('finCotSubidaPor', { nombre: v.subidoPor?.nombre || '—', fecha: new Date(v.creadoEn).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => ver(v)}><Eye size={14} /> {tf('finCotVer')}</Button>
                      <Button variant="ghost" size="sm" onClick={() => descargar(v)}><Download size={14} /> {tf('finCotDescargar')}</Button>
                      {v.numero > 1 && original && (
                        <Button variant="ghost" size="sm" onClick={() => setComparando(v)}><Columns2 size={14} /> {tf('finCotComparar')}</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      )}

      {subiendoVersion && cotizacion && (
        <FormularioVersion
          cotizacion={cotizacion}
          onClose={() => setSubiendoVersion(false)}
          onGuardado={async () => { setSubiendoVersion(false); await recargar(); onCambio(); }}
        />
      )}

      {cotizacion && (
        <ModalAccesoCotizacion
          abierto={cambiandoAcceso}
          titulo={tf('finCotAccTitulo', { folio: cotizacion.folio })}
          inicial={accesoDe(cotizacion)}
          creadorId={cotizacion.creadoPorId}
          onCerrar={() => setCambiandoAcceso(false)}
          onGuardar={guardarAcceso}
        />
      )}

      {comparando && original && (
        <Modal open onClose={() => setComparando(null)} maxWidth="1400px" height="min(92dvh, 960px)" title={tf('finCotCompararTitulo', { n: comparando.numero })} bodyClassName="!p-0">
          <div className="grid h-full grid-cols-1 md:grid-cols-2 md:divide-x divide-[var(--color-border)]">
            {[original, comparando].map((v) => (
              <div key={v.id} className="flex min-h-[320px] flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2 text-[12.5px]">
                  <span className="font-semibold text-[var(--color-text)]">{tf('finCotVersion', { n: v.numero })}{v.numero === 1 ? ` · ${tf('finCotOriginal')}` : ''}</span>
                  <span className="tabular-nums text-[var(--color-text-muted)]">{v.monto !== null ? monto(v.monto, cotizacion.moneda) : tf('finCotSinMonto')}</span>
                </div>
                <div className="min-h-0 flex-1">
                  <PanelArchivo archivo={v} cargar={cargarArchivo} descargar={descargar} textos={textosArchivo} />
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Modal>
  );
};

export default DetalleCotizacion;
