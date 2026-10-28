// Ventana "Mandar a finanzas": copia un archivo de una tarea o de un proyecto
// a Cotizaciones y/o a Gastos variables. En cada destino se elige si va a un
// registro nuevo (con sus datos; el cliente del proyecto ya viene puesto) o a
// uno que ya existe (versión nueva de una cotización, comprobante de un
// gasto). El servidor guarda todo o nada (finanzasDesdeAdjunto.controller.js)
// y el archivo de la tarea no cambia.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import {
  AlertTriangle, Check, FileStack, Loader2, ReceiptText, Search, Send,
} from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import SelectorSimple from '../SelectorSimple';
import { ListSkeleton } from '../Skeleton';
import { AvisoError, Campo, Seccion } from './piezas';
import { SelectorAccesoCotizacion } from './AccesoCotizacion';
import { finanzasService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { useFormatoFinanzas } from '../../hooks/useFormatoFinanzas';
import { useDebounce } from '../../utils/useDebounce';
import { ACCESO_ABIERTO } from '../../utils/accesoConocimiento';
import {
  MONEDAS, OPCIONES_SWR_FINANZAS, TIPOS_COTIZACION, etiquetaEmpresa, hoyClave, opcionesCliente, recargarFinanzas, rutaCategoria,
} from '../../utils/finanzas';

const sinExtension = (nombre = '') => String(nombre).replace(/\.[^.]+$/, '');

/** Tarjeta para elegir un destino (con el motivo si no se puede). */
const Destino = ({ activo, onCambio, Icono, titulo, ayuda, aviso }) => (
  <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${aviso ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${activo ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}`}>
    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]" checked={activo} disabled={Boolean(aviso)} onChange={(e) => onCambio(e.target.checked)} />
    <span className="min-w-0">
      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--color-text)]"><Icono size={15} aria-hidden="true" />{titulo}</span>
      <span className="block text-[12px] text-[var(--color-text-muted)]">{aviso || ayuda}</span>
    </span>
  </label>
);

/** Nuevo / existente. */
const Modo = ({ valor, onCambio, opciones, etiqueta }) => (
  <div className="dash-segmento mb-4 inline-flex h-10 items-center" role="tablist" aria-label={etiqueta}>
    {opciones.map((o) => (
      <button key={o.valor} type="button" role="tab" aria-selected={valor === o.valor} disabled={o.deshabilitado} onClick={() => onCambio(o.valor)}>{o.etiqueta}</button>
    ))}
  </div>
);

/** Buscador de una cotización o un gasto variable ya registrado. */
const BuscadorRegistro = ({ tipo, valor, onCambio }) => {
  const tf = useTextoFinanzas();
  const { monto, fecha } = useFormatoFinanzas();
  const [busqueda, setBusqueda] = useState('');
  const q = useDebounce(busqueda, 300);
  const { data, isLoading } = useSWR(
    ['finanzas-mandar-buscar', tipo, q],
    () => (tipo === 'cotizacion'
      ? finanzasService.cotizaciones.listar({ q, page: 1, limit: 30 })
      : finanzasService.gastos.listar({ categoria: 'VARIABLES', q, page: 1, limit: 30 })),
    { ...OPCIONES_SWR_FINANZAS, keepPreviousData: true },
  );
  const lista = (tipo === 'cotizacion' ? data?.cotizaciones : data?.gastos) || [];
  return (
    <div className="sm:col-span-2">
      <div className="relative mb-2">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
        <input type="search" className="form-input !pl-9" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={tf(tipo === 'cotizacion' ? 'finManBuscarCot' : 'finManBuscarGasto')} aria-label={tf(tipo === 'cotizacion' ? 'finManBuscarCot' : 'finManBuscarGasto')} />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)]" role="radiogroup" aria-label={tf(tipo === 'cotizacion' ? 'finManElegirCot' : 'finManElegirGasto')}>
        {isLoading && !data && <div className="p-3"><ListSkeleton rows={3} header={false} /></div>}
        {data && lista.length === 0 && <p className="px-3 py-5 text-center text-[12.5px] text-[var(--color-text-muted)]">{tf('finManSinResultados')}</p>}
        {lista.map((r) => {
          const elegido = String(r.id) === String(valor);
          const titulo = tipo === 'cotizacion' ? r.titulo : r.concepto;
          const quien = tipo === 'cotizacion' ? r.contraparteNombre : r.proveedorNombre;
          const cifra = tipo === 'cotizacion' ? (r.montoActual !== null ? monto(r.montoActual, r.moneda) : null) : monto(r.monto, r.moneda);
          return (
            <label key={r.id} className={`flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 ${elegido ? 'bg-[var(--color-primary-10)]' : 'hover:bg-[color-mix(in_srgb,var(--color-text)_3%,transparent)]'}`}>
              <input type="radio" name={`buscar-${tipo}`} className="h-4 w-4 shrink-0 accent-[var(--color-primary)]" checked={elegido} onChange={() => onCambio(String(r.id), r)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{titulo}</span>
                <span className="block truncate text-[11.5px] text-[var(--color-text-muted)]">{[r.folio, quien, fecha(r.fecha)].filter(Boolean).join(' · ')}</span>
              </span>
              {cifra && <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-[var(--color-text)]">{cifra}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
};

const Contenido = ({ ctx, catalogos, onClose, onListo }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { showToast } = useToast();
  const { usuario } = useAuth();
  const { destinos, proyecto, tarea, adjunto } = ctx;
  const clienteProyecto = proyecto?.cliente || null;
  const tituloBase = tarea?.titulo || sinExtension(adjunto.nombre);

  // Por qué no se puede mandar a un destino (sin permiso, tipo de archivo o tamaño).
  const avisoDe = (motivo, textoTipo) => {
    if (motivo === 'permiso') return tf('finManSinPermiso');
    if (motivo === 'tipo') return tf(textoTipo);
    if (motivo === 'tamano') return tf('finManMuyGrande', { mb: ctx.maximoMB });
    return null;
  };
  const avisoCot = avisoDe(destinos.cotizacion.motivo, 'finManTipoCot');
  const avisoGasto = avisoDe(destinos.gasto.motivo, 'finManTipoGasto');

  const [aCot, setACot] = useState(!avisoCot);
  const [aGasto, setAGasto] = useState(false);
  const [modoCot, setModoCot] = useState('nueva');
  const [modoGasto, setModoGasto] = useState(destinos.gasto.nuevo ? 'nuevo' : 'existente');
  const [cot, setCot] = useState({
    tipo: 'RECIBIDA', titulo: tituloBase, empresaId: '', contraparteNombre: '', clienteId: clienteProyecto ? String(clienteProyecto.id) : '',
    moneda: 'MXN', fecha: hoyClave(), monto: '', nota: '', cotizacionId: '',
  });
  const [acceso, setAcceso] = useState(ACCESO_ABIERTO);
  const [gasto, setGasto] = useState({
    concepto: tituloBase, monto: '', moneda: 'MXN', fecha: hoyClave(), fechaLimite: '', empresaId: '', proveedorNombre: '',
    clienteId: clienteProyecto ? String(clienteProyecto.id) : '', gastoId: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // La ventana es larga: el aviso de error queda arriba, se lleva a la vista.
  const refError = useRef(null);
  useEffect(() => {
    if (error) refError.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const clientes = opcionesCliente(catalogos?.clientes, clienteProyecto);
  const proveedores = catalogos?.proveedores || [];
  const directorioCot = cot.tipo === 'ENVIADA' ? (catalogos?.clientes || []) : proveedores;
  const cambiarCot = (campo) => (valor) => { setCot((p) => ({ ...p, [campo]: valor })); setError(null); };
  const cambiarGasto = (campo) => (valor) => { setGasto((p) => ({ ...p, [campo]: valor })); setError(null); };
  const entrada = (cambiar) => (e) => cambiar(e.target.value);

  // Elegir una ficha del directorio llena el nombre (si no se había escrito otro).
  const elegirEmpresa = (lista, estado, set, campoNombre) => (empresaId) => {
    const ficha = lista.find((c) => String(c.id) === empresaId);
    const anterior = lista.find((c) => String(c.id) === estado.empresaId);
    const nombreAnterior = anterior ? (anterior.nombreComercial || anterior.nombre) : '';
    const reemplazar = !estado[campoNombre] || estado[campoNombre] === nombreAnterior;
    set((p) => ({ ...p, empresaId, [campoNombre]: reemplazar ? (ficha ? (ficha.nombreComercial || ficha.nombre) : '') : p[campoNombre] }));
    setError(null);
  };
  // Una enviada va al cliente: si el proyecto tiene uno, se propone.
  const elegirTipo = (tipo) => setCot((p) => {
    const cliente = tipo === 'ENVIADA' && clienteProyecto ? clienteProyecto : null;
    return {
      ...p, tipo, empresaId: cliente ? String(cliente.id) : '', contraparteNombre: cliente ? (cliente.nombreComercial || cliente.nombre) : '',
    };
  });

  const mandar = async (e) => {
    e.preventDefault();
    if (!aCot && !aGasto) { setError({ texto: tf('finManElegirDestino') }); return; }
    if (aCot && modoCot === 'version' && !cot.cotizacionId) { setError({ texto: tf('finManElegirCot') }); return; }
    if (aGasto && modoGasto === 'existente' && !gasto.gastoId) { setError({ texto: tf('finManElegirGasto') }); return; }
    const cuerpo = {};
    if (aCot) {
      cuerpo.cotizacion = modoCot === 'version'
        ? { modo: 'version', cotizacionId: cot.cotizacionId, monto: cot.monto, nota: cot.nota }
        : {
          modo: 'nueva',
          tipo: cot.tipo,
          titulo: cot.titulo,
          empresaId: cot.empresaId || null,
          contraparteNombre: cot.contraparteNombre,
          clienteId: cot.tipo === 'RECIBIDA' ? cot.clienteId || null : null,
          moneda: cot.moneda,
          fecha: cot.fecha,
          monto: cot.monto,
          nota: cot.nota,
          ...(destinos.cotizacion.acceso && acceso.restringido ? { acceso } : {}),
        };
    }
    if (aGasto) {
      cuerpo.gasto = modoGasto === 'existente'
        ? { modo: 'existente', gastoId: gasto.gastoId }
        : {
          modo: 'nuevo',
          concepto: gasto.concepto,
          monto: gasto.monto,
          moneda: gasto.moneda,
          fecha: gasto.fecha,
          fechaLimite: gasto.fechaLimite || null,
          empresaId: gasto.empresaId || null,
          proveedorNombre: gasto.proveedorNombre,
          clienteId: gasto.clienteId || null,
        };
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await finanzasService.desdeAdjunto.mandar(adjunto.id, cuerpo);
      showToast(res.mensaje, 'success');
      recargarFinanzas();
      onListo(res);
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
      setGuardando(false);
    }
  };

  const copias = ctx.copias || [];

  return (
    <Modal
      open
      onClose={guardando ? undefined : onClose}
      maxWidth="760px"
      title={tf('finManTitulo')}
      subtitle={tf('finManSub', { nombre: adjunto.nombre })}
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" form="form-mandar-finanzas" disabled={guardando || (!aCot && !aGasto)}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {guardando ? tf('finManMandando') : tf('finManMandar')}
          </Button>
        </div>
      )}
    >
      <form id="form-mandar-finanzas" onSubmit={mandar} noValidate>
        <AvisoError error={error} refError={refError} />
        {copias.length > 0 && (
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--badge-warning-fg)_30%,transparent)] bg-[var(--badge-warning-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-warning-fg)]" role="status">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            {tf('finManYaEsta', { lista: copias.map((c) => (c.numero > 1 ? `${c.folio} (v${c.numero})` : c.folio)).join(', ') })}
          </p>
        )}
        {(proyecto || tarea) && (
          <p className="mb-4 text-[12.5px] text-[var(--color-text-muted)]">
            {tf('finManDe', { origen: [tarea?.titulo, proyecto?.nombre].filter(Boolean).join(' · ') })}
            {clienteProyecto && ` · ${tf('finManClienteProyecto', { cliente: etiquetaEmpresa(clienteProyecto) })}`}
          </p>
        )}

        <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={tf('finManDestinos')}>
          <Destino activo={aCot} onCambio={(v) => { setACot(v); setError(null); }} Icono={FileStack} titulo={tf('finCotizacionesTitulo')} ayuda={tf('finManCotAyuda')} aviso={avisoCot} />
          <Destino activo={aGasto} onCambio={(v) => { setAGasto(v); setError(null); }} Icono={ReceiptText} titulo={tf('finCatVARIABLES')} ayuda={tf('finManGastoAyuda')} aviso={avisoGasto} />
        </div>

        {aCot && (
          <Seccion titulo={tf('finCotizacionesTitulo')}>
            <div className="sm:col-span-2">
              <Modo
                etiqueta={tf('finCotizacionesTitulo')}
                valor={modoCot}
                onCambio={setModoCot}
                opciones={[
                  { valor: 'nueva', etiqueta: tf('finManCotNueva') },
                  { valor: 'version', etiqueta: tf('finManCotVersion'), deshabilitado: !destinos.cotizacion.existente },
                ]}
              />
            </div>
            {modoCot === 'version' ? (
              <>
                <BuscadorRegistro tipo="cotizacion" valor={cot.cotizacionId} onCambio={(id, r) => setCot((p) => ({ ...p, cotizacionId: id, moneda: r.moneda }))} />
                <Campo id="man-cot-nota" label={tf('finCotQueCambio')} requerido ancho>
                  <textarea id="man-cot-nota" rows={2} className="form-input" value={cot.nota} onChange={entrada(cambiarCot('nota'))} maxLength={2000} placeholder={tf('finCotQueCambioPh')} />
                </Campo>
                <Campo id="man-cot-monto" label={tf('finCotMonto')} ayuda={tf('finCotMontoAyuda')}>
                  <input id="man-cot-monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={cot.monto} onChange={entrada(cambiarCot('monto'))} />
                </Campo>
              </>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-2 sm:col-span-2" role="radiogroup" aria-label={tf('finCotTipo')}>
                  {TIPOS_COTIZACION.map((tipo) => (
                    <button key={tipo} type="button" role="radio" aria-checked={cot.tipo === tipo} onClick={() => elegirTipo(tipo)} className={`rounded-xl border px-3 py-2 text-left transition-colors ${cot.tipo === tipo ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}`}>
                      <span className="block text-[13px] font-semibold text-[var(--color-text)]">{tf(`finCotTipo${tipo}`)}</span>
                      <span className="block text-[11.5px] text-[var(--color-text-muted)]">{tf(`finCotTipo${tipo}Hint`)}</span>
                    </button>
                  ))}
                </div>
                <Campo id="man-cot-titulo" label={tf('finCotTitulo')} requerido ancho>
                  <input id="man-cot-titulo" className="form-input" value={cot.titulo} onChange={entrada(cambiarCot('titulo'))} maxLength={255} />
                </Campo>
                {directorioCot.length > 0 && (
                  <Campo id="man-cot-empresa" label={`${tf(`finCotContraparte${cot.tipo}`)} · ${tf('finCotDelDirectorio')}`}>
                    <SelectorSimple id="man-cot-empresa" valor={cot.empresaId} onCambio={elegirEmpresa(directorioCot, cot, setCot, 'contraparteNombre')} opcionVacia={tf('finCotSinFicha')} opciones={directorioCot.map((c) => ({ valor: String(c.id), etiqueta: etiquetaEmpresa(c) }))} />
                  </Campo>
                )}
                <Campo id="man-cot-contraparte" label={directorioCot.length > 0 ? tf('finCotNombreContraparte') : tf(`finCotContraparte${cot.tipo}`)} requerido ancho={directorioCot.length === 0}>
                  <input id="man-cot-contraparte" className="form-input" value={cot.contraparteNombre} onChange={entrada(cambiarCot('contraparteNombre'))} maxLength={255} placeholder={tf('finCotNombreContrapartePh')} />
                </Campo>
                {cot.tipo === 'RECIBIDA' && clientes.length > 0 && (
                  <Campo id="man-cot-cliente" label={tf('finClienteDe')} ayuda={tf('finClienteDeAyuda')} ancho>
                    <SelectorSimple id="man-cot-cliente" valor={cot.clienteId} onCambio={cambiarCot('clienteId')} opcionVacia={tf('finClienteNinguno')} opciones={clientes} />
                  </Campo>
                )}
                <Campo id="man-cot-fecha" label={tf('finCotFecha')} requerido>
                  <input id="man-cot-fecha" type="date" className="form-input" value={cot.fecha} onChange={entrada(cambiarCot('fecha'))} />
                </Campo>
                <Campo id="man-cot-moneda" label={tf('finMoneda')}>
                  <SelectorSimple id="man-cot-moneda" valor={cot.moneda} onCambio={cambiarCot('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
                </Campo>
                <Campo id="man-cot-monto" label={tf('finCotMonto')} ayuda={tf('finCotMontoAyuda')}>
                  <input id="man-cot-monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={cot.monto} onChange={entrada(cambiarCot('monto'))} />
                </Campo>
                <Campo id="man-cot-nota" label={tf('finCotNotaOriginal')}>
                  <input id="man-cot-nota" className="form-input" value={cot.nota} onChange={entrada(cambiarCot('nota'))} maxLength={2000} />
                </Campo>
                {destinos.cotizacion.acceso && (
                  <div className="mb-2 sm:col-span-2">
                    <p className="form-label mb-1.5">{tf('finCotAccQuienVe')}</p>
                    <SelectorAccesoCotizacion valor={acceso} onCambio={setAcceso} creadorId={usuario?.id} nombre="man-acceso" />
                  </div>
                )}
              </>
            )}
          </Seccion>
        )}

        {aGasto && (
          <Seccion titulo={tf('finCatVARIABLES')}>
            <div className="sm:col-span-2">
              <Modo
                etiqueta={tf('finCatVARIABLES')}
                valor={modoGasto}
                onCambio={setModoGasto}
                opciones={[
                  { valor: 'nuevo', etiqueta: tf('finManGastoNuevo'), deshabilitado: !destinos.gasto.nuevo },
                  { valor: 'existente', etiqueta: tf('finManGastoExistente'), deshabilitado: !destinos.gasto.existente },
                ]}
              />
            </div>
            {modoGasto === 'existente' ? (
              <BuscadorRegistro tipo="gasto" valor={gasto.gastoId} onCambio={(id) => setGasto((p) => ({ ...p, gastoId: id }))} />
            ) : (
              <>
                <Campo id="man-gasto-concepto" label={tf('finConcepto')} requerido ancho>
                  <input id="man-gasto-concepto" className="form-input" value={gasto.concepto} onChange={entrada(cambiarGasto('concepto'))} maxLength={255} />
                </Campo>
                <Campo id="man-gasto-monto" label={tf('finMonto')} requerido>
                  <input id="man-gasto-monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="form-input" value={gasto.monto} onChange={entrada(cambiarGasto('monto'))} />
                </Campo>
                <Campo id="man-gasto-moneda" label={tf('finMoneda')}>
                  <SelectorSimple id="man-gasto-moneda" valor={gasto.moneda} onCambio={cambiarGasto('moneda')} opciones={MONEDAS.map((m) => ({ valor: m, etiqueta: m }))} />
                </Campo>
                <Campo id="man-gasto-fecha" label={tf('finFechaGasto')} requerido>
                  <input id="man-gasto-fecha" type="date" className="form-input" value={gasto.fecha} onChange={entrada(cambiarGasto('fecha'))} />
                </Campo>
                <Campo id="man-gasto-limite" label={tf('finFechaLimite')} ayuda={tf('finFechaLimiteAyuda')}>
                  <input id="man-gasto-limite" type="date" className="form-input" value={gasto.fechaLimite} onChange={entrada(cambiarGasto('fechaLimite'))} />
                </Campo>
                {proveedores.length > 0 && (
                  <Campo id="man-gasto-empresa" label={tf('finProveedorDirectorio')}>
                    <SelectorSimple id="man-gasto-empresa" valor={gasto.empresaId} onCambio={elegirEmpresa(proveedores, gasto, setGasto, 'proveedorNombre')} opcionVacia={tf('finProveedorSinFicha')} opciones={proveedores.map((c) => ({ valor: String(c.id), etiqueta: etiquetaEmpresa(c) }))} />
                  </Campo>
                )}
                <Campo id="man-gasto-proveedor" label={tf('finProveedorNombre')} ancho={proveedores.length === 0}>
                  <input id="man-gasto-proveedor" className="form-input" value={gasto.proveedorNombre} onChange={entrada(cambiarGasto('proveedorNombre'))} maxLength={255} placeholder={tf('finProveedorNombrePh')} />
                </Campo>
                {clientes.length > 0 && (
                  <Campo id="man-gasto-cliente" label={tf('finClienteDe')} ayuda={tf('finClienteDeAyuda')} ancho>
                    <SelectorSimple id="man-gasto-cliente" valor={gasto.clienteId} onCambio={cambiarGasto('clienteId')} opcionVacia={tf('finClienteNinguno')} opciones={clientes} />
                  </Campo>
                )}
                <p className="text-[12px] text-[var(--color-text-muted)] sm:col-span-2">{tf('finManGastoPendiente')}</p>
              </>
            )}
          </Seccion>
        )}
      </form>
    </Modal>
  );
};

/** Props: adjuntoId, onClose, onListo(respuesta) tras mandarlo. */
const MandarAFinanzas = ({ adjuntoId, onClose, onListo }) => {
  const tf = useTextoFinanzas();
  const { data: ctx, error } = useSWR(['finanzas-mandar-contexto', adjuntoId], () => finanzasService.desdeAdjunto.contexto(adjuntoId), { revalidateOnFocus: false });
  // Directorio (clientes y proveedores); sin permiso de verlo, solo nombres libres.
  const { data: catalogos, error: errorCatalogos } = useSWR('finanzas-catalogos', () => finanzasService.catalogos(), { ...OPCIONES_SWR_FINANZAS, shouldRetryOnError: false });
  const listos = ctx && (catalogos || errorCatalogos);
  if (listos) return <Contenido ctx={ctx} catalogos={catalogos} onClose={onClose} onListo={onListo} />;
  return (
    <Modal open onClose={onClose} maxWidth="760px" title={tf('finManTitulo')}>
      {error ? <div className="alert-error">{error.message}</div> : <ListSkeleton rows={4} header={false} />}
    </Modal>
  );
};

export default MandarAFinanzas;

/** Etiquetas de a dónde ya se mandó un archivo ("COT-2026-0004 · v2", "GAS-2026-0031"). */
export const CopiasEnFinanzas = ({ copias = [] }) => {
  const tf = useTextoFinanzas();
  if (!copias.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={tf('finManEnFinanzas')}>
      {copias.map((c) => (
        <Link
          key={`${c.tipo}-${c.id}-${c.numero || ''}`}
          to={c.tipo === 'cotizacion' ? `/cotizaciones?cotizacion=${c.id}` : `${rutaCategoria(c.categoria || 'VARIABLES')}?gasto=${c.id}`}
          className="inline-flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-px font-mono text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title={tf(c.tipo === 'cotizacion' ? 'finManCopiaCot' : 'finManCopiaGasto', { folio: c.folio })}
        >
          <Check size={10} aria-hidden="true" />
          {c.folio}{c.numero > 1 ? ` · v${c.numero}` : ''}
        </Link>
      ))}
    </span>
  );
};
