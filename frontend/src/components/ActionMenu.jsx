import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { usePreferences } from '../context/PreferencesContext';

/**
 * Menu de "3 puntitos" para agrupar acciones secundarias.
 *
 * Criterio acordado con el usuario: cuando un componente tiene 3 o mas acciones,
 * la principal se deja visible y el resto se mete aqui, para no llenar la tarjeta
 * de botones. Con 2 o menos, se dejan sueltos con su Tooltip.
 *
 *   <ActionMenu items={[
 *     { label: t('edit'),   icon: <Pencil size={14} />, onSelect: () => editar(x) },
 *     { label: t('delete'), icon: <Trash2 size={14} />, onSelect: () => borrar(x), danger: true },
 *   ]} />
 *
 * Los `items` falsy se ignoran, para poder escribir `cond && {...}` en la lista.
 */
const ActionMenu = ({
  items = [],
  align = 'end',
  size = 16,
  className = '',
}) => {
  const { t } = usePreferences();
  const visibles = items.filter(Boolean);
  if (visibles.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('moreOptions')}
          title={t('moreOptions')}
          // Las tarjetas que contienen este menu suelen tener su propio onClick
          // (abrir la tarea); sin esto, pulsar los 3 puntitos tambien la abriria.
          // Con el dedo el boton mide 40px como minimo (con p-1.5 eran 28px).
          onClick={(event) => event.stopPropagation()}
          className={`flex items-center justify-center rounded-lg p-1.5 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] data-[state=open]:bg-[var(--color-surface-3)] ${className}`}
        >
          <MoreVertical size={size} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        onClick={(event) => event.stopPropagation()}
        className="z-[1500] min-w-[190px]"
      >
        {visibles.map((item, index) => (
          item.separator
            ? <DropdownMenuSeparator key={`sep-${index}`} />
            : (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled}
                onSelect={() => item.onSelect?.()}
                className={`gap-2 font-medium ${item.danger ? 'text-[var(--color-error)] focus:text-[var(--color-error)]' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </DropdownMenuItem>
            )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ActionMenu;
