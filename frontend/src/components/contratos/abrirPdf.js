// Ayudas para mostrar los PDF de contratos, que se piden con la sesión y se
// sirven desde memoria (blob).
//
// En teléfonos y tabletas un PDF dentro de un <iframe> no sirve: iOS Safari
// solo pinta la primera página y Chrome para Android no lo muestra. Ahí se
// abre en una pestaña nueva, donde el visor del sistema sí funciona.

/**
 * true en iPad aunque se presente como Mac: desde iPadOS 13 Safari dice
 * "Macintosh" y, con teclado o trackpad conectado, (pointer: coarse) deja de
 * cumplirse. Ningún Mac de escritorio tiene pantalla táctil, así que
 * maxTouchPoints > 1 lo delata.
 */
const esIpad = () => /iPad/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** true si el navegador puede mostrar el PDF dentro de la página. */
export const puedeIncrustarPdf = () => {
  if (typeof window === 'undefined') return false;
  const tactil = window.matchMedia?.('(pointer: coarse)').matches || esIpad();
  return !tactil && navigator.pdfViewerEnabled !== false;
};

/**
 * Abre el PDF en una pestaña nueva. La pestaña se abre en el clic (si no, el
 * navegador la bloquea) y recibe el PDF cuando llega. Si aun así el navegador
 * la bloquea, se llama a `alBloquear` (p. ej. para descargarlo).
 */
export const abrirPdfEnPestana = async (obtenerUrl, { alBloquear } = {}) => {
  const ventana = window.open('', '_blank');
  try {
    const url = await obtenerUrl();
    if (ventana && !ventana.closed) ventana.location.href = url;
    else await alBloquear?.();
    // Se libera después, no al instante: la pestaña lee el blob al cargar.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    ventana?.close();
    throw err;
  }
};
