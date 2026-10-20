// Crear o editar un artículo de la base de conocimiento (/conocimiento/nuevo y
// /conocimiento/:id/editar). Solo administradores. El texto lleva formato
// básico tipo Markdown con una barra de botones y vista previa; los archivos
// elegidos antes de crear el artículo se suben al guardarlo.
import { useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Loader2, Quote, Save,
} from 'lucide-react';
import { conocimientoService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { useTextoConocimiento } from '../hooks/useTextoConocimiento';
import { ListSkeleton } from '../components/Skeleton';
import { Button } from '../components/ui/button';
import { AvisoError, Campo } from '../components/finanzas/piezas';
import Markdown from '../components/conocimiento/Markdown';
import ArchivosArticulo from '../components/conocimiento/ArchivosArticulo';

const VACIO = { titulo: '', categoria: '', resumen: '', contenido: '', publicado: true, fijado: false };

const Formulario = ({ articulo, categorias }) => {
  const { t } = usePreferences();
  const tc = useTextoConocimiento();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const editando = Boolean(articulo?.id);
  const [form, setForm] = useState(() => (articulo
    ? { titulo: articulo.titulo, categoria: articulo.categoria, resumen: articulo.resumen || '', contenido: articulo.contenido || '', publicado: articulo.publicado, fijado: articulo.fijado }
    : VACIO));
  const [pestana, setPestana] = useState('escribir');
  const [pendientes, setPendientes] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const areaTexto = useRef(null);

  const cambiar = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
    setError(null);
  };

  // Barra de formato: envuelve la selección o antepone un prefijo a cada línea.
  const aplicar = (accion) => {
    const ta = areaTexto.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    let nuevo;
    let selA;
    let selB;
    if (accion.envolver) {
      const [antes, despues, ejemplo] = accion.envolver;
      const texto = value.slice(a, b) || ejemplo;
      nuevo = `${value.slice(0, a)}${antes}${texto}${despues}${value.slice(b)}`;
      selA = a + antes.length;
      selB = selA + texto.length;
    } else {
      const inicio = value.lastIndexOf('\n', a - 1) + 1;
      const finLinea = value.indexOf('\n', b);
      const fin = finLinea === -1 ? value.length : finLinea;
      const lineas = value.slice(inicio, fin).split('\n').map((l, i) => `${accion.prefijo(i)}${l}`).join('\n');
      nuevo = `${value.slice(0, inicio)}${lineas}${value.slice(fin)}`;
      selA = inicio;
      selB = inicio + lineas.length;
    }
    setForm((p) => ({ ...p, contenido: nuevo }));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(selA, selB); });
  };
  const botones = [
    { id: 'negrita', etiqueta: tc('conNegrita'), Icono: Bold, accion: { envolver: ['**', '**', tc('conNegrita').toLowerCase()] } },
    { id: 'cursiva', etiqueta: tc('conCursiva'), Icono: Italic, accion: { envolver: ['_', '_', tc('conCursiva').toLowerCase()] } },
    { id: 'titulo', etiqueta: tc('conEncabezado'), Icono: Heading2, accion: { prefijo: () => '## ' } },
    { id: 'lista', etiqueta: tc('conLista'), Icono: List, accion: { prefijo: () => '- ' } },
    { id: 'numerada', etiqueta: tc('conListaNumerada'), Icono: ListOrdered, accion: { prefijo: (i) => `${i + 1}. ` } },
    { id: 'cita', etiqueta: tc('conCita'), Icono: Quote, accion: { prefijo: () => '> ' } },
    { id: 'enlace', etiqueta: tc('conEnlace'), Icono: Link2, accion: { envolver: ['[', '](https://)', tc('conTextoEnlace')] } },
    { id: 'codigo', etiqueta: tc('conCodigo'), Icono: Code, accion: { envolver: ['`', '`', 'codigo'] } },
  ];

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const data = editando ? await conocimientoService.editar(articulo.id, form) : await conocimientoService.crear(form);
      // Los archivos elegidos antes de que existiera el artículo.
      for (const archivo of pendientes) {
        try {
          await conocimientoService.subirArchivo(data.articulo.id, archivo);
        } catch (err) {
          showToast(`${archivo.name}: ${err.message}`, 'error');
        }
      }
      // La lista y la ficha se vuelven a pedir con lo recién guardado.
      mutate((clave) => Array.isArray(clave) && String(clave[0]).startsWith('conocimiento'));
      showToast(editando ? tc('conActualizado') : tc('conCreado'), 'success');
      navigate(`/conocimiento/${data.articulo.id}`, { replace: true });
    } catch (err) {
      setError({ texto: err.message, detalles: err.detalles });
      setGuardando(false);
    }
  };

  const volverA = editando ? `/conocimiento/${articulo.id}` : '/conocimiento';

  return (
    <form onSubmit={guardar} noValidate className="mx-auto max-w-6xl">
      <Link to={volverA} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
        <ArrowLeft size={15} /> {editando ? articulo.titulo : tc('conVolver')}
      </Link>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[30px]">{editando ? tc('conEditarTitulo') : tc('conNuevo')}</h1>
        <div className="flex w-full gap-2 md:w-auto">
          <Button type="button" variant="outline" className="flex-1 md:flex-none" onClick={() => navigate(volverA)} disabled={guardando}>{t('cancel')}</Button>
          <Button type="submit" className="flex-1 md:flex-none" disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {guardando ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
      <AvisoError error={error} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-1">
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Campo id="art-titulo" label={tc('conArticuloTitulo')} requerido ancho>
              <input id="art-titulo" name="titulo" className="form-input text-[15px]" value={form.titulo} onChange={cambiar} maxLength={200} placeholder={tc('conTituloPh')} required autoFocus={!editando} />
            </Campo>
            <Campo id="art-categoria" label={tc('conCategoria')} requerido ayuda={tc('conCategoriaAyuda')}>
              <input id="art-categoria" name="categoria" className="form-input" value={form.categoria} onChange={cambiar} maxLength={80} placeholder={tc('conCategoriaPh')} list="art-categorias" required />
              <datalist id="art-categorias">{categorias.map((c) => <option key={c.nombre} value={c.nombre} />)}</datalist>
            </Campo>
            <Campo id="art-resumen" label={tc('conResumen')}>
              <input id="art-resumen" name="resumen" className="form-input" value={form.resumen} onChange={cambiar} maxLength={300} placeholder={tc('conResumenPh')} />
            </Campo>
          </div>

          <div className="form-group">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="form-label !mb-0">{tc('conContenido')}</span>
              <div className="dash-segmento h-9 items-center text-[12.5px]" role="tablist" aria-label={tc('conContenido')}>
                <button type="button" role="tab" aria-selected={pestana === 'escribir'} onClick={() => setPestana('escribir')}>{tc('conEscribir')}</button>
                <button type="button" role="tab" aria-selected={pestana === 'previa'} onClick={() => setPestana('previa')}>{tc('conVistaPrevia')}</button>
              </div>
            </div>
            {pestana === 'escribir' ? (
              <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-primary)]">
                <div className="flex flex-wrap gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-1" role="toolbar" aria-label={tc('conContenido')}>
                  {botones.map(({ id, etiqueta, Icono, accion }) => (
                    <button key={id} type="button" className="dash-icono max-md:!h-10 max-md:!w-10" title={etiqueta} aria-label={etiqueta} onMouseDown={(e) => e.preventDefault()} onClick={() => aplicar(accion)}>
                      <Icono size={15} />
                    </button>
                  ))}
                </div>
                <textarea
                  ref={areaTexto}
                  name="contenido"
                  aria-label={tc('conContenido')}
                  value={form.contenido}
                  onChange={cambiar}
                  rows={18}
                  className="block min-h-[360px] w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-[13.5px] leading-relaxed text-[var(--color-text)] outline-none"
                />
              </div>
            ) : (
              <div className="min-h-[360px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
                {form.contenido.trim() ? <Markdown texto={form.contenido} /> : <p className="text-[13px] text-[var(--color-text-muted)]">{tc('conVistaPreviaVacia')}</p>}
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">{tc('conFormatoAyuda')}</p>
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" name="publicado" checked={form.publicado} onChange={cambiar} className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]" />
              <span>
                <span className="block text-[13.5px] font-medium text-[var(--color-text)]">{tc('conPublicado')}</span>
                <span className="block text-[12px] text-[var(--color-text-muted)]">{tc('conPublicadoAyuda')}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" name="fijado" checked={form.fijado} onChange={cambiar} className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]" />
              <span>
                <span className="block text-[13.5px] font-medium text-[var(--color-text)]">{tc('conFijado')}</span>
                <span className="block text-[12px] text-[var(--color-text-muted)]">{tc('conFijadoAyuda')}</span>
              </span>
            </label>
          </div>
          <ArchivosArticulo
            archivos={articulo?.archivos || []}
            puedeEditar
            articuloId={articulo?.id || null}
            pendientes={pendientes}
            onPendientes={setPendientes}
          />
        </aside>
      </div>
    </form>
  );
};

const EditorArticuloPage = () => {
  const { id } = useParams();
  const { usuario } = useAuth();
  // Artículo nuevo: "conocimiento.crear"; uno existente: "conocimiento.editar".
  const esAdmin = puede(usuario, id ? 'conocimiento.editar' : 'conocimiento.crear');
  const { data: lista } = useSWR(esAdmin ? ['conocimiento', '', ''] : null, () => conocimientoService.listar());
  const { data, error } = useSWR(esAdmin && id ? ['conocimiento-articulo', id] : null, () => conocimientoService.obtener(id));

  if (!esAdmin) return <Navigate to={id ? `/conocimiento/${id}` : '/conocimiento'} replace />;
  if (id && error) return <Navigate to="/conocimiento" replace />;
  if (id && !data) return <div className="mx-auto max-w-6xl"><ListSkeleton rows={6} header={false} /></div>;
  return <Formulario key={id || 'nuevo'} articulo={data?.articulo || null} categorias={lista?.categorias || []} />;
};

export default EditorArticuloPage;
