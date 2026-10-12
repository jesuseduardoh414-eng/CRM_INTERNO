import { useRef, useState } from 'react';
import { tareasService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import Modal from './Modal';
import SelectorSimple from './SelectorSimple';
import { ESTADOS_TAREA, PRIORIDADES_TAREA } from '../utils/estadosTarea';
import {
  AlertTriangle,
  ArrowDownToLine,
  Braces,
  CheckCircle2,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  UploadCloud,
  User,
  Users,
  XCircle,
} from 'lucide-react';

// El `accept` lleva las extensiones y tambien los tipos MIME: en Android, con
// solo extensiones el selector a veces deja los archivos en gris.
const FORMAT_INFO = {
  excel: {
    label: 'Excel',
    ext: '.xlsx,.xls',
    accept: '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
  },
  json: {
    label: 'JSON',
    ext: '.json',
    accept: '.json,application/json',
  },
};

// Mismo tope que el backend (uploadImport.middleware): 4 MB. Antes aqui se
// anunciaban 5 y un archivo de 4.5 MB fallaba sin explicacion clara.
const MAXIMO_IMPORTAR_MB = 4;

const MODOS = [
  { key: 'yo', labelKey: 'imp_modoYo', descKey: 'imp_modoYoDesc', Icono: User },
  { key: 'miembro', labelKey: 'imp_modoMiembro', descKey: 'imp_modoMiembroDesc', Icono: Users },
  { key: 'archivo', labelKey: 'imp_modoArchivo', descKey: 'imp_modoArchivoDesc', Icono: FileText },
];

const ESTADOS = ['PENDIENTE', 'EN_PROGRESO', 'HECHO'];
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA'];

const formatSize = (bytes = 0) => (
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
);

const normalizarEstado = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  const mapa = {
    PENDIENTE: 'PENDIENTE',
    'POR HACER': 'PENDIENTE',
    POR_HACER: 'PENDIENTE',
    EN_PROGRESO: 'EN_PROGRESO',
    'EN PROGRESO': 'EN_PROGRESO',
    'EN-PROGRESO': 'EN_PROGRESO',
    HECHO: 'HECHO',
    COMPLETADO: 'HECHO',
    TERMINADO: 'HECHO',
  };

  return mapa[raw] || raw;
};

const normalizarPrioridad = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  const mapa = {
    BAJA: 'BAJA',
    MEDIA: 'MEDIA',
    ALTA: 'ALTA',
    LOW: 'BAJA',
    MEDIUM: 'MEDIA',
    HIGH: 'ALTA',
  };

  return mapa[raw] || raw;
};

const normalizarFila = (fila = {}) => ({
  fila: fila.fila,
  numeroActividad: fila.numeroActividad ?? '',
  titulo: fila.titulo ?? '',
  descripcion: fila.descripcion ?? '',
  estado: normalizarEstado(fila.estado),
  prioridad: normalizarPrioridad(fila.prioridad),
  fechaInicio: fila.fechaInicio ?? '',
  venceEn: fila.venceEn ?? '',
  asignadoEmail: fila.asignadoEmail ?? '',
  completadoEn: fila.completadoEn ?? '',
  horaCompletado: fila.horaCompletado ?? '',
  // El archivo trae cuando se hizo pero la fila no esta HECHO (solo lo sabe
  // el servidor: el valor original puede ser un "Si" que aqui no se ve)
  traeCierre: (fila.avisos || []).some((aviso) => aviso.startsWith('Trae fecha de completado')),
  omitida: !!fila.omitida,
});

// Aproximado en hora del navegador; la cuenta exacta (zona de la empresa) la
// hace el servidor al guardar.
const instanteCompletado = (fila) => new Date(`${fila.completadoEn}T${fila.horaCompletado || '12:00'}`).getTime();

// Una fecha anterior al 2000 en un archivo de tareas es casi siempre un error
// de formato (Excel que exporta "1900-01-00", un numero suelto...). Antes
// pasaba como valida y se guardaba una tarea en el siglo pasado.
const ANIO_MINIMO = 2000;
const esFechaRazonable = (valor) => {
  const fecha = new Date(valor);
  return !Number.isNaN(fecha.getTime()) && fecha.getFullYear() >= ANIO_MINIMO;
};

// `exigirFecha` refleja la regla de la instalacion: el backend rechaza esas
// filas. `estadoPorDefecto` es el que toma una fila sin estado. Devuelve
// claves de textosProyectos; el texto se resuelve al pintar.
const validarFilaPreview = (fila, exigirFecha = false, estadoPorDefecto = 'PENDIENTE') => {
  const errores = [];
  if (!String(fila.titulo || '').trim()) errores.push('imp_errTitulo');
  if (exigirFecha && !fila.venceEn) errores.push('imp_errFecha');

  if (fila.numeroActividad !== '' && fila.numeroActividad !== null && fila.numeroActividad !== undefined) {
    const numero = Number(fila.numeroActividad);
    if (!Number.isInteger(numero) || numero <= 0) errores.push('imp_errNumero');
  }

  if (fila.estado && !ESTADOS.includes(normalizarEstado(fila.estado))) errores.push('imp_errEstado');
  if (fila.prioridad && !PRIORIDADES.includes(normalizarPrioridad(fila.prioridad))) errores.push('imp_errPrioridad');
  if (fila.fechaInicio && !esFechaRazonable(fila.fechaInicio)) errores.push('imp_errInicio');
  if (fila.venceEn && !esFechaRazonable(fila.venceEn)) errores.push('imp_errLimite');

  // La fecha y hora de cierre solo cuentan en tareas hechas (y son opcionales)
  if (normalizarEstado(fila.estado || estadoPorDefecto) === 'HECHO') {
    if (fila.completadoEn && !esFechaRazonable(fila.completadoEn)) {
      errores.push('imp_errCompletado');
    } else if (fila.horaCompletado && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(fila.horaCompletado)) {
      errores.push('imp_errHora');
    } else if (fila.horaCompletado && !fila.completadoEn) {
      errores.push('imp_errHoraSinFecha');
    } else if (fila.completadoEn && instanteCompletado(fila) > Date.now()) {
      errores.push('imp_errFutura');
    } else if (fila.completadoEn && fila.fechaInicio && fila.completadoEn < fila.fechaInicio) {
      errores.push('imp_errAnterior');
    }
  }

  return errores;
};

const correoEsDeMiembro = (correo, usuarios) => usuarios.some(
  (u) => String(u.email || '').toLowerCase() === String(correo || '').toLowerCase(),
);

const ModalImportar = ({ proyectoId, usuarios = [], usuarioActual, onClose, onImportado }) => {
  const { t } = usePreferences();
  const tx = useTextoProyectos();
  // Sin estado o prioridad en la fila, el backend usa los de la configuracion:
  // la vista previa muestra esos mismos.
  const { reglasTareas } = useConfiguracion();
  const [tab, setTab] = useState('excel');
  const [archivo, setArchivo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errorGlobal, setErrorGlobal] = useState('');
  const [modo, setModo] = useState('yo');
  const [miembroId, setMiembroId] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [previewArchivo, setPreviewArchivo] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef(null);

  const fmt = FORMAT_INFO[tab];
  const previewActiva = previewRows.length > 0 && !resultado;
  const filasActivas = previewRows.filter((fila) => !fila.omitida);
  const filasInvalidas = filasActivas.filter((fila) => validarFilaPreview(fila, reglasTareas.exigirFechaLimite, reglasTareas.estadoInicial).length > 0);
  const filasConAvisos = filasActivas.filter((fila) => modo === 'archivo' && fila.asignadoEmail && !correoEsDeMiembro(fila.asignadoEmail, usuarios));

  const nombreAsignacion = (fila) => {
    if (modo === 'yo') return usuarioActual?.nombre ? tx('imp_yo', { nombre: usuarioActual.nombre }) : tx('imp_tu');
    if (modo === 'miembro') {
      const miembro = usuarios.find((u) => String(u.id) === String(miembroId))
        || (usuarioActual && String(usuarioActual.id) === String(miembroId) ? usuarioActual : null);
      return miembro ? miembro.nombre : tx('imp_sinResponsable');
    }
    if (!fila.asignadoEmail) return tx('imp_sinAsignar');
    const miembro = usuarios.find((u) => String(u.email || '').toLowerCase() === String(fila.asignadoEmail).toLowerCase());
    return miembro ? miembro.nombre : tx('imp_correoNoEncontrado');
  };

  const validarArchivo = (file, tipoActual) => {
    if (!file) return null;
    const nombre = String(file.name || '').toLowerCase();
    if (tipoActual === 'json' && !nombre.endsWith('.json')) return tx('imp_noJson');
    if (tipoActual === 'excel' && !(nombre.endsWith('.xlsx') || nombre.endsWith('.xls'))) return tx('imp_noExcel');
    if (file.size > MAXIMO_IMPORTAR_MB * 1024 * 1024) {
      return tx('imp_muyGrande', { size: formatSize(file.size), max: MAXIMO_IMPORTAR_MB });
    }
    return null;
  };

  const resetFlujo = () => {
    setArchivo(null);
    setResultado(null);
    setErrorGlobal('');
    setPreviewRows([]);
    setPreviewArchivo('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    resetFlujo();
  };

  /** Mismo camino para el selector y para soltar un archivo encima. */
  const elegirArchivo = (file) => {
    if (!file) return;
    const errorArchivo = validarArchivo(file, tab);
    if (errorArchivo) {
      resetFlujo();
      setErrorGlobal(errorArchivo);
      return;
    }
    setArchivo(file);
    setResultado(null);
    setErrorGlobal('');
    setPreviewRows([]);
    setPreviewArchivo('');
  };

  const handlePreview = async () => {
    if (!archivo) {
      setErrorGlobal(tx('imp_faltaArchivo'));
      return;
    }
    if (modo === 'miembro' && !miembroId) {
      setErrorGlobal(tx('imp_faltaMiembro'));
      return;
    }

    setCargando(true);
    setErrorGlobal('');
    setResultado(null);

    try {
      const asignadoId = modo === 'miembro' ? miembroId : null;
      const data = await tareasService.previewImportar(proyectoId, archivo, modo, asignadoId);
      setPreviewRows((data.filas || []).map((fila) => normalizarFila(fila)));
      setPreviewArchivo(data.archivo || archivo.name);
    } catch (err) {
      setErrorGlobal(err.message);
    } finally {
      setCargando(false);
    }
  };

  const handleGuardarPreview = async () => {
    if (filasActivas.length === 0) {
      setErrorGlobal(tx('imp_sinFilas'));
      return;
    }
    if (filasInvalidas.length > 0) {
      setErrorGlobal(tx('imp_corrige'));
      return;
    }
    if (modo === 'miembro' && !miembroId) {
      setErrorGlobal(tx('imp_faltaMiembro'));
      return;
    }

    setGuardando(true);
    setErrorGlobal('');

    try {
      const payload = filasActivas.map((fila) => ({
        numeroActividad: fila.numeroActividad,
        titulo: fila.titulo,
        descripcion: fila.descripcion,
        estado: fila.estado,
        prioridad: fila.prioridad,
        fechaInicio: fila.fechaInicio,
        venceEn: fila.venceEn,
        asignadoEmail: fila.asignadoEmail,
        completadoEn: fila.completadoEn,
        horaCompletado: fila.horaCompletado,
      }));
      const asignadoId = modo === 'miembro' ? miembroId : null;
      const data = await tareasService.confirmarImportacion(proyectoId, payload, modo, asignadoId);
      setResultado(data);
      setPreviewRows([]);
      if (data.creadas > 0 && onImportado) onImportado(data);
    } catch (err) {
      setErrorGlobal(err.message);
    } finally {
      setGuardando(false);
    }
  };

  // La plantilla se descarga con la cabecera Authorization (fetch + blob), asi
  // que un fallo del servidor llega aqui en vez de abrir una pestaña en blanco.
  const handleDescargarPlantilla = async () => {
    setErrorGlobal('');
    try {
      await tareasService.descargarPlantilla(tab === 'excel' ? 'excel' : 'json');
    } catch (err) {
      setErrorGlobal(err.message || t('downloadFailed'));
    }
  };

  const updateFila = (filaIndex, field, value) => {
    setPreviewRows((prev) => prev.map((fila, index) => (
      index === filaIndex
        ? {
            ...fila,
            [field]:
              field === 'estado'
                ? normalizarEstado(value)
                : field === 'prioridad'
                  ? normalizarPrioridad(value)
                  : value,
          }
        : fila
    )));
  };

  // Los botones van en el pie fijo de la ventana: con la vista previa larga
  // quedaban al final del scroll y en el movil habia que bajar hasta abajo.
  const pie = (
    <div className="imp-pie">
      <button type="button" onClick={onClose} className="det-control det-boton">
        {t('close')}
      </button>

      {previewActiva && (
        <button
          type="button"
          onClick={() => { setPreviewRows([]); setErrorGlobal(''); setResultado(null); }}
          className="det-control det-boton"
        >
          {tx('imp_cambiarArchivo')}
        </button>
      )}

      {!previewActiva && !resultado && (
        <button type="button" onClick={handlePreview} disabled={cargando || !archivo} className="btn-primary imp-principal">
          {cargando ? <><Loader2 size={16} className="animate-spin" /> {tx('imp_revisando')}</> : <><Info size={16} /> {tx('imp_revisar')}</>}
        </button>
      )}

      {previewActiva && (
        <button
          type="button"
          onClick={handleGuardarPreview}
          disabled={guardando || filasActivas.length === 0 || filasInvalidas.length > 0}
          className="btn-primary imp-principal"
        >
          {guardando ? <><Loader2 size={16} className="animate-spin" /> {t('saving')}</> : <><ArrowDownToLine size={16} /> {tx('imp_guardar')}</>}
        </button>
      )}

      {resultado && (
        <button type="button" onClick={resetFlujo} className="btn-primary imp-principal">
          <RotateCcw size={16} /> {tx('imp_otro')}
        </button>
      )}
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="1100px"
      title={tx('imp_titulo')}
      subtitle={tx('imp_subtitulo')}
      footer={pie}
    >
        {!resultado && (
          <fieldset className="mb-5 min-w-0">
            <legend className="mb-2 text-[13px] font-medium text-[var(--color-text-dim)]">{tx('imp_aQuien')}</legend>
            <div className="flex flex-col gap-1.5">
              {MODOS.map((m) => (
                <label key={m.key} className="imp-modo" data-activo={modo === m.key || undefined}>
                  <input
                    type="radio"
                    name="modoAsignacion"
                    value={m.key}
                    checked={modo === m.key}
                    onChange={() => {
                      setModo(m.key);
                      setPreviewRows([]);
                      setErrorGlobal('');
                      setResultado(null);
                    }}
                    className="accent-[var(--color-primary)]"
                  />
                  <m.Icono size={18} className="imp-modo-icono shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-[var(--color-text)]">{tx(m.labelKey)}</span>
                    <span className="block text-[12px] text-[var(--color-text-muted)]">{tx(m.descKey)}</span>
                  </span>
                </label>
              ))}
            </div>

            {modo === 'miembro' && (
              <div className="mt-3 space-y-1.5">
                <span className="form-label block">{tx('imp_miembro')}</span>
                <SelectorSimple
                  aria-label={tx('imp_miembro')}
                  valor={miembroId}
                  onCambio={setMiembroId}
                  placeholder={tx('imp_miembroPlaceholder')}
                  opciones={[
                    ...(usuarioActual ? [{ valor: String(usuarioActual.id), etiqueta: tx('imp_yo', { nombre: usuarioActual.nombre }) }] : []),
                    ...usuarios.filter((u) => u.id !== usuarioActual?.id).map((u) => ({
                      valor: String(u.id),
                      etiqueta: `${u.nombre} — ${u.email}`,
                    })),
                  ]}
                />
              </div>
            )}
          </fieldset>
        )}

        {!resultado && (
          <div role="tablist" aria-label={tx('imp_formatoAria')} className="imp-formatos mb-4">
            {['excel', 'json'].map((formato) => (
              <button
                key={formato}
                type="button"
                role="tab"
                aria-selected={tab === formato}
                onClick={() => handleTabChange(formato)}
              >
                {formato === 'excel' ? <FileSpreadsheet size={16} /> : <Braces size={16} />} {FORMAT_INFO[formato].label}
              </button>
            ))}
          </div>
        )}

        {!previewActiva && !resultado && (
          <>
            <button type="button" onClick={handleDescargarPlantilla} className="imp-plantilla mb-4">
              <Download size={14} /> {tx('imp_descargarPlantilla', { formato: fmt.label })}
            </button>

            <div className="mb-5">
              <span className="form-label mb-1.5 block">{tx('imp_seleccionar', { formato: fmt.label })}</span>
              {/* Boton real: la zona se alcanza con el teclado y en el movil
                  abre el selector de archivos al tocarla. */}
              <button
                type="button"
                className="imp-soltar"
                data-con-archivo={archivo ? '' : undefined}
                data-arrastrando={arrastrando || undefined}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastrando(false);
                  elegirArchivo(e.dataTransfer.files?.[0]);
                }}
              >
                {archivo ? (
                  <>
                    <File size={30} className="text-[var(--color-primary)]" aria-hidden="true" />
                    <span className="max-w-full break-all text-[14px] font-medium text-[var(--color-text)]">{archivo.name}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]">{formatSize(archivo.size)}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={36} className="text-[var(--color-text-dim)]" aria-hidden="true" />
                    <span className="text-[14px] font-semibold text-[var(--color-text)]">{tx('imp_elegir')}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]">{tx('imp_limite', { ext: fmt.ext, max: MAXIMO_IMPORTAR_MB })}</span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={fmt.accept}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  elegirArchivo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </>
        )}

        {errorGlobal && (
          <div className="alert-error mb-4 text-[13.5px]" role="alert">
            <XCircle size={16} className="shrink-0" /> {errorGlobal}
          </div>
        )}

        {previewActiva && (
          <div className="mb-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-[var(--color-text)]">{tx('imp_vistaPrevia')}</p>
                <p className="break-all text-[12.5px] text-[var(--color-text-muted)]">{previewArchivo}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="badge-info">{tx('imp_activas', { n: filasActivas.length })}</span>
                <span className="badge-danger">{tx('imp_conError', { n: filasInvalidas.length })}</span>
                <span className="badge-warning">{tx('imp_conAviso', { n: filasConAvisos.length })}</span>
              </div>
            </div>

            <div className="grid gap-3">
              {previewRows.map((fila, index) => {
                const errores = fila.omitida ? [] : validarFilaPreview(fila, reglasTareas.exigirFechaLimite, reglasTareas.estadoInicial);
                const estadoFila = fila.estado || reglasTareas.estadoInicial;
                const avisoCorreo = !fila.omitida && modo === 'archivo' && fila.asignadoEmail && !correoEsDeMiembro(fila.asignadoEmail, usuarios);

                return (
                  <div
                    key={`fila-${fila.fila}-${index}`}
                    className="imp-fila"
                    data-omitida={fila.omitida || undefined}
                    data-error={errores.length > 0 || undefined}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--color-text)]">{tx('imp_fila', { n: fila.fila })}</p>
                        <p className="text-[12px] text-[var(--color-text-muted)]">{tx('imp_asignacion', { nombre: nombreAsignacion(fila) })}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateFila(index, 'omitida', !fila.omitida)}
                        aria-pressed={fila.omitida}
                        className="det-control det-boton"
                      >
                        {fila.omitida ? tx('imp_reactivar') : tx('imp_omitir')}
                      </button>
                    </div>

                    {/* Una columna en el movil, dos en tablet y cuatro en
                        escritorio. Antes era `auto-fit` con campos que ocupaban
                        dos columnas, y en un movil la rejilla se salia de la
                        ventana por la derecha. */}
                    <div className="imp-campos">
                      <label className="imp-campo">
                        <span>{tx('imp_colNumero')}</span>
                        <input disabled={fila.omitida} value={fila.numeroActividad} onChange={(e) => updateFila(index, 'numeroActividad', e.target.value)} className="form-input" type="number" min="1" inputMode="numeric" />
                      </label>
                      <label className="imp-campo imp-campo-ancho">
                        <span>{tx('imp_colTitulo')}</span>
                        <input disabled={fila.omitida} value={fila.titulo} onChange={(e) => updateFila(index, 'titulo', e.target.value)} className="form-input" />
                      </label>
                      <div className="imp-campo">
                        <span>{tx('imp_colEstado')}</span>
                        <SelectorSimple
                          aria-label={tx('imp_estadoFila', { n: fila.fila })}
                          disabled={fila.omitida}
                          valor={estadoFila}
                          onCambio={(v) => updateFila(index, 'estado', v)}
                          opciones={ESTADOS_TAREA.map((e) => ({ valor: e.value, etiqueta: t(e.labelKey) }))}
                        />
                      </div>
                      <div className="imp-campo">
                        <span>{tx('imp_colPrioridad')}</span>
                        <SelectorSimple
                          aria-label={tx('imp_prioridadFila', { n: fila.fila })}
                          disabled={fila.omitida}
                          valor={fila.prioridad || reglasTareas.prioridadDefecto}
                          onCambio={(v) => updateFila(index, 'prioridad', v)}
                          opciones={PRIORIDADES_TAREA.map((p) => ({ valor: p.value, etiqueta: t(p.labelKey) }))}
                        />
                      </div>
                      <label className="imp-campo">
                        <span>{tx('imp_colInicio')}</span>
                        <input disabled={fila.omitida} value={fila.fechaInicio} onChange={(e) => updateFila(index, 'fechaInicio', e.target.value)} className="form-input" type="date" min={`${ANIO_MINIMO}-01-01`} aria-invalid={Boolean(fila.fechaInicio) && !esFechaRazonable(fila.fechaInicio)} />
                      </label>
                      <label className="imp-campo">
                        <span>{tx('imp_colLimite')}</span>
                        <input disabled={fila.omitida} value={fila.venceEn} onChange={(e) => updateFila(index, 'venceEn', e.target.value)} className="form-input" type="date" min={`${ANIO_MINIMO}-01-01`} aria-invalid={Boolean(fila.venceEn) && !esFechaRazonable(fila.venceEn)} />
                      </label>
                      {/* Cuando se hizo: solo en tareas hechas, y opcional. Sin
                          fecha se usa la limite (si ya paso) o el momento de
                          importar; sin hora, el mediodia. */}
                      {estadoFila === 'HECHO' && (
                        <>
                          <label className="imp-campo">
                            <span>{tx('imp_colCompletada')}</span>
                            <input disabled={fila.omitida} value={fila.completadoEn} onChange={(e) => updateFila(index, 'completadoEn', e.target.value)} className="form-input" type="date" min={`${ANIO_MINIMO}-01-01`} aria-invalid={Boolean(fila.completadoEn) && !esFechaRazonable(fila.completadoEn)} />
                          </label>
                          <label className="imp-campo">
                            <span>{tx('imp_colHora')}</span>
                            <input disabled={fila.omitida} value={fila.horaCompletado} onChange={(e) => updateFila(index, 'horaCompletado', e.target.value)} className="form-input" type="time" />
                          </label>
                        </>
                      )}
                      <label className="imp-campo imp-campo-ancho">
                        <span>{tx('imp_colDescripcion')}</span>
                        <textarea disabled={fila.omitida} value={fila.descripcion} onChange={(e) => updateFila(index, 'descripcion', e.target.value)} className="form-input resize-y" rows="2" />
                      </label>
                      <label className="imp-campo">
                        <span>{tx('imp_colCorreo')}</span>
                        <input
                          disabled={fila.omitida || modo !== 'archivo'}
                          value={fila.asignadoEmail}
                          onChange={(e) => updateFila(index, 'asignadoEmail', e.target.value)}
                          className="form-input"
                          type="email"
                          inputMode="email"
                          autoCapitalize="none"
                          placeholder={modo === 'archivo' ? tx('imp_correoPlaceholder') : tx('imp_correoPorModo')}
                        />
                      </label>
                    </div>

                    {!fila.omitida && errores.length > 0 && (
                      <ul className="imp-aviso imp-aviso-error mt-3">
                        {errores.map((clave) => <li key={clave}>{tx(clave)}</li>)}
                      </ul>
                    )}

                    {!fila.omitida && fila.traeCierre && estadoFila !== 'HECHO' && (
                      <p className="imp-aviso imp-aviso-alerta mt-2.5">{tx('imp_avisoCierre')}</p>
                    )}

                    {avisoCorreo && (
                      <p className="imp-aviso imp-aviso-alerta mt-2.5">{tx('imp_avisoCorreo')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            {resultado.creadas > 0 && (
              <div className="alert-success text-[14px] font-medium">
                <CheckCircle2 size={18} className="shrink-0" />
                {resultado.creadas === 1 ? tx('imp_creadaUna') : tx('imp_creadas', { n: resultado.creadas })}
              </div>
            )}

            {resultado.errores?.length > 0 && (
              <div className="imp-aviso imp-aviso-alerta">
                <p className="mb-2 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={14} className="shrink-0" />
                  {resultado.errores.length === 1 ? tx('imp_errorUna') : tx('imp_errores', { n: resultado.errores.length })}
                </p>
                <ul className="grid gap-1.5">
                  {resultado.errores.map((error, i) => (
                    <li key={`${error.fila}-${i}`} className="text-[var(--color-text-dim)]">
                      <strong className="text-[var(--badge-warning-fg)]">{tx('imp_fila', { n: error.fila })}:</strong> {error.razon}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
    </Modal>
  );
};

export default ModalImportar;
