// Ventana para registrar o editar un gasto. La categoría viene fijada por la
// pantalla desde la que se abre (se puede cambiar a otra donde se tenga
// permiso de edición). Al crear se puede adjuntar ya la factura o ticket.
import { useEffect, useRef, useState } from 'react';
import { FileUp, Loader2, Save, X } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { finanzasService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, PuntoPartida, Seccion } from './piezas';
import {
  ACEPTA_COMPROBANTE, METODOS_PAGO, MONEDAS, MONEDA_BASE, categoriasEditables, comprobanteMaxBytes, comprobanteMaxMegas,
  esComprobanteValido, hoyClave,
} from '../../utils/finanzas';

const VACIO = {
  categoria: '', concepto: '', descripcion: '', monto: '', moneda: 'MXN', fecha: '', fechaLimite: '', estado: 'PENDIENTE', pagadoEn: '',
  metodo: '', referencia: '', partidaId: '', empresaId: '', proveedorNombre: '', cuentaId: '', notas: '',
};

const desdeGasto = (g) => Object.fromEntries(Object.keys(VACIO).map((k) => {
  const valor = g?.[k];
  if (valor === null || valor === undefined) return [k, VACIO[k]];
  return [k, String(valor)];
}));

const FormularioGasto = ({ open, gasto, categoria, catalogos, onClose, onGuardado }) => {
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const editando = Boolean(gasto?.id);
  const [form, setForm] = useState(() => (editando ? desdeGasto(gasto) : { ...VACIO, categoria: categoria || '', fecha: hoyClave() }));
  const [comprobante, setComprobante] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const refError = useRef(null);
  const categorias = categoriasEditables(usuario);

  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const cambiar = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };
  const elegir = (name) => (value) => cambiar({ target: { name, value } });

  // Al cambiar de proveedor el nombre se reemplaza si estaba vacío o era el de la ficha anterior.
  const elegirProveedor = (empresaId) => {
    const lista = catalogos?.proveedores || [];
    const ficha = lista.find((c) => String(c.id) === empresaId);
    setForm((prev) => {
      const anterior = lista.find((c) => String(c.id) === prev.empresaId);
      const nombreAnterior = anterior ? (anterior.nombreComercial || anterior.nombre) : '';
      const reemplazar = !prev.proveedorNombre || prev.proveedorNombre === nombreAnterior;
      return { ...prev, empresaId, proveedorNombre: reemplazar ? (ficha ? (ficha.nombreComercial || ficha.nombre) : '') : prev.proveedorNombre };
    });
    setError(null);
  };

  const elegirArchivo = (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (!esComprobanteValido(archivo)) { setError({ texto: tf('finCompTipo') }); return; }
    if (archivo.size > comprobanteMaxBytes()) { setError({ texto: tf('finCompTamano', { mb: comprobanteMaxMegas() }) }); return; }
    setComprobante(archivo);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const datos = {
      ...form,
      partidaId: form.partidaId || null,
      empresaId: form.empresaId || null,
      cuentaId: form.cuentaId || null,
      metodo: form.metodo || null,
      fechaLimite: form.fechaLimite || null,
      pagadoEn: form.pagadoEn || null,
    };
    // El estado inicial solo se manda al crear; después se cambia con "Marcar pagado".
    if (editando) { delete datos.estado; if (gasto.estado !== 'PAGADO') delete datos.pagadoEn; }
    try {
      const data = editando ? await finanzasService.gastos.editar(gasto.id, datos) : await finanzasService.gastos.crear(datos);
      if (comprobante) {
        try {
          await finanzasService.gastos.subirComprobante(data.gasto.id, comprobante);
        } catch (errorArchivo) {
          showToast(errorArchivo.message, 'error');
        }
      }
      showToast(editando ? tf('finGastoActualizado') : tf('finGastoCreado', { folio: data.gasto.folio }), 'success');
      onGuardado(data.gasto);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  const proveedores = catalogos?.proveedores || [];
  const partidas = (catalogos?.partidas || []).filter((p) => p.activa || String(p.id) === form.partidaId);
  const cuentas = (catalogos?.cuentas || []).filter((c) => c.activa || String(c.id) === form.cuentaId);
  const conPartida = Boolean(form.partidaId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="760px"
      title={editando ? tf('finGastoEditar') : tf('finGastoNuevo')}
      subtitle={editando ? gasto.folio : tf('finRequeridos')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-gasto" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <form id="form-gasto" onSubmit={guardar} noValidate>
        <AvisoError error={error} refError={refError} />

        <Seccion titulo={tf('finSecGasto')}>
          <Campo id="gasto-categoria" label={tf('finCategoria')} requerido>
            <SelectorSimple id="gasto-categoria" valor={form.categoria} onCambio={elegir('categoria')} opcionVacia={tf('finElegir')} opciones={categorias.map((c) => ({ valor: c, etiqueta: tf(`finCat${c}`) }))} />
          </Campo>
          <Campo id="gasto-partida" label={tf('finPartida')} ayuda={partidas.length === 0 ? tf('finSinPartidasAyuda') : tf('finPartidaAyuda')}>
            <SelectorSimple id="gasto-partida" valor={form.partidaId} onCambio={elegir('partidaId')} opcionVacia={tf('finSinPartida')} opciones={partidas.map((p) => ({ valor: String(p.id), etiqueta: p.nombre }))} />
          </Campo>
          <Campo id="gasto-concepto" label={tf('finConcepto')} requerido ancho>
            <input id="gasto-concepto" name="concepto" className="form-input" value={form.concepto} onChange={cambiar} placeholder={tf('finConceptoGastoPh')} maxLength={255} required autoFocus />
          </Campo>
          <Campo id="gasto-monto" label={tf('finMonto')} requerido>
            <input id="gasto-monto" name="monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={cambiar} required />
          </Campo>
          <Campo id="gasto-moneda" label={tf('finMoneda')} ayuda={conPartida && form.moneda !== MONEDA_BASE ? tf('finPartidaSoloMxn', { moneda: MONEDA_BASE }) : undefined}>
            <SelectorSimple id="gasto-moneda" valor={form.moneda} onCambio={elegir('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
          </Campo>
          <Campo id="gasto-fecha" label={tf('finFechaGasto')} requerido ayuda={tf('finFechaGastoAyuda')}>
            <input id="gasto-fecha" name="fecha" type="date" className="form-input" value={form.fecha} onChange={cambiar} required />
          </Campo>
          <Campo id="gasto-limite" label={tf('finFechaLimite')} ayuda={tf('finFechaLimiteAyuda')}>
            <input id="gasto-limite" name="fechaLimite" type="date" className="form-input" value={form.fechaLimite} onChange={cambiar} />
          </Campo>
          <Campo id="gasto-desc" label={tf('finDescripcion')} ancho>
            <textarea id="gasto-desc" name="descripcion" rows={2} className="form-input" value={form.descripcion} onChange={cambiar} />
          </Campo>
        </Seccion>

        <Seccion titulo={tf('finSecProveedorPago')}>
          {proveedores.length > 0 && (
            <Campo id="gasto-empresa" label={tf('finProveedorDirectorio')}>
              <SelectorSimple id="gasto-empresa" valor={form.empresaId} onCambio={elegirProveedor} opcionVacia={tf('finProveedorSinFicha')} opciones={proveedores.map((c) => ({ valor: String(c.id), etiqueta: c.nombreComercial ? `${c.nombreComercial} (${c.nombre})` : c.nombre }))} />
            </Campo>
          )}
          <Campo id="gasto-proveedor" label={tf('finProveedorNombre')} ancho={proveedores.length === 0}>
            <input id="gasto-proveedor" name="proveedorNombre" className="form-input" value={form.proveedorNombre} onChange={cambiar} maxLength={255} placeholder={tf('finProveedorNombrePh')} />
          </Campo>
          {!editando && (
            <Campo id="gasto-estado" label={tf('finEstadoInicial')}>
              <SelectorSimple id="gasto-estado" valor={form.estado} onCambio={elegir('estado')} opciones={[{ valor: 'PENDIENTE', etiqueta: tf('finEstadoGastoPENDIENTE') }, { valor: 'PAGADO', etiqueta: tf('finEstadoGastoPAGADO') }]} />
            </Campo>
          )}
          {(form.estado === 'PAGADO' || gasto?.estado === 'PAGADO') && (
            <Campo id="gasto-pagado" label={tf('finPagadoEn')}>
              <input id="gasto-pagado" name="pagadoEn" type="date" className="form-input" value={form.pagadoEn} onChange={cambiar} />
            </Campo>
          )}
          <Campo id="gasto-cuenta" label={tf('finCuentaOrigen')}>
            <SelectorSimple id="gasto-cuenta" valor={form.cuentaId} onCambio={elegir('cuentaId')} opcionVacia={tf('finSinCuenta')} opciones={cuentas.map((c) => ({ valor: String(c.id), etiqueta: c.banco ? `${c.nombre} · ${c.banco}` : c.nombre }))} />
          </Campo>
          <Campo id="gasto-metodo" label={tf('finMetodo')}>
            <SelectorSimple id="gasto-metodo" valor={form.metodo} onCambio={elegir('metodo')} opcionVacia={tf('finSinEspecificar')} opciones={METODOS_PAGO.map((m) => ({ valor: m, etiqueta: tf(`finMetodo${m}`) }))} />
          </Campo>
          <Campo id="gasto-ref" label={tf('finReferencia')}>
            <input id="gasto-ref" name="referencia" className="form-input" value={form.referencia} onChange={cambiar} maxLength={80} placeholder={tf('finReferenciaGastoPh')} />
          </Campo>
          <Campo id="gasto-notas" label={tf('finNotas')} ancho>
            <textarea id="gasto-notas" name="notas" rows={2} className="form-input" value={form.notas} onChange={cambiar} />
          </Campo>
        </Seccion>

        {conPartida && (
          <p className="-mt-3 mb-5 flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
            <PuntoPartida color={partidas.find((p) => String(p.id) === form.partidaId)?.color} />
            {tf('finPartidaDescuenta', { partida: partidas.find((p) => String(p.id) === form.partidaId)?.nombre || '' })}
          </p>
        )}

        {!editando && (
          <Seccion titulo={tf('finCompAdjuntarAhora')}>
            <div className="sm:col-span-2">
              {comprobante ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-3)] py-1 pl-4 pr-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-[var(--color-text)]">{comprobante.name}</span>
                  <button type="button" onClick={() => setComprobante(null)} className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('removeFile')}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-4 text-sm text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)]">
                  <FileUp size={18} aria-hidden="true" />
                  <span>{tf('finCompAdjuntarHintGasto', { mb: comprobanteMaxMegas() })}</span>
                  <input type="file" accept={ACEPTA_COMPROBANTE} className="sr-only" onChange={elegirArchivo} />
                </label>
              )}
            </div>
          </Seccion>
        )}
      </form>
    </Modal>
  );
};

export default FormularioGasto;
