// Archivos adjuntos de un artículo de la base de conocimiento: lista con ver
// y descargar; los administradores suben (clic o arrastrar) y quitan. En un
// artículo que aún no se guarda, los archivos quedan "pendientes" y el editor
// los sube al crear el artículo.
import { useCallback, useState } from 'react';
import { Download, Eye, FileText, FileUp, Image as ImageIcon, Loader2, Trash2, X } from 'lucide-react';
import { conocimientoService } from '../../services/api';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmacion } from '../ConfirmDialog';
import { useTextoConocimiento } from '../../hooks/useTextoConocimiento';
import { useVerArchivo } from '../../hooks/useVerArchivo';
import { Panel } from '../finanzas/piezas';
import { ACEPTA_DOCUMENTO, esDocumentoValido, esImagen, formatearTamano } from '../../utils/finanzas';

/** Tope de subida en MB: el mismo de los adjuntos del CRM (panel de configuración). */
const useLimiteArchivo = () => {
  const { config } = useConfiguracion();
  const mb = Number(config?.subidas?.adjuntosMaxMB) > 0 ? Number(config.subidas.adjuntosMaxMB) : 4;
  return { mb, bytes: mb * 1024 * 1024 };
};

const Icono = ({ mime }) => (
  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${esImagen(mime) ? 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]' : 'bg-[var(--color-primary-10)] text-[var(--color-primary)]'}`} aria-hidden="true">
    {esImagen(mime) ? <ImageIcon size={17} /> : <FileText size={17} />}
  </span>
);

/**
 * Props: archivos (del servidor), puedeEditar, articuloId (null si es nuevo),
 * pendientes / onPendientes (archivos elegidos antes de guardar), onCambio().
 */
const ArchivosArticulo = ({ archivos = [], puedeEditar, articuloId, pendientes = [], onPendientes, onCambio }) => {
  const tc = useTextoConocimiento();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { mb, bytes } = useLimiteArchivo();
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const cargar = useCallback((id) => conocimientoService.urlArchivo(id), []);
  const { ver, descargar, visor } = useVerArchivo({
    cargar,
    descargarArchivo: conocimientoService.descargarArchivo,
    textos: { soloDescarga: tc('conSoloDescarga'), descargar: tc('conDescargar'), abrir: tc('conAbrir') },
  });

  const agregar = async (archivo) => {
    if (!archivo) return;
    if (!esDocumentoValido(archivo)) { showToast(tc('conArchivoTipo'), 'error'); return; }
    if (archivo.size > bytes) { showToast(tc('conArchivoTamano', { mb }), 'error'); return; }
    if (!articuloId) { onPendientes?.([...pendientes, archivo]); return; }
    setSubiendo(true);
    try {
      await conocimientoService.subirArchivo(articuloId, archivo);
      showToast(tc('conArchivoSubido'), 'success');
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const quitar = async (a) => {
    const ok = await confirmar({ titulo: tc('conArchivoBorrarConfirm', { nombre: a.nombreOriginal }), textoConfirmar: tc('conQuitar'), peligro: true });
    if (!ok) return;
    try {
      await conocimientoService.eliminarArchivo(a.id);
      showToast(tc('conArchivoBorrado'), 'success');
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const total = archivos.length + pendientes.length;
  if (!puedeEditar && archivos.length === 0) return null;

  return (
    <Panel titulo={tc('conArchivos')} conteo={total}>
      {dialogo}
      {visor}
      {total > 0 && (
        <ul>
          {archivos.map((a) => (
            <li key={a.id} className="cli-fila">
              <Icono mime={a.mime} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => ver(a)}>
                <span className="block truncate text-[13px] font-medium text-[var(--color-text)] hover:underline">{a.nombreOriginal}</span>
                <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{formatearTamano(a.tamano)}</span>
              </button>
              <div className="flex shrink-0 items-center">
                <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tc('conVer')} aria-label={tc('conVer')} onClick={() => ver(a)}><Eye size={15} /></button>
                <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tc('conDescargar')} aria-label={tc('conDescargar')} onClick={() => descargar(a)}><Download size={15} /></button>
                {puedeEditar && (
                  <button type="button" className="dash-icono hover:!text-[var(--color-error)] max-md:!h-10 max-md:!w-10" title={tc('conQuitar')} aria-label={tc('conQuitar')} onClick={() => quitar(a)}><Trash2 size={15} /></button>
                )}
              </div>
            </li>
          ))}
          {pendientes.map((f, i) => (
            <li key={`p${i}`} className="cli-fila">
              <Icono mime={f.type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{f.name}</span>
                <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{formatearTamano(f.size)} · {tc('conArchivosPendientes')}</span>
              </span>
              <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tc('conQuitar')} aria-label={tc('conQuitar')} onClick={() => onPendientes?.(pendientes.filter((_p, j) => j !== i))}><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      {puedeEditar && (
        <div className={`p-4 ${total > 0 ? 'border-t border-[var(--color-border)]' : ''}`}>
          <label
            className="ctr-soltar"
            data-arrastrando={arrastrando || undefined}
            data-ocupado={subiendo || undefined}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!subiendo) agregar(e.dataTransfer.files?.[0]); }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true">
              {subiendo ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--color-text)]">{tc('conAdjuntar')}</span>
              <span className="block text-[12px] text-[var(--color-text-muted)]">{tc('conAdjuntarHint', { mb })}</span>
            </span>
            <input type="file" accept={ACEPTA_DOCUMENTO} className="sr-only" disabled={subiendo} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; agregar(f); }} />
          </label>
        </div>
      )}
    </Panel>
  );
};

export default ArchivosArticulo;
