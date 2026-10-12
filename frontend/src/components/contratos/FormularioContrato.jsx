// Ventana para crear o editar un contrato. Al crear se puede adjuntar ya el
// PDF escaneado; se sube justo después de guardar los datos.
import { useEffect, useRef, useState } from 'react';
import { FileUp, Loader2, Save, X } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { contratosService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import SelectorEmpresa from '../clientes/SelectorEmpresa';
import SelectorSimple from '../SelectorSimple';
import { empresaEsDeTipo } from '../../utils/empresas';
import {
  CATEGORIAS_CONTRATO, ESTADOS_CONTRATO, MONEDAS, pdfMaxBytes, pdfMaxMegas, PERIODICIDADES, TIPOS_CONTRATO,
} from '../../utils/contratos';

const VACIO = {
  titulo: '', tipo: 'CLIENTE', categoria: '', estado: 'BORRADOR', descripcion: '',
  contraparteNombre: '', contraparteRfc: '', contraparteContacto: '', contraparteEmail: '', contraparteTelefono: '',
  monto: '', moneda: 'MXN', incluyeIva: false, periodicidadPago: '',
  fechaFirma: '', fechaInicio: '', fechaFin: '', renovacionAutomatica: false, diasAviso: 30,
  proyectoId: '', responsableId: '', notas: '', empresaId: '',
};
const CAMPOS_CONTRAPARTE = ['contraparteNombre', 'contraparteRfc', 'contraparteContacto', 'contraparteEmail', 'contraparteTelefono'];

const desdeContrato = (c) => Object.fromEntries(Object.keys(VACIO).map((k) => {
  const valor = k === 'empresaId' ? (c?.empresaId ?? c?.empresa?.id) : c?.[k];
  if (valor === null || valor === undefined) return [k, VACIO[k]];
  return [k, typeof VACIO[k] === 'string' ? String(valor) : valor];
}));

const Seccion = ({ titulo, children }) => (
  <fieldset className="mb-6 last:mb-0">
    <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{titulo}</legend>
    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{children}</div>
  </fieldset>
);

const Campo = ({ id, label, requerido, ancho = false, children }) => (
  <div className={`form-group ${ancho ? 'sm:col-span-2' : ''}`}>
    <label className="form-label" htmlFor={id}>{label}{requerido && <span className="text-[var(--color-error)]"> *</span>}</label>
    {children}
  </div>
);

const FormularioContrato = ({ open, contrato, catalogos, onClose, onGuardado }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const editando = Boolean(contrato?.id);
  // La página monta este componente con un `key` distinto en cada apertura,
  // así que el estado inicial siempre parte del contrato (o de cero).
  const [form, setForm] = useState(() => (editando ? desdeContrato(contrato) : VACIO));
  // Empresa del directorio elegida (para saber si sigue valiendo al cambiar el tipo).
  const [empresa, setEmpresa] = useState(() => contrato?.empresa || null);
  const { moduloActivo } = useConfiguracion();
  const conDirectorio = moduloActivo('clientes');
  const [pdf, setPdf] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const refError = useRef(null);

  // El aviso de error está arriba del formulario: en móvil, tras pulsar Guardar
  // al final, quedaba fuera de la vista y parecía que no pasaba nada.
  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const cambiar = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((prev) => {
      const siguiente = { ...prev, [name]: type === 'checkbox' ? checked : value };
      // Un proveedor no puede quedar en un contrato de cliente (ni al revés):
      // se suelta la empresa, pero se conservan los datos ya llenados.
      if (name === 'tipo' && empresa && !empresaEsDeTipo(empresa, value)) siguiente.empresaId = '';
      return siguiente;
    });
    setError(null);
  };

  /** Al elegir una empresa se copian sus datos y los de su contacto principal. */
  const elegirEmpresa = (empresaId, ficha) => {
    setEmpresa(ficha);
    setError(null);
    setForm((prev) => {
      if (!ficha) return { ...prev, empresaId };
      const principal = ficha.contactos?.find((c) => c.principal) || null;
      return {
        ...prev,
        empresaId,
        contraparteNombre: ficha.nombre,
        contraparteRfc: ficha.rfc || '',
        contraparteContacto: principal?.nombre || '',
        contraparteEmail: principal?.email || ficha.email || '',
        contraparteTelefono: principal?.telefono || ficha.telefono || '',
      };
    });
  };

  const elegirPdf = (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) { setError({ texto: t('ctrOnlyPdf') }); return; }
    if (archivo.size > pdfMaxBytes()) { setError({ texto: t('ctrTooBig', { mb: pdfMaxMegas() }) }); return; }
    setPdf(archivo);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const datos = {
      ...form,
      monto: form.monto === '' ? null : form.monto,
      diasAviso: Number(form.diasAviso) || 0,
      proyectoId: form.proyectoId || null,
      responsableId: form.responsableId || null,
      categoria: form.categoria || null,
      periodicidadPago: form.periodicidadPago || null,
      empresaId: form.empresaId || null,
    };
    // Sin el módulo de clientes no se toca el enlace que ya tuviera el contrato.
    if (!conDirectorio) delete datos.empresaId;
    // Con empresa, lo que se deje vacío de la contraparte lo llena el backend
    // con la ficha (si se manda '' lo tomaría como "borrar").
    if (datos.empresaId) CAMPOS_CONTRAPARTE.forEach((k) => { if (!String(datos[k] ?? '').trim()) delete datos[k]; });
    try {
      const data = editando
        ? await contratosService.editar(contrato.id, datos)
        : await contratosService.crear(datos);
      if (pdf) {
        try {
          await contratosService.subirArchivo(data.contrato.id, pdf, 'FIRMADO');
        } catch (errorPdf) {
          showToast(errorPdf.message, 'error');
        }
      }
      showToast(editando ? t('ctrUpdated') : t('ctrCreated', { folio: data.contrato.folio }), 'success');
      onGuardado(data.contrato);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
    } finally {
      setGuardando(false);
    }
  };

  const opciones = (valores, prefijo) => valores.map((v) => ({ valor: v, etiqueta: t(`${prefijo}${v}`) }));
  // Los desplegables entregan el valor suelto; se pasa por el mismo `cambiar`
  const elegir = (name) => (value) => cambiar({ target: { name, value } });

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="820px"
      title={editando ? t('ctrEditTitle') : t('ctrNew')}
      subtitle={editando ? contrato.folio : t('ctrRequiredHint')}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-contrato" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('ctrSaving') : t('ctrSave')}
          </Button>
        </div>
      )}
    >
      <form id="form-contrato" onSubmit={guardar} noValidate>
        {error && (
          <div ref={refError} role="alert" className="alert-error mb-5 flex-col items-start">
            <span>{error.texto}</span>
            {error.detalles?.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-sm">{error.detalles.map((d) => <li key={d}>{d}</li>)}</ul>
            )}
          </div>
        )}

        <Seccion titulo={t('ctrSecGeneral')}>
          <Campo id="ctr-titulo" label={t('ctrFieldTitle')} requerido ancho>
            <input id="ctr-titulo" name="titulo" className="form-input" value={form.titulo} onChange={cambiar} placeholder={t('ctrFieldTitlePh')} maxLength={255} required autoFocus />
          </Campo>
          <Campo id="ctr-tipo" label={t('ctrFieldType')} requerido>
            <SelectorSimple id="ctr-tipo" valor={form.tipo} onCambio={elegir('tipo')} opciones={opciones(TIPOS_CONTRATO, 'ctrType')} />
          </Campo>
          <Campo id="ctr-categoria" label={t('ctrFieldCategory')}>
            <SelectorSimple id="ctr-categoria" valor={form.categoria} onCambio={elegir('categoria')} opcionVacia={t('ctrSelect')} opciones={opciones(CATEGORIAS_CONTRATO, 'ctrCat')} />
          </Campo>
          <Campo id="ctr-estado" label={t('ctrFieldStatus')}>
            <SelectorSimple id="ctr-estado" valor={form.estado} onCambio={elegir('estado')} opciones={opciones(ESTADOS_CONTRATO, 'ctrStatus')} />
          </Campo>
          <Campo id="ctr-desc" label={t('ctrFieldDescription')} ancho>
            <textarea id="ctr-desc" name="descripcion" rows={3} className="form-input" value={form.descripcion} onChange={cambiar} placeholder={t('ctrFieldDescriptionPh')} />
          </Campo>
        </Seccion>

        <Seccion titulo={t('ctrSecCounterparty')}>
          {conDirectorio && (
            <SelectorEmpresa id="ctr-empresa" tipo={form.tipo} valor={form.empresaId} onChange={elegirEmpresa} />
          )}
          <Campo id="ctr-cp" label={t('ctrFieldCpName')} requerido={!form.empresaId} ancho>
            <input id="ctr-cp" name="contraparteNombre" className="form-input" value={form.contraparteNombre} onChange={cambiar} maxLength={255} required={!form.empresaId} />
          </Campo>
          <Campo id="ctr-rfc" label={t('ctrFieldCpRfc')}>
            <input id="ctr-rfc" name="contraparteRfc" className="form-input uppercase" value={form.contraparteRfc} onChange={cambiar} maxLength={13} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="XAXX010101000" />
          </Campo>
          <Campo id="ctr-contacto" label={t('ctrFieldCpContact')}>
            <input id="ctr-contacto" name="contraparteContacto" className="form-input" value={form.contraparteContacto} onChange={cambiar} maxLength={255} />
          </Campo>
          <Campo id="ctr-email" label={t('ctrFieldCpEmail')}>
            <input id="ctr-email" name="contraparteEmail" type="email" autoComplete="off" className="form-input" value={form.contraparteEmail} onChange={cambiar} maxLength={191} />
          </Campo>
          <Campo id="ctr-tel" label={t('ctrFieldCpPhone')}>
            <input id="ctr-tel" name="contraparteTelefono" type="tel" inputMode="tel" autoComplete="off" className="form-input" value={form.contraparteTelefono} onChange={cambiar} maxLength={40} />
          </Campo>
        </Seccion>

        <Seccion titulo={t('ctrSecEconomic')}>
          <Campo id="ctr-monto" label={t('ctrFieldAmount')}>
            <input id="ctr-monto" name="monto" type="number" min="0" step="0.01" inputMode="decimal" className="form-input" value={form.monto} onChange={cambiar} />
          </Campo>
          <Campo id="ctr-moneda" label={t('ctrFieldCurrency')}>
            <SelectorSimple id="ctr-moneda" valor={form.moneda} onCambio={elegir('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
          </Campo>
          <Campo id="ctr-periodo" label={t('ctrFieldPeriodicity')}>
            <SelectorSimple id="ctr-periodo" valor={form.periodicidadPago} onCambio={elegir('periodicidadPago')} opcionVacia={t('ctrSelect')} opciones={opciones(PERIODICIDADES, 'ctrPer')} />
          </Campo>
          <label className="flex items-center gap-2.5 self-center pt-2 text-sm text-[var(--color-text)]">
            <input type="checkbox" name="incluyeIva" checked={form.incluyeIva} onChange={cambiar} className="h-4 w-4 accent-[var(--color-primary)]" />
            {t('ctrFieldVat')}
          </label>
        </Seccion>

        <Seccion titulo={t('ctrSecTerm')}>
          <Campo id="ctr-firma" label={t('ctrFieldSigned')}>
            <input id="ctr-firma" name="fechaFirma" type="date" className="form-input" value={form.fechaFirma} onChange={cambiar} />
          </Campo>
          <Campo id="ctr-aviso" label={t('ctrFieldNoticeDays')}>
            <input id="ctr-aviso" name="diasAviso" type="number" inputMode="numeric" min="0" max="365" className="form-input" value={form.diasAviso} onChange={cambiar} />
          </Campo>
          <Campo id="ctr-inicio" label={t('ctrFieldStart')}>
            <input id="ctr-inicio" name="fechaInicio" type="date" className="form-input" value={form.fechaInicio} onChange={cambiar} />
          </Campo>
          <Campo id="ctr-fin" label={t('ctrFieldEnd')}>
            <input id="ctr-fin" name="fechaFin" type="date" min={form.fechaInicio || undefined} className="form-input" value={form.fechaFin} onChange={cambiar} />
          </Campo>
          <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] sm:col-span-2">
            <input type="checkbox" name="renovacionAutomatica" checked={form.renovacionAutomatica} onChange={cambiar} className="h-4 w-4 accent-[var(--color-primary)]" />
            {t('ctrFieldAutoRenew')}
          </label>
        </Seccion>

        <Seccion titulo={t('ctrSecRelation')}>
          <Campo id="ctr-proyecto" label={t('ctrFieldProject')}>
            <SelectorSimple
              id="ctr-proyecto"
              valor={form.proyectoId}
              onCambio={elegir('proyectoId')}
              opcionVacia={t('ctrNone')}
              opciones={(catalogos?.proyectos || []).map((p) => ({ valor: String(p.id), etiqueta: p.nombre }))}
            />
          </Campo>
          <Campo id="ctr-resp" label={t('ctrFieldOwner')}>
            <SelectorSimple
              id="ctr-resp"
              valor={form.responsableId}
              onCambio={elegir('responsableId')}
              opcionVacia={t('ctrNone')}
              opciones={(catalogos?.usuarios || []).map((u) => ({ valor: String(u.id), etiqueta: u.nombre }))}
            />
          </Campo>
          <Campo id="ctr-notas" label={t('ctrFieldNotes')} ancho>
            <textarea id="ctr-notas" name="notas" rows={2} className="form-input" value={form.notas} onChange={cambiar} />
          </Campo>
        </Seccion>

        {!editando && (
          <Seccion titulo={t('ctrAttachNow')}>
            <div className="sm:col-span-2">
              {pdf ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-3)] py-1 pl-4 pr-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-[var(--color-text)]">{pdf.name}</span>
                  <button type="button" onClick={() => setPdf(null)} className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('removeFile')}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-4 text-sm text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)]">
                  <FileUp size={18} aria-hidden="true" />
                  <span>{t('ctrAttachHint')}</span>
                  <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={elegirPdf} />
                </label>
              )}
            </div>
          </Seccion>
        )}
      </form>
    </Modal>
  );
};

export default FormularioContrato;
