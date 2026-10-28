import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  adjuntosService, finanzasService, getPublicAssetUrl, portalEquipoService,
} from '../services/api';
import { useTextoPortal } from '../hooks/useTextoPortal';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { puedeFinanzas, tieneAccesoFinanzas } from '../utils/finanzas';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import MandarAFinanzas, { CopiasEnFinanzas } from './finanzas/MandarAFinanzas';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import Tooltip from './Tooltip';
import { useConfirmacion } from './ConfirmDialog';
import {
  Archive,
  Download,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Landmark,
  Paperclip,
  Trash2,
  Building2,
  Upload,
  X,
} from 'lucide-react';
import { PanelSkeleton } from './Skeleton';

// Mismas reglas que el backend (upload.middleware): los tipos van en
// categorias que el configurador puede apagar y el tamaño maximo sale de
// subidas.adjuntosMaxMB. Antes iban fijos aqui (4 MB y todos los tipos): con
// otro limite en el panel se rechazaban archivos validos o pasaban tipos que
// el servidor iba a rechazar. Se valida aqui para avisar al instante.
const CATEGORIAS_ADJUNTOS = {
  pdf: { extensiones: ['pdf'], mimes: ['application/pdf'] },
  imagenes: { extensiones: ['png', 'jpg', 'jpeg', 'gif', 'webp'], mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
  office: { extensiones: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'], mimes: [] },
  texto: { extensiones: ['txt', 'csv', 'json'], mimes: [] },
  comprimidos: { extensiones: ['zip'], mimes: [] },
};
const MAXIMO_MB_POR_DEFECTO = 4;

/** Categorias activas, tope en MB y el `accept` del selector de archivos. */
const reglasSubida = (subidas = {}) => {
  const activos = subidas.tiposAdjuntos || {};
  const categorias = Object.keys(CATEGORIAS_ADJUNTOS).filter((clave) => activos[clave] !== false);
  const extensiones = categorias.flatMap((clave) => CATEGORIAS_ADJUNTOS[clave].extensiones);
  // El `accept` lleva tambien los MIME de imagen y PDF: en Android, con solo
  // extensiones, el selector no ofrece la galeria ni la camara.
  const accept = [
    ...extensiones.map((ext) => `.${ext}`),
    ...categorias.flatMap((clave) => CATEGORIAS_ADJUNTOS[clave].mimes),
  ].join(',');
  const maximoMB = Number(subidas.adjuntosMaxMB) > 0 ? Number(subidas.adjuntosMaxMB) : MAXIMO_MB_POR_DEFECTO;
  return { categorias, extensiones, accept, maximoMB };
};

const extensionDe = (nombre = '') => {
  const partes = String(nombre).toLowerCase().split('.');
  return partes.length > 1 ? partes.pop() : '';
};

const buildTempId = (file, index) => `${file.name}-${file.size}-${file.lastModified}-${index}`;

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// Los adjuntos nuevos viven en el disco del servidor y llegan con una ruta
// relativa ("/api/archivos/adjuntos/..."); los antiguos de Vercel Blob, con una
// URL absoluta. Ambos se resuelven a una URL que el navegador puede abrir.
const urlDeAdjunto = (valor) => {
  const url = String(valor || '');
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return getPublicAssetUrl(url);
  return null;
};

const getPreviewKind = (tipo = '', nombre = '') => {
  const lowerName = String(nombre).toLowerCase();
  if (tipo.includes('image')) return 'image';
  if (tipo.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    tipo.includes('text') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.json')
  ) return 'text';
  return 'file';
};

const getFileIcon = (tipo = '', nombre = '') => {
  const lowerName = String(nombre).toLowerCase();
  if (tipo.includes('image')) return <ImageIcon size={17} />;
  if (tipo.includes('pdf') || lowerName.endsWith('.pdf')) return <FileText size={17} color="var(--color-error)" />;
  if (
    tipo.includes('word') ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) return <FileText size={17} color="var(--color-primary)" />;
  if (
    tipo.includes('excel') ||
    tipo.includes('spreadsheet') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.csv')
  ) return <FileSpreadsheet size={17} color="var(--color-success)" />;
  if (
    tipo.includes('zip') ||
    tipo.includes('rar') ||
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.rar') ||
    lowerName.endsWith('.7z')
  ) return <Archive size={17} />;
  return <File size={17} />;
};

/**
 * Descarga desde la URL del adjunto. Se pasa por un blob en memoria para que
 * el navegador respete el nombre original; si el navegador no deja leerla
 * (CORS), se abre en una pestaña nueva como respaldo. Lleva la cookie de
 * archivos (crm_archivos): sin sesion el servidor ya no la entrega.
 */
const descargarDesdeUrl = async (url, nombre) => {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('No se pudo descargar');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = objectUrl;
    enlace.download = nombre || 'archivo';
    enlace.style.display = 'none';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
};

/**
 * Un archivo en una fila: icono (o miniatura si es imagen), nombre, peso y
 * fecha, y las acciones como iconos. Antes era una tarjeta de 220px de alto
 * con la vista previa incrustada; en la columna lateral cabian dos.
 */
const FilaAdjunto = ({ item, isPending = false, canDelete = false, onDelete, onCompartir, onMandar, copias }) => {
  const { t, locale } = usePreferences();
  const tp = useTextoPortal();
  const tf = useTextoFinanzas();
  const kind = getPreviewKind(item.tipo, item.nombre);
  // Los adjuntos traen su URL publica (servidor o Vercel Blob); los pendientes,
  // una URL local temporal. Un adjunto antiguo con solo un nombre de archivo ya
  // no se puede abrir: las rutas /adjuntos/ver y /descargar desaparecieron.
  const urlRemota = urlDeAdjunto(item.url);
  const previewUrl = item.previewUrl || urlRemota;

  return (
    <li className="det-adjunto">
      <span className="det-adjunto-icono">
        {kind === 'image' && previewUrl
          ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          : getFileIcon(item.tipo, item.nombre)}
      </span>
      <span className="min-w-0 flex-1">
        <span title={item.nombre} className="block truncate text-[13px] font-medium text-[var(--color-text)]">
          {item.nombre}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
          {isPending && <span className="det-adjunto-nuevo">{t('attachmentNew')}</span>}
          {formatSize(item.tamano || item.size)}{item.creadoEn ? ` · ${new Date(item.creadoEn).toLocaleDateString(locale)}` : ''}
          {item.visibleCliente && onCompartir && <span className="ptl-chip-cliente" title={tp('ptlCompartido')}>{tp('ptlClienteBadge')}</span>}
        </span>
        {/* A dónde se mandó en finanzas (solo lo que la persona ve allá). */}
        {copias?.length > 0 && <span className="mt-1 block"><CopiasEnFinanzas copias={copias} /></span>}
      </span>
      <span className="flex shrink-0 items-center">
        {previewUrl && (
          <Tooltip label={t('attachmentView')}>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="dash-icono">
              <Eye size={15} />
            </a>
          </Tooltip>
        )}
        {!isPending && urlRemota && (
          <Tooltip label={t('attachmentDownload')}>
            <button type="button" onClick={() => descargarDesdeUrl(urlRemota, item.nombre)} className="dash-icono">
              <Download size={15} />
            </button>
          </Tooltip>
        )}
        {onMandar && !isPending && (
          <Tooltip label={tf('finManBoton')}>
            <button type="button" onClick={onMandar} aria-label={tf('finManBoton')} className="dash-icono">
              <Landmark size={15} />
            </button>
          </Tooltip>
        )}
        {onCompartir && !isPending && (
          <Tooltip label={item.visibleCliente ? tp('ptlDejarCompartir') : tp('ptlCompartirCliente')}>
            <button
              type="button"
              onClick={onCompartir}
              aria-pressed={Boolean(item.visibleCliente)}
              aria-label={item.visibleCliente ? tp('ptlDejarCompartir') : tp('ptlCompartirCliente')}
              className="dash-icono"
              style={item.visibleCliente ? { color: 'var(--color-gold-text)' } : undefined}
            >
              <Building2 size={15} />
            </button>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip label={isPending ? t('removeFile') : t('delete')}>
            <button type="button" onClick={onDelete} className="dash-icono det-icono-peligro">
              {isPending ? <X size={15} /> : <Trash2 size={15} />}
            </button>
          </Tooltip>
        )}
      </span>
    </li>
  );
};

const TaskAttachments = ({
  tareaId,
  type = 'tareas',
  title,
  pendingFiles = [],
  onPendingFilesChange,
  onAttachmentsChange,
  showUploader = true,
  showExisting = true,
  uploadLabel,
  // Version para columna estrecha: un panel con cabecera propia y el boton de
  // subir a todo el ancho. Se usa en el panel lateral del detalle de proyecto.
  compacto = false,
  // Texto de ayuda bajo el titulo (por defecto, el de tipos y tamano)
  ayuda,
  // Archivos del proyecto: botón para mostrarlos u ocultarlos en el portal
  // del cliente (solo administradores del proyecto con cliente asignado).
  compartirCliente = false,
}) => {
  const tp = useTextoPortal();
  const tx = useTextoProyectos();
  const { usuario } = useAuth();
  const { t } = usePreferences();
  const { config, moduloActivo } = useConfiguracion();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [subiendo, setSubiendo] = useState(false);
  // "Mandar a finanzas" (cotizaciones y/o gastos variables): archivos de
  // tareas y de proyectos, para quien puede registrar ahí.
  const [mandando, setMandando] = useState(null);
  const conFinanzas = moduloActivo('finanzas') && (type === 'tareas' || type === 'proyectos');
  const mandaAFinanzas = conFinanzas && (puedeFinanzas(usuario, 'cotizaciones', 'crear')
    || puedeFinanzas(usuario, 'gastos.VARIABLES', 'crear') || puedeFinanzas(usuario, 'gastos.VARIABLES', 'editar'));
  const inputRef = useRef(null);
  const reglas = useMemo(() => reglasSubida(config?.subidas ?? undefined), [config?.subidas]);
  const tiposTexto = reglas.categorias.map((clave) => tx(`adj_tipo_${clave}`)).join(', ');

  // Los adjuntos ya guardados van por SWR: se cachean por tarea y no hace falta
  // un efecto que los pida a mano (lo que marcaba el lint).
  const { data: adjuntos, error: errorCarga, isLoading, mutate } = useSWR(
    tareaId && showExisting ? ['adjuntos', type, tareaId] : null,
    async ([, tipo, id]) => {
      const respuesta = await adjuntosService.listar(id, tipo);
      return respuesta.adjuntos || [];
    },
    { onSuccess: (lista) => onAttachmentsChange?.(lista) },
  );

  // A dónde se mandó cada archivo (clave "finanzas-…": se recarga al mandar).
  const idsGuardados = (adjuntos || []).map((a) => a.id).filter(Boolean);
  const { data: copias, mutate: recargarCopias } = useSWR(
    (mandaAFinanzas || (conFinanzas && tieneAccesoFinanzas(usuario))) && idsGuardados.length ? ['finanzas-copias-adjuntos', idsGuardados.join(',')] : null,
    () => finanzasService.desdeAdjunto.copias(idsGuardados),
    { revalidateOnFocus: false },
  );

  const actualizarAdjuntos = (siguiente) => {
    mutate(siguiente, { revalidate: false });
    onAttachmentsChange?.(siguiente);
  };

  const tempFiles = useMemo(
    () => pendingFiles.map((file, index) => ({
      id: buildTempId(file, index),
      nombre: file.name,
      tipo: file.type,
      tamano: file.size,
      previewUrl: file.type?.startsWith('image/') || file.type === 'application/pdf'
        ? URL.createObjectURL(file)
        : null,
    })),
    [pendingFiles]
  );

  useEffect(() => () => {
    tempFiles.forEach((file) => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    });
  }, [tempFiles]);

  /** Separa los archivos validos de los rechazados, con el motivo de cada uno. */
  const validarArchivos = (files) => {
    const validos = [];
    const rechazados = [];
    files.forEach((file) => {
      const extension = extensionDe(file.name);
      if (!reglas.extensiones.includes(extension)) {
        rechazados.push(reglas.categorias.length
          ? tx('adj_tipoRechazado', { name: file.name, tipos: tiposTexto })
          : tx('adj_sinTipos'));
      } else if (file.size > reglas.maximoMB * 1024 * 1024) {
        rechazados.push(tx('adj_muyGrande', { name: file.name, size: formatSize(file.size), max: reglas.maximoMB }));
      } else {
        validos.push(file);
      }
    });
    return { validos, rechazados };
  };

  const handleFilesSelected = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    const { validos, rechazados } = validarArchivos(files);
    rechazados.forEach((motivo) => showToast(motivo, 'error'));
    if (validos.length === 0) return;

    if (tareaId) {
      setSubiendo(true);
      try {
        const data = await adjuntosService.subir(tareaId, validos, type);
        const nuevosAdjuntos = data.adjuntos || (data.adjunto ? [data.adjunto] : []);
        actualizarAdjuntos([...nuevosAdjuntos, ...(adjuntos || [])]);
        showToast(t('attachmentUploaded', { count: nuevosAdjuntos.length }));
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setSubiendo(false);
      }
    } else if (onPendingFilesChange) {
      onPendingFilesChange((prev) => [...prev, ...validos]);
    }
  };

  const handleEliminar = async (adjunto) => {
    const ok = await confirmar({
      titulo: t('attachmentDeleteConfirm'),
      descripcion: adjunto.nombre,
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await adjuntosService.eliminar(adjunto.id);
      actualizarAdjuntos((adjuntos || []).filter((a) => a.id !== adjunto.id));
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleCompartir = async (adjunto) => {
    const visible = !adjunto.visibleCliente;
    try {
      await portalEquipoService.compartirArchivo(adjunto.id, visible);
      actualizarAdjuntos((adjuntos || []).map((a) => (a.id === adjunto.id ? { ...a, visibleCliente: visible } : a)));
      showToast(visible ? tp('ptlCompartido') : tp('ptlNoCompartido'), visible ? 'success' : 'info');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const removePendingFile = (targetId) => {
    if (!onPendingFilesChange) return;
    onPendingFilesChange((prev) =>
      prev.filter((file, index) => buildTempId(file, index) !== targetId)
    );
  };

  if (isLoading && !adjuntos) return <PanelSkeleton rows={3} titleWidth="170px" />;

  const allItems = [
    ...tempFiles.map((file) => ({ ...file, isPending: true })),
    ...(adjuntos || []).map((file) => ({ ...file, isPending: false })),
  ];

  const tituloPorDefecto = type === 'proyectos'
    ? t('attachmentProjectTitle')
    : type === 'agenda' ? t('attachmentEventTitle') : t('attachmentTaskTitle');

  // Boton real (no un <label> con el input oculto en display:none, que no se
  // alcanzaba con el teclado). El input queda fuera de la vista con sr-only
  // pero sigue siendo accesible.
  const subidor = showUploader && (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        className="det-subir"
      >
        <Upload size={14} />
        {subiendo ? t('attachmentUploading') : (uploadLabel || t('attachmentUpload'))}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={reglas.accept}
        onChange={handleFilesSelected}
        disabled={subiendo}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );

  // Si falla la carga no se dice "sin archivos": parecería que no hay nada
  // cuando en realidad no se pudo leer. Se ofrece reintentar.
  const lista = errorCarga && !adjuntos ? (
    <div className="alert-error justify-between text-[12.5px]" role="alert">
      <span>{tx('adj_errorCarga')}</span>
      <button type="button" onClick={() => mutate()} className="font-semibold">{t('retry')}</button>
    </div>
  ) : allItems.length === 0 ? (
    <p className="det-adjuntos-vacio">{t('attachmentEmpty')}</p>
  ) : (
    <ul className="det-adjuntos">
      {allItems.map((item) => {
        // Autor o quien edita proyectos (el servidor revisa el alcance).
        const canDelete = item.isPending || item.usuarioId === usuario?.id || puede(usuario, 'proyectos.editar');
        return (
          <FilaAdjunto
            key={item.id || item.url}
            item={item}
            isPending={item.isPending}
            canDelete={canDelete}
            onDelete={() => (item.isPending ? removePendingFile(item.id) : handleEliminar(item))}
            onCompartir={compartirCliente ? () => handleCompartir(item) : undefined}
            onMandar={mandaAFinanzas ? () => setMandando(item.id) : undefined}
            copias={item.isPending ? null : copias?.copias?.[item.id]}
          />
        );
      })}
    </ul>
  );

  const ventanaFinanzas = mandando && (
    <MandarAFinanzas
      adjuntoId={mandando}
      onClose={() => setMandando(null)}
      onListo={() => { setMandando(null); recargarCopias(); }}
    />
  );

  // Columna lateral: panel con cabecera en versalitas, como las secciones de
  // la ficha de cliente.
  if (compacto) {
    return (
      <section className="det-panel">
        <header className="det-panel-cabecera">
          <h2 className="det-etiqueta">
            <Paperclip size={13} aria-hidden="true" />
            {title || tituloPorDefecto}
            {allItems.length > 0 && <span className="cli-conteo">{allItems.length}</span>}
          </h2>
        </header>
        <div className="space-y-3 p-3">
          {ayuda && <p className="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{ayuda}</p>}
          {subidor}
          {lista}
        </div>
        {dialogo}
        {ventanaFinanzas}
      </section>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text)]">
          <Paperclip size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
          {title || tituloPorDefecto}
          {allItems.length > 0 && <span className="font-normal text-[var(--color-text-muted)]">· {allItems.length}</span>}
        </h4>
        {subidor}
      </div>

      {showUploader && (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {ayuda || tx('adj_ayuda', { max: reglas.maximoMB, tipos: tiposTexto })}
        </p>
      )}

      {lista}

      {dialogo}
      {ventanaFinanzas}
    </div>
  );
};

export default TaskAttachments;
