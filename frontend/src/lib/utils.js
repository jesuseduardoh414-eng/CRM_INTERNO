import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Une clases de Tailwind resolviendo conflictos (usado por los componentes de shadcn)
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
