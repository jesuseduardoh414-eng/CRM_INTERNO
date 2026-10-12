// En moviles/tabletas el autofocus al cargar abre el teclado y tapa media
// pantalla antes de que el usuario lo pida: solo se enfoca con puntero fino.
export const enfocarAlCargar = () => typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches;
