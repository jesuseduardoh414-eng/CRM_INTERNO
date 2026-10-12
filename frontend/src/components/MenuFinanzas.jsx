// Grupo "Finanzas" del menú lateral: Ventas, Tesorería y Gastos. Gastos lleva
// un submenú con las categorías que la persona puede ver y el informe; se
// abre solo mientras se está en una de sus páginas (o si se abrió a mano).
// Colapsado, Gastos es un enlace directo a su primera página.
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

const MenuFinanzas = ({ titulo, enlaces, colapsado, onNavegar }) => {
  const location = useLocation();
  const [abiertoManual, setAbiertoManual] = useState(null);
  if (!enlaces.length) return null;

  return (
    <div>
      {colapsado
        ? <div className="mx-auto my-3 h-px w-6 bg-[var(--color-border)]" aria-hidden="true" />
        : <p className="crm-lateral-grupo">{titulo}</p>}
      <div className="flex flex-col gap-0.5">
        {enlaces.map(({ to, etiqueta, Icono, sub, raiz }) => {
          const enSeccion = Boolean(raiz) && location.pathname.startsWith(raiz);
          const conSubmenu = Boolean(sub) && !colapsado;
          const abierto = conSubmenu && (abiertoManual ?? enSeccion);
          const alPulsar = (e) => {
            if (conSubmenu) {
              // Con submenú, el enlace solo lo abre o cierra; la página se
              // elige en la lista de abajo.
              e.preventDefault();
              setAbiertoManual(!abierto);
              return;
            }
            onNavegar();
          };
          // El padre se marca mientras se está en cualquiera de sus páginas
          // (también colapsado); `end` evita que solo la primera lo active.
          return (
            <div key={to}>
              <NavLink
                to={to}
                end={Boolean(sub)}
                onClick={alPulsar}
                title={colapsado ? etiqueta : undefined}
                aria-label={colapsado ? etiqueta : undefined}
                aria-expanded={conSubmenu ? abierto : undefined}
                data-abierto={sub && enSeccion ? 'true' : undefined}
                className={`crm-nav-item ${colapsado ? 'crm-nav-colapsado crm-nav-riel' : ''} ${conSubmenu && enSeccion ? 'crm-nav-padre-activo' : ''}`}
              >
                <Icono size={17} strokeWidth={2} />
                {colapsado
                  ? <span className="crm-nav-rotulo" aria-hidden="true">{etiqueta}</span>
                  : <span className="crm-nav-texto">{etiqueta}</span>}
                {conSubmenu && <ChevronDown size={14} className="crm-nav-flecha" aria-hidden="true" />}
              </NavLink>
              {abierto && (
                <div className="flex flex-col gap-0.5" role="group" aria-label={etiqueta}>
                  {sub.map((s) => (
                    <NavLink key={s.to} to={s.to} onClick={onNavegar} className="crm-nav-item crm-nav-sub">
                      <span className="crm-nav-texto">{s.corta || s.etiqueta}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MenuFinanzas;
