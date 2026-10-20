// Detalle de un contrato: sus datos, los PDF cargados (ver dentro del CRM,
// descargar, eliminar) y la zona para subir el escaneado. Se monta con un
// `key` por contrato, así que siempre arranca limpio.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Download, ExternalLink, Eye, FileCheck2, FileText, FileUp, FileWarning, FolderKanban, Loader2,
  Mail, Pencil, Phone, RefreshCcw, Trash2, User,
} from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../ui/button';
import { contratosService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { puede } from '../../utils/permisos';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoClientes } from '../../hooks/useTextoClientes';
import { useConfirmacion } from '../ConfirmDialog';
import SelectorSimple from '../SelectorSimple';
import UserAvatar from '../UserAvatar';
import { inicialesEmpresa } from '../../utils/empresas';
import {
  BADGE_ESTADO, pdfMaxBytes, pdfMaxMegas, TIPOS_DOCUMENTO, TONO_VIGENCIA, estadoVisible, formatearFechaCorta, formatearMonto,
  formatearTamano, progresoVigencia, textoVencimiento,
} from '../../utils/contratos';
import { abrirPdfEnPestana, puedeIncrustarPdf } from './abrirPdf';

/** Panel con cabecera, igual que en la ficha de clientes. */
const Panel = ({ titulo, conteo, accion, children }) => (
  <section className="cli-panel overflow-hidden">
    <header className="cli-panel-cabecera">
      <h3 className="cli-etiqueta">
        {titulo}
        {conteo !== undefined && <span className="cli-conteo">{conteo}</span>}
      </h3>
      {accion}
    </header>
    {children}
  </section>
);

const DetalleContrato = ({ open, contratoId, onClose, onEditar, onEliminar, onCambio }) => {
  const { t, locale } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { moduloActivo } = useConfiguracion();
  const tc = useTextoClientes();
  const { usuario } = useAuth();
  // Editar (datos y PDFs) y eliminar son permisos aparte.
  const puedeEditar = puede(usuario, 'contratos.editar');
  const puedeEliminar = puede(usuario, 'contratos.eliminar');
  const [contrato, setContrato] = useState(null);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [tipoDocumento, setTipoDocumento] = useState('FIRMADO');
  const [arrastrando, setArrastrando] = useState(false);
  const [previa, setPrevia] = useState(null); // { archivo, url }
  const [abriendo, setAbriendo] = useState(null);
  const urlPrevia = useRef(null);
  // En pantallas táctiles no se arrastra: el texto invita a tocar.
  const [tactil] = useState(() => window.matchMedia?.('(hover: none)').matches ?? false);

  const recargar = async () => {
    const data = await contratosService.obtener(contratoId);
    setContrato(data.contrato);
    return data.contrato;
  };

  useEffect(() => {
    let cancelado = false;
    contratosService.obtener(contratoId)
      .then((data) => { if (!cancelado) setContrato(data.contrato); })
      .catch((err) => { if (!cancelado) setError(err.message); });
    return () => { cancelado = true; };
  }, [contratoId]);

  // La vista previa vive en memoria (blob): se libera al cerrar.
  useEffect(() => () => { if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current); }, []);

  const cerrarPrevia = () => {
    if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current);
    urlPrevia.current = null;
    setPrevia(null);
  };

  const descargar = async (archivo) => {
    try {
      await contratosService.descargarArchivo(archivo.id, archivo.nombreOriginal);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // En móvil, el visor del sistema (pestaña nueva) en lugar del iframe.
  const abrirEnPestana = async (archivo) => {
    setAbriendo(archivo.id);
    try {
      await abrirPdfEnPestana(() => contratosService.urlParaVer(archivo.id), { alBloquear: () => descargar(archivo) });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAbriendo(null);
    }
  };

  const ver = async (archivo) => {
    if (!puedeIncrustarPdf()) { abrirEnPestana(archivo); return; }
    setAbriendo(archivo.id);
    try {
      const url = await contratosService.urlParaVer(archivo.id);
      if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current);
      urlPrevia.current = url;
      setPrevia({ archivo, url });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAbriendo(null);
    }
  };

  const subir = async (archivo) => {
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) { showToast(t('ctrOnlyPdf'), 'error'); return; }
    if (archivo.size > pdfMaxBytes()) { showToast(t('ctrTooBig', { mb: pdfMaxMegas() }), 'error'); return; }
    setSubiendo(true);
    try {
      await contratosService.subirArchivo(contratoId, archivo, tipoDocumento);
      showToast(t('ctrUploaded'), 'success');
      await recargar();
      onCambio();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const borrarArchivo = async (archivo) => {
    const ok = await confirmar({ titulo: t('ctrFileDeleteConfirm', { name: archivo.nombreOriginal }), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await contratosService.eliminarArchivo(archivo.id);
      if (previa?.archivo.id === archivo.id) cerrarPrevia();
      showToast(t('ctrFileDeleted'), 'success');
      await recargar();
      onCambio();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const estado = contrato ? estadoVisible(contrato) : null;
  const monto = contrato ? formatearMonto(contrato.monto, contrato.moneda, locale) : null;
  const vencimiento = contrato ? textoVencimiento(t, contrato) : null;
  const progreso = contrato ? progresoVigencia(contrato) : null;
  const tieneFirmado = contrato?.archivos.some((a) => a.tipoDocumento === 'FIRMADO');

  const pie = contrato && !previa && (puedeEditar || puedeEliminar) && (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
      {puedeEliminar ? (
        <Button type="button" variant="outline" className="text-[var(--color-error)]" onClick={() => onEliminar(contrato)}>
          <Trash2 size={16} /> {t('delete')}
        </Button>
      ) : <span />}
      {puedeEditar && (
        <Button type="button" onClick={() => onEditar(contrato)}>
          <Pencil size={16} /> {t('edit')}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="1040px"
      title={contrato ? contrato.titulo : t('ctrDetail')}
      subtitle={contrato ? `${contrato.folio} · ${t(`ctrType${contrato.tipo}`)}` : undefined}
      headerExtra={estado && <span className={BADGE_ESTADO[estado]}>{t(`ctrStatus${estado}`)}</span>}
      footer={pie}
    >
      {dialogo}
      {error && <div role="alert" className="alert-error">{error}</div>}
      {!contrato && !error && (
        <div className="flex justify-center py-16 text-[var(--color-text-muted)]"><Loader2 className="animate-spin" /></div>
      )}

      {contrato && previa && (
        <div className="flex h-[70dvh] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cerrarPrevia}>
              <ArrowLeft size={15} /> {t('ctrClosePreview')}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">{previa.archivo.nombreOriginal}</span>
            <div className="flex items-center gap-2">
              {/* El blob ya está en memoria: se abre tal cual en otra pestaña */}
              <Button asChild variant="outline" size="sm">
                <a href={previa.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} /> {t('ctrOpenTab')}
                </a>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => descargar(previa.archivo)}>
                <Download size={15} /> {t('ctrDownload')}
              </Button>
            </div>
          </div>
          <iframe title={previa.archivo.nombreOriginal} src={previa.url} className="min-h-0 flex-1 rounded-2xl border border-[var(--color-border)] bg-white" />
        </div>
      )}

      {contrato && !previa && (
        <div className="space-y-5">
          {/* Cifras principales: monto, vigencia y documentos */}
          <div className="ctr-franja">
            <div>
              <div className="ctr-franja-etiqueta">{t('ctrFieldAmount')}</div>
              <div className="ctr-franja-valor">{monto || '—'}</div>
              <div className="ctr-franja-nota">
                {monto
                  ? [contrato.periodicidadPago && t(`ctrPer${contrato.periodicidadPago}`), contrato.incluyeIva ? t('ctrVatIncluded') : t('ctrPlusVat')].filter(Boolean).join(' · ')
                  : t('ctrNoAmount')}
              </div>
            </div>
            <div>
              <div className="ctr-franja-etiqueta">{t('ctrColTerm')}</div>
              <div className="mt-1.5 text-[15px] font-semibold tabular-nums text-[var(--color-text)]">
                {contrato.fechaInicio || contrato.fechaFin
                  ? <>{formatearFechaCorta(contrato.fechaInicio, locale) || '—'} <span className="font-normal text-[var(--color-text-muted)]">→</span> {formatearFechaCorta(contrato.fechaFin, locale) || '—'}</>
                  : t('ctrNoDates')}
              </div>
              {progreso && (
                <div className="ctr-barra mt-2.5" data-tono={TONO_VIGENCIA[estado] || 'neutral'} role="progressbar" aria-valuenow={progreso.porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label={t('ctrElapsed', { p: progreso.porcentaje })}>
                  <span style={{ width: `${progreso.porcentaje}%` }} />
                </div>
              )}
              <div className="ctr-franja-nota flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className={vencimiento ? `font-medium ${estado === 'VENCIDO' ? 'text-[var(--color-error)]' : estado === 'POR_VENCER' ? 'text-[var(--color-warning)]' : ''}` : 'flex items-center gap-1'}>
                  {vencimiento
                    || (contrato.renovacionAutomatica && <><RefreshCcw size={11} aria-hidden="true" /> {t('ctrAutoRenew')}</>)
                    || (progreso?.diasParaIniciar > 0 && t('ctrStartsIn', { n: progreso.diasParaIniciar }))}
                </span>
                {progreso && <span className="tabular-nums">{t('ctrElapsed', { p: progreso.porcentaje })}</span>}
              </div>
            </div>
            <div>
              <div className="ctr-franja-etiqueta">{t('ctrFiles')}</div>
              <div className="ctr-franja-valor">{contrato.archivos.length}</div>
              <div className="ctr-franja-nota">
                {tieneFirmado
                  ? <span className="flex items-center gap-1 text-[var(--color-success)]"><FileCheck2 size={13} aria-hidden="true" /> {t('ctrDocFIRMADO')}</span>
                  : <span className="flex items-center gap-1 font-medium text-[var(--color-warning)]"><FileWarning size={13} aria-hidden="true" /> {t('ctrMissingSigned')}</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              {contrato.descripcion && (
                <Panel titulo={t('ctrFieldDescription')}>
                  <p className="whitespace-pre-line px-4 py-3 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">{contrato.descripcion}</p>
                </Panel>
              )}

              <Panel
                titulo={t('ctrSecCounterparty')}
                accion={contrato.empresa && moduloActivo('clientes') && (
                  <Link to={`/clientes/${contrato.empresa.id}`} className="cli-enlace">
                    {tc('cliCtrVerFicha')} <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="ctr-mono" data-grande aria-hidden="true">{inicialesEmpresa(contrato.contraparteNombre)}</span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold leading-snug text-[var(--color-text)]">{contrato.contraparteNombre}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="cli-tipo" data-tipo={contrato.tipo}>{t(`ctrType${contrato.tipo}`)}</span>
                      {contrato.contraparteRfc && <span className="font-mono text-[12px] text-[var(--color-text-muted)]">{contrato.contraparteRfc}</span>}
                    </div>
                    {/* El nombre del directorio solo si difiere de la contraparte (que es la foto al firmar) */}
                    {contrato.empresa && contrato.empresa.nombre !== contrato.contraparteNombre && (
                      <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{contrato.empresa.nombre}</div>
                    )}
                  </div>
                </div>
                {(contrato.contraparteContacto || contrato.contraparteEmail || contrato.contraparteTelefono) && (
                  <div className="border-t border-[var(--color-border)]">
                    {contrato.contraparteContacto && (
                      <div className="cli-contacto items-center">
                        <span className="cli-avatar" aria-hidden="true"><User size={15} /></span>
                        <div className="min-w-0 text-[13px]">
                          <div className="text-[12px] text-[var(--color-text-muted)]">{t('ctrFieldCpContact')}</div>
                          <div className="font-medium text-[var(--color-text)]">{contrato.contraparteContacto}</div>
                        </div>
                      </div>
                    )}
                    {contrato.contraparteEmail && (
                      <div className="cli-contacto items-center">
                        <span className="cli-avatar" aria-hidden="true"><Mail size={15} /></span>
                        <div className="min-w-0 text-[13px]">
                          <div className="text-[12px] text-[var(--color-text-muted)]">{t('ctrFieldCpEmail')}</div>
                          <a className="block truncate font-medium text-[var(--color-text)] hover:underline" href={`mailto:${contrato.contraparteEmail}`}>{contrato.contraparteEmail}</a>
                        </div>
                      </div>
                    )}
                    {contrato.contraparteTelefono && (
                      <div className="cli-contacto items-center">
                        <span className="cli-avatar" aria-hidden="true"><Phone size={15} /></span>
                        <div className="min-w-0 text-[13px]">
                          <div className="text-[12px] text-[var(--color-text-muted)]">{t('ctrFieldCpPhone')}</div>
                          <a className="font-medium text-[var(--color-text)] hover:underline" href={`tel:${contrato.contraparteTelefono.replace(/\s+/g, '')}`}>{contrato.contraparteTelefono}</a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              <Panel titulo={t('ctrSecGeneral')}>
                <dl className="ctr-datos">
                  {contrato.categoria && <div><dt>{t('ctrFieldCategory')}</dt><dd>{t(`ctrCat${contrato.categoria}`)}</dd></div>}
                  {contrato.fechaFirma && <div><dt>{t('ctrFieldSigned')}</dt><dd>{formatearFechaCorta(contrato.fechaFirma, locale)}</dd></div>}
                  {contrato.periodicidadPago && <div><dt>{t('ctrFieldPeriodicity')}</dt><dd>{t(`ctrPer${contrato.periodicidadPago}`)}</dd></div>}
                  {monto && <div><dt>{t('ctrVat')}</dt><dd>{contrato.incluyeIva ? t('ctrVatIncluded') : t('ctrPlusVat')}</dd></div>}
                  {contrato.fechaFin && (
                    <div>
                      <dt>{t('ctrSecTerm')}</dt>
                      <dd>{[contrato.renovacionAutomatica && t('ctrAutoRenew'), t('ctrNoticeDays', { n: contrato.diasAviso })].filter(Boolean).join(' · ')}</dd>
                    </div>
                  )}
                  {contrato.proyecto && (
                    <div>
                      <dt>{t('ctrFieldProject')}</dt>
                      <dd>
                        <Link to={`/proyectos/${contrato.proyecto.id}`} className="inline-flex items-center gap-1.5 hover:underline" title={t('ctrOpenProject')}>
                          <FolderKanban size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
                          {contrato.proyecto.nombre}
                          <ArrowUpRight size={12} className="text-[var(--color-text-muted)]" aria-hidden="true" />
                        </Link>
                      </dd>
                    </div>
                  )}
                  {contrato.responsable && (
                    <div>
                      <dt>{t('ctrFieldOwner')}</dt>
                      <dd className="flex items-center gap-2">
                        <UserAvatar usuario={contrato.responsable} size={22} radius={6} fontSize="10px" />
                        <span className="min-w-0 truncate">{contrato.responsable.nombre}</span>
                      </dd>
                    </div>
                  )}
                </dl>
              </Panel>

              {contrato.notas && (
                <Panel titulo={t('ctrFieldNotes')}>
                  <p className="whitespace-pre-line px-4 py-3 text-[13px] text-[var(--color-text-dim)]">{contrato.notas}</p>
                </Panel>
              )}

              {contrato.creadoPor && (
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  {t('ctrCreatedBy', { name: contrato.creadoPor.nombre, date: new Date(contrato.creadoEn).toLocaleDateString(locale) })}
                </p>
              )}
            </div>

            <div className="lg:sticky lg:top-0 lg:self-start">
              <Panel titulo={t('ctrFiles')} conteo={contrato.archivos.length}>
                {!tieneFirmado && (
                  <div className="flex items-start gap-3 border-b border-[var(--color-border)] bg-[var(--badge-warning-bg)] px-4 py-3 text-[var(--badge-warning-fg)]">
                    <FileWarning size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="text-[13px]">
                      <div className="font-semibold">{t('ctrMissingSigned')}</div>
                      <div className="mt-0.5 opacity-90">{t('ctrMissingSignedHint')}</div>
                    </div>
                  </div>
                )}

                {contrato.archivos.length > 0 && (
                  <ul>
                    {contrato.archivos.map((archivo) => (
                      <li key={archivo.id}>
                        <div className="cli-fila">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]" aria-hidden="true">
                            <FileText size={17} />
                          </span>
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => ver(archivo)}>
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-[var(--color-text)] hover:underline">{archivo.nombreOriginal}</span>
                              <span className="badge-neutral shrink-0">{t(`ctrDoc${archivo.tipoDocumento}`)}</span>
                            </span>
                            <span className="block truncate text-[12px] text-[var(--color-text-muted)]">
                              {formatearTamano(archivo.tamano)} · {t('ctrUploadedBy', { name: archivo.subidoPor?.nombre || '—', date: new Date(archivo.creadoEn).toLocaleDateString(locale) })}
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center">
                            <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={t('ctrView')} aria-label={t('ctrView')} onClick={() => ver(archivo)} disabled={abriendo === archivo.id}>
                              {abriendo === archivo.id ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                            </button>
                            <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={t('ctrDownload')} aria-label={t('ctrDownload')} onClick={() => descargar(archivo)}>
                              <Download size={15} />
                            </button>
                            {puedeEditar && (
                              <button type="button" className="dash-icono hover:!text-[var(--color-error)] max-md:!h-10 max-md:!w-10" title={t('delete')} aria-label={t('delete')} onClick={() => borrarArchivo(archivo)}>
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {puedeEditar && (
                <div className={`space-y-3 p-4 ${contrato.archivos.length > 0 ? 'border-t border-[var(--color-border)]' : ''}`}>
                  {/* Primero el tipo: se aplica al PDF que se elija a continuación */}
                  <div className="flex items-center gap-3">
                    <label htmlFor="ctr-tipo-doc" className="shrink-0 text-[12.5px] font-medium text-[var(--color-text-muted)]">{t('ctrDocType')}</label>
                    <SelectorSimple
                      id="ctr-tipo-doc"
                      className="flex-1"
                      valor={tipoDocumento}
                      onCambio={setTipoDocumento}
                      opciones={TIPOS_DOCUMENTO.map((tipo) => ({ valor: tipo, etiqueta: t(`ctrDoc${tipo}`) }))}
                    />
                  </div>
                  <label
                    className="ctr-soltar"
                    data-arrastrando={arrastrando || undefined}
                    data-ocupado={subiendo || undefined}
                    onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                    onDragLeave={() => setArrastrando(false)}
                    onDrop={(e) => { e.preventDefault(); setArrastrando(false); subir(e.dataTransfer.files?.[0]); }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-10)] text-[var(--color-primary)]" aria-hidden="true">
                      {subiendo ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--color-text)]">
                        {subiendo ? t('ctrUploading') : contrato.archivos.length > 0 ? t('ctrUploadMore') : tactil ? t('ctrDropShortTouch') : t('ctrDropShort')}
                      </span>
                      <span className="block text-[12px] text-[var(--color-text-muted)]">{t('ctrDropHint', { mb: pdfMaxMegas() })}</span>
                    </span>
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={subiendo} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; subir(f); }} />
                  </label>
                </div>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DetalleContrato;
