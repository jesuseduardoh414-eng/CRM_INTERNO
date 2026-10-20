// Ficha de una empresa del directorio (/clientes/:id): cabecera con acciones,
// proyectos y contratos a la izquierda; datos generales y contactos a la
// derecha. Se monta con `key` por empresa, así que siempre arranca limpia.
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Ban, FileText, Globe, Mail, MapPin, Pencil, Phone, Plus, RefreshCcw,
  RotateCcw, Star, Trash2, UserRound,
} from 'lucide-react';
import { empresasService } from '../../services/api';
import { usePreferences } from '../../context/PreferencesContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { puede } from '../../utils/permisos';
import { useConfirmacion } from '../ConfirmDialog';
import { PanelSkeleton } from '../Skeleton';
import ActionMenu from '../ActionMenu';
import { Button } from '../ui/button';
import FormularioEmpresa from './FormularioEmpresa';
import FormularioContacto from './FormularioContacto';
import AccesoPortal from './AccesoPortal';
import { useTextoClientes } from '../../hooks/useTextoClientes';
import { useTextoProyectos } from '../../hooks/useTextoProyectos';
import { areasDeTexto } from '../../utils/areas';
import { getEstadoProyecto } from '../../utils/estadosProyecto';
import { BADGE_ESTADO, formatearFechaCorta, formatearMonto } from '../../utils/contratos';
import { empresaEsDeTipo, inicialesEmpresa, urlSitio } from '../../utils/empresas';

// Las fechas llegan como ISO completo; formatearFechaCorta espera 'AAAA-MM-DD'.
const fechaCorta = (valor, locale) => (valor ? formatearFechaCorta(String(valor).slice(0, 10), locale) : null);

/** Panel con cabecera: etiqueta en mayúsculas, conteo y acción opcional. */
const Panel = ({ titulo, conteo, accion, children }) => (
  <section className="cli-panel">
    <header className="cli-panel-cabecera">
      <h2 className="cli-etiqueta">
        {titulo}
        {conteo !== undefined && <span className="cli-conteo">{conteo}</span>}
      </h2>
      {accion}
    </header>
    {children}
  </section>
);

const Vacio = ({ texto, ayuda }) => (
  <div className="px-4 py-8 text-center">
    <p className="text-[13px] text-[var(--color-text-dim)]">{texto}</p>
    {ayuda && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{ayuda}</p>}
  </div>
);

const DetalleEmpresa = ({ empresaId, onVolver, onCambio }) => {
  const { t, locale } = usePreferences();
  const tc = useTextoClientes();
  const tp = useTextoProyectos();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { nombreArea, colorArea, moduloActivo } = useConfiguracion();
  const { usuario } = useAuth();
  // Editar (datos, estado y contactos) y eliminar son permisos aparte.
  const puedeEditar = puede(usuario, 'clientes.editar');
  const puedeEliminar = puede(usuario, 'clientes.eliminar');
  const conContratos = moduloActivo('contratos');
  const [editando, setEditando] = useState(null); // clave del formulario abierto
  const [contactoForm, setContactoForm] = useState(null); // { contacto?, clave }

  const { data, error, isLoading, mutate } = useSWR(['empresa', empresaId], () => empresasService.obtener(empresaId));
  const empresa = data?.empresa;

  const recargar = () => { mutate(); onCambio?.(); };

  const cambiarEstado = async (estado) => {
    try {
      await empresasService.editar(empresa.id, { estado });
      showToast(estado === 'ACTIVO' ? tc('cliActivada') : tc('cliDesactivada'), 'success');
      recargar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const eliminar = async () => {
    const ok = await confirmar({
      titulo: tc('cliEliminarConfirm', { nombre: empresa.nombre }),
      descripcion: tc('cliEliminarTexto'),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await empresasService.eliminar(empresa.id);
      showToast(tc('cliEliminada'), 'success');
      onCambio?.();
      onVolver();
    } catch (err) {
      // 409: tiene contratos. Se ofrece la salida que sí se puede: desactivarla.
      if (err.status === 409 && empresa.estado !== 'INACTIVO') {
        const desactivar = await confirmar({
          titulo: tc('cliEliminarBloqueado', { nombre: empresa.nombre }),
          descripcion: tc('cliEliminarBloqueadoTexto', { mensaje: err.message }),
          textoConfirmar: tc('cliDesactivar'),
        });
        if (desactivar) cambiarEstado('INACTIVO');
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  const marcarPrincipal = async (contacto) => {
    try {
      await empresasService.editarContacto(contacto.id, { principal: true });
      showToast(tc('cliContactoGuardado'), 'success');
      recargar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const eliminarContacto = async (contacto) => {
    const ok = await confirmar({
      titulo: tc('cliEliminarContactoConfirm', { nombre: contacto.nombre }),
      descripcion: tc('cliEliminarContactoTexto'),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await empresasService.eliminarContacto(contacto.id);
      showToast(tc('cliContactoEliminado'), 'success');
      recargar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const volver = (
    <button type="button" onClick={onVolver} className="cli-volver -ml-1 min-h-[40px] px-1">
      <ArrowLeft size={15} aria-hidden="true" /> {tc('cliVolver')}
    </button>
  );

  if (isLoading && !data) {
    return <div className="mx-auto max-w-7xl">{volver}<div className="mt-4"><PanelSkeleton rows={5} /></div></div>;
  }
  if (error || !empresa) {
    return (
      <div className="mx-auto max-w-7xl">
        {volver}
        <div className="cli-panel mt-4 flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm text-[var(--color-text-dim)]">{error?.status === 404 ? tc('cliNoEncontrada') : (error?.message || tc('cliNoEncontrada'))}</p>
          {error?.status !== 404 && <Button variant="outline" onClick={() => mutate()}><RefreshCcw size={15} /> {t('retry')}</Button>}
        </div>
      </div>
    );
  }

  const inactiva = empresa.estado === 'INACTIVO';
  const esCliente = empresaEsDeTipo(empresa, 'CLIENTE');
  const datos = [
    { icono: Mail, etiqueta: tc('cliEmail'), valor: empresa.email, href: empresa.email && `mailto:${empresa.email}` },
    { icono: Phone, etiqueta: tc('cliTelefono'), valor: empresa.telefono, href: empresa.telefono && `tel:${empresa.telefono.replace(/\s+/g, '')}` },
    { icono: Globe, etiqueta: tc('cliSitioWeb'), valor: empresa.sitioWeb, href: urlSitio(empresa.sitioWeb), externo: true },
    { icono: MapPin, etiqueta: tc('cliDireccion'), valor: [empresa.direccion, empresa.ciudad].filter(Boolean).join(', ') },
  ].filter((d) => d.valor);

  return (
    <div className="mx-auto max-w-7xl">
      {dialogo}
      {volver}

      {/* Cabecera de la ficha */}
      <div className="mb-6 mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="cli-monograma" aria-hidden="true">{inicialesEmpresa(empresa.nombre)}</span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-[var(--color-text)] md:text-[26px]">{empresa.nombre}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-text-muted)]">
              <span className="cli-tipo" data-tipo={empresa.tipo}>{tc(`cliTipo${empresa.tipo}`)}</span>
              {empresa.nombreComercial && <span>{empresa.nombreComercial}</span>}
              {empresa.rfc && <span className="font-mono text-[12px]">{empresa.rfc}</span>}
              {empresa.sector && <span>{empresa.sector}</span>}
              {inactiva && <span className="badge-neutral">{tc('cliEstadoINACTIVO')}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {puedeEditar && (
            <Button variant="outline" onClick={() => setEditando(Date.now())}>
              <Pencil size={15} /> {t('edit')}
            </Button>
          )}
          {(puedeEditar || puedeEliminar) && (
            <ActionMenu
              className="h-10 w-10 border border-[var(--color-border)]"
              items={[
                puedeEditar && (inactiva
                  ? { label: tc('cliActivar'), icon: <RotateCcw size={15} />, onSelect: () => cambiarEstado('ACTIVO') }
                  : { label: tc('cliDesactivar'), icon: <Ban size={15} />, onSelect: () => cambiarEstado('INACTIVO') }),
                puedeEditar && puedeEliminar && { separator: true },
                puedeEliminar && { label: tc('cliEliminar'), icon: <Trash2 size={15} />, onSelect: eliminar, danger: true },
              ].filter(Boolean)}
            />
          )}
        </div>
      </div>

      {inactiva && <div className="alert-info mb-6 text-[13px]">{tc('cliInactivaAviso')}</div>}

      {/* Dos columnas solo desde xl: en lg la barra lateral deja ~700-950px y
          la columna principal quedaba en ~360px. En tableta el lateral pasa
          abajo y reparte sus paneles en dos columnas. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Proyectos: solo para quien es cliente */}
          <Panel
            titulo={tc('cliProyectos')}
            conteo={esCliente ? empresa.proyectos.length : undefined}
            // Lleva a la lista de Proyectos ya filtrada por este cliente
            accion={esCliente && empresa.proyectos.length > 0 && (
              <Link to={`/proyectos?clienteId=${empresa.id}`} className="cli-enlace">
                {tp('lista_verTodos')} <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            )}
          >
            {!esCliente ? <Vacio texto={tc('cliSoloClientesProyectos')} />
              : empresa.proyectos.length === 0 ? <Vacio texto={tc('cliSinProyectos')} ayuda={tc('cliSinProyectosAyuda')} />
                : (
                  <ul>
                    {empresa.proyectos.map((p) => {
                      const estado = getEstadoProyecto(p.estado);
                      const areas = areasDeTexto(p.area);
                      return (
                        <li key={p.id}>
                          <Link to={`/proyectos/${p.id}`} className="cli-fila">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{p.nombre}</span>
                              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-text-muted)]">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: estado.dot }} aria-hidden="true" />
                                  {t(estado.labelKey)}
                                </span>
                                {areas.map((a) => (
                                  <span key={a} className="inline-flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-sm" style={{ background: colorArea(a) }} aria-hidden="true" />
                                    {nombreArea(a)}
                                  </span>
                                ))}
                              </span>
                            </span>
                            <span className="hidden w-44 shrink-0 sm:block">
                              <span className="flex items-center gap-2">
                                <span className="dash-barra"><span style={{ width: `${p.avance}%`, background: 'var(--color-primary)' }} /></span>
                                <span className="w-9 text-right text-[12px] font-medium tabular-nums text-[var(--color-text)]">{p.avance}%</span>
                              </span>
                              <span className="mt-0.5 block text-[11.5px] text-[var(--color-text-muted)]">
                                {p.tareas ? tc('cliTareas', { hechas: p.tareasHechas, total: p.tareas }) : tc('cliSinTareas')}
                              </span>
                            </span>
                            <ArrowUpRight size={15} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </Panel>

          {conContratos && (
            <Panel
              titulo={tc('cliContratos')}
              conteo={empresa.contratos.length}
              accion={empresa.contratos.length > 0 && (
                <Link to={`/contratos?empresaId=${empresa.id}`} className="cli-enlace">{tc('cliVerTodos')} <ArrowUpRight size={13} /></Link>
              )}
            >
              {empresa.contratos.length === 0 ? <Vacio texto={tc('cliSinContratos')} /> : (
                <ul>
                  {empresa.contratos.map((c) => (
                    <li key={c.id}>
                      <Link to={`/contratos?id=${c.id}`} className="cli-fila">
                        <FileText size={16} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{c.titulo}</span>
                          <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">
                            <span className="font-mono">{c.folio}</span>
                            {' · '}{t(`ctrType${c.tipo}`)}
                            {(c.fechaInicio || c.fechaFin) && ` · ${fechaCorta(c.fechaInicio, locale) || '—'} → ${fechaCorta(c.fechaFin, locale) || '—'}`}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-right text-[13px] font-medium tabular-nums text-[var(--color-text)] sm:block">
                          {formatearMonto(c.monto, c.moneda, locale) || <span className="font-normal text-[var(--color-text-muted)]">{t('ctrNoAmount')}</span>}
                        </span>
                        <span className={`${BADGE_ESTADO[c.estado] || 'badge-neutral'} shrink-0`}>{t(`ctrStatus${c.estado}`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-5 md:grid-cols-2 xl:flex xl:flex-col xl:items-stretch">
          <Panel titulo={tc('cliDatosGenerales')}>
            <div className="px-4 py-3">
              {datos.length === 0 && !empresa.notas && <p className="py-2 text-[13px] text-[var(--color-text-muted)]">{tc('cliSinDatos')}</p>}
              {datos.length > 0 && (
                <dl className="flex flex-col gap-3">
                  {datos.map(({ icono: Icono, etiqueta, valor, href, externo }) => (
                    <div key={etiqueta} className="flex items-start gap-2.5">
                      <Icono size={15} className="mt-[3px] shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <dt className="sr-only">{etiqueta}</dt>
                        <dd className="break-words text-[13px] text-[var(--color-text)]">
                          {href
                            ? <a href={href} className="hover:underline" {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{valor}</a>
                            : valor}
                        </dd>
                      </div>
                    </div>
                  ))}
                </dl>
              )}
              {empresa.notas && (
                <div className={datos.length ? 'mt-4 border-t border-[var(--color-border)] pt-3' : ''}>
                  <div className="cli-etiqueta mb-1">{tc('cliNotas')}</div>
                  <p className="whitespace-pre-line text-[13px] text-[var(--color-text-dim)]">{empresa.notas}</p>
                </div>
              )}
            </div>
            <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[11.5px] text-[var(--color-text-muted)]">
              {empresa.creadoPor
                ? tc('cliCreadaPor', { nombre: empresa.creadoPor.nombre, fecha: new Date(empresa.creadoEn).toLocaleDateString(locale) })
                : tc('cliCreadaEl', { fecha: new Date(empresa.creadoEn).toLocaleDateString(locale) })}
            </p>
          </Panel>

          <Panel
            titulo={tc('cliContactos')}
            conteo={empresa.contactos.length}
            accion={puedeEditar && (
              <button type="button" className="cli-enlace -my-2 min-h-[40px]" onClick={() => setContactoForm({ contacto: null, clave: Date.now() })}>
                <Plus size={14} /> {tc('cliNuevoContacto')}
              </button>
            )}
          >
            {empresa.contactos.length === 0 ? <Vacio texto={tc('cliSinContactos')} /> : (
              <ul>
                {empresa.contactos.map((c) => (
                  <li key={c.id} className="cli-contacto">
                    <span className="cli-avatar" aria-hidden="true"><UserRound size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{c.nombre}</span>
                        {c.principal && <span className="cli-principal"><Star size={10} aria-hidden="true" /> {tc('cliPrincipal')}</span>}
                      </div>
                      {c.puesto && <div className="truncate text-[12px] text-[var(--color-text-muted)]">{c.puesto}</div>}
                      {(c.email || c.telefono) && (
                        <div className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-[var(--color-text-dim)]">
                          {c.email && <a href={`mailto:${c.email}`} className="truncate hover:underline">{c.email}</a>}
                          {c.telefono && <a href={`tel:${c.telefono.replace(/\s+/g, '')}`} className="hover:underline">{c.telefono}</a>}
                        </div>
                      )}
                      {c.notas && <p className="mt-1 whitespace-pre-line text-[12px] text-[var(--color-text-muted)]">{c.notas}</p>}
                    </div>
                    {puedeEditar && (
                      <ActionMenu
                        size={15}
                        className="-mr-1 shrink-0"
                        items={[
                          { label: t('edit'), icon: <Pencil size={15} />, onSelect: () => setContactoForm({ contacto: c, clave: Date.now() }) },
                          !c.principal && { label: tc('cliMarcarPrincipal'), icon: <Star size={15} />, onSelect: () => marcarPrincipal(c) },
                          { separator: true },
                          { label: t('delete'), icon: <Trash2 size={15} />, onSelect: () => eliminarContacto(c), danger: true },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Quién de este cliente entra a su portal */}
          {esCliente && moduloActivo('portalClientes') && <div className="min-w-0 md:col-span-2"><AccesoPortal empresa={empresa} /></div>}
        </aside>
      </div>

      {editando && (
        <FormularioEmpresa
          key={editando}
          open
          empresa={empresa}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(); }}
        />
      )}
      {contactoForm && (
        <FormularioContacto
          key={contactoForm.clave}
          open
          empresaId={empresa.id}
          contacto={contactoForm.contacto}
          sugerirPrincipal={empresa.contactos.length === 0}
          onClose={() => setContactoForm(null)}
          onGuardado={() => { setContactoForm(null); recargar(); }}
        />
      )}
    </div>
  );
};

export default DetalleEmpresa;
