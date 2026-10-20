// Archivos privados (cotizaciones, base de conocimiento): no tienen URL
// pública, se piden con la sesión y se muestran desde memoria (blob).
//   PanelArchivo  pinta un archivo (PDF o imagen) dentro de un contenedor
//   VisorArchivo  ventana con un archivo
// Para decidir cómo abrir uno (ventana, pestaña o descarga): hooks/useVerArchivo.
import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { Button } from './ui/button';
import { abrirPdfEnPestana, puedeIncrustarPdf } from './contratos/abrirPdf';
import { esImagen, seVeEnElCrm } from '../utils/finanzas';

/**
 * `archivo`: { id, nombreOriginal, mime }. `cargar(id)` devuelve la URL de
 * memoria (debe ser estable: useCallback); `descargar(archivo)` lo baja.
 * `textos`: { soloDescarga, descargar, abrir }.
 */
export const PanelArchivo = ({ archivo, cargar, descargar, textos }) => {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const incrustable = seVeEnElCrm(archivo.mime) && (esImagen(archivo.mime) || puedeIncrustarPdf());

  useEffect(() => {
    if (!incrustable) return undefined;
    let vivo = true;
    let creada = null;
    cargar(archivo.id)
      .then((u) => { creada = u; if (vivo) setUrl(u); else URL.revokeObjectURL(u); })
      .catch((err) => { if (vivo) setError(err.message); });
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [archivo.id, incrustable, cargar]);

  if (!incrustable) {
    // Office, o un PDF en un teléfono: se abre aparte o se descarga.
    const esPdf = archivo.mime === 'application/pdf';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-[var(--color-text-muted)]">
        <p className="max-w-xs">{esPdf ? archivo.nombreOriginal : textos.soloDescarga}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {esPdf && (
            <Button variant="outline" onClick={() => abrirPdfEnPestana(() => cargar(archivo.id), { alBloquear: () => descargar(archivo) })}>
              <ExternalLink size={15} /> {textos.abrir}
            </Button>
          )}
          <Button variant="outline" onClick={() => descargar(archivo)}><Download size={15} /> {textos.descargar}</Button>
        </div>
      </div>
    );
  }
  if (error) return <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[var(--color-error)]">{error}</div>;
  if (!url) return <div className="flex h-full items-center justify-center"><Loader2 size={22} className="animate-spin text-[var(--color-text-muted)]" /></div>;
  return esImagen(archivo.mime)
    ? <div className="flex h-full items-center justify-center bg-[var(--color-bg-base)] p-4"><img src={url} alt={archivo.nombreOriginal} className="max-h-full max-w-full rounded-lg object-contain" /></div>
    : <iframe src={url} title={archivo.nombreOriginal} className="h-full w-full border-0" />;
};

export const VisorArchivo = ({ archivo, cargar, descargar, textos, onClose }) => (
  <Modal
    open
    onClose={onClose}
    maxWidth="960px"
    height="min(90dvh, 900px)"
    title={archivo.nombreOriginal}
    bodyClassName="!p-0"
    headerExtra={<Button variant="ghost" size="sm" onClick={() => descargar(archivo)}><Download size={15} /> {textos.descargar}</Button>}
  >
    <PanelArchivo archivo={archivo} cargar={cargar} descargar={descargar} textos={textos} />
  </Modal>
);

