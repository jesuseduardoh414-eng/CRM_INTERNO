import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { notificacionesService } from '../services/api';
import { Bell, CheckCheck, Trash2, ArrowUpRight, CalendarDays, ClipboardList, MessagesSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const getNotificationDestination = (notificacion, usuario, portalActivo = false) => {
  const proyectoId = notificacion.tarea?.proyectoId
    || notificacion.proyecto?.id
    || notificacion.proyectoId
    || notificacion.evento?.proyecto?.id
    || notificacion.evento?.proyectoId;

  // Conversación del portal de clientes (avisos anteriores a su retiro): el
  // equipo va al proyecto; la pestaña "Cliente" solo si el portal sigue activo.
  if (notificacion.tipo === 'MENSAJE_PORTAL' && proyectoId) {
    if (usuario?.rol === 'CLIENTE') return `/portal/proyectos/${proyectoId}?vista=mensajes`;
    return portalActivo ? `/proyectos/${proyectoId}?vista=cliente` : `/proyectos/${proyectoId}`;
  }

  if (proyectoId && notificacion.tarea?.id) {
    return `/proyectos/${proyectoId}?tarea=${notificacion.tarea.id}`;
  }

  if (notificacion.evento?.id || notificacion.eventoId) {
    const eventoId = notificacion.evento?.id || notificacion.eventoId;
    const fecha = notificacion.evento?.fechaInicio
      ? encodeURIComponent(notificacion.evento.fechaInicio)
      : '';
    return fecha ? `/agenda?evento=${eventoId}&fecha=${fecha}` : `/agenda?evento=${eventoId}`;
  }

  if (proyectoId) {
    return `/proyectos/${proyectoId}`;
  }

  if (notificacion.tipo === 'recordatorio') {
    return '/agenda';
  }

  return null;
};

const getNotificationMeta = (notificacion) => {
  const proyectoNombre = notificacion.tarea?.proyecto?.nombre
    || notificacion.proyecto?.nombre
    || notificacion.evento?.proyecto?.nombre;
  const actorNombre = notificacion.actorNombre
    || notificacion.evento?.creador?.nombre
    || null;

  return {
    proyectoNombre,
    actorNombre,
  };
};

const getNotificationAccent = (notificacion) => {
  if (notificacion.tipo === 'MENSAJE_PORTAL') {
    return {
      color: 'var(--color-gold-text)',
      soft: 'var(--color-gold-10)',
      icon: MessagesSquare,
      labelKey: 'notificationTypeMessage',
    };
  }
  if (notificacion.evento?.id || notificacion.eventoId || notificacion.tipo === 'recordatorio') {
    return {
      color: 'var(--color-accent-purple)',
      soft: 'color-mix(in srgb, var(--color-accent-purple) 12%, transparent)',
      icon: CalendarDays,
      labelKey: 'notificationTypeAgenda',
    };
  }

  return {
    color: 'var(--color-primary)',
    soft: 'var(--color-primary-10)',
    icon: ClipboardList,
    labelKey: 'notificationTypeTask',
  };
};

// Los avisos del navegador solo se piden tras un gesto de la persona (abrir la
// campana). Pedirlos al cargar la pagina es lo que los navegadores penalizan y
// lo que mas gente rechaza sin leer.
const pedirPermisoAvisos = () => {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch {
    // Navegadores antiguos: no pasa nada si no se puede pedir
  }
};

/**
 * `enSidebar` adapta la campana a la barra lateral: fondo oscuro fijo (el
 * sidebar no cambia con el tema) y panel que se abre hacia arriba y a la
 * derecha, porque ahi el boton queda pegado a la esquina inferior izquierda.
 */
const NotificationCenter = ({ enSidebar = false, colapsado = false }) => {
  const { t, locale } = usePreferences();
  const { usuario } = useAuth();
  const { moduloActivo } = useConfiguracion();
  const portalActivo = moduloActivo('clientes') && moduloActivo('portalClientes');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const usuarioId = usuario?.id;

  // Sondeo cada 15 s como respaldo de Realtime. SWR lo pausa solo mientras la
  // pestaña esta oculta (refreshWhenHidden) y vuelve a pedir al regresar
  // (revalidateOnFocus). El dedupingInterval propio es menor que el global de
  // 30 s; si no, un sondeo de cada dos se descartaba por repetido.
  const { data, mutate } = useSWR(
    usuarioId ? ['notificaciones', usuarioId] : null,
    async () => {
      const respuesta = await notificacionesService.listar();
      return respuesta?.notificaciones || [];
    },
    {
      refreshInterval: 15000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    },
  );
  const notificaciones = data || [];
  const unreadCount = notificaciones.filter((n) => !n.leida).length;

  useEffect(() => {
    if (!usuarioId) return undefined;

    // Solo configurar Realtime si Supabase está inicializado
    const realtimeEnabled = import.meta.env.VITE_ENABLE_REALTIME === 'true';
    if (!supabase || !realtimeEnabled) return undefined;

    // Filtrado en el servidor por la columna `usuarioId` de la tabla
    // notificaciones (schema.prisma): antes llegaban las inserciones de todo el
    // mundo y se descartaban aqui.
    const channel = supabase
      .channel(`notificaciones-usuario-${usuarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `usuarioId=eq.${usuarioId}` },
        () => {
          mutate();
          if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
        },
      )
      .subscribe((status, err) => {
        if (err && status !== 'CHANNEL_ERROR') console.error('[Realtime] Error:', err);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuarioId, mutate]);

  const alCambiarAbierto = (abierto) => {
    setOpen(abierto);
    if (abierto) pedirPermisoAvisos();
  };

  const handleMarcarLeida = async (id) => {
    try {
      await notificacionesService.marcarLeida(id);
      mutate((prev) => (prev || []).map((n) => (n.id === id ? { ...n, leida: true } : n)), { revalidate: false });
    } catch (error) {
      console.error(error);
    }
  };

  const handleMarcarTodas = async () => {
    try {
      await notificacionesService.marcarTodasLeidas();
      mutate((prev) => (prev || []).map((n) => ({ ...n, leida: true })), { revalidate: false });
    } catch (error) {
      console.error(error);
    }
  };

  const handleNotificationClick = async (notificacion) => {
    try {
      if (!notificacion.leida) {
        await handleMarcarLeida(notificacion.id);
      }
    } finally {
      const destino = getNotificationDestination(notificacion, usuario, portalActivo);
      setOpen(false);
      if (destino) {
        navigate(destino);
      }
    }
  };

  const handleEliminarNotificacion = async (event, id) => {
    event.stopPropagation();
    try {
      await notificacionesService.eliminar(id);
      mutate((prev) => (prev || []).filter((item) => item.id !== id), { revalidate: false });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Popover open={open} onOpenChange={alCambiarAbierto}>
    <div style={{ width: enSidebar ? '100%' : undefined }}>
      <PopoverTrigger asChild>
      {/* En el sidebar la campana es una fila mas del menu: mismo alto, mismo
          icono a la izquierda y el texto al lado. El numero de pendientes va a
          la derecha como contador, no encimado sobre el icono. */}
      {enSidebar ? (
        <button
          type="button"
          title={colapsado ? t('notificationsTitle') : undefined}
          aria-label={t('notificationsTitle')}
          data-abierto={open || undefined}
          className={`crm-nav-item ${colapsado ? 'crm-nav-colapsado' : ''}`}
        >
          <span className="relative shrink-0 flex items-center justify-center">
            <Bell size={17} strokeWidth={2} />
            {/* Colapsado no hay sitio para el contador al lado: vuelve a la esquina */}
            {colapsado && unreadCount > 0 && (
              <span
                className="absolute -top-1.5 -right-2 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
                style={{ background: 'var(--color-error)', border: '2px solid var(--color-bg-base)' }}
              >
            {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </span>

          {!colapsado && (
            <>
              <span className="crm-nav-texto">{t('notificationsTitle')}</span>
              {unreadCount > 0 && (
                <span className="crm-nav-contador">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </>
          )}
        </button>
              ) : (
        <button
          type="button"
          title={t('notificationsTitle')}
          aria-label={t('notificationsTitle')}
          style={{
          background: open ? 'var(--color-surface-3)' : 'var(--color-bg-base)',
          border: '1px solid var(--color-border)',
            cursor: 'pointer',
          width: '42px', height: '42px',
          borderRadius: '12px',
            position: 'relative',
          fontSize: '1.2rem',
          color: unreadCount > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: open ? 'inset 0 2px 4px rgba(0,0,0,0.05)' : 'var(--shadow-sm)',
          }}
        onMouseOver={e => {
          e.currentTarget.style.background = 'var(--color-surface-3)';
          e.currentTarget.style.borderColor = 'var(--color-primary)';
          }}
        onMouseOut={e => {
            if (open) return;
            e.currentTarget.style.background = 'var(--color-bg-base)';
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        >
          <Bell size={20} fill={unreadCount > 0 ? 'currentColor' : 'none'} />
          {unreadCount > 0 && (
            <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            background: 'var(--color-error)', color: 'var(--color-on-primary)',
              fontSize: '0.7rem', fontWeight: 500,
            width: '20px', height: '20px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--color-surface)',
            }}>
            {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
      </PopoverTrigger>

      {/* Sale por un portal, asi que ya no lo recorta el desplazamiento del
          menu lateral: ahi un panel de 380px dentro de una barra de 280px se
          cortaba y dejaba una barra horizontal. En el menu aparece a su derecha
          apoyado abajo; en la barra movil, debajo del boton. */}
      <PopoverContent
        side={enSidebar ? 'right' : 'bottom'}
        align="end"
        sideOffset={12}
        // En un telefono de 360px el panel ocupa el ancho menos un margen y no
        // pasa del alto que queda bajo la barra (antes 70vh + una lista de 430px
        // fijos: en horizontal la lista se cortaba sin poder desplazarse).
        collisionPadding={12}
        className="z-[1500] w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-[1.5rem] p-0 shadow-[var(--shadow-xl)]"
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'min(70dvh, var(--radix-popover-content-available-height, 70dvh))' }}>
          <div style={{
            padding: '1rem 1rem 0.9rem', borderBottom: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexShrink: 0
          }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--color-text)' }}>{t('notificationsTitle')}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                {unreadCount > 0 ? t('notificationsPending', { count: unreadCount }) : t('notificationsAllGood')}
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarcarTodas}
                style={{
                  background: 'var(--color-primary-10)',
                  border: '1px solid var(--color-primary-20)',
                  color: 'var(--color-primary)',
                  fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.5rem 0.7rem',
                  borderRadius: '999px'
                }}
              >
                <CheckCheck size={14} /> {t('notificationsMarkAll')}
              </button>
            )}
          </div>

          <div style={{ flex: '1 1 auto', minHeight: 0, maxHeight: '430px', overflowY: 'auto', overscrollBehavior: 'contain', padding: '0.65rem' }}>
            {notificaciones.length === 0 ? (
              <div style={{
                margin: '0.35rem',
                padding: '2.25rem 1rem',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: '0.92rem',
                borderRadius: '1.2rem',
                background: 'var(--color-surface-3)',
                border: '1px dashed var(--color-border)'
              }}>
                {t('notificationsEmpty')}
              </div>
              ) : (
                notificaciones.map((n) => {
                  const destino = getNotificationDestination(n, usuario, portalActivo);
                  const { proyectoNombre, actorNombre } = getNotificationMeta(n);
                  const accent = getNotificationAccent(n);
                  const AccentIcon = accent.icon;
                  return (
                  // Toda la tarjeta abre el aviso: con teclado tambien (Enter/Espacio)
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotificationClick(n)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleNotificationClick(n);
                      }
                    }}
                    style={{
                      marginBottom: '0.6rem',
                      padding: '0.95rem',
                      cursor: destino ? 'pointer' : (n.leida ? 'default' : 'pointer'),
                      background: n.leida ? 'var(--color-surface-2)' : 'var(--color-surface)',
                      transition: 'transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
                      position: 'relative',
                      borderRadius: '1.15rem',
                      border: n.leida ? '1px solid var(--color-border-light)' : `1px solid ${accent.soft}`,
                      boxShadow: n.leida ? 'var(--shadow-sm)' : 'var(--shadow-md)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div style={{
                        width: '2.35rem',
                        height: '2.35rem',
                        borderRadius: '0.9rem',
                        background: accent.soft,
                        color: accent.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: `inset 0 0 0 1px ${accent.soft}`,
                      }}>
                        <AccentIcon size={16} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                            <span style={{
                              fontSize: '0.65rem',
                              fontWeight: 500,
                              color: accent.color,
                              background: accent.soft,
                              padding: '0.22rem 0.45rem',
                              borderRadius: '999px'
                            }}>
                              {t(accent.labelKey)}
                            </span>
                            {!n.leida && (
                              <span style={{
                                width: '0.48rem',
                                height: '0.48rem',
                                borderRadius: '999px',
                                background: accent.color,
                                boxShadow: `0 0 0 4px ${accent.soft}`
                              }} />
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={(event) => handleEliminarNotificacion(event, n.id)}
                            aria-label={t('notificationDelete')}
                            title={t('notificationDelete')}
                            style={{
                              border: '1px solid transparent',
                              background: 'var(--badge-danger-bg)',
                              color: 'var(--badge-danger-fg)',
                              width: '2rem',
                              height: '2rem',
                              borderRadius: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div style={{
                          fontSize: '0.9rem',
                          fontWeight: n.leida ? 500 : 700,
                          color: 'var(--color-text)',
                          lineHeight: 1.38,
                          marginBottom: '0.45rem',
                          overflowWrap: 'anywhere', // URLs o nombres largos sin espacios
                        }}>
                          {n.mensaje}
                        </div>

                        {(proyectoNombre || actorNombre) && (
                          <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.4rem',
                            marginBottom: '0.55rem',
                          }}>
                            {proyectoNombre && (
                              <span style={{
                                fontSize: '0.68rem',
                                color: 'var(--color-text-dim)',
                                background: 'var(--color-surface-3)',
                                padding: '0.28rem 0.5rem',
                                borderRadius: '999px',
                                fontWeight: 500
                              }}>
                                {t('notificationProject')}: {proyectoNombre}
                              </span>
                            )}
                            {actorNombre && (
                              <span style={{
                                fontSize: '0.68rem',
                                color: 'var(--color-text-dim)',
                                background: 'var(--color-surface-3)',
                                padding: '0.28rem 0.5rem',
                                borderRadius: '999px',
                                fontWeight: 500
                              }}>
                                {n.tipo === 'MENSAJE_PORTAL' ? t('notificationFrom') : n.tipo === 'recordatorio' ? t('notificationInvitedBy') : t('notificationAssignedBy')}: {actorNombre}
                              </span>
                            )}
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                            {new Date(n.creadaEn).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {destino && (
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              fontSize: '0.72rem',
                              color: accent.color,
                              fontWeight: 500
                            }}>
                              {t('viewDetail')} <ArrowUpRight size={13} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
          </div>
        </div>
      </PopoverContent>
    </div>
    </Popover>
  );
};

export default NotificationCenter;
