// Directorio de clientes y proveedores (solo administradores). /clientes es la
// lista con cifras y filtros; /clientes/:id abre la ficha de una empresa.
// Los filtros viven en la URL (?q=&tipo=&estado=&pagina=) para que al volver
// de una ficha (o con Atrás) la lista quede como estaba.
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, Plus, RefreshCcw, Search, X } from 'lucide-react';
import { empresasService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { ListSkeleton } from '../components/Skeleton';
import CampoFiltro from '../components/CampoFiltro';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import FormularioEmpresa from '../components/clientes/FormularioEmpresa';
import DetalleEmpresa from '../components/clientes/DetalleEmpresa';
import { useTextoClientes } from '../hooks/useTextoClientes';
import { useDebounce } from '../utils/useDebounce';

const POR_PAGINA = 25;
const TIPOS = ['TODOS', 'CLIENTE', 'PROVEEDOR'];
const ESTADOS = ['TODOS', 'ACTIVO', 'INACTIVO'];
const SEGMENTOS_TIPO = [
  { valor: 'TODOS', clave: 'cliTodos' },
  { valor: 'CLIENTE', clave: 'cliClientes' },
  { valor: 'PROVEEDOR', clave: 'cliProveedores' },
];

// Primera columna fija al desplazar la tabla en horizontal. Lleva fondo propio
// (opaco) y repite el resaltado de la fila al pasar el puntero.
const COL_FIJA = 'sticky left-0 z-[1]';
const CELDA_FIJA = 'bg-[var(--color-surface)] group-hover:bg-[color-mix(in_srgb,var(--color-text)_3%,var(--color-surface))]';

const ClientesPage = () => {
  const { t } = usePreferences();
  const tc = useTextoClientes();
  const { usuario } = useAuth();
  const { moduloActivo } = useConfiguracion();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const conContratos = moduloActivo('contratos');

  // Filtros leídos de la URL; valores desconocidos caen al predeterminado.
  const [params, setParams] = useSearchParams();
  const qUrl = params.get('q') || '';
  const tipo = TIPOS.includes(params.get('tipo')) ? params.get('tipo') : 'TODOS';
  const estado = ESTADOS.includes(params.get('estado')) ? params.get('estado') : 'TODOS';
  const pagina = Math.max(1, Number.parseInt(params.get('pagina'), 10) || 1);

  // El buscador escribe en un estado local y pasa a la URL con retardo (y con
  // replace, para no llenar el historial con cada letra).
  const [busqueda, setBusqueda] = useState(qUrl);
  const q = useDebounce(busqueda, 300);
  // Si la URL cambia desde fuera (Atrás, enlace del menú) el cuadro la sigue.
  const [qUrlPrevia, setQUrlPrevia] = useState(qUrl);
  if (qUrl !== qUrlPrevia) {
    setQUrlPrevia(qUrl);
    if (qUrl !== q) setBusqueda(qUrl);
  }
  // Solo escribe cuando el texto retrasado cambia de verdad: una navegación
  // "replace" sin cambios borraría el state de la ruta (p. ej. en la ficha).
  const qEscritaRef = useRef(q);
  useEffect(() => {
    if (qEscritaRef.current === q) return;
    qEscritaRef.current = q;
    // setParams navega aunque devuelva los mismos parámetros: se compara
    // antes (si no, en la ficha se perdería el state `desdeLista`).
    if (q === qUrl) return;
    setParams((prev) => {
      const sig = new URLSearchParams(prev);
      if (q) sig.set('q', q); else sig.delete('q');
      sig.delete('pagina'); // una búsqueda nueva vuelve a la primera página
      return sig;
    }, { replace: true });
  }, [q, qUrl, setParams]);

  // Cambia filtros en la URL; los predeterminados no se escriben.
  const actualizarFiltros = (cambios) => {
    setParams((prev) => {
      const sig = new URLSearchParams(prev);
      Object.entries(cambios).forEach(([clave, valor]) => {
        if (!valor || valor === 'TODOS' || (clave === 'pagina' && valor === 1)) sig.delete(clave);
        else sig.set(clave, String(valor));
      });
      return sig;
    }, { replace: true });
  };
  const setPagina = (fn) => actualizarFiltros({ pagina: typeof fn === 'function' ? fn(pagina) : fn });

  const [formulario, setFormulario] = useState(null); // clave de apertura
  // Sección Clientes: ver / crear / editar / eliminar (utils/permisos.js).
  const esAdmin = puede(usuario, 'clientes.ver');
  const puedeCrear = puede(usuario, 'clientes.crear');

  const { data, error, isLoading, mutate } = useSWR(
    esAdmin ? ['empresas', qUrl, tipo, estado, pagina] : null,
    () => empresasService.listar({
      q: qUrl,
      tipo: tipo === 'TODOS' ? '' : tipo,
      estado: estado === 'TODOS' ? '' : estado,
      page: pagina,
      limit: POR_PAGINA,
    }),
    { keepPreviousData: true },
  );
  const { data: resumen, mutate: recargarResumen } = useSWR(esAdmin ? 'empresas-resumen' : null, () => empresasService.resumen());

  if (!esAdmin) return <Navigate to="/dashboard" replace />;

  const recargarTodo = () => { mutate(); recargarResumen(); };

  if (id) {
    return (
      <DetalleEmpresa
        key={id}
        empresaId={Number(id)}
        // Si se llegó desde la lista se regresa con Atrás (conserva sus filtros).
        onVolver={() => (location.state?.desdeLista ? navigate(-1) : navigate('/clientes'))}
        onCambio={recargarTodo}
      />
    );
  }

  const empresas = data?.empresas || [];
  const meta = data?.meta;
  const hayFiltros = Boolean(busqueda) || tipo !== 'TODOS' || estado !== 'TODOS';
  // Cualquier filtro nuevo vuelve a la primera página.
  const filtrar = (cambios) => actualizarFiltros({ ...cambios, pagina: 1 });
  const limpiar = () => { setBusqueda(''); filtrar({ q: '', tipo: 'TODOS', estado: 'TODOS' }); };
  const abrir = (empresa) => navigate(`/clientes/${empresa.id}`, { state: { desdeLista: true } });

  // Cifras en texto plano; las tres primeras filtran la lista.
  const cifras = [
    { clave: 'cliResClientes', valor: resumen?.clientes, activo: tipo === 'CLIENTE' && estado === 'ACTIVO', onClick: () => filtrar({ tipo: 'CLIENTE', estado: 'ACTIVO' }) },
    { clave: 'cliResProveedores', valor: resumen?.proveedores, activo: tipo === 'PROVEEDOR' && estado === 'ACTIVO', onClick: () => filtrar({ tipo: 'PROVEEDOR', estado: 'ACTIVO' }) },
    { clave: 'cliResInactivas', valor: resumen?.inactivas, activo: tipo === 'TODOS' && estado === 'INACTIVO', onClick: () => filtrar({ tipo: 'TODOS', estado: 'INACTIVO' }) },
    { clave: 'cliResProyectos', valor: resumen?.proyectosConCliente },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tc('cliTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tc('cliSubtitulo')}</p>
        </div>
        {puedeCrear && (
          <Button className="w-full md:w-auto" onClick={() => setFormulario(Date.now())}>
            <Plus size={16} /> {tc('cliNueva')}
          </Button>
        )}
      </div>

      <dl className="cli-cifras mb-6">
        {cifras.map(({ clave, valor, activo, onClick }) => {
          const contenido = (
            <>
              <dd>{valor ?? '—'}</dd>
              <dt>{tc(clave)}</dt>
            </>
          );
          return (
            <div key={clave}>
              {onClick
                ? <button type="button" onClick={onClick} aria-pressed={activo} data-activo={activo || undefined}>{contenido}</button>
                : <span>{contenido}</span>}
            </div>
          );
        })}
      </dl>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CampoFiltro label={t('search')} htmlFor="clientes-buscar" className="min-w-[240px] max-w-md flex-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="clientes-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={tc('cliBuscarPh')}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
            />
          </div>
        </CampoFiltro>
        <CampoFiltro label={tc('cliFiltroTipo')}>
          <div className="dash-segmento h-10 items-center" role="tablist" aria-label={tc('cliFiltroTipo')}>
            {SEGMENTOS_TIPO.map((s) => (
              <button key={s.valor} type="button" role="tab" aria-selected={tipo === s.valor} onClick={() => filtrar({ tipo: s.valor })}>
                {tc(s.clave)}
              </button>
            ))}
          </div>
        </CampoFiltro>
        <CampoFiltro label={tc('cliFiltroEstado')}>
          <Select value={estado} onValueChange={(v) => filtrar({ estado: v })}>
            <SelectTrigger className="h-10 w-[150px] text-[13.5px] font-normal"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[1500]">
              <SelectItem value="TODOS" className="text-sm font-normal">{tc('cliTodosEstados')}</SelectItem>
              <SelectItem value="ACTIVO" className="text-sm font-normal">{tc('cliEstadoACTIVO')}</SelectItem>
              <SelectItem value="INACTIVO" className="text-sm font-normal">{tc('cliEstadoINACTIVO')}</SelectItem>
            </SelectContent>
          </Select>
        </CampoFiltro>
        {hayFiltros && (
          <Button variant="ghost" className="h-10 text-[var(--color-text-dim)]" onClick={limpiar}>
            <X size={15} /> {t('clearFilters')}
          </Button>
        )}
      </div>

      {/* Lista */}
      <div className="cli-panel overflow-hidden">
        {isLoading && !data && <div className="p-4"><ListSkeleton rows={6} header={false} /></div>}
        {error && !data && (
          <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-[var(--color-text-muted)]">
            <span>{tc('cliErrorCarga')}</span>
            <Button variant="outline" onClick={() => mutate()}><RefreshCcw size={15} /> {t('retry')}</Button>
          </div>
        )}
        {data && empresas.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Building2 size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />
            <p className="text-[14px] font-medium text-[var(--color-text)]">{hayFiltros ? tc('cliSinResultados') : tc('cliVacio')}</p>
            {!hayFiltros && <p className="max-w-sm text-[13px] text-[var(--color-text-muted)]">{tc('cliVacioAyuda')}</p>}
            <div className="mt-3">
              {hayFiltros
                ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
                : puedeCrear && <Button onClick={() => setFormulario(Date.now())}><Plus size={16} /> {tc('cliNueva')}</Button>}
            </div>
          </div>
        )}

        {empresas.length > 0 && (
          <>
            {/* En tableta (y con la barra lateral en horizontal) el ancho útil
                ronda 700-950px: RFC y ciudad se ocultan hasta xl y, si aun así
                no cabe, la tabla se desplaza dentro de su caja con la empresa fija. */}
            <div className="hidden overflow-x-auto overscroll-x-contain md:block">
            <table className="cli-tabla">
              <thead>
                <tr>
                  <th className={COL_FIJA}>{tc('cliColEmpresa')}</th>
                  <th>{tc('cliColTipo')}</th>
                  <th className="hidden xl:table-cell">{tc('cliColRfc')}</th>
                  <th>{tc('cliColContacto')}</th>
                  <th className="text-right">{tc('cliColProyectos')}</th>
                  {conContratos && <th className="text-right">{tc('cliColContratos')}</th>}
                  <th className="hidden xl:table-cell">{tc('cliColCiudad')}</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} onClick={() => abrir(e)} data-inactiva={e.estado === 'INACTIVO' || undefined} className="group">
                    <td className={`${COL_FIJA} ${CELDA_FIJA} max-w-[280px]`}>
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-[13.5px] font-medium text-[var(--color-text)] hover:underline"
                        onClick={(ev) => { ev.stopPropagation(); abrir(e); }}
                      >
                        {e.nombre}
                      </button>
                      {(e.nombreComercial || e.estado === 'INACTIVO' || e.ciudad) && (
                        <div className="truncate text-[12px] text-[var(--color-text-muted)]">
                          {[e.nombreComercial, e.estado === 'INACTIVO' && tc('cliEstadoINACTIVO')].filter(Boolean).join(' · ')}
                          {/* Sin columna de ciudad (hasta xl) la ciudad va aquí */}
                          {e.ciudad && <span className="xl:hidden">{(e.nombreComercial || e.estado === 'INACTIVO') && ' · '}{e.ciudad}</span>}
                        </div>
                      )}
                    </td>
                    <td><span className="cli-tipo" data-tipo={e.tipo}>{tc(`cliTipo${e.tipo}`)}</span></td>
                    <td className="hidden font-mono text-[12px] text-[var(--color-text-dim)] xl:table-cell">{e.rfc || <span className="text-[var(--color-text-muted)]">—</span>}</td>
                    <td className="max-w-[220px]">
                      {e.contactoPrincipal ? (
                        <>
                          <div className="truncate text-[13px] text-[var(--color-text)]">{e.contactoPrincipal.nombre}</div>
                          {(e.contactoPrincipal.email || e.contactoPrincipal.telefono) && (
                            <div className="truncate text-[12px] text-[var(--color-text-muted)]">{e.contactoPrincipal.email || e.contactoPrincipal.telefono}</div>
                          )}
                        </>
                      ) : <span className="text-[12.5px] text-[var(--color-text-muted)]">{tc('cliSinContacto')}</span>}
                    </td>
                    <td className="text-right tabular-nums">{e.totalProyectos || <span className="text-[var(--color-text-muted)]">0</span>}</td>
                    {conContratos && (
                      <td className="text-right tabular-nums">
                        {e.contratosVigentes || <span className="text-[var(--color-text-muted)]">0</span>}
                        {e.totalContratos > e.contratosVigentes && <span className="text-[12px] text-[var(--color-text-muted)]"> / {e.totalContratos}</span>}
                      </td>
                    )}
                    <td className="hidden text-[var(--color-text-dim)] xl:table-cell">{e.ciudad || <span className="text-[var(--color-text-muted)]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <ul className="divide-y divide-[var(--color-border)] md:hidden">
              {empresas.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => abrir(e)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
                    <span className="min-w-0">
                      <span className={`block truncate text-[14px] font-medium ${e.estado === 'INACTIVO' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>{e.nombre}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">
                        {[e.contactoPrincipal?.nombre, e.ciudad].filter(Boolean).join(' · ') || tc('cliSinContacto')}
                      </span>
                    </span>
                    <span className="cli-tipo shrink-0" data-tipo={e.tipo}>{tc(`cliTipo${e.tipo}`)}</span>
                  </button>
                </li>
              ))}
            </ul>

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                <span className="tabular-nums">
                  {tc('cliRango', { desde: (meta.page - 1) * meta.limit + 1, hasta: Math.min(meta.page * meta.limit, meta.total), total: meta.total })}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" onClick={() => setPagina((n) => Math.max(1, n - 1))} disabled={!meta.hasPrev} aria-label={t('previous')} title={t('previous')}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="min-w-[52px] text-center font-medium tabular-nums text-[var(--color-text)]">{meta.page} / {meta.totalPages}</span>
                  <button type="button" className="dash-icono max-md:!h-10 max-md:!w-10" onClick={() => setPagina((n) => n + 1)} disabled={!meta.hasNext} aria-label={t('next')} title={t('next')}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
            {meta && meta.totalPages <= 1 && (
              <div className="border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                {meta.total === 1 ? tc('cliConteoUna') : tc('cliConteo', { n: meta.total })}
              </div>
            )}
          </>
        )}
      </div>

      {formulario && (
        <FormularioEmpresa
          key={formulario}
          open
          tipoInicial={tipo === 'PROVEEDOR' ? 'PROVEEDOR' : 'CLIENTE'}
          onClose={() => setFormulario(null)}
          onGuardado={(empresa) => { setFormulario(null); recargarTodo(); navigate(`/clientes/${empresa.id}`, { state: { desdeLista: true } }); }}
        />
      )}
    </div>
  );
};

export default ClientesPage;
