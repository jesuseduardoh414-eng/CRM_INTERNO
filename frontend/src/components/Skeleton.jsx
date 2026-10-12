// Esqueletos de carga. La animación `skeleton-shimmer` vive en index.css.

const shimmer = {
  background: 'linear-gradient(90deg, rgba(148,163,184,0.08) 25%, rgba(148,163,184,0.18) 50%, rgba(148,163,184,0.08) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeleton-shimmer 1.5s infinite linear',
};

// `maxWidth: 100%`: los anchos fijos (240px, 220px...) desbordaban la tarjeta
// en un telefono de 360px y aparecia scroll horizontal mientras cargaba.
export const SkeletonBlock = ({ width = '100%', height = 16, radius = 12, style = {} }) => (
  <div
    aria-hidden="true"
    style={{
      width,
      maxWidth: '100%',
      height,
      borderRadius: radius,
      ...shimmer,
      ...style,
    }}
  />
);

export const SkeletonText = ({ lines = 3, widths = ['100%', '92%', '68%'] }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%' }}>
    {Array.from({ length: lines }).map((_, index) => (
      <SkeletonBlock key={index} height={12} width={widths[index] || widths[widths.length - 1] || '100%'} radius={999} />
    ))}
  </div>
);

// Cabecera de página: título, subtítulo y botón de acción
const SkeletonHeader = () => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
    <div style={{ flex: 1, minWidth: 'min(280px, 100%)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <SkeletonBlock width="220px" height={16} radius={999} />
      <SkeletonBlock width="min(520px, 100%)" height={44} radius={18} />
      <SkeletonBlock width="min(420px, 100%)" height={16} radius={999} />
    </div>
    <SkeletonBlock width="180px" height={54} radius={20} />
  </div>
);

// El Layout ya pone su margen: en movil 2rem mas por lado dejaba el esqueleto
// en una columna estrecha (y distinto de la pagina que luego aparece).
const contenedorPagina = { maxWidth: '1280px', margin: '0 auto', padding: 'min(2rem, 4vw)' };

/**
 * Rejilla de tarjetas (listado de proyectos, miembros...).
 *   <GridSkeleton cards={6} />
 */
export const GridSkeleton = ({ cards = 6, minWidth = '260px', header = true }) => (
  <div style={{ width: '100%' }} aria-busy="true">
    <div style={contenedorPagina}>
      {header && <SkeletonHeader />}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minWidth}), 1fr))`, gap: '1.25rem' }}>
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SkeletonBlock width="90px" height={22} radius={999} />
              <SkeletonBlock width="28px" height={28} radius={10} />
            </div>
            <SkeletonBlock width={`${80 - (index % 3) * 8}%`} height={20} radius={10} />
            <SkeletonText lines={2} widths={['100%', '70%']} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <SkeletonBlock width="32px" height={32} radius={12} />
              <SkeletonBlock width="32px" height={32} radius={12} />
              <SkeletonBlock width="32px" height={32} radius={12} />
              <div style={{ flex: 1 }} />
              <SkeletonBlock width="64px" height={12} radius={999} />
            </div>
            <SkeletonBlock width="100%" height={8} radius={999} />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Lista de filas (tareas, actividad, detalle de proyecto...).
 *   <ListSkeleton rows={8} />
 */
export const ListSkeleton = ({ rows = 6, header = true }) => (
  <div style={{ width: '100%' }} aria-busy="true">
    <div style={contenedorPagina}>
      {header && <SkeletonHeader />}
      <div className="card" style={{ padding: '0.5rem 0', display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem 1.5rem',
              borderBottom: index === rows - 1 ? 'none' : '1px solid var(--color-border-light)',
            }}
          >
            <SkeletonBlock width="20px" height={20} radius={6} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <SkeletonBlock width={`${70 - (index % 4) * 6}%`} height={14} radius={999} />
              <SkeletonBlock width={`${40 - (index % 3) * 5}%`} height={12} radius={999} />
            </div>
            <SkeletonBlock width="72px" height={22} radius={999} />
            <SkeletonBlock width="32px" height={32} radius={12} />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Esqueleto de página completa.
 *   variant="default"  cabecera + tarjetas de resumen + panel y lateral (Inicio)
 *   variant="grid"     cabecera + rejilla de tarjetas (Proyectos)
 *   variant="list"     cabecera + lista de filas (Detalle, Usuarios)
 */
export const PageSkeleton = ({ cards = 3, showSidebar = true, variant = 'default' }) => {
  if (variant === 'grid') return <GridSkeleton cards={Math.max(cards, 3)} />;
  if (variant === 'list') return <ListSkeleton rows={Math.max(cards * 2, 4)} />;

  return (
    <div style={{ width: '100%' }} aria-busy="true">
      <div style={contenedorPagina}>
        <SkeletonHeader />

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 170px), 1fr))`, gap: '1rem', marginBottom: '2rem' }}>
          {Array.from({ length: cards }).map((_, index) => (
            <div key={index} className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <SkeletonBlock width="54px" height={54} radius={18} />
              <SkeletonBlock width="72px" height={30} radius={14} />
              <SkeletonBlock width="120px" height={12} radius={999} />
              <SkeletonBlock width="88px" height={12} radius={999} />
            </div>
          ))}
        </div>

        <div className={showSidebar ? 'grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid gap-6'}>
          <div className="card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <SkeletonBlock width="220px" height={20} radius={999} />
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <SkeletonBlock width="44px" height={44} radius={14} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <SkeletonBlock width={`${78 - index * 4}%`} height={14} radius={999} />
                  <SkeletonBlock width={`${52 - index * 3}%`} height={12} radius={999} />
                </div>
              </div>
            ))}
          </div>

          {showSidebar && (
            <div className="card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <SkeletonBlock width="170px" height={20} radius={999} />
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  <SkeletonBlock width={`${88 - index * 8}%`} height={14} radius={999} />
                  <SkeletonBlock width={`${68 - index * 8}%`} height={12} radius={999} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AuthSkeleton = ({ compact = false }) => (
  <div
    aria-busy="true"
    style={{ minHeight: compact ? '320px' : '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', background: compact ? 'transparent' : 'var(--color-bg-base)' }}
  >
    <div style={{ width: '100%', maxWidth: compact ? '440px' : '520px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '28px', padding: compact ? '2rem' : 'clamp(1.5rem, 6vw, 2.5rem)', boxShadow: 'var(--shadow-xl)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
        <SkeletonBlock width="72px" height={72} radius={24} />
        <SkeletonBlock width="240px" height={26} radius={14} />
        <SkeletonBlock width="70%" height={14} radius={999} />
      </div>
      <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <SkeletonBlock width="100%" height={54} radius={16} />
        <SkeletonBlock width="100%" height={54} radius={16} />
        <SkeletonBlock width="100%" height={54} radius={16} />
      </div>
    </div>
  </div>
);

export const PanelSkeleton = ({ rows = 4, titleWidth = '180px' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-busy="true">
    <SkeletonBlock width={titleWidth} height={22} radius={999} />
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} style={{ padding: '1rem', borderRadius: '18px', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <SkeletonBlock width={`${84 - index * 6}%`} height={14} radius={999} />
        <SkeletonBlock width={`${58 - index * 5}%`} height={12} radius={999} />
      </div>
    ))}
  </div>
);

export default PageSkeleton;
