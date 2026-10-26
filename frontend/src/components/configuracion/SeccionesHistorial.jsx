// Registro de actividad y papelera del panel de configuración (pedido del
// 2026-10-26). Son lo único del panel que muestra datos de la empresa: quién
// cambió qué y lo que se borró, con sus archivos. Backend:
// controllers/configuracionAuditoria.controller.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import {
  Banknote, BookOpen, Building2, CalendarDays, ChevronDown, Cloud, Download, FileSignature, FileText, FolderKanban, Landmark,
  ListChecks, Loader2, MessageSquare, Paperclip, Pencil, Plus, Receipt, RotateCcw, Search, Trash2, UserRound,
} from 'lucide-react';
import { configuracionService } from '../../services/api';
import SelectorSimple from '../SelectorSimple';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmacion } from '../ConfirmDialog';
import { Fila } from './PiezasConfiguracion';
import { CAMPOS_OCULTOS, etiquetaCampo, textoValor } from '../../utils/camposHistorial';

const MODULOS = ['proyectos', 'tareas', 'archivos', 'clientes', 'contratos', 'agenda', 'finanzas', 'cotizaciones', 'conocimiento', 'usuarios', 'configuracion'];

const ICONO_TIPO = {
  proyecto: FolderKanban, tarea: ListChecks, comentario: MessageSquare, adjunto: Paperclip, cliente: Building2, contacto: UserRound,
  contrato: FileSignature, archivoContrato: FileSignature, evento: CalendarDays, diaEmpresa: CalendarDays, diaEspecial: CalendarDays,
  cuenta: Landmark, pago: Banknote, gasto: Receipt, comprobante: Receipt, cotizacion: FileText, articulo: BookOpen, archivoConocimiento: BookOpen,
};

/** Fecha 'YYYY-MM-DD' del selector -> ISO del inicio de ese dia (o del siguiente). */
const inicioDia = (valor, sumar = 0) => {
  if (!valor) return '';
  const fecha = new Date(`${valor}T00:00:00`);
  fecha.setDate(fecha.getDate() + sumar);
  return fecha.toISOString();
};
const claveDia = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Campo de busqueda con su icono; avisa el texto 300 ms despues de dejar de escribir. */
const Buscador = ({ valor, onCambio, placeholder }) => {
  const [texto, setTexto] = useState(valor);
  useEffect(() => {
    const espera = setTimeout(() => { if (texto !== valor) onCambio(texto); }, 300);
    return () => clearTimeout(espera);
  }, [texto, valor, onCambio]);
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
      <input type="search" className="cfg-input !pl-9" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={100} />
    </div>
  );
};

const Estado = ({ cargando, error, onReintentar, vacio }) => {
  const { t } = usePreferences();
  if (cargando) return <div className="flex justify-center py-10 text-[var(--color-text-muted)]"><Loader2 className="animate-spin" /></div>;
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-[13px] text-[var(--color-text-dim)]">
        <p>{t('hisError')}</p>
        <button type="button" className="cfg-btn" onClick={onReintentar}><RotateCcw size={13} /> {t('hisReintentar')}</button>
      </div>
    );
  }
  return <p className="rounded-[8px] border border-dashed border-[var(--cfg-linea-fuerte)] p-6 text-center text-[13.5px] text-[var(--color-text-dim)]">{vacio}</p>;
};

/**
 * Lista paginada (40-50 por pagina, "Cargar mas" con el id del ultimo). `pedir(filtros)`
 * devuelve { [clave]: [...], siguiente }.
 */
const usePaginado = (pedir, clave, filtros) => {
  const [filas, setFilas] = useState([]);
  const [siguiente, setSiguiente] = useState(null);
  const [masCargando, setMasCargando] = useState(false);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  // Filtros de la ultima carga terminada: mientras no sean los actuales, se esta cargando.
  const [listoPara, setListoPara] = useState(null);
  const cargando = listoPara !== filtros;

  useEffect(() => {
    let cancelado = false;
    pedir(filtros)
      .then((r) => {
        if (cancelado) return;
        setFilas(r[clave] || []);
        setSiguiente(r.siguiente || null);
        setError(false);
        setListoPara(filtros);
      })
      .catch(() => {
        if (cancelado) return;
        setError(true);
        setListoPara(filtros);
      });
    return () => { cancelado = true; };
  }, [pedir, clave, filtros, intento]);

  const cargar = () => { setListoPara(null); setIntento((n) => n + 1); };

  const cargarMas = async () => {
    if (!siguiente) return;
    setMasCargando(true);
    try {
      const r = await pedir({ ...filtros, antesDe: siguiente });
      setFilas((previas) => [...previas, ...(r[clave] || [])]);
      setSiguiente(r.siguiente || null);
    } catch {
      setError(true);
    } finally {
      setMasCargando(false);
    }
  };

  return { filas, setFilas, siguiente, cargando, masCargando, error, cargar, cargarMas };
};

const usePersonas = () => {
  const [personas, setPersonas] = useState([]);
  useEffect(() => {
    let cancelado = false;
    configuracionService.personasActividad().then((r) => { if (!cancelado) setPersonas(r.personas || []); }).catch(() => {});
    return () => { cancelado = true; };
  }, []);
  return personas;
};

// ── Registro de actividad ─────────────────────────────────────────────────

const ACCION_ICONO = { crear: Plus, editar: Pencil, eliminar: Trash2 };
const ACCION_COLOR = {
  crear: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
  editar: 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]',
  eliminar: 'bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]',
};

const Cambios = ({ cambios }) => {
  const { t, language } = usePreferences();
  return (
    <div className="mt-2 overflow-hidden rounded-[8px] border border-[var(--cfg-linea)] text-[12.5px]">
      <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-[var(--color-surface-3)] px-3 py-1.5 font-semibold text-[var(--color-text-muted)] sm:grid">
        <span>{t('hisCampo')}</span><span>{t('hisAntes')}</span><span>{t('hisDespues')}</span>
      </div>
      <ul className="divide-y divide-[var(--cfg-linea)]">
        {cambios.map((c) => (
          <li key={c.campo} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3">
            <span className="font-medium text-[var(--color-text)]">{etiquetaCampo(c.campo, language)}</span>
            <span className="break-words text-[var(--color-text-dim)]">
              <span className="font-semibold text-[var(--color-text-muted)] sm:hidden">{t('hisAntes')}: </span>
              <span className="line-through decoration-[var(--color-text-muted)]/50">{c.antes === null && c.despues === '(cambió)' ? '—' : textoValor(c.antes, { t, language, nombre: c.antesNombre })}</span>
            </span>
            <span className="break-words text-[var(--color-text)]">
              <span className="font-semibold text-[var(--color-text-muted)] sm:hidden">{t('hisDespues')}: </span>
              {c.despues === '(cambió)' ? t('hisCambio') : textoValor(c.despues, { t, language, nombre: c.despuesNombre })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const FilaActividad = ({ r }) => {
  const { t, language } = usePreferences();
  const [abierta, setAbierta] = useState(false);
  const Icono = ACCION_ICONO[r.accion] || Pencil;
  const actor = r.origen === 'drive' ? t('hisGoogleDrive') : (r.usuarioNombre || t('hisAlguien'));
  const purga = r.modulo === 'papelera';
  const verbo = purga ? t('hisVerboPurgar') : t(`hisVerbo_${r.accion}`);
  const tipo = t(`hisTipo_${r.tipo}`);
  let nombre = r.entidadNombre;
  if (nombre && !r.entidadId && /^\d+$/.test(nombre)) nombre = t('hisVarios', { n: nombre });
  else if (nombre && !r.entidadId && /^\+\d+$/.test(nombre)) nombre = t('hisMas', { n: nombre.slice(1) });
  const hora = new Date(r.creadoEn).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-MX', { hour: '2-digit', minute: '2-digit' });
  const cambios = Array.isArray(r.cambios) ? r.cambios : [];

  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ACCION_COLOR[r.accion] || ACCION_COLOR.editar}`} aria-hidden="true">
        {r.origen === 'drive' ? <Cloud size={14} /> : <Icono size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13.5px] leading-snug text-[var(--color-text)]">
          <strong className="font-semibold">{actor}</strong> {verbo} {tipo}
          {nombre && <> <strong className="font-semibold">«{nombre}»</strong></>}
          {r.origen === 'calendar' && <span className="text-[var(--color-text-dim)]"> ({t('hisDesdeCalendar')})</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="tabular-nums">{hora}</span>
          <span className="badge-neutral">{t(`hisModulo_${r.modulo}`)}</span>
          {cambios.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}>
              {abierta ? t('hisOcultarCambios') : t('hisVerCambios', { n: cambios.length })}
              <ChevronDown size={13} className={`transition-transform ${abierta ? 'rotate-180' : ''}`} />
            </button>
          )}
        </p>
        {abierta && <Cambios cambios={cambios} />}
      </div>
    </li>
  );
};

export const SeccionActividad = () => {
  const { t, language } = usePreferences();
  const personas = usePersonas();
  const [filtros, setFiltros] = useState({ q: '', usuarioId: '', modulo: '', accion: '', desde: '', hasta: '' });
  const consulta = useMemo(() => ({ ...filtros, desde: inicioDia(filtros.desde), hasta: inicioDia(filtros.hasta, 1) }), [filtros]);
  const { filas, siguiente, cargando, masCargando, error, cargar, cargarMas } = usePaginado(configuracionService.actividad, 'registros', consulta);
  const set = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));
  const hayFiltros = Object.values(filtros).some(Boolean);
  const cambiarQ = useCallback((q) => setFiltros((f) => ({ ...f, q })), []);

  // Agrupado por dia: "Hoy", "Ayer" o la fecha.
  const dias = useMemo(() => {
    const hoyFecha = new Date();
    const ayerFecha = new Date(hoyFecha);
    ayerFecha.setDate(hoyFecha.getDate() - 1);
    const hoy = claveDia(hoyFecha.toISOString());
    const ayer = claveDia(ayerFecha.toISOString());
    const grupos = [];
    for (const r of filas) {
      const clave = claveDia(r.creadoEn);
      let grupo = grupos[grupos.length - 1];
      if (!grupo || grupo.clave !== clave) {
        const titulo = clave === hoy ? t('hisHoy') : clave === ayer ? t('hisAyer')
          : new Date(r.creadoEn).toLocaleDateString(language === 'en' ? 'en-US' : 'es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        grupo = { clave, titulo, filas: [] };
        grupos.push(grupo);
      }
      grupo.filas.push(r);
    }
    return grupos;
  }, [filas, t, language]);

  return (
    <Fila titulo={t('cfgSecActivity')} descripcion={t('hisDesdeCuando')}>
      <div className="mb-4 space-y-3">
        <Buscador valor={filtros.q} onCambio={cambiarQ} placeholder={t('hisBuscar')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectorSimple id="his-persona" aria-label={t('hisTodasPersonas')} valor={filtros.usuarioId} onCambio={set('usuarioId')} opcionVacia={t('hisTodasPersonas')} placeholder={t('hisTodasPersonas')}
            opciones={personas.map((p) => ({ valor: String(p.id), etiqueta: p.nombre }))} />
          <SelectorSimple id="his-modulo" aria-label={t('hisTodosModulos')} valor={filtros.modulo} onCambio={set('modulo')} opcionVacia={t('hisTodosModulos')} placeholder={t('hisTodosModulos')}
            opciones={[...MODULOS, 'papelera'].map((m) => ({ valor: m, etiqueta: t(`hisModulo_${m}`) }))} />
          <SelectorSimple id="his-accion" aria-label={t('hisTodasAcciones')} valor={filtros.accion} onCambio={set('accion')} opcionVacia={t('hisTodasAcciones')} placeholder={t('hisTodasAcciones')}
            opciones={['crear', 'editar', 'eliminar'].map((a) => ({ valor: a, etiqueta: t(`hisAccion_${a}`) }))} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[9rem] flex-1 sm:flex-none">
            <span className="cfg-label !mb-1 text-[12px]">{t('hisDesde')}</span>
            <input type="date" className="cfg-input" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => set('desde')(e.target.value)} />
          </label>
          <label className="min-w-[9rem] flex-1 sm:flex-none">
            <span className="cfg-label !mb-1 text-[12px]">{t('hisHasta')}</span>
            <input type="date" className="cfg-input" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => set('hasta')(e.target.value)} />
          </label>
          {hayFiltros && (
            <button type="button" className="cfg-btn cfg-btn-texto" onClick={() => setFiltros({ q: '', usuarioId: '', modulo: '', accion: '', desde: '', hasta: '' })}>
              {t('hisLimpiar')}
            </button>
          )}
        </div>
      </div>

      {cargando || error || !filas.length
        ? <Estado cargando={cargando} error={error} onReintentar={cargar} vacio={t('hisSinActividad')} />
        : (
          <div className="space-y-4">
            {dias.map((d) => (
              <section key={d.clave}>
                <h3 className="sticky top-14 z-[1] bg-[var(--color-surface)] py-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)] first-letter:uppercase">{d.titulo}</h3>
                <ul className="divide-y divide-[var(--cfg-linea)]">
                  {d.filas.map((r) => <FilaActividad key={r.id} r={r} />)}
                </ul>
              </section>
            ))}
            {siguiente && (
              <div className="flex justify-center">
                <button type="button" className="cfg-btn" onClick={cargarMas} disabled={masCargando}>
                  {masCargando && <Loader2 size={13} className="animate-spin" />} {t('hisCargarMas')}
                </button>
              </div>
            )}
          </div>
        )}
    </Fila>
  );
};

// ── Papelera ──────────────────────────────────────────────────────────────

/** Titulo y texto secundario de un elemento de una lista dentro de la copia (comentario, tarea, archivo...). */
const resumenHijo = (h, { t, language }) => {
  const principal = h.titulo || h.nombre || h.nombreOriginal || h.contenido || h.descripcion || h.accion || '—';
  const quien = h.autorNombre || h.usuarioNombre || null;
  const cuando = h.creadoEn ? textoValor(h.creadoEn, { t, language }) : null;
  return { principal: String(principal), secundario: [quien, cuando].filter(Boolean).join(' · ') };
};

const DatosCopia = ({ datos }) => {
  const { t, language } = usePreferences();
  if (!datos || typeof datos !== 'object') return null;
  const simples = [];
  const listas = [];
  for (const [campo, valor] of Object.entries(datos)) {
    if (CAMPOS_OCULTOS.has(campo)) continue;
    if (Array.isArray(valor)) { if (valor.length && typeof valor[0] === 'object') listas.push([campo, valor]); continue; }
    if (valor && typeof valor === 'object') {
      // Relacion con nombre (cliente, creador, empresa, autor...)
      if (valor.nombre) simples.push([campo, valor.nombre]);
      continue;
    }
    if (valor === null || valor === '' || (/Id$/.test(campo) && typeof valor === 'number')) continue;
    simples.push([campo, valor]);
  }
  return (
    <div className="space-y-3">
      {simples.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {simples.map(([campo, valor]) => (
            <div key={campo} className="contents">
              <dt className="font-medium text-[var(--color-text-muted)]">{etiquetaCampo(campo, language)}</dt>
              <dd className="whitespace-pre-line break-words text-[var(--color-text)]">{textoValor(valor, { t, language })}</dd>
            </div>
          ))}
        </dl>
      )}
      {listas.map(([campo, lista]) => (
        <div key={campo}>
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            {t(`papSeccion_${campo}`) === `papSeccion_${campo}` ? etiquetaCampo(campo, language) : t(`papSeccion_${campo}`)} ({lista.length})
          </p>
          <ul className="space-y-1 rounded-[8px] bg-[var(--color-surface-3)] p-2.5 text-[12.5px]">
            {lista.slice(0, 50).map((h, i) => {
              const { principal, secundario } = resumenHijo(h, { t, language });
              return (
                <li key={h.id ?? i} className="break-words">
                  <span className="text-[var(--color-text)]">{principal.length > 300 ? `${principal.slice(0, 299)}…` : principal}</span>
                  {secundario && <span className="block text-[11.5px] text-[var(--color-text-muted)]">{secundario}</span>}
                </li>
              );
            })}
            {lista.length > 50 && <li className="text-[var(--color-text-muted)]">{t('hisMas', { n: lista.length - 50 })}</li>}
          </ul>
        </div>
      ))}
    </div>
  );
};

const tamanoTexto = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const DetallePapelera = ({ id, onEliminado }) => {
  const { t } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [elemento, setElemento] = useState(null);
  const [error, setError] = useState(false);
  const [bajando, setBajando] = useState(null);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    configuracionService.elementoPapelera(id).then((r) => { if (!cancelado) setElemento(r.elemento); }).catch(() => { if (!cancelado) setError(true); });
    return () => { cancelado = true; };
  }, [id]);

  const bajar = async (indice, nombre) => {
    setBajando(indice);
    try { await configuracionService.descargarDePapelera(id, indice, nombre); } catch (e) { showToast(e.message, 'error'); } finally { setBajando(null); }
  };

  const eliminar = async () => {
    if (!(await confirmar({ titulo: t('papConfirmar', { nombre: elemento.nombre }), descripcion: t('papConfirmarTexto'), peligro: true, textoConfirmar: t('papConfirmarBoton') }))) return;
    setEliminando(true);
    try {
      const r = await configuracionService.eliminarDePapelera(id);
      showToast(r.mensaje, 'success');
      onEliminado(id);
    } catch (e) {
      showToast(e.message, 'error');
      setEliminando(false);
    }
  };

  if (error) return <p className="py-3 text-[13px] text-[var(--color-error)]">{t('hisError')}</p>;
  if (!elemento) return <div className="flex justify-center py-4 text-[var(--color-text-muted)]"><Loader2 size={18} className="animate-spin" /></div>;
  const archivos = elemento.archivos || [];

  return (
    <div className="mt-3 space-y-4 rounded-[8px] border border-[var(--cfg-linea)] p-3 sm:p-4">
      {dialogo}
      <div>
        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{t('papArchivosTitulo')}</p>
        {archivos.length === 0 ? <p className="text-[12.5px] text-[var(--color-text-dim)]">{t('papSinArchivos')}</p> : (
          <ul className="space-y-1.5">
            {archivos.map((a, i) => (
              <li key={`${a.nombre}-${i}`} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Paperclip size={14} className="shrink-0 text-[var(--color-text-muted)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{a.nombre}</span>
                {a.tamano ? <span className="text-[12px] text-[var(--color-text-muted)]">{tamanoTexto(a.tamano)}</span> : null}
                <button type="button" className="cfg-btn !h-8 text-[12.5px]" onClick={() => bajar(i, a.nombre)} disabled={bajando === i}>
                  {bajando === i ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('papDescargar')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{t('papDatos')}</p>
        <DatosCopia datos={elemento.datos} />
      </div>
      <div className="flex justify-end border-t border-[var(--cfg-linea)] pt-3">
        <button type="button" className="cfg-btn cfg-btn-texto cfg-btn-peligro" onClick={eliminar} disabled={eliminando}>
          {eliminando ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t('papEliminar')}
        </button>
      </div>
    </div>
  );
};

const FilaPapelera = ({ e, abierta, onAlternar, onEliminado }) => {
  const { t, language } = usePreferences();
  const Icono = ICONO_TIPO[e.tipo] || Trash2;
  const cuando = formatDistanceToNow(new Date(e.borradoEn), { addSuffix: true, locale: language === 'en' ? enUS : es });
  const quien = e.origen === 'drive' ? t('papQuitadoDrive', { cuando })
    : e.origen === 'calendar' ? t('papCanceladoCalendar', { cuando })
      : e.borradoPorNombre ? t('papBorradoPor', { nombre: e.borradoPorNombre, cuando }) : t('papBorrado', { cuando });
  return (
    <li className="py-3">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={onAlternar} aria-expanded={abierta}>
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-3)] text-[var(--color-text-dim)]" aria-hidden="true">
          {e.origen === 'drive' ? <Cloud size={16} /> : <Icono size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[14px] font-semibold text-[var(--color-text)]">{e.nombre}</span>
          <span className="mt-0.5 block text-[12.5px] text-[var(--color-text-dim)]">
            {t(`papTipo_${e.tipo}`)}{e.contexto ? ` · ${e.contexto}` : ''}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            <span title={new Date(e.borradoEn).toLocaleString(language === 'en' ? 'en-US' : 'es-MX')}>{quien}</span>
            {e.archivos > 0 && <span className="badge-neutral inline-flex items-center gap-1"><Paperclip size={11} /> {e.archivos === 1 ? t('papUnArchivo') : t('papArchivos', { n: e.archivos })}</span>}
          </span>
        </span>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-[var(--color-text-muted)] transition-transform ${abierta ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {abierta && <DetallePapelera id={e.id} onEliminado={onEliminado} />}
    </li>
  );
};

export const SeccionPapelera = () => {
  const { t } = usePreferences();
  const personas = usePersonas();
  const [filtros, setFiltros] = useState({ q: '', modulo: '', usuarioId: '' });
  const { filas, setFilas, siguiente, cargando, masCargando, error, cargar, cargarMas } = usePaginado(configuracionService.papelera, 'elementos', filtros);
  const [abierto, setAbierto] = useState(null);
  const set = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));
  const hayFiltros = Object.values(filtros).some(Boolean);
  const cambiarQ = useCallback((q) => setFiltros((f) => ({ ...f, q })), []);

  return (
    <Fila titulo={t('cfgSecTrash')} descripcion={t('papIntro')}>
      <div className="mb-4 space-y-3">
        <Buscador valor={filtros.q} onCambio={cambiarQ} placeholder={t('hisBuscar')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <SelectorSimple id="pap-modulo" aria-label={t('hisTodosModulos')} valor={filtros.modulo} onCambio={set('modulo')} opcionVacia={t('hisTodosModulos')} placeholder={t('hisTodosModulos')}
            opciones={MODULOS.filter((m) => !['usuarios', 'configuracion'].includes(m)).map((m) => ({ valor: m, etiqueta: t(`hisModulo_${m}`) }))} />
          <SelectorSimple id="pap-persona" aria-label={t('hisTodasPersonas')} valor={filtros.usuarioId} onCambio={set('usuarioId')} opcionVacia={t('hisTodasPersonas')} placeholder={t('hisTodasPersonas')}
            opciones={personas.map((p) => ({ valor: String(p.id), etiqueta: p.nombre }))} />
          {hayFiltros && <button type="button" className="cfg-btn cfg-btn-texto" onClick={() => setFiltros({ q: '', modulo: '', usuarioId: '' })}>{t('hisLimpiar')}</button>}
        </div>
      </div>

      {cargando || error || !filas.length
        ? <Estado cargando={cargando} error={error} onReintentar={cargar} vacio={hayFiltros ? t('papSinResultados') : t('papVacia')} />
        : (
          <>
            <ul className="divide-y divide-[var(--cfg-linea)]">
              {filas.map((e) => (
                <FilaPapelera
                  key={e.id}
                  e={e}
                  abierta={abierto === e.id}
                  onAlternar={() => setAbierto((a) => (a === e.id ? null : e.id))}
                  onEliminado={(id) => { setFilas((f) => f.filter((x) => x.id !== id)); setAbierto(null); }}
                />
              ))}
            </ul>
            {siguiente && (
              <div className="mt-3 flex justify-center">
                <button type="button" className="cfg-btn" onClick={cargarMas} disabled={masCargando}>
                  {masCargando && <Loader2 size={13} className="animate-spin" />} {t('hisCargarMas')}
                </button>
              </div>
            )}
          </>
        )}
    </Fila>
  );
};
