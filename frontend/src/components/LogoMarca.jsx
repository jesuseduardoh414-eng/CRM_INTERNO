// Logo de la instalación. Usa las imágenes subidas en el panel de
// configuración; si no hay, las de fábrica (OMNIS); y si la instalación cambió
// de nombre sin subir logo, pinta el nombre en texto para no mostrar otra marca.
//
//  fondo:    'oscuro' (menú, panel del login) | 'claro' | 'auto' (según el tema)
//  variante: 'horizontal' | 'isotipo' (símbolo cuadrado, menú colapsado)
import { useConfiguracion } from '../context/ConfiguracionContext';

const LogoTexto = ({ texto, fondo, variante, className }) => {
  if (variante === 'isotipo') {
    return (
      <span
        className={`inline-flex aspect-square items-center justify-center rounded-full border-2 font-bold ${className}`}
        style={{ borderColor: 'var(--marca-acento, var(--color-gold))', color: fondo === 'oscuro' ? '#fffcf0' : 'var(--color-text)' }}
        aria-label={texto}
      >
        {texto.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center font-bold uppercase tracking-[0.3em] ${className}`}
      style={{ color: fondo === 'oscuro' ? '#fffcf0' : 'var(--color-text)' }}
    >
      {texto}
    </span>
  );
};

const LogoMarca = ({ fondo = 'auto', variante = 'horizontal', className = '', textoClassName = 'text-xl' }) => {
  const { imagen, marca } = useConfiguracion();
  const alt = marca.nombreEmpresa || marca.nombreSistema;

  if (variante === 'isotipo') {
    const src = imagen('isotipo');
    return src
      ? <img src={src} alt={alt} className={`object-contain ${className}`} />
      : <LogoTexto texto={marca.nombreCorto || 'C'} fondo={fondo} variante="isotipo" className={`${className} ${textoClassName}`} />;
  }

  if (fondo === 'auto') {
    return (
      <>
        <span className="brand-logo-light"><LogoMarca fondo="claro" className={className} textoClassName={textoClassName} /></span>
        <span className="brand-logo-dark"><LogoMarca fondo="oscuro" className={className} textoClassName={textoClassName} /></span>
      </>
    );
  }

  const src = imagen(fondo === 'oscuro' ? 'logoOscuro' : 'logoClaro');
  return src
    ? <img src={src} alt={alt} className={`object-contain ${className}`} />
    : <LogoTexto texto={marca.nombreCorto || marca.nombreSistema} fondo={fondo} className={textoClassName} />;
};

export default LogoMarca;
