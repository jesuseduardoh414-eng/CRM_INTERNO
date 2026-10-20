/**
 * Nombre de un archivo subido tal como lo escribio la persona.
 *
 * multer 1.x lee el nombre del archivo como latin1, pero los navegadores lo
 * mandan en UTF-8: "Cotización.pdf" llegaba como "CotizaciÃ³n.pdf". Si al
 * releerlo como UTF-8 sale texto valido, ese es el bueno; si no (un nombre que
 * de verdad venia en latin1), se deja como llego.
 */
const nombreUtf8 = (nombre) => {
  const texto = String(nombre || '');
  if (!/[\u0080-ÿ]/.test(texto)) return texto;
  const releido = Buffer.from(texto, 'latin1').toString('utf8');
  return releido.includes('�') ? texto : releido;
};

module.exports = { nombreUtf8 };
