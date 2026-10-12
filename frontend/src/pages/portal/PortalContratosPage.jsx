// Contratos del cliente (en revisión, vigentes y terminados) con sus PDF.
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { Download, Eye, FileSignature, FileText, Loader2, RefreshCcw } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { portalService } from '../../services/api';
import { formatearMonto, formatearTamano, progresoVigencia } from '../../utils/contratos';
import {
  CabeceraPortal, ErrorPortal, PanelPortal, VacioPortal,
} from '../../components/portal/PiezasPortal';
import { ListSkeleton } from '../../components/Skeleton';
import { fechaDia } from '../../utils/portal';
import { abrirPdfEnPestana } from '../../components/contratos/abrirPdf';

const BADGE = { VIGENTE: 'badge-success', EN_REVISION: 'badge-info', TERMINADO: 'badge-neutral' };

const TarjetaContrato = ({ contrato: c }) => {
  const { locale } = usePreferences();
  const { showToast } = useToast();
  const tp = useTextoPortal();
  const [abriendo, setAbriendo] = useState(null);
  const corta = { day: 'numeric', month: 'short', year: 'numeric' };
  // progresoVigencia espera fechas 'AAAA-MM-DD'.
  const vigencia = c.estado === 'VIGENTE'
    ? progresoVigencia({ fechaInicio: c.fechaInicio?.slice(0, 10), fechaFin: c.fechaFin?.slice(0, 10) })
    : null;
  const monto = formatearMonto(c.monto, c.moneda, locale);

  const descargar = async (archivo) => {
    try {
      await portalService.descargarArchivoContrato(archivo.id, archivo.nombreOriginal);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // El PDF se abre en una pestaña nueva con el visor del sistema (también en
  // el teléfono). Si el navegador bloquea la pestaña, se descarga.
  const ver = async (archivo) => {
    setAbriendo(archivo.id);
    try {
      await abrirPdfEnPestana(() => portalService.urlArchivoContrato(archivo.id), { alBloquear: () => descargar(archivo) });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAbriendo(null);
    }
  };

  return (
    <PanelPortal>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[12px] text-[var(--color-text-muted)]">{c.folio}</p>
            <h2 className="mt-0.5 break-words text-[17px] font-semibold leading-snug">{c.titulo}</h2>
            {c.proyecto && (
              <Link to={`/portal/proyectos/${c.proyecto.id}`} className="mt-1 inline-block text-[12.5px] text-[var(--color-text-dim)] hover:underline">
                {tp('ptlProyectoRel', { nombre: c.proyecto.nombre })}
              </Link>
            )}
          </div>
          <span className={BADGE[c.estado] || 'badge-neutral'}>{tp(`ptlContrato${c.estado}`)}</span>
        </div>

        {c.descripcion && <p className="mt-3 whitespace-pre-line text-[13.5px] text-[var(--color-text-dim)]">{c.descripcion}</p>}

        <div className="ptl-contrato-cifras mt-5">
          <div className="ptl-dato">
            <small>{tp('ptlVigencia')}</small>
            <strong>{fechaDia(c.fechaInicio, locale, corta) || '—'} → {fechaDia(c.fechaFin, locale, corta) || '—'}</strong>
          </div>
          {monto && (
            <div className="ptl-dato">
              <small>{tp('ptlMonto')}{c.periodicidadPago ? ` · ${tp(`ptlPeriodicidad${c.periodicidadPago}`)}` : ''}</small>
              <strong>{monto} <span className="text-[12px] font-normal text-[var(--color-text-muted)]">{c.incluyeIva ? tp('ptlIvaIncluido') : tp('ptlMasIva')}</span></strong>
            </div>
          )}
          {c.fechaFirma && (
            <div className="ptl-dato"><small>{tp('ptlFechaFirma')}</small><strong>{fechaDia(c.fechaFirma, locale, corta)}</strong></div>
          )}
        </div>

        {vigencia && (
          <div className="mt-4">
            <div className="ctr-barra" data-tono="success"><span style={{ width: `${vigencia.porcentaje}%` }} /></div>
          </div>
        )}
        {c.renovacionAutomatica && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-dim)]"><RefreshCcw size={13} aria-hidden="true" /> {tp('ptlRenovacion')}</p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)]">
        <p className="px-5 pb-1 pt-3 text-[12px] font-semibold text-[var(--color-text-muted)]">{tp('ptlArchivos')}</p>
        {c.archivos.length === 0 ? (
          <p className="px-5 pb-4 text-[13px] text-[var(--color-text-muted)]">{tp('ptlSinArchivos')}</p>
        ) : (
          <ul className="pb-1">
            {c.archivos.map((a) => (
              <li key={a.id} className="ptl-fila px-5">
                <span className="ptl-icono"><FileText size={16} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{a.nombreOriginal}</span>
                  <span className="text-[12px] text-[var(--color-text-muted)]">{tp(`ptlDoc${a.tipoDocumento}`)} · {formatearTamano(a.tamano)}</span>
                </span>
                <button type="button" className="ptl-enlace" onClick={() => ver(a)} disabled={abriendo === a.id} aria-label={`${tp('ptlVer')} ${a.nombreOriginal}`}>
                  {abriendo === a.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}<span className="hidden sm:inline">{tp('ptlVer')}</span>
                </button>
                <button type="button" className="ptl-enlace" onClick={() => descargar(a)} aria-label={`${tp('ptlDescargar')} ${a.nombreOriginal}`}>
                  <Download size={14} aria-hidden="true" /><span className="hidden sm:inline">{tp('ptlDescargar')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelPortal>
  );
};

const PortalContratosPage = () => {
  const tp = useTextoPortal();
  const { data, error, isLoading, mutate } = useSWR(['portal', 'contratos'], portalService.contratos);

  return (
    <div>
      <CabeceraPortal titulo={tp('ptlContratosTitulo')} subtitulo={tp('ptlContratosSubtitulo')} />
      {isLoading && !data ? <ListSkeleton rows={3} header={false} />
        : error && !data ? <ErrorPortal error={error} onReintentar={() => mutate()} />
          : data.contratos.length === 0
            ? <div className="ptl-panel"><VacioPortal icono={FileSignature} texto={tp('ptlSinContratos')} /></div>
            : <div className="flex flex-col gap-5">{data.contratos.map((c) => <TarjetaContrato key={c.id} contrato={c} />)}</div>}
    </div>
  );
};

export default PortalContratosPage;
