import { useState } from 'react';
import { getPublicAssetUrl } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';

const getInitials = (nombre = '') => (
  nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('') || '?'
);

/**
 * Foto de una persona, con iniciales de respaldo.
 *
 * `fotoPerfilUrl` admite las tres formas que devuelve el backend: una URL
 * absoluta de Vercel Blob (https://...), un `data:` en base64 (perfiles
 * antiguos) o una ruta relativa al servidor; `getPublicAssetUrl` las resuelve.
 * Si la imagen no carga, se cae a las iniciales.
 */
const UserAvatar = ({
  usuario,
  nombre,
  fotoPerfilUrl,
  size = 48,
  radius = 14,
  color = 'var(--color-primary)',
  background = 'var(--color-primary-10)',
  borderColor = 'var(--color-primary-20)',
  fontSize = '1rem',
  shadow = 'none',
  className = '',
  title,
}) => {
  const { t } = usePreferences();
  // Se guarda QUE url fallo, no un si/no: el mismo avatar se reutiliza con otra
  // persona (p. ej. al cambiar el responsable de una tarjeta) y antes, tras un
  // fallo, ya no volvia a intentar ninguna foto.
  const [urlFallida, setUrlFallida] = useState(null);

  const displayName = nombre || usuario?.nombre || '';
  const displayPhoto = fotoPerfilUrl ?? usuario?.fotoPerfilUrl ?? '';
  const resolvedPhoto = getPublicAssetUrl(typeof displayPhoto === 'string' ? displayPhoto : '');
  const mostrarFoto = Boolean(resolvedPhoto) && urlFallida !== resolvedPhoto;

  return (
    <div
      className={className}
      title={title || displayName || undefined}
      // Con iniciales, el nombre va en aria-label para que el lector no lea "JD"
      role={mostrarFoto ? undefined : 'img'}
      aria-label={mostrarFoto ? undefined : (displayName || t('userGeneric'))}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${radius}px`,
        flexShrink: 0,
        overflow: 'hidden',
        // Con foto se usa un fondo neutro: los colores de acento (naranja, azul...)
        // se transparentaban a traves de los PNG y se veian mal.
        background: mostrarFoto ? 'var(--color-surface-3)' : background,
        border: `1.5px solid ${mostrarFoto ? 'var(--color-border)' : borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 500,
        fontSize,
        color,
        boxShadow: shadow,
      }}
    >
      {mostrarFoto ? (
        <img
          src={resolvedPhoto}
          alt={displayName || t('userGeneric')}
          // Si la URL esta rota se cae a las iniciales en vez de dejar el hueco vacio
          onError={() => setUrlFallida(resolvedPhoto)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span aria-hidden="true">{getInitials(displayName)}</span>
      )}
    </div>
  );
};

export default UserAvatar;
