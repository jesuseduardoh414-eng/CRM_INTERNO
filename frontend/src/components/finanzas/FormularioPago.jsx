// Ventana para registrar o editar un pago recibido (Ventas). Al crear se
// puede adjuntar ya el comprobante; se sube justo después de guardar.
import { useEffect, useRef, useState } from 'react';
import { FileUp, Loader2, Save, X } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, Seccion } from './piezas';
import {
  ACEPTA_COMPROBANTE, METODOS_PAGO, MONEDAS, comprobanteMaxBytes, comprobanteMaxMegas, esComprobanteValido, hoyClave,
} from '../../utils/finanzas';

const VACIO = {
  concepto: '', monto: '', moneda: 'MXN', fecha: '', metodo: 'TRANSFERENCIA', referencia: '',
  empresaId: '', clienteNombre: '', cuentaId: '', contratoId: '', proyectoId: '', notas: '',
};

const desdePago = (p) => Object.fromEntries(Object.keys(VACIO).map((k) => {
  const valor = p?.[k];
  if (valor === null || valor === undefined) return [k, VACIO[k]];
  return [k, String(valor)];
}));

const FormularioPago = ({ open, pago, catalogos, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const editando = Boolean(pago?.id);
  const [form, setForm] = useState(() => (editando ? desdePago(pago) : { ...VACIO, fecha: hoyClave() }));
  const [comprobante, setComprobante] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const refError = useRef(null);

  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const cambiar = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };
  const elegir = (name) => (value) => cambiar({ target: { name, value } });

  // Al elegir un cliente del directorio se propone su nombre y se acotan
  // contratos y proyectos a los suyos.
  // Al cambiar de cliente: el nombre se reemplaza si estaba vacío o era el de
  // la ficha anterior (no si se escribió a mano), y se sueltan el contrato y el
  // proyecto que no son del nuevo cliente.
  const elegirCliente = (empresaId) => {
    const lista = catalogos?.clientes || [];
    const ficha = lista.find((c) => String(c.id) === empresaId);
    setForm((prev) => {
      const anterior = lista.find((c) => String(c.id) === prev.empresaId);
      const nombreAnterior = anterior ? (anterior.nombreComercial || anterior.nombre) : '';
      const reemplazar = !prev.clienteNombre || prev.clienteNombre === nombreAnterior;
      const contrato = (catalogos?.contratos || []).find((c) => String(c.id) === prev.contratoId);
      const proyecto = (catalogos?.proyectos || []).find((p) => String(p.id) === prev.proyectoId);
      return {
        ...prev,
        empresaId,
        clienteNombre: reemplazar ? (ficha ? (ficha.nombreComercial || ficha.nombre) : '') : prev.clienteNombre,
        contratoId: contrato && empresaId && contrato.empresaId && String(contrato.empresaId) !== empresaId ? '' : prev.contratoId,
        proyectoId: proyecto && empresaId && proyecto.clienteId && String(proyecto.clienteId) !== empresaId ? '' : prev.proyectoId,
      };
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
      empresaId: form.empresaId || null,
      cuentaId: form.cuentaId || null,
      contratoId: form.contratoId || null,
      proyectoId: form.proyectoId || null,
    };
    try {
      const data = editando ? await finanzasService.pagos.editar(pago.id, datos) : await finanzasService.pagos.crear(datos);
      if (comprobante) {
        try {
          await finanzasService.pagos.subirComprobante(data.pago.id, comprobante);
        } catch (errorArchivo) {
          showToast(errorArchivo.message, 'error');
        }
      }
      showToast(editando ? tf('finPagoActualizado') : tf('finPagoCreado', { folio: data.pago.folio }), 'success');
      onGuardado(data.pago);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  const clientes = catalogos?.clientes || [];
  const contratos = (catalogos?.contratos || []).filter((c) => !form.empresaId || String(c.empresaId) === form.empresaId || !c.empresaId);
  const proyectos = (catalogos?.proyectos || []).filter((p) => !form.empresaId || String(p.clienteId) === form.empresaId || !p.clienteId);
  const cuentas = (catalogos?.cuentas || []).filter((c) => c.activa || String(c.id) === form.cuentaId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="760px"
      title={editando ? tf('finPagoEditar') : tf('finPagoNuevo')}
      subtitle={editando ? pago.folio : tf('finRequeridos')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-pago" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <form id="form-pago" onSubmit={guardar} noValidate>
        <AvisoError error={error} refError={refError} />

        <Seccion titulo={tf('finSecPago')}>
          <Campo id="pago-concepto" label={tf('finConcepto')} requerido ancho>
            <input id="pago-concepto" name="concepto" className="form-input" value={form.concepto} onChange={cambiar} placeholder={tf('finConceptoPagoPh')} maxLength={255} required autoFocus />
          </Campo>
          <Campo id="pago-monto" label={tf('finMonto')} requerido>
            <input id="pago-monto" name="monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={cambiar} required />
          </Campo>
          <Campo id="pago-moneda" label={tf('finMoneda')}>
            <SelectorSimple id="pago-moneda" valor={form.moneda} onCambio={elegir('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
          </Campo>
          <Campo id="pago-fecha" label={tf('finFechaPago')} requerido>
            <input id="pago-fecha" name="fecha" type="date" className="form-input" value={form.fecha} onChange={cambiar} required />
          </Campo>
          <Campo id="pago-metodo" label={tf('finMetodo')}>
            <SelectorSimple id="pago-metodo" valor={form.metodo} onCambio={elegir('metodo')} opciones={METODOS_PAGO.map((m) => ({ valor: m, etiqueta: tf(`finMetodo${m}`) }))} />
          </Campo>
          <Campo id="pago-cuenta" label={tf('finCuentaDestino')} ayuda={cuentas.length === 0 ? tf('finSinCuentasAyuda') : undefined}>
            <SelectorSimple id="pago-cuenta" valor={form.cuentaId} onCambio={elegir('cuentaId')} opcionVacia={tf('finSinCuenta')} opciones={cuentas.map((c) => ({ valor: String(c.id), etiqueta: c.banco ? `${c.nombre} · ${c.banco}` : c.nombre }))} />
          </Campo>
          <Campo id="pago-ref" label={tf('finReferencia')}>
            <input id="pago-ref" name="referencia" className="form-input" value={form.referencia} onChange={cambiar} maxLength={80} placeholder={tf('finReferenciaPh')} />
          </Campo>
        </Seccion>

        <Seccion titulo={tf('finSecCliente')}>
          {clientes.length > 0 && (
            <Campo id="pago-empresa" label={tf('finClienteDirectorio')}>
              <SelectorSimple id="pago-empresa" valor={form.empresaId} onCambio={elegirCliente} opcionVacia={tf('finClienteSinFicha')} opciones={clientes.map((c) => ({ valor: String(c.id), etiqueta: c.nombreComercial ? `${c.nombreComercial} (${c.nombre})` : c.nombre }))} />
            </Campo>
          )}
          <Campo id="pago-cliente" label={tf('finClienteNombre')} requerido={!form.empresaId} ancho={clientes.length === 0}>
            <input id="pago-cliente" name="clienteNombre" className="form-input" value={form.clienteNombre} onChange={cambiar} maxLength={255} required={!form.empresaId} placeholder={tf('finClienteNombrePh')} />
          </Campo>
          {contratos.length > 0 && (
            <Campo id="pago-contrato" label={tf('finContrato')}>
              <SelectorSimple id="pago-contrato" valor={form.contratoId} onCambio={elegir('contratoId')} opcionVacia={tf('finNinguno')} opciones={contratos.map((c) => ({ valor: String(c.id), etiqueta: `${c.folio} · ${c.titulo}` }))} />
            </Campo>
          )}
          {proyectos.length > 0 && (
            <Campo id="pago-proyecto" label={tf('finProyecto')}>
              <SelectorSimple id="pago-proyecto" valor={form.proyectoId} onCambio={elegir('proyectoId')} opcionVacia={tf('finNinguno')} opciones={proyectos.map((p) => ({ valor: String(p.id), etiqueta: p.nombre }))} />
            </Campo>
          )}
          <Campo id="pago-notas" label={tf('finNotas')} ancho>
            <textarea id="pago-notas" name="notas" rows={2} className="form-input" value={form.notas} onChange={cambiar} />
          </Campo>
        </Seccion>

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
                  <span>{tf('finCompAdjuntarHint', { mb: comprobanteMaxMegas() })}</span>
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

export default FormularioPago;
