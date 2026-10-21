// Archivos adjuntos de un artículo de la base de conocimiento: lista con ver
// y descargar; los administradores suben (clic o arrastrar, varios a la vez)
// y quitan. En un artículo que aún no se guarda, los archivos quedan
// "pendientes" y el editor los sube al crear el artículo. Un archivo puede
// tener su propio acceso (candado); quien gestiona accesos lo cambia aquí.
import { useCallback, useState } from 'react';
import { Download, Eye, FileText, FileUp, Image as ImageIcon, Loader2, Lock, Trash2, UserCog, X } from 'lucide-react';
import { conocimientoService } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmacion } from '../ConfirmDialog';
import { useTextoConocimiento } from '../../hooks/useTextoConocimiento';
import { useLimiteArchivo } from '../../hooks/useConocimiento';
import { useVerArchivo } from '../../hooks/useVerArchivo';
import { Panel } from '../finanzas/piezas';
import ModalAcceso from './ModalAcceso';
import { ACEPTA_DOCUMENTO, esDocumentoValido, esImagen, formatearTamano } from '../../utils/finanzas';
import { accesoDe } from '../../utils/accesoConocimiento';

const Icono = ({ mime }) => (
  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${esImagen(mime) ? 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]' : 'bg-[var(--color-primary-10)] text-[var(--color-primary)]'}`} aria-hidden="true">
    {esImagen(mime) ? <ImageIcon size={17} /> : <FileText size={17} />}
  </span>
);

/**
 * Props: archivos (del servidor), puedeEditar, articuloId (null si es nuevo),
 * pendientes / onPendientes (archivos elegidos antes de guardar), onCambio(),
 * y para el acceso de cada archivo: gestionaAcceso, accesoArticulo y autorId.
 */
const ArchivosArticulo = ({ archivos = [], puedeEditar, articuloId, pendientes = [], onPendientes, onCambio, gestionaAcceso = false, accesoArticulo, autorId }) => {
  const tc = useTextoConocimiento();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { mb, bytes } = useLimiteArchivo();
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [accesoDeArchivo, setAccesoDeArchivo] = useState(null);
  const cargar = useCallback((id) => conocimientoService.urlArchivo(id), []);
  const { ver, descargar, visor } = useVerArchivo({
    cargar,
    descargarArchivo: conocimientoService.descargarArchivo,
    textos: { soloDescarga: tc('conSoloDescarga'), descargar: tc('conDescargar'), abrir: tc('conAbrir') },
  });

  const agregar = async (lista) => {
    const validos = [];
    for (const archivo of lista) {
      if (!esDocumentoValido(archivo)) showToast(`${archivo.name}: ${tc('conArchivoTipo')}`, 'error');
      else if (archivo.size > bytes) showToast(`${archivo.name}: ${tc('conArchivoTamano', { mb })}`, 'error');
      else validos.push(archivo);
    }
    if (!validos.length) return;
    if (!articuloId) { onPendientes?.([...pendientes, ...validos]); return; }
    setSubiendo(true);
    let subidos = 0;
    for (const archivo of validos) {
      try {
        await conocimientoService.subirArchivo(articuloId, archivo);
        subidos += 1;
      } catch (err) {
        showToast(`${archivo.name}: ${err.message}`, 'error');
      }
    }
    setSubiendo(false);
    if (subidos) {
      showToast(tc('conArchivoSubido'), 'success');
      onCambio?.();
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

  const guardarAcceso = async (valor) => {
    await conocimientoService.cambiarAccesoArchivo(accesoDeArchivo.id, valor);
    showToast(tc('accGuardado'), 'success');
    onCambio?.();
  };

  const total = archivos.length + pendientes.length;
  if (!puedeEditar && archivos.length === 0) return null;

  return (
    <Panel titulo={tc('conArchivos')} conteo={total}>
      {dialogo}
      {visor}
      <ModalAcceso
        abierto={Boolean(accesoDeArchivo)}
        titulo={accesoDeArchivo ? tc('accTituloArchivo', { nombre: accesoDeArchivo.nombreOriginal }) : ''}
        inicial={accesoDeArchivo ? accesoDe(accesoDeArchivo) : null}
        contexto="archivo"
        accesoArticulo={accesoArticulo}
        autorId={autorId}
        subidoPorId={accesoDeArchivo?.subidoPor?.id}
        onCerrar={() => setAccesoDeArchivo(null)}
        onGuardar={guardarAcceso}
      />
      {total > 0 && (
        <ul>
          {archivos.map((a) => (
            <li key={a.id} className="cli-fila">
              <Icono mime={a.mime} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => ver(a)}>
                <span className="block truncate text-[13px] font-medium text-[var(--color-text)] hover:underline">{a.nombreOriginal}</span>
                <span className="flex items-center gap-1 truncate text-[12px] text-[var(--color-text-muted)]">
                  {a.restringido && <Lock size={11} className="shrink-0" role="img" aria-label={tc('accRestringidoArchivo')} />}
                  {formatearTamano(a.tamano)}
                </span>
              </button>
              <div className="flex shrink-0 items-center">
                <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tc('conVer')} aria-label={tc('conVer')} onClick={() => ver(a)}><Eye size={15} /></button>
                <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tc('conDescargar')} aria-label={tc('conDescargar')} onClick={() => descargar(a)}><Download size={15} /></button>
                {gestionaAcceso && (
                  <button type="button" className={`dash-icono max-md:!h-10 max-md:!w-10 ${a.restringido ? '!text-[var(--color-primary)]' : ''}`} title={tc('accArchivoBoton')} aria-label={`${tc('accArchivoBoton')}: ${a.nombreOriginal}`} onClick={() => setAccesoDeArchivo(a)}><UserCog size={15} /></button>
                )}
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
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!subiendo) agregar([...(e.dataTransfer.files || [])]); }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true">
              {subiendo ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--color-text)]">{tc('conAdjuntar')}</span>
              <span className="block text-[12px] text-[var(--color-text-muted)]">{tc('conAdjuntarHint', { mb })}</span>
            </span>
            <input type="file" multiple accept={ACEPTA_DOCUMENTO} className="sr-only" disabled={subiendo} onChange={(e) => { const lista = [...(e.target.files || [])]; e.target.value = ''; agregar(lista); }} />
          </label>
        </div>
      )}
    </Panel>
  );
};

export default ArchivosArticulo;
