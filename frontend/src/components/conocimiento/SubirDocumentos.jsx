// Subir varios documentos de una vez a la base de conocimiento: cada archivo
// queda como un artículo propio con su título y su categoría (la general o
// la suya), todos con el mismo acceso. Se suben uno por uno; los que fallan
// se quedan en la lista, marcados, para corregirlos y volver a intentar.
import { useState } from 'react';
import { CheckCircle2, FileText, FileUp, Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { conocimientoService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoConocimiento } from '../../hooks/useTextoConocimiento';
import { useLimiteArchivo } from '../../hooks/useConocimiento';
import { puede } from '../../utils/permisos';
import { ACEPTA_DOCUMENTO, esDocumentoValido, esImagen, formatearTamano } from '../../utils/finanzas';
import { ACCESO_ABIERTO } from '../../utils/accesoConocimiento';
import SelectorAcceso, { ResumenAcceso } from './SelectorAcceso';

let siguienteId = 0;

/** "Manual_de-ventas 2026.pdf" → "Manual de ventas 2026". */
const tituloDesdeNombre = (nombre) => nombre.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

const Contenido = ({ categorias, onCerrar, onSubidos }) => {
  const { t } = usePreferences();
  const tc = useTextoConocimiento();
  const { showToast } = useToast();
  const { usuario } = useAuth();
  const gestionaAcceso = puede(usuario, 'conocimiento.acceso');
  const { mb, bytes } = useLimiteArchivo();
  // { id, archivo, titulo, categoria, estado: pendiente | subiendo | listo | error, error }
  const [filas, setFilas] = useState([]);
  const [categoria, setCategoria] = useState('');
  const [acceso, setAcceso] = useState(ACCESO_ABIERTO);
  const [eligiendoAcceso, setEligiendoAcceso] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  const agregar = (lista) => {
    const nuevas = [];
    for (const archivo of lista) {
      if (!esDocumentoValido(archivo)) { showToast(`${archivo.name}: ${tc('conArchivoTipo')}`, 'error'); continue; }
      if (archivo.size > bytes) { showToast(`${archivo.name}: ${tc('conArchivoTamano', { mb })}`, 'error'); continue; }
      const repetido = [...filas, ...nuevas].some((f) => f.archivo.name === archivo.name && f.archivo.size === archivo.size);
      if (!repetido) {
        siguienteId += 1;
        nuevas.push({ id: siguienteId, archivo, titulo: tituloDesdeNombre(archivo.name), categoria: '', estado: 'pendiente', error: null });
      }
    }
    if (nuevas.length) setFilas((p) => [...p, ...nuevas]);
  };
  const cambiarFila = (id, cambios) => setFilas((p) => p.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  const categoriaDe = (f) => (f.categoria.trim() || categoria.trim());
  const porSubir = filas.filter((f) => f.estado !== 'listo');

  const subir = async () => {
    // Primero se revisan todas, para marcar de una vez lo que falta.
    let faltan = false;
    const revisadas = filas.map((f) => {
      if (f.estado === 'listo') return f;
      const error = f.titulo.trim().length < 3 ? tc('docFaltaTitulo') : categoriaDe(f).length < 2 ? tc('docFaltaCategoria') : null;
      if (error) faltan = true;
      return { ...f, estado: error ? 'error' : 'pendiente', error };
    });
    setFilas(revisadas);
    if (faltan) {
      // La primera con error puede quedar abajo, fuera de la vista.
      requestAnimationFrame(() => document.querySelector('[data-fila-error]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }

    setSubiendo(true);
    let subidos = 0;
    let fallidos = 0;
    for (const f of revisadas) {
      if (f.estado === 'listo') continue;
      cambiarFila(f.id, { estado: 'subiendo', error: null });
      try {
        await conocimientoService.crearDocumento(f.archivo, {
          titulo: f.titulo.trim(),
          categoria: categoriaDe(f),
          // Sin restringir no hace falta mandarlo: nace para todo el equipo.
          acceso: gestionaAcceso && acceso.restringido ? acceso : undefined,
        });
        subidos += 1;
        cambiarFila(f.id, { estado: 'listo' });
      } catch (err) {
        fallidos += 1;
        cambiarFila(f.id, { estado: 'error', error: [err.message, ...(err.detalles || [])].join(' · ') });
      }
    }
    setSubiendo(false);
    if (subidos) onSubidos?.();
    if (fallidos) { showToast(tc('docConErrores'), 'error'); return; }
    showToast(subidos === 1 ? tc('docSubidosUno') : tc('docSubidosN', { n: subidos }), 'success');
    onCerrar();
  };

  const zona = (
    <label
      className="ctr-soltar"
      data-arrastrando={arrastrando || undefined}
      data-ocupado={subiendo || undefined}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!subiendo) agregar([...(e.dataTransfer.files || [])]); }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true"><FileUp size={18} /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--color-text)]">{filas.length ? tc('docSoltarMas') : tc('docSoltar')}</span>
        <span className="block text-[12px] text-[var(--color-text-muted)]">{tc('docSoltarHint', { mb })}</span>
      </span>
      <input type="file" multiple accept={ACEPTA_DOCUMENTO} className="sr-only" disabled={subiendo} onChange={(e) => { const lista = [...(e.target.files || [])]; e.target.value = ''; agregar(lista); }} />
    </label>
  );

  return (
    <Modal
      open
      onClose={subiendo ? undefined : onCerrar}
      title={tc('docSubir')}
      subtitle={tc('docSubtitulo')}
      maxWidth="820px"
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={subiendo}>{t('cancel')}</Button>
          <Button type="button" onClick={subir} disabled={subiendo || porSubir.length === 0}>
            {subiendo ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {subiendo ? tc('docSubiendo') : (porSubir.length === 1 ? tc('docSubirUno') : tc('docSubirN', { n: porSubir.length }))}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className={`grid grid-cols-1 gap-4 ${gestionaAcceso && !eligiendoAcceso ? 'md:grid-cols-2' : ''}`}>
          <div className="form-group !mb-0">
            <label htmlFor="doc-categoria" className="form-label">{tc('docCategoria')}</label>
            <input id="doc-categoria" className="form-input" value={categoria} onChange={(e) => setCategoria(e.target.value)} maxLength={80} placeholder={tc('conCategoriaPh')} list="doc-categorias" disabled={subiendo} />
            <datalist id="doc-categorias">{categorias.map((c) => <option key={c.nombre} value={c.nombre} />)}</datalist>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{tc('docCategoriaAyuda')}</p>
          </div>
          {gestionaAcceso && !eligiendoAcceso && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="form-label !mb-0">{tc('docAcceso')}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEligiendoAcceso(true)} disabled={subiendo}>{tc('accCambiar')}</Button>
              </div>
              <ResumenAcceso acceso={acceso} />
            </div>
          )}
        </div>
        {gestionaAcceso && eligiendoAcceso && (
          <div className="rounded-xl border border-[var(--color-border)] p-4">
            <p className="mb-3 text-[13.5px] font-semibold text-[var(--color-text)]">{tc('docAcceso')}</p>
            <SelectorAcceso valor={acceso} onCambio={setAcceso} autorId={usuario?.id} nombre="acceso-documentos" />
          </div>
        )}

        {zona}

        {filas.length > 0 && (
          <ul className="space-y-2.5">
            {filas.map((f) => {
              const listo = f.estado === 'listo';
              return (
                <li key={f.id} data-fila-error={f.estado === 'error' || undefined} className={`rounded-xl border p-3 ${f.estado === 'error' ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]'} ${listo ? 'opacity-70' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${esImagen(f.archivo.type) ? 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]' : 'bg-[var(--color-primary-10)] text-[var(--color-primary)]'}`} aria-hidden="true">
                      {esImagen(f.archivo.type) ? <ImageIcon size={16} /> : <FileText size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{f.archivo.name}</span>
                      <span className="block text-[12px] text-[var(--color-text-muted)]">{formatearTamano(f.archivo.size)}</span>
                    </span>
                    {f.estado === 'subiendo' && <Loader2 size={17} className="shrink-0 animate-spin text-[var(--color-primary)]" aria-label={tc('docSubiendo')} />}
                    {listo && <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-[var(--color-success,var(--color-primary))]"><CheckCircle2 size={16} aria-hidden="true" />{tc('docListo')}</span>}
                    {!listo && f.estado !== 'subiendo' && (
                      <button type="button" className="dash-icono shrink-0 max-md:!h-10 max-md:!w-10" title={tc('conQuitar')} aria-label={`${tc('conQuitar')}: ${f.archivo.name}`} onClick={() => setFilas((p) => p.filter((x) => x.id !== f.id))} disabled={subiendo}>
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  {!listo && (
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">{tc('docTitulo')}</span>
                        <input
                          className="form-input w-full"
                          value={f.titulo}
                          onChange={(e) => cambiarFila(f.id, { titulo: e.target.value, ...(f.estado === 'error' ? { estado: 'pendiente', error: null } : {}) })}
                          maxLength={200}
                          disabled={subiendo}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">{tc('docCategoriaPropia')}</span>
                        <input
                          className="form-input w-full"
                          value={f.categoria}
                          onChange={(e) => cambiarFila(f.id, { categoria: e.target.value, ...(f.estado === 'error' ? { estado: 'pendiente', error: null } : {}) })}
                          maxLength={80}
                          list="doc-categorias"
                          // Vacía, lleva la categoría para todos (se ve como sugerencia).
                          placeholder={categoria.trim() || tc('conCategoriaPh')}
                          disabled={subiendo}
                        />
                      </label>
                    </div>
                  )}
                  {f.error && <p className="mt-2 text-[12.5px] text-[var(--color-error)]" role="alert">{f.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

/** Props: abierto, categorias (las que ya existen, para sugerir), onCerrar, onSubidos. */
const SubirDocumentos = ({ abierto, ...props }) => (abierto ? <Contenido {...props} /> : null);

export default SubirDocumentos;
