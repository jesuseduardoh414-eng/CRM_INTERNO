// Listas reutilizables del portal: documentos y reuniones.
import { Link } from 'react-router-dom';
import { Download, ExternalLink, FileImage, FileSpreadsheet, FileText, MapPin, Video } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { useTextoPortal } from '../../hooks/useTextoPortal';
import { getPublicAssetUrl } from '../../services/api';
import { formatearTamano } from '../../utils/contratos';
import { fechaHora, mismoDia } from '../../utils/portal';
import {
  BloqueFecha,
} from './PiezasPortal';

const iconoArchivo = (nombre = '', tipo = '') => {
  if (/^image\//.test(tipo) || /\.(png|jpe?g|gif|webp|svg)$/i.test(nombre)) return FileImage;
  if (/sheet|excel|csv/.test(tipo) || /\.(xlsx?|csv)$/i.test(nombre)) return FileSpreadsheet;
  return FileText;
};

/** Tabla de documentos compartidos (columna de proyecto opcional). */
export const ListaDocumentos = ({ documentos, mostrarProyecto = false }) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  return (
    <ul>
      {documentos.map((d) => {
        const Icono = iconoArchivo(d.nombre, d.tipo);
        const url = getPublicAssetUrl(d.url);
        return (
          <li key={d.id} className="ptl-fila">
            <span className="ptl-icono"><Icono size={17} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13.5px] font-medium hover:underline">{d.nombre}</a>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-[var(--color-text-muted)]">
                {mostrarProyecto && d.proyecto && (
                  <Link to={`/portal/proyectos/${d.proyecto.id}?vista=documentos`} className="truncate hover:underline">{d.proyecto.nombre}</Link>
                )}
                <span>{fechaHora(d.creadoEn, locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {Number.isFinite(d.tamano) && <span>{formatearTamano(d.tamano)}</span>}
              </span>
            </span>
            <a href={url} target="_blank" rel="noopener noreferrer" className="ptl-enlace hidden sm:inline-flex" aria-label={`${tp('ptlAbrir')} ${d.nombre}`}>
              <ExternalLink size={14} aria-hidden="true" /> {tp('ptlAbrir')}
            </a>
            <a href={url} download={d.nombre} className="ptl-enlace" aria-label={`${tp('ptlDescargar')} ${d.nombre}`}>
              <Download size={14} aria-hidden="true" /><span className="hidden sm:inline">{tp('ptlDescargar')}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
};

/** Una reunión: fecha, hora, modalidad, lugar o enlace. */
export const FilaReunion = ({ reunion: r, pasada = false }) => {
  const { locale } = usePreferences();
  const tp = useTextoPortal();
  const inicio = new Date(r.fechaInicio);
  const hoy = new Date();
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  const relativo = mismoDia(inicio, hoy) ? tp('ptlHoy') : mismoDia(inicio, manana) ? tp('ptlManana') : null;
  const hora = r.todoElDia
    ? tp('ptlTodoElDia')
    : [fechaHora(r.fechaInicio, locale, { hour: '2-digit', minute: '2-digit' }), r.fechaFin && fechaHora(r.fechaFin, locale, { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' – ');
  const enLinea = r.modalidad === 'virtual';

  return (
    <li className={`ptl-fila items-start ${pasada ? 'opacity-75' : ''}`}>
      <BloqueFecha valor={r.fechaInicio} locale={locale} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">{r.titulo}</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-text-dim)]">
          {relativo && <strong className="font-semibold text-[var(--color-text)]">{relativo} · </strong>}
          {inicio.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · {hora}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1">
            {enLinea ? <Video size={13} aria-hidden="true" /> : <MapPin size={13} aria-hidden="true" />}
            {tp(`ptlModalidad${r.modalidad}`)}{!enLinea && r.ubicacion ? ` · ${r.ubicacion}` : ''}
          </span>
          {r.proyecto && <Link to={`/portal/proyectos/${r.proyecto.id}`} className="hover:underline">{r.proyecto.nombre}</Link>}
          {r.organizador && <span>{tp('ptlOrganiza', { nombre: r.organizador })}</span>}
        </div>
        {r.descripcion && <p className="mt-2 whitespace-pre-line text-[13px] text-[var(--color-text-dim)]">{r.descripcion}</p>}
        {!pasada && r.instruccionesAcceso && (
          <p className="mt-2 rounded-lg bg-[var(--color-surface-3)] px-3 py-2 text-[12.5px] text-[var(--color-text-dim)]">
            <strong className="font-semibold">{tp('ptlAcceso')}:</strong> {r.instruccionesAcceso}
          </p>
        )}
      </div>
      {!pasada && r.urlReunion && (
        <a href={r.urlReunion} target="_blank" rel="noopener noreferrer" aria-label={`${tp('ptlUnirse')}: ${r.titulo}`} className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 text-[13px] font-semibold text-[var(--color-on-primary)] hover:opacity-90">
          <Video size={14} aria-hidden="true" /> <span className="hidden sm:inline">{tp('ptlUnirse')}</span>
        </a>
      )}
    </li>
  );
};
