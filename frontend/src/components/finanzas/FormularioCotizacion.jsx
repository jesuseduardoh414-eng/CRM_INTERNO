// Ventana para subir una cotización nueva (datos + archivo original + monto)
// o, solo el administrador general, corregir sus datos. Al corregir no se
// tocan los archivos: las versiones nunca se reemplazan.
import { useState } from 'react';
import { FileUp, Loader2, Lock, Save, X } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { finanzasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AvisoError, Campo, Seccion } from './piezas';
import {
  ACEPTA_DOCUMENTO, MONEDAS, TIPOS_COTIZACION, comprobanteMaxBytes, comprobanteMaxMegas, esDocumentoValido, hoyClave,
} from '../../utils/finanzas';

const desdeCotizacion = (c) => ({
  tipo: c?.tipo || 'RECIBIDA',
  titulo: c?.titulo || '',
  descripcion: c?.descripcion || '',
  empresaId: c?.empresaId ? String(c.empresaId) : '',
  contraparteNombre: c?.contraparteNombre || '',
  moneda: c?.moneda || 'MXN',
  fecha: c?.fecha || hoyClave(),
  monto: '',
  nota: '',
});

/** Zona para elegir o soltar un archivo. */
export const ZonaArchivo = ({ archivo, onElegir, onQuitar, onError, tf, t }) => {
  const [arrastrando, setArrastrando] = useState(false);
  const elegir = (f) => {
    if (!f) return;
    if (!esDocumentoValido(f)) { onError(tf('finCotArchivoTipo')); return; }
    if (f.size > comprobanteMaxBytes()) { onError(tf('finCompTamano', { mb: comprobanteMaxMegas() })); return; }
    onElegir(f);
  };
  if (archivo) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-3)] py-1 pl-4 pr-3 text-sm">
        <span className="min-w-0 truncate font-medium text-[var(--color-text)]">{archivo.name}</span>
        <button type="button" onClick={onQuitar} className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('removeFile')}>
          <X size={16} />
        </button>
      </div>
    );
  }
  return (
    <label
      className="ctr-soltar"
      data-arrastrando={arrastrando || undefined}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]); }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true"><FileUp size={18} /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--color-text)]">{tf('finCotArchivoElegir')}</span>
        <span className="block text-[12px] text-[var(--color-text-muted)]">{tf('finCotArchivoHint', { mb: comprobanteMaxMegas() })}</span>
      </span>
      <input type="file" accept={ACEPTA_DOCUMENTO} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; elegir(f); }} />
    </label>
  );
};

const FormularioCotizacion = ({ open, cotizacion, catalogos, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const editando = Boolean(cotizacion?.id);
  const [form, setForm] = useState(() => desdeCotizacion(cotizacion));
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cambiar = (e) => { const { name, value } = e.target; setForm((p) => ({ ...p, [name]: value })); setError(null); };
  const elegir = (name) => (value) => cambiar({ target: { name, value } });

  // Proveedores para las recibidas, clientes para las enviadas.
  const directorio = (form.tipo === 'ENVIADA' ? catalogos?.clientes : catalogos?.proveedores) || [];
  const elegirEmpresa = (empresaId) => {
    const ficha = directorio.find((c) => String(c.id) === empresaId);
    setForm((prev) => {
      const anterior = directorio.find((c) => String(c.id) === prev.empresaId);
      const nombreAnterior = anterior ? (anterior.nombreComercial || anterior.nombre) : '';
      const reemplazar = !prev.contraparteNombre || prev.contraparteNombre === nombreAnterior;
      return { ...prev, empresaId, contraparteNombre: reemplazar ? (ficha ? (ficha.nombreComercial || ficha.nombre) : '') : prev.contraparteNombre };
    });
    setError(null);
  };
  // Al cambiar de tipo, la ficha elegida ya no es del directorio que toca.
  const elegirTipo = (tipo) => setForm((p) => ({ ...p, tipo, empresaId: '' }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!editando && !archivo) { setError({ texto: tf('finCotArchivoFalta') }); return; }
    setGuardando(true);
    setError(null);
    const datos = {
      tipo: form.tipo,
      titulo: form.titulo,
      descripcion: form.descripcion,
      empresaId: form.empresaId || null,
      contraparteNombre: form.contraparteNombre,
      moneda: form.moneda,
      fecha: form.fecha,
    };
    try {
      const data = editando
        ? await finanzasService.cotizaciones.editar(cotizacion.id, datos)
        : await finanzasService.cotizaciones.crear(archivo, { ...datos, empresaId: datos.empresaId || '', monto: form.monto, nota: form.nota });
      showToast(editando ? tf('finCotActualizada') : tf('finCotCreada', { folio: data.cotizacion.folio }), 'success');
      onGuardado(data.cotizacion);
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
      maxWidth="760px"
      title={editando ? tf('finCotCorregir') : tf('finCotizacionNueva')}
      subtitle={editando ? `${cotizacion.folio} · ${tf('finCotCorregirSub')}` : tf('finRequeridos')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-cotizacion" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    >
      <form id="form-cotizacion" onSubmit={guardar} noValidate>
        <AvisoError error={error} />

        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tf('finCotTipo')}>
          {TIPOS_COTIZACION.map((tipo) => (
            <button
              key={tipo}
              type="button"
              role="radio"
              aria-checked={form.tipo === tipo}
              onClick={() => elegirTipo(tipo)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${form.tipo === tipo ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}`}
            >
              <span className="block text-[13.5px] font-semibold text-[var(--color-text)]">{tf(`finCotTipo${tipo}`)}</span>
              <span className="block text-[12px] text-[var(--color-text-muted)]">{tf(`finCotTipo${tipo}Hint`)}</span>
            </button>
          ))}
        </div>

        <Seccion titulo={tf('finCotizacion')}>
          <Campo id="cot-titulo" label={tf('finCotTitulo')} requerido ancho>
            <input id="cot-titulo" name="titulo" className="form-input" value={form.titulo} onChange={cambiar} maxLength={255} placeholder={tf('finCotTituloPh')} required autoFocus />
          </Campo>
          {directorio.length > 0 && (
            <Campo id="cot-empresa" label={`${tf(`finCotContraparte${form.tipo}`)} · ${tf('finCotDelDirectorio')}`}>
              <SelectorSimple id="cot-empresa" valor={form.empresaId} onCambio={elegirEmpresa} opcionVacia={tf('finCotSinFicha')} opciones={directorio.map((c) => ({ valor: String(c.id), etiqueta: c.nombreComercial ? `${c.nombreComercial} (${c.nombre})` : c.nombre }))} />
            </Campo>
          )}
          <Campo id="cot-contraparte" label={directorio.length > 0 ? tf('finCotNombreContraparte') : tf(`finCotContraparte${form.tipo}`)} requerido ancho={directorio.length === 0}>
            <input id="cot-contraparte" name="contraparteNombre" className="form-input" value={form.contraparteNombre} onChange={cambiar} maxLength={255} placeholder={tf('finCotNombreContrapartePh')} />
          </Campo>
          <Campo id="cot-fecha" label={tf('finCotFecha')} requerido>
            <input id="cot-fecha" name="fecha" type="date" className="form-input" value={form.fecha} onChange={cambiar} required />
          </Campo>
          <Campo id="cot-moneda" label={tf('finMoneda')}>
            <SelectorSimple id="cot-moneda" valor={form.moneda} onCambio={elegir('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
          </Campo>
          <Campo id="cot-desc" label={tf('finDescripcion')} ancho>
            <textarea id="cot-desc" name="descripcion" rows={2} className="form-input" value={form.descripcion} onChange={cambiar} />
          </Campo>
        </Seccion>

        {!editando && (
          <Seccion titulo={tf('finCotArchivo')}>
            <div className="sm:col-span-2 mb-4">
              <ZonaArchivo archivo={archivo} onElegir={(f) => { setArchivo(f); setError(null); }} onQuitar={() => setArchivo(null)} onError={(texto) => setError({ texto })} tf={tf} t={t} />
              <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--color-text-muted)]"><Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{tf('finCotOriginalFija')}</p>
            </div>
            <Campo id="cot-monto" label={tf('finCotMonto')} ayuda={tf('finCotMontoAyuda')}>
              <input id="cot-monto" name="monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={cambiar} />
            </Campo>
            <Campo id="cot-nota" label={tf('finCotNotaOriginal')}>
              <input id="cot-nota" name="nota" className="form-input" value={form.nota} onChange={cambiar} maxLength={2000} />
            </Campo>
          </Seccion>
        )}
      </form>
    </Modal>
  );
};

export default FormularioCotizacion;
