// Pestañas de Gastos: las categorías que la persona puede ver y el Informe.
// Repiten el submenú del menú lateral para cuando está colapsado (ahí Gastos
// es un solo icono) o en el teléfono.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { RUTA_INFORME, categoriasVisibles, puedeVerFinanzas, rutaCategoria } from '../../utils/finanzas';

const NavCategoriasGastos = () => {
  const { usuario } = useAuth();
  const tf = useTextoFinanzas();
  const pestanas = [
    ...categoriasVisibles(usuario).map((c) => ({ to: rutaCategoria(c), etiqueta: tf(`finCat${c}Corta`) })),
    ...(puedeVerFinanzas(usuario, 'informe') ? [{ to: RUTA_INFORME, etiqueta: tf('finInformeTitulo') }] : []),
  ];
  if (pestanas.length < 2) return null;
  return (
    <nav className="fin-pestanas mb-5" aria-label={tf('finGastosTitulo')}>
      {pestanas.map(({ to, etiqueta }) => (
        <NavLink key={to} to={to} className="fin-pestana">{etiqueta}</NavLink>
      ))}
    </nav>
  );
};

export default NavCategoriasGastos;
