import { Children, cloneElement, isValidElement } from 'react';
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';

/**
 * Etiqueta flotante para botones que solo muestran un icono.
 *
 * Ademas de la etiqueta visual, copia el texto a `aria-label` del hijo: Radix
 * enlaza el tooltip con `aria-describedby`, pero eso da una *descripcion*, no un
 * *nombre* accesible. Sin `aria-label` un boton de solo icono sigue siendo
 * anonimo para un lector de pantalla.
 *
 *   <Tooltip label={t('edit')}>
 *     <button onClick={...}><Pencil size={14} /></button>
 *   </Tooltip>
 */
const Tooltip = ({ label, side = 'top', children }) => {
  if (!label) return children;

  const child = Children.only(children);
  const conNombre = isValidElement(child) && !child.props['aria-label']
    ? cloneElement(child, { 'aria-label': label })
    : child;

  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{conNombre}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </TooltipRoot>
  );
};

export default Tooltip;
