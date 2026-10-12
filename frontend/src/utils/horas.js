// Horas 'HH:MM' (24 h): conversion a minutos, lectura de lo que escribe la
// persona y formato segun el idioma. Las usa components/SelectorHora y quien
// necesite mostrar una hora suelta igual que el selector.

const dosDigitos = (n) => String(n).padStart(2, '0');

/** 'HH:MM' -> minutos desde medianoche (null si no es una hora valida). */
export const aMinutosHora = (hora) => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hora || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};

/** Minutos -> 'HH:MM'. */
export const horaDeMinutos = (minutos) => `${dosDigitos(Math.floor(minutos / 60))}:${dosDigitos(minutos % 60)}`;

/**
 * Lo que escribe la persona -> minutos. Acepta "9", "09", "930", "0930",
 * "14:30", "9.30", "9h30", "2pm", "2 p.m.", "12am". Null si no se entiende.
 */
export const interpretarHora = (texto) => {
  const limpio = String(texto || '').toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?([ap])?\.?(?:m\.?)?$/.exec(limpio);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
};

/** 'HH:MM' con el formato del idioma ("9:00 a.m." / "9:00 AM" / "14:30"). */
export const formatoHora = (hora, locale) => {
  const minutos = aMinutosHora(hora);
  if (minutos === null) return hora || '';
  return new Date(2000, 0, 1, Math.floor(minutos / 60), minutos % 60)
    .toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, ' ');
};
