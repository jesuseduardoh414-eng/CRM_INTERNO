/**
 * Arma el HTML de un correo a partir de la configuracion (marca, colores,
 * diseño y textos propios) y del catalogo de plantillas. Funcion pura: no
 * lee la base ni envia nada, asi sirve igual para enviar y para la vista
 * previa del panel.
 *
 * El HTML usa tablas y estilos en linea: es lo unico que Gmail, Outlook y
 * Apple Mail muestran igual. Todo texto que viene de la configuracion o de
 * las variables se escapa; lo unico que se interpreta es **negrita**.
 */
const { escapeHtml } = require('./security.utils');
const { PLANTILLAS_POR_ID, camposDe } = require('./plantillasCorreo');

const PIE_FABRICA = 'Correo automático de {sistema}. No respondas a este mensaje.';
const FUENTE = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";

/** Texto oscuro o blanco segun la luminosidad del fondo. */
const textoSobre = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  const canal = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  return lum > 0.45 ? '#0f172a' : '#ffffff';
};

const reemplazar = (texto, vars, escapar) => String(texto || '').replace(/\{(\w+)\}/g, (original, clave) => (
  Object.prototype.hasOwnProperty.call(vars, clave) ? (escapar ? escapeHtml(String(vars[clave])) : String(vars[clave])) : original
));

/** Texto de la configuracion -> HTML seguro (variables escapadas, **negrita**). */
const aHtml = (texto, vars) => reemplazar(escapeHtml(texto), vars, true)
  .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br>');

/** Texto plano de una sola linea (asunto, texto oculto de la bandeja). */
const aPlano = (texto, vars) => reemplazar(texto, vars, false)
  .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const describirContexto = (contexto, zona) => {
  if (!contexto) return null;
  const fecha = contexto.fecha ? new Date(contexto.fecha) : new Date();
  const cuando = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: zona }).format(fecha);
  const partes = [`<strong>Fecha:</strong> ${escapeHtml(cuando)} (${escapeHtml(zona.replace(/_/g, ' '))})`];
  if (contexto.ip) partes.push(`<strong>IP:</strong> ${escapeHtml(contexto.ip)}`);
  if (contexto.userAgent) partes.push(`<strong>Navegador:</strong> ${escapeHtml(String(contexto.userAgent).slice(0, 160))}`);
  return partes.join('<br>');
};

/** Textos efectivos de una plantilla: los del panel o, si faltan, los de fabrica. */
const textosDe = (config, plantilla) => {
  const propios = config.textosCorreo?.[plantilla.id] || {};
  return Object.fromEntries(camposDe(plantilla).map((campo) => [campo, propios[campo] || plantilla[campo] || null]));
};

/**
 * @param {object} opciones
 * @param {object} opciones.config   configuracion completa (validada)
 * @param {string} opciones.id       id de la plantilla (plantillasCorreo.js)
 * @param {object} opciones.vars     variables propias de la plantilla
 * @param {object} opciones.extras   { url, codigo, contexto }
 * @param {string} [opciones.logoSrc] src de la imagen del logo (cid: o data:); null = texto
 * @returns {{ asunto: string, html: string }}
 */
const renderizar = ({ config, id, vars = {}, extras = {}, logoSrc = null, zonaHoraria = 'America/Mexico_City' }) => {
  const plantilla = PLANTILLAS_POR_ID[id];
  if (!plantilla) throw new Error(`Plantilla de correo desconocida: ${id}`);

  const { marca, colores } = config;
  const d = config.disenoCorreo;
  const todas = { sistema: marca.nombreSistema, empresa: marca.nombreEmpresa, ...vars };
  const textos = textosDe(config, plantilla);

  const primario = colores.primario;
  const acento = colores.acento;
  const colorBoton = d.colorBoton || primario;
  const radio = d.esquinas === 'rectas' ? 0 : 16;
  const radioCaja = d.esquinas === 'rectas' ? 0 : 12;
  const radioBoton = { recto: 0, pildora: 999, redondeado: 10 }[d.boton] ?? 10;
  const alinear = d.alineacion === 'centro' ? 'center' : 'left';

  // ── Cabecera ──
  const fondoCabecera = d.cabecera === 'color' ? primario : '#ffffff';
  const tintaCabecera = d.cabecera === 'color' ? textoSobre(primario) : primario;
  const marcaTexto = `
    <div style="font-size:18px;font-weight:700;letter-spacing:0.32em;color:${tintaCabecera};">${escapeHtml(marca.nombreCorto.toUpperCase())}</div>
    <div style="font-size:10px;letter-spacing:0.28em;color:${d.cabecera === 'color' ? acento : '#64748b'};margin-top:4px;">${escapeHtml(marca.nombreEmpresa.toUpperCase())}</div>`;
  const marcaLogo = logoSrc
    ? `<img src="${logoSrc}" alt="${escapeHtml(marca.nombreSistema)}" height="${d.logoAltura}" style="display:inline-block;height:${d.logoAltura}px;width:auto;max-width:260px;border:0;outline:none;text-decoration:none;">`
    : marcaTexto;
  const cabecera = `
    ${d.cabecera === 'franja' ? `<tr><td style="height:6px;line-height:6px;font-size:0;background:${primario};">&nbsp;</td></tr>` : ''}
    <tr><td style="background:${fondoCabecera};padding:24px 32px;text-align:${alinear};${d.cabecera !== 'color' ? 'border-bottom:1px solid #e2e8f0;' : ''}">${marcaLogo}</td></tr>
    ${d.cabecera !== 'franja' ? `<tr><td style="height:3px;line-height:3px;font-size:0;background:${acento};">&nbsp;</td></tr>` : ''}`;

  // ── Cuerpo ──
  const parrafos = String(textos.cuerpo || '').split(/\n\s*\n/).filter((p) => p.trim());
  const htmlParrafos = parrafos.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${aHtml(p.trim(), todas)}</p>`);
  const contexto = plantilla.extras.contexto ? describirContexto(extras.contexto, zonaHoraria) : null;
  if (contexto) {
    htmlParrafos.push(`<p style="margin:0 0 14px;padding:12px 14px;border-radius:${radioCaja ? 8 : 0}px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;line-height:1.6;color:#475569;">${contexto}</p>`);
  }

  const codigo = plantilla.extras.codigo && extras.codigo ? `
    <div style="margin:24px 0;text-align:center;">
      <div style="display:inline-block;padding:16px 28px;border-radius:${radioCaja}px;background:#f8fafc;border:1px solid #e2e8f0;font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.4em;color:${primario};">${escapeHtml(extras.codigo)}</div>
    </div>` : '';

  const url = plantilla.extras.boton && extras.url ? escapeHtml(extras.url) : null;
  const boton = url && textos.boton ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
      <tr><td style="border-radius:${radioBoton}px;background:${colorBoton};">
        <a href="${url}" style="display:inline-block;padding:14px 28px;border-radius:${radioBoton}px;background:${colorBoton};color:${textoSobre(colorBoton)};font-family:${FUENTE};font-size:15px;font-weight:600;text-decoration:none;">${aHtml(textos.boton, todas)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#64748b;">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all;color:${primario};">${url}</span></p>` : '';

  const nota = textos.nota
    ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">${aHtml(textos.nota, todas)}</p>`
    : '';

  // ── Pie ──
  const sitio = d.sitioWeb ? `<a href="${escapeHtml(d.sitioWeb)}" style="color:#64748b;text-decoration:underline;">${escapeHtml(d.sitioWeb.replace(/^https?:\/\//, ''))}</a>` : null;
  const contacto = [d.direccion && escapeHtml(d.direccion), d.telefono && escapeHtml(d.telefono), sitio].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const pie = `
    <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">${aHtml(d.pieTexto || PIE_FABRICA, todas)}</p>
    ${contacto ? `<p style="margin:6px 0 0;font-size:11px;line-height:1.6;color:#94a3b8;">${contacto}</p>` : ''}
    ${d.textoLegal ? `<p style="margin:10px 0 0;font-size:10px;line-height:1.5;color:#a3adbb;">${aHtml(d.textoLegal, todas)}</p>` : ''}`;

  const asunto = aPlano(textos.asunto, todas).slice(0, 200);
  const preencabezado = escapeHtml(aPlano(parrafos[0] || textos.titulo, todas).slice(0, 140));

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${d.colorFondo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preencabezado}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${d.colorFondo};">
  <tr><td align="center" style="padding:32px 12px;font-family:${FUENTE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:${radio}px;overflow:hidden;border-collapse:separate;">
      ${cabecera}
      <tr><td style="padding:32px;font-family:${FUENTE};">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${primario};font-family:${FUENTE};">${aHtml(textos.titulo, todas)}</h1>
        ${htmlParrafos.join('\n        ')}
        ${codigo}
        ${boton}
        ${nota}
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:16px 24px 0;text-align:center;font-family:${FUENTE};">${pie}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Version en texto plano: los filtros de spam desconfian de los correos que
  // solo traen HTML, y algunos clientes la muestran en vez del HTML.
  const contextoPlano = contexto ? contexto.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : null;
  const conSaltos = (txt) => reemplazar(txt, todas, false).replace(/\*\*([^*\n]+?)\*\*/g, '$1').trim();
  const texto = [
    marca.nombreSistema.toUpperCase(),
    '',
    conSaltos(textos.titulo),
    '',
    ...parrafos.map((p) => `${conSaltos(p)}\n`),
    contextoPlano ? `${contextoPlano}\n` : null,
    plantilla.extras.codigo && extras.codigo ? `Código: ${extras.codigo}\n` : null,
    plantilla.extras.boton && extras.url && textos.boton ? `${conSaltos(textos.boton)}: ${extras.url}\n` : null,
    textos.nota ? `${conSaltos(textos.nota)}\n` : null,
    '—',
    conSaltos(d.pieTexto || PIE_FABRICA),
    [d.direccion, d.telefono, d.sitioWeb].filter(Boolean).join(' · ') || null,
    d.textoLegal ? conSaltos(d.textoLegal) : null,
  ].filter((linea) => linea !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { asunto, html, texto };
};

module.exports = { renderizar, textoSobre, PIE_FABRICA };
