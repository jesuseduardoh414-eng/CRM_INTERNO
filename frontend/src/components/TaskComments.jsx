import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { comentariosService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { MessageSquare, Trash2, Send } from 'lucide-react';
import { PanelSkeleton } from './Skeleton';
import UserAvatar from './UserAvatar';
import Tooltip from './Tooltip';
import { useConfirmacion } from './ConfirmDialog';

const TaskComments = ({ tareaId, type = 'tareas', onCommentsChange }) => {
  const { usuario } = useAuth();
  const { t, locale } = usePreferences();
  const { showToast } = useToast();
  const { confirmar, dialogo } = useConfirmacion();
  const [nuevo, setNuevo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef(null);

  // Por SWR: se cachea por tarea y no hace falta pedirlos a mano en un efecto
  const { data: comentarios, isLoading, mutate } = useSWR(
    tareaId ? ['comentarios', type, tareaId] : null,
    async ([, tipo, id]) => {
      const respuesta = await comentariosService.listar(id, tipo);
      return respuesta.comentarios || [];
    },
    { onSuccess: (lista) => onCommentsChange?.(lista) },
  );
  const lista = comentarios || [];

  const actualizarComentarios = (siguiente) => {
    mutate(siguiente, { revalidate: false });
    onCommentsChange?.(siguiente);
  };

  // Scroll al final cuando hay nuevos comentarios
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lista.length]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nuevo.trim() || enviando) return;

    setEnviando(true);
    try {
      const data = await comentariosService.crear(tareaId, nuevo, type);
      actualizarComentarios([...lista, data.comentario]);
      setNuevo('');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleEliminar = async (id) => {
    const ok = await confirmar({
      titulo: t('commentDeleteConfirm'),
      textoConfirmar: t('delete'),
      peligro: true,
    });
    if (!ok) return;
    try {
      await comentariosService.eliminar(id);
      actualizarComentarios(lista.filter((c) => c.id !== id));
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  if (isLoading && !comentarios) return <PanelSkeleton rows={4} titleWidth="190px" />;

  // Conversacion compacta: texto de 13.5px, burbujas con poco radio y el
  // campo de escritura con el mismo estilo que el resto del formulario.
  return (
    <div className="flex flex-col gap-3">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text)]">
        <MessageSquare size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
        {type === 'proyectos' ? t('commentsProjectWall') : t('commentsTaskThread')}
        <span className="font-normal text-[var(--color-text-muted)]">· {lista.length}</span>
      </h4>

      {/* Mensajes con scroll interno */}
      <div ref={scrollRef} className="flex max-h-[340px] flex-col gap-3 overflow-y-auto pr-1">
        {lista.length === 0 ? (
          <p className="det-adjuntos-vacio">{t('commentsEmpty')}</p>
        ) : (
          lista.map(c => {
            const esMio = c.autorId === usuario?.id;
            const puedeBorrar = esMio || usuario?.rol === 'ADMIN';
            return (
              <div key={c.id} className={`group flex gap-2.5 ${esMio ? 'flex-row-reverse' : ''}`}>
                <UserAvatar
                  usuario={c.autor}
                  size={26}
                  radius={999}
                  fontSize="0.62rem"
                  color={esMio ? 'var(--color-on-primary)' : 'var(--color-text-dim)'}
                  background={esMio ? 'var(--color-primary)' : 'var(--color-surface-3)'}
                  borderColor="transparent"
                  className="mt-0.5 shrink-0"
                />

                <div className={`flex max-w-[85%] flex-col ${esMio ? 'items-end' : 'items-start'}`}>
                  <div className={`mb-1 flex items-center gap-2 px-0.5 ${esMio ? 'flex-row-reverse' : ''}`}>
                    <span className="text-[12.5px] font-medium text-[var(--color-text)]">
                      {esMio ? t('commentsYou') : (c.autor?.nombre || t('commentsUnknownAuthor'))}
                    </span>
                    {/* Fecha y hora: solo la hora no decia de que dia era el mensaje */}
                    <span className="text-[11.5px] tabular-nums text-[var(--color-text-muted)]">
                      {new Date(c.creadoEn).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {puedeBorrar && (
                      <Tooltip label={t('delete')}>
                        <button
                          type="button"
                          onClick={() => handleEliminar(c.id)}
                          className="dash-icono det-icono-peligro com-borrar !h-6 !w-6 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tooltip>
                    )}
                  </div>

                  <div
                    className="whitespace-pre-wrap break-words rounded-[10px] border px-3 py-2 text-[13.5px] leading-relaxed text-[var(--color-text)]"
                    style={{
                      background: esMio ? 'var(--color-primary-10)' : 'var(--color-bg-base)',
                      borderColor: esMio ? 'var(--color-primary-20)' : 'var(--color-border)',
                    }}
                  >
                    {c.contenido}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Escribir un mensaje */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          value={nuevo}
          onChange={e => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd + Enter envia sin tener que ir al boton
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(e);
          }}
          placeholder={t('commentsPlaceholder')}
          aria-label={t('commentsPlaceholder')}
          rows={2}
          className="form-input min-w-0 flex-1 resize-none"
        />
        <button
          type="submit"
          disabled={!nuevo.trim() || enviando}
          className="btn-primary h-10 shrink-0 !py-0 text-[13.5px] disabled:opacity-40"
        >
          {enviando ? t('commentsSending') : (
            <><Send size={14} /> <span>{t('commentsSend')}</span></>
          )}
        </button>
      </form>

      {dialogo}
    </div>
  );
};

export default TaskComments;
