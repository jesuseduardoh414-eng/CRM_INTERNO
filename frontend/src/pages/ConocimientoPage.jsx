// Base de conocimiento (/conocimiento): buscador, categorías y artículos.
// Todo el equipo lee; los administradores crean y editan (y ven borradores),
// a mano o subiendo varios documentos a la vez. Cada quien ve solo lo que su
// acceso le permite (el candado marca lo restringido).
import { useState } from 'react';
import useSWR from 'swr';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Lock, Paperclip, Pin, Plus, Search, Upload, X } from 'lucide-react';
import { conocimientoService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { useTextoConocimiento } from '../hooks/useTextoConocimiento';
import { useDebounce } from '../utils/useDebounce';
import { ListSkeleton } from '../components/Skeleton';
import { Button } from '../components/ui/button';
import { ErrorCarga, Vacio } from '../components/finanzas/piezas';
import SubirDocumentos from '../components/conocimiento/SubirDocumentos';

const ConocimientoPage = () => {
  const { t, locale } = usePreferences();
  const tc = useTextoConocimiento();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const q = useDebounce(busqueda, 300);
  // La categoría va en la URL: el artículo enlaza a su categoría.
  const categoria = params.get('categoria') || '';
  const elegirCategoria = (c) => {
    if (c) params.set('categoria', c); else params.delete('categoria');
    setParams(params, { replace: true });
  };

  const { data, error, isLoading, mutate } = useSWR(['conocimiento', q, categoria], () => conocimientoService.listar({ q, categoria }), { keepPreviousData: true });
  const articulos = data?.articulos || [];
  const categorias = data?.categorias || [];
  const { usuario } = useAuth();
  const puedeEditar = puede(usuario, 'conocimiento.crear');
  const hayFiltros = Boolean(busqueda) || Boolean(categoria);
  const limpiar = () => { setBusqueda(''); elegirCategoria(''); };
  const fechaCorta = (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const [subirDocumentos, setSubirDocumentos] = useState(false);

  return (
    <div className="mx-auto max-w-7xl">
      <SubirDocumentos abierto={subirDocumentos} categorias={categorias} onCerrar={() => setSubirDocumentos(false)} onSubidos={() => mutate()} />
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{tc('conTitulo')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{tc('conSubtitulo')}</p>
        </div>
        {puedeEditar && (
          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            <Button variant="outline" className="w-full md:w-auto" onClick={() => setSubirDocumentos(true)}><Upload size={16} /> {tc('docSubir')}</Button>
            <Button className="w-full md:w-auto" onClick={() => navigate('/conocimiento/nuevo')}><Plus size={16} /> {tc('conNuevo')}</Button>
          </div>
        )}
      </div>

      <div className="relative mb-4 max-w-xl">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={tc('conBuscarPh')}
          aria-label={t('search')}
          className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[14px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-20)]"
        />
      </div>

      {categorias.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label={tc('conCategoria')}>
          {[{ nombre: '', total: categorias.reduce((s, c) => s + c.total, 0) }, ...categorias].map((c) => {
            const activa = categoria === c.nombre;
            return (
              <button
                key={c.nombre || '__todas'}
                type="button"
                role="tab"
                aria-selected={activa}
                onClick={() => elegirCategoria(c.nombre)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${activa ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)] text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              >
                {c.nombre || tc('conTodas')}
                <span className="tabular-nums text-[var(--color-text-muted)]">{c.total}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading && !data && <ListSkeleton rows={4} header={false} />}
      {error && !data && <ErrorCarga texto={tc('conErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
      {data && articulos.length === 0 && (
        <div className="cli-panel">
          <Vacio
            icono={<BookOpen size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />}
            titulo={hayFiltros ? tc('conSinResultados') : tc('conVacio')}
            texto={hayFiltros ? undefined : (puedeEditar ? tc('conVacioHint') : tc('conVacioHintMiembro'))}
            accion={hayFiltros
              ? <Button variant="outline" onClick={limpiar}><X size={15} /> {t('clearFilters')}</Button>
              : (puedeEditar && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => setSubirDocumentos(true)}><Upload size={16} /> {tc('docSubir')}</Button>
                  <Button onClick={() => navigate('/conocimiento/nuevo')}><Plus size={16} /> {tc('conNuevo')}</Button>
                </div>
              ))}
          />
        </div>
      )}

      {articulos.length > 0 && (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {articulos.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/conocimiento/${a.id}`}
                  className="flex h-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{a.categoria}</span>
                    {a.fijado && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-gold-text,var(--color-primary))]"><Pin size={12} aria-hidden="true" />{tc('conDestacado')}</span>}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {a.restringido && <Lock size={13} className="text-[var(--color-text-muted)]" role="img" aria-label={tc('accRestringido')} />}
                      {!a.publicado && <span className="badge-neutral">{tc('conBorrador')}</span>}
                    </span>
                  </div>
                  <h2 className="mt-1.5 text-[15.5px] font-semibold leading-snug text-[var(--color-text)]">{a.titulo}</h2>
                  {a.resumen && <p className="mt-1 line-clamp-2 text-[13px] text-[var(--color-text-dim)]">{a.resumen}</p>}
                  <div className="mt-auto flex items-center gap-3 pt-3 text-[12px] text-[var(--color-text-muted)]">
                    <span>{tc('conActualizadoEl', { fecha: fechaCorta(a.actualizadoEn) })}</span>
                    {a.totalArchivos > 0 && (
                      <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden="true" />{a.totalArchivos === 1 ? tc('conArchivosUno') : tc('conArchivosN', { n: a.totalArchivos })}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-[var(--color-text-muted)]">{articulos.length === 1 ? tc('conCuentaUno') : tc('conCuenta', { n: articulos.length })}</p>
        </>
      )}
    </div>
  );
};

export default ConocimientoPage;
