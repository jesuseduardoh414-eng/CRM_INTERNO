// Genera la paleta completa del CRM a partir de los dos colores de marca que
// elige el configurador (primario y acento), para tema claro y oscuro.
//
// Reglas:
//  - Todo texto sobre un color de marca se elige por contraste (WCAG AA 4.5:1).
//  - El menú lateral lleva texto blanco: si el primario es claro se oscurece.
//  - En oscuro, los fondos toman el tono del primario con poca luz (opcional:
//    `tenirModoOscuro`), así un rojo o un verde siguen viéndose oscuros.
//  - Con los colores de fábrica no se inyecta nada: index.css ya tiene la paleta
//    OMNIS ajustada a mano.

export const COLORES_FABRICA = { primario: '#10233f', acento: '#c9a227', tenirModoOscuro: true };

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

const hexARgb = (hex) => {
  const limpio = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(limpio.slice(i, i + 2), 16));
};
const rgbAHex = (rgb) => `#${rgb.map((v) => Math.round(limitar(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

export const mezclar = (a, b, t) => {
  const ca = hexARgb(a);
  const cb = hexARgb(b);
  return rgbAHex(ca.map((v, i) => v + (cb[i] - v) * t));
};

const luminancia = (hex) => {
  const [r, g, b] = hexARgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contraste = (a, b) => {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const rgbAHsl = (hex) => {
  const [r, g, b] = hexARgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
};

const hslAHex = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbAHex([f(0), f(8), f(4)].map((v) => v * 255));
};

/** Oscurece (o aclara) `color` hasta llegar a `minimo` de contraste contra `fondo`. */
export const ajustarContraste = (color, fondo, minimo = 4.5) => {
  if (contraste(color, fondo) >= minimo) return color;
  const destino = luminancia(fondo) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidato = mezclar(color, destino, t);
    if (contraste(candidato, fondo) >= minimo) return candidato;
  }
  return destino;
};

/** Texto legible sobre `fondo`: el preferido si llega a 4.5:1, si no blanco o casi negro. */
export const textoSobre = (fondo, preferido = null) => {
  if (preferido && contraste(preferido, fondo) >= 4.5) return preferido;
  return contraste('#ffffff', fondo) >= contraste('#0f172a', fondo) ? '#ffffff' : '#0f172a';
};

export const esColorFabrica = (colores = {}) => (
  String(colores.primario).toLowerCase() === COLORES_FABRICA.primario
  && String(colores.acento).toLowerCase() === COLORES_FABRICA.acento
  && colores.tenirModoOscuro !== false
);

/** Variables CSS de cada tema. */
export const generarVariables = ({ primario, acento, tenirModoOscuro = true }) => {
  const blanco = '#ffffff';

  // ── Claro ──
  const primarioClaro = ajustarContraste(primario, blanco, 4.5);
  const sidebar = ajustarContraste(primario, blanco, 7);
  const infoBg = mezclar(primarioClaro, blanco, 0.88);
  const claro = {
    '--color-primary': primarioClaro,
    '--color-primary-light': mezclar(primarioClaro, blanco, 0.12),
    '--color-primary-dark': mezclar(primarioClaro, '#000000', 0.25),
    '--color-on-primary': textoSobre(primarioClaro, blanco),
    '--color-sidebar': sidebar,
    '--color-sidebar-item': mezclar(sidebar, blanco, 0.08),
    '--color-gold': acento,
    '--color-gold-light': mezclar(acento, blanco, 0.25),
    '--color-gold-dark': mezclar(acento, '#000000', 0.12),
    '--color-on-gold': textoSobre(acento, sidebar),
    '--color-gold-text': ajustarContraste(acento, blanco, 4.5),
    '--badge-info-bg': infoBg,
    '--badge-info-fg': ajustarContraste(primarioClaro, infoBg, 4.5),
    '--marca-primario': sidebar,
    '--marca-acento': acento,
  };

  // ── Oscuro ── (fondos con el tono del primario y poca luz)
  const [h, s] = rgbAHsl(primario);
  const tono = tenirModoOscuro ? h : 220;
  const sat = tenirModoOscuro ? limitar(s, 0.15, 0.6) : 0.12;
  const fondo = (l, ajusteSat = 1) => hslAHex(tono, sat * ajusteSat, l);
  const surface = fondo(0.15);
  const acentoOscuro = ajustarContraste(acento, surface, 4.5);
  const oscuro = {
    '--color-bg-base': fondo(0.075),
    '--color-surface': surface,
    '--color-surface-2': fondo(0.17),
    '--color-surface-3': fondo(0.21),
    '--color-sidebar': fondo(0.11),
    '--color-sidebar-item': fondo(0.16),
    '--color-border': fondo(0.3, 0.9),
    '--color-border-light': fondo(0.25, 0.9),
    '--color-text': hslAHex(tono, 0.4, 0.94),
    '--color-text-dim': hslAHex(tono, 0.3, 0.8),
    '--color-text-muted': ajustarContraste(hslAHex(tono, 0.25, 0.66), fondo(0.21), 4.5),
    '--color-primary': acentoOscuro,
    '--color-primary-light': mezclar(acentoOscuro, blanco, 0.2),
    '--color-primary-dark': mezclar(acentoOscuro, '#000000', 0.1),
    '--color-on-primary': textoSobre(acentoOscuro, fondo(0.15)),
    '--color-gold': acentoOscuro,
    '--color-gold-light': mezclar(acentoOscuro, blanco, 0.25),
    '--color-gold-dark': mezclar(acentoOscuro, '#000000', 0.1),
    '--color-on-gold': textoSobre(acentoOscuro, fondo(0.15)),
    '--color-gold-text': ajustarContraste(mezclar(acentoOscuro, blanco, 0.2), surface, 4.5),
    '--badge-info-bg': fondo(0.24),
    '--badge-info-fg': ajustarContraste(hslAHex(tono, 0.6, 0.8), fondo(0.24), 4.5),
    '--marca-primario': sidebar,
    '--marca-acento': acento,
  };
  return { claro, oscuro };
};

const bloque = (selector, variables) => `${selector}{${Object.entries(variables).map(([k, v]) => `${k}:${v}`).join(';')}}`;

/**
 * CSS que sobrescribe la paleta. Se usa `html:root` (más específico que el
 * `:root` de index.css) para ganar sin depender del orden de carga.
 * Devuelve '' con los colores de fábrica.
 */
export const cssDeMarca = (colores) => {
  if (!colores || esColorFabrica(colores)) return '';
  const { claro, oscuro } = generarVariables(colores);
  return `${bloque('html:root', claro)}${bloque('html:root[data-theme="dark"]', oscuro)}`;
};

const ID_ESTILO = 'tema-marca';

export const aplicarCssDeMarca = (css) => {
  let estilo = document.getElementById(ID_ESTILO);
  if (!css) { estilo?.remove(); return; }
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = ID_ESTILO;
    document.head.appendChild(estilo);
  }
  if (estilo.textContent !== css) estilo.textContent = css;
};
