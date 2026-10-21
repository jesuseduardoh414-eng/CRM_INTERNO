// Artículo de la base de conocimiento (/conocimiento/:id): texto con formato y
// archivos. Los administradores lo editan o eliminan, y quien gestiona accesos
// elige quién lo ve (el artículo entero y cada archivo).
import { useState } from 'react';
import useSWR, { mutate as mutarGlobal } from 'swr';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Lock, Pencil, Pin, Trash2 } from 'lucide-react';
import { conocimientoService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { useToast } from '../context/ToastContext';
import { useConfirmacion } from '../components/ConfirmDialog';
import { useTextoConocimiento } from '../hooks/useTextoConocimiento';
import { ListSkeleton } from '../components/Skeleton';
import { Button } from '../components/ui/button';
import { ErrorCarga, Panel, Vacio } from '../components/finanzas/piezas';
import Markdown from '../components/conocimiento/Markdown';
import ArchivosArticulo from '../components/conocimiento/ArchivosArticulo';
import ModalAcceso from '../components/conocimiento/ModalAcceso';
import { ResumenAcceso } from '../components/conocimiento/SelectorAcceso';
import { accesoDe } from '../utils/accesoConocimiento';

const ArticuloPage = () => {
  const { id } = useParams();
  const { t, locale } = usePreferences();
  const tc = useTextoConocimiento();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const { data, error, isLoading, mutate } = useSWR(['conocimiento-articulo', id], () => conocimientoService.obtener(id));
  const articulo = data?.articulo;
  const { usuario } = useAuth();
  const puedeEditar = puede(usuario, 'conocimiento.editar');
  const puedeEliminar = puede(usuario, 'conocimiento.eliminar');
  const gestionaAcceso = puede(usuario, 'conocimiento.acceso');
  const [cambiandoAcceso, setCambiandoAcceso] = useState(false);
  const fechaLarga = (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  const eliminar = async () => {
    const ok = await confirmar({ titulo: tc('conEliminarConfirm', { titulo: articulo.titulo }), descripcion: tc('conEliminarTexto'), textoConfirmar: t('delete'), peligro: true });
    if (!ok) return;
    try {
      await conocimientoService.eliminar(articulo.id);
      showToast(tc('conEliminado'), 'success');
      navigate('/conocimiento', { replace: true });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const guardarAcceso = async (valor) => {
    const res = await conocimientoService.cambiarAcceso(articulo.id, valor);
    mutarGlobal((clave) => Array.isArray(clave) && clave[0] === 'conocimiento');
    if (res.sinAcceso) {
      showToast(tc('accSinAcceso'), 'success');
      navigate('/conocimiento', { replace: true });
      return;
    }
    showToast(tc('accGuardado'), 'success');
    mutate();
  };

  const volver = (
    <Link to="/conocimiento" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
      <ArrowLeft size={15} /> {tc('conVolver')}
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        {volver}
        <div className="cli-panel">
          {error.status === 404
            ? <Vacio icono={<BookOpen size={28} className="mb-1 text-[var(--color-text-muted)]" aria-hidden="true" />} titulo={tc('conNoEncontrado')} />
            : <ErrorCarga texto={tc('conErrorCarga')} reintentar={() => mutate()} etiquetaReintentar={t('retry')} />}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {dialogo}
      {volver}
      {isLoading && !articulo && <ListSkeleton rows={5} header={false} />}
      {articulo && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <article className="min-w-0">
            <header className="mb-6 border-b border-[var(--color-border)] pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/conocimiento?categoria=${encodeURIComponent(articulo.categoria)}`} className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text)]">{articulo.categoria}</Link>
                {articulo.fijado && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-gold-text,var(--color-primary))]"><Pin size={12} aria-hidden="true" />{tc('conDestacado')}</span>}
                {!articulo.publicado && <span className="badge-neutral">{tc('conBorrador')}</span>}
                {articulo.restringido && <span className="badge-neutral inline-flex items-center gap-1"><Lock size={11} aria-hidden="true" />{tc('accRestringido')}</span>}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{articulo.titulo}</h1>
              {articulo.resumen && <p className="mt-2 max-w-3xl text-[15px] text-[var(--color-text-dim)]">{articulo.resumen}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12.5px] text-[var(--color-text-muted)]">
                  {articulo.autor?.nombre && <>{tc('conEscritoPor', { nombre: articulo.autor.nombre })} · </>}
                  {articulo.editadoPor?.nombre
                    ? tc('conActualizadoPor', { fecha: fechaLarga(articulo.actualizadoEn), nombre: articulo.editadoPor.nombre })
                    : tc('conActualizadoEl', { fecha: fechaLarga(articulo.actualizadoEn) })}
                </p>
                {(puedeEditar || puedeEliminar) && (
                  <div className="flex gap-2">
                    {puedeEditar && <Button variant="outline" size="sm" onClick={() => navigate(`/conocimiento/${articulo.id}/editar`)}><Pencil size={14} /> {tc('conEditar')}</Button>}
                    {puedeEliminar && <Button variant="ghost" size="sm" className="text-[var(--color-error)]" onClick={eliminar}><Trash2 size={14} /> {t('delete')}</Button>}
                  </div>
                )}
              </div>
            </header>
            {articulo.contenido?.trim()
              ? <Markdown texto={articulo.contenido} className="max-w-3xl" />
              : <p className="text-[13.5px] text-[var(--color-text-muted)]">{tc('conSinContenido')}</p>}
          </article>
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            {gestionaAcceso && (
              <Panel titulo={tc('accQuienVe')} extra={<Button variant="ghost" size="sm" onClick={() => setCambiandoAcceso(true)}>{tc('accCambiar')}</Button>}>
                <div className="px-4 pb-4 pt-1"><ResumenAcceso acceso={accesoDe(articulo)} /></div>
              </Panel>
            )}
            <ArchivosArticulo
              archivos={articulo.archivos}
              puedeEditar={puedeEditar}
              articuloId={articulo.id}
              onCambio={() => mutate()}
              gestionaAcceso={gestionaAcceso}
              accesoArticulo={accesoDe(articulo)}
              autorId={articulo.autorId}
            />
            <ModalAcceso
              abierto={cambiandoAcceso}
              titulo={tc('accTituloArticulo', { titulo: articulo.titulo })}
              inicial={accesoDe(articulo)}
              autorId={articulo.autorId}
              onCerrar={() => setCambiandoAcceso(false)}
              onGuardar={guardarAcceso}
            />
          </aside>
        </div>
      )}
    </div>
  );
};

export default ArticuloPage;
