// Comprobantes (PDF o imagen) de un pago o de un gasto: lista, vista previa,
// descarga, subida (clic o arrastrar) y borrado. Los archivos no tienen URL
// pública: se piden con la sesión y se muestran desde memoria (blob).
import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText, FileUp, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { OrigenArchivo, Panel } from './piezas';
import { useToast } from '../../context/ToastContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useConfirmacion } from '../ConfirmDialog';
import { finanzasService } from '../../services/api';
import { abrirPdfEnPestana, puedeIncrustarPdf } from '../contratos/abrirPdf';
import { ACEPTA_COMPROBANTE, comprobanteMaxBytes, comprobanteMaxMegas, esComprobanteValido, esImagen, formatearTamano } from '../../utils/finanzas';

/**
 * Props: comprobantes (lista), puedeEditar, onSubir(archivo) -> Promise,
 * onCambio() tras borrar, titulo opcional.
 */
const Comprobantes = ({ comprobantes = [], puedeEditar, onSubir, onCambio, titulo }) => {
  const tf = useTextoFinanzas();
  const { t, locale } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [abriendo, setAbriendo] = useState(null);
  const [previa, setPrevia] = useState(null);
  const urlPrevia = useRef(null);
  const tactil = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  // La vista previa vive en memoria (blob): se libera al cerrar.
  // `montado`: si la ficha se cierra mientras llega un archivo, su URL de
  // memoria se libera en vez de quedar huérfana.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current); };
  }, []);

  const cerrarPrevia = () => {
    if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current);
    urlPrevia.current = null;
    setPrevia(null);
  };

  const descargar = async (c) => {
    try {
      await finanzasService.comprobantes.descargar(c.id, c.nombreOriginal);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const ver = async (c) => {
    // Un PDF en móvil se abre en el visor del sistema (pestaña nueva).
    if (!esImagen(c.mime) && !puedeIncrustarPdf()) {
      setAbriendo(c.id);
      try {
        await abrirPdfEnPestana(() => finanzasService.comprobantes.urlParaVer(c.id), { alBloquear: () => descargar(c) });
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setAbriendo(null);
      }
      return;
    }
    setAbriendo(c.id);
    try {
      const url = await finanzasService.comprobantes.urlParaVer(c.id);
      if (!montado.current) { URL.revokeObjectURL(url); return; }
      if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current);
      urlPrevia.current = url;
      setPrevia({ comprobante: c, url });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAbriendo(null);
    }
  };

  const subir = async (archivo) => {
    if (!archivo || !onSubir) return;
    if (!esComprobanteValido(archivo)) { showToast(tf('finCompTipo'), 'error'); return; }
    if (archivo.size > comprobanteMaxBytes()) { showToast(tf('finCompTamano', { mb: comprobanteMaxMegas() }), 'error'); return; }
    setSubiendo(true);
    try {
      await onSubir(archivo);
      showToast(tf('finCompSubido'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const borrar = async (c) => {
    const ok = await confirmar({ titulo: tf('finCompBorrarConfirm', { nombre: c.nombreOriginal }), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await finanzasService.comprobantes.eliminar(c.id);
      if (previa?.comprobante.id === c.id) cerrarPrevia();
      showToast(tf('finCompBorrado'), 'success');
      onCambio?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <Panel titulo={titulo || tf('finComprobantes')} conteo={comprobantes.length}>
      {dialogo}
      {comprobantes.length > 0 && (
        <ul>
          {comprobantes.map((c) => (
            <li key={c.id}>
              <div className="cli-fila">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${esImagen(c.mime) ? 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]' : 'bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]'}`} aria-hidden="true">
                  {esImagen(c.mime) ? <ImageIcon size={17} /> : <FileText size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <button type="button" className="block w-full min-w-0 text-left" onClick={() => ver(c)}>
                    <span className="block truncate text-[13px] font-medium text-[var(--color-text)] hover:underline">{c.nombreOriginal}</span>
                    <span className="block truncate text-[12px] text-[var(--color-text-muted)]">
                      {formatearTamano(c.tamano)} · {tf('finCompSubidoPor', { nombre: c.subidoPor?.nombre || '—', fecha: new Date(c.creadoEn).toLocaleDateString(locale) })}
                    </span>
                  </button>
                  <OrigenArchivo item={c} texto={tf('finOrigenDesde')} />
                </div>
                <div className="flex shrink-0 items-center">
                  <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tf('finCompVer')} aria-label={tf('finCompVer')} onClick={() => ver(c)} disabled={abriendo === c.id}>
                    {abriendo === c.id ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                  </button>
                  <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={tf('finCompDescargar')} aria-label={tf('finCompDescargar')} onClick={() => descargar(c)}>
                    <Download size={15} />
                  </button>
                  {puedeEditar && (
                    <button type="button" className="dash-icono hover:!text-[var(--color-error)] max-md:!h-10 max-md:!w-10" title={t('delete')} aria-label={t('delete')} onClick={() => borrar(c)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && onSubir && (
        <div className={`p-4 ${comprobantes.length > 0 ? 'border-t border-[var(--color-border)]' : ''}`}>
          <label
            className="ctr-soltar"
            data-arrastrando={arrastrando || undefined}
            data-ocupado={subiendo || undefined}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!subiendo) subir(e.dataTransfer.files?.[0]); }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true">
              {subiendo ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--color-text)]">
                {subiendo ? tf('finCompSubiendo') : comprobantes.length > 0 ? tf('finCompOtro') : tactil ? tf('finCompElegir') : tf('finCompSoltar')}
              </span>
              <span className="block text-[12px] text-[var(--color-text-muted)]">{tf('finCompAyuda', { mb: comprobanteMaxMegas() })}</span>
            </span>
            <input type="file" accept={ACEPTA_COMPROBANTE} className="sr-only" disabled={subiendo} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; subir(f); }} />
          </label>
        </div>
      )}
      {!puedeEditar && comprobantes.length === 0 && (
        <p className="px-4 py-6 text-center text-[13px] text-[var(--color-text-muted)]">{tf('finCompNinguno')}</p>
      )}

      {previa && (
        <Modal open onClose={cerrarPrevia} maxWidth="960px" height="min(90dvh, 900px)" title={previa.comprobante.nombreOriginal} bodyClassName="!p-0">
          {esImagen(previa.comprobante.mime)
            ? <div className="flex h-full items-center justify-center bg-[var(--color-bg-base)] p-4"><img src={previa.url} alt={previa.comprobante.nombreOriginal} className="max-h-full max-w-full rounded-lg object-contain" /></div>
            : <iframe src={previa.url} title={previa.comprobante.nombreOriginal} className="h-full w-full border-0" />}
        </Modal>
      )}
    </Panel>
  );
};

export default Comprobantes;
