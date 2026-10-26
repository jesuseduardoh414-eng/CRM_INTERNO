// Google Calendar de cada persona, sincronizado en los dos sentidos.
//
// Al conectar, el CRM crea en el Google de la persona un calendario aparte
// (con el nombre del sistema, p. ej. "OMNIS CRM") y mueve ahi los eventos que
// ya estaban sincronizados en su calendario principal. Desde entonces:
//   - CRM -> Google: crear, editar o borrar un evento propio en el CRM lo
//     escribe en ese calendario (syncEventoToGoogle / deleteEventoFromGoogle).
//   - Google -> CRM: lo que se crea, edita o borra en ese calendario desde
//     Google entra al CRM (sincronizarDesdeGoogle), con la marca incremental de
//     Google (syncToken): cada 5 minutos para todos y al abrir la agenda.
// El calendario principal (eventos personales) no se toca. Para no rebotar los
// cambios, cada evento guarda el etag de la ultima version que el CRM escribio
// o leyo: si lo que llega de Google trae ese mismo etag, es el eco del CRM. Si
// los dos lados cambiaron, gana el ultimo cambio.
const prisma = require('../lib/prisma');
const contexto = require('../lib/contexto');
const { cifrar, descifrar } = require('../utils/cifrado.utils');
const { zonaHoraria, desfaseMs, partesDiaMexico, instanteLocal, claveDiaMexico } = require('../utils/fechas.utils');

// En pruebas se apuntan a un Google falso.
const OAUTH = process.env.GOOGLE_OAUTH_URL_PRUEBA || 'https://oauth2.googleapis.com';
const GOOGLE_TOKEN_URL = `${OAUTH}/token`;
const GOOGLE_REVOKE_URL = `${OAUTH}/revoke`;
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL_PRUEBA || 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CALENDAR_API = process.env.GOOGLE_CALENDAR_URL_PRUEBA || 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPE = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
].join(' ');

const DAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Separa, en la descripcion que va a Google, lo que escribio la persona de los
// datos que agrega el CRM (instrucciones, proyecto, enlace). Al volver de
// Google solo se toma lo de arriba. 'Sincronizado desde CRM' es el formato
// anterior (antes del 2026-10-20).
const MARCA_DATOS = '— Sincronizado desde CRM —';
const MARCA_ANTERIOR = 'Sincronizado desde CRM';
const INTERVALO_SYNC_MS = 5 * 60 * 1000;
const DIAS_PENDIENTES = 30;
const MAX_PENDIENTES = 300;

const enc = encodeURIComponent;
const configuracion = () => require('./configuracion.service').configEnCache();

// Ademas de las credenciales, el modulo debe estar encendido en el panel
// (si se apaga, los eventos dejan de sincronizarse).
// Credenciales OAuth: las del panel de configuracion (secreto cifrado) y, si
// no hay, las del .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
const credencialesGoogle = () => {
  const g = configuracion().google || {};
  let secreto = null;
  if (g.clientId && g.secretCifrado) {
    try { secreto = require('../utils/cifrado.utils').descifrar(g.secretCifrado); } catch (_e) { secreto = null; }
  }
  return g.clientId && secreto
    ? { clientId: g.clientId, clientSecret: secreto }
    : { clientId: process.env.GOOGLE_CLIENT_ID || null, clientSecret: process.env.GOOGLE_CLIENT_SECRET || null };
};

const isGoogleCalendarConfigured = () => {
  const { clientId, clientSecret } = credencialesGoogle();
  return Boolean(clientId && clientSecret)
    && configuracion().modulos?.googleCalendar !== false;
};

// ── Fechas ──────────────────────────────────────────────────────────────────

const toGoogleDateTime = (date) => ({
  dateTime: new Date(date).toISOString(),
  timeZone: zonaHoraria(),
});

/** 'YYYY-MM-DD' del dia siguiente a un 'YYYY-MM-DD'. */
const diaSiguiente = (clave) => {
  const [y, m, d] = clave.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// Un evento de todo el dia se guarda de 00:00 a 23:59 del dia local (lo que
// manda la agenda). Antes se tomaba el dia en UTC y en Mexico el final caia un
// dia despues (23:59 local = 05:59 UTC del dia siguiente).
const toGoogleAllDayRange = (inicio, fin) => ({
  start: { date: claveDiaMexico(new Date(inicio)) },
  end: { date: diaSiguiente(claveDiaMexico(new Date(fin || inicio))) },
});

const partesDeClave = (clave) => {
  const [year, month, day] = clave.split('-').map(Number);
  return { year, month: month - 1, day };
};

/** 'HH:MM' local (zona de la empresa) de un instante. */
const horaLocal = (instante) => {
  const t = new Date(instante).getTime();
  const local = new Date(t - desfaseMs(t));
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
};

/** 0 = domingo … 6 = sabado, del dia local de un instante. */
const diaSemanaLocal = (instante) => {
  const { year, month, day } = partesDiaMexico(instante);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
};

// ── CRM -> Google: el evento como lo pide Google ─────────────────────────────

const buildRecurrenceRule = (evento) => {
  if (!evento.esRecurrente || !evento.patronRecurrencia) return [];

  try {
    const patron = typeof evento.patronRecurrencia === 'string'
      ? JSON.parse(evento.patronRecurrencia)
      : evento.patronRecurrencia;

    const dias = Array.isArray(patron?.dias)
      ? patron.dias.map((dia) => DAY_CODE[dia]).filter(Boolean)
      : [];

    if (dias.length === 0) return [];

    const parts = ['RRULE:FREQ=WEEKLY', `BYDAY=${dias.join(',')}`];
    if (evento.fechaFinRecurr) {
      const untilDate = new Date(evento.fechaFinRecurr);
      untilDate.setUTCHours(23, 59, 59, 999);
      const until = untilDate
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
      parts.push(`UNTIL=${until}`);
    }

    return [parts.join(';')];
  } catch (error) {
    console.warn('[google-calendar] No se pudo construir la recurrencia:', error.message);
    return [];
  }
};

// Nota que deja en la descripcion un evento repetido de Google que el CRM no
// sabe repetir (recurrenciaDesdeGoogle): mientras este, no se toca su RRULE.
const NOTA_RECURRENCIA = 'En Google este evento se repite';

/**
 * Evento del CRM -> cuerpo para Google. Con `parcial` (para PATCH sobre un
 * evento que ya existe) se manda null en lo que el CRM quito, para que Google
 * lo borre, y no se mandan los invitados si el CRM no tiene: asi se conservan
 * los que se agregaron en Google, igual que el enlace de Meet o el color.
 */
const buildGoogleEventPayload = (evento, { parcial = false } = {}) => {
  const attendees = (evento.invitados || [])
    .map((invitado) => invitado?.usuario?.email)
    .filter((email) => !!email && email !== evento.usuario?.email)
    .map((email) => ({ email }));

  const datosCrm = [
    evento.instruccionesAcceso ? `Instrucciones: ${evento.instruccionesAcceso}` : null,
    evento.proyecto?.nombre ? `Proyecto: ${evento.proyecto.nombre}` : null,
    evento.urlReunion ? `Enlace: ${evento.urlReunion}` : null,
  ].filter(Boolean);

  const vacio = parcial ? null : undefined;
  const payload = {
    summary: evento.titulo,
    description: [evento.descripcion, MARCA_DATOS, ...datosCrm].filter(Boolean).join('\n\n'),
    location: (evento.modalidad === 'presencial' && evento.ubicacion) || vacio,
    attendees: attendees.length > 0 ? attendees : undefined,
    reminders: evento.alertaMinutos
      ? { useDefault: false, overrides: [{ method: 'popup', minutes: evento.alertaMinutos }] }
      : { useDefault: true },
    extendedProperties: {
      private: {
        crmEventId: evento.id,
        crmTipo: evento.tipo,
      },
    },
  };

  if (evento.todoElDia) {
    Object.assign(payload, toGoogleAllDayRange(evento.fechaInicio, evento.fechaFin));
  } else {
    payload.start = toGoogleDateTime(evento.fechaInicio);
    payload.end = toGoogleDateTime(evento.fechaFin || evento.fechaInicio);
  }

  const recurrence = buildRecurrenceRule(evento);
  if (recurrence.length > 0) payload.recurrence = recurrence;
  else if (parcial && !String(evento.descripcion || '').includes(NOTA_RECURRENCIA)) payload.recurrence = null;

  return payload;
};

// ── Google -> CRM: el evento de Google como datos del CRM ────────────────────

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * Descripcion de Google -> descripcion del CRM: sin el HTML que pone el editor
 * de Google Calendar y sin los datos que agrega el CRM (de la marca para abajo).
 */
const limpiarDescripcion = (texto) => {
  if (!texto) return null;
  let s = String(texto)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTIDADES[m]);
  const parrafos = s.split(/\n{2,}/);
  const corte = parrafos.findIndex((p) => p.trim() === MARCA_DATOS || p.trim() === MARCA_ANTERIOR);
  if (corte >= 0) {
    // Formato anterior: los datos del CRM iban antes de 'Sincronizado desde CRM'.
    s = parrafos.slice(0, corte)
      .filter((p) => !/^(Instrucciones|Proyecto|Enlace): /.test(p.trim()))
      .join('\n\n');
  }
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s || null;
};

/** 'YYYYMMDD' o 'YYYYMMDDTHHMMSSZ' (UNTIL de una RRULE) -> fin de ese dia local. */
const finDeUntil = (until) => {
  const m = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until || '');
  if (!m) return null;
  const partes = m[4]
    ? partesDiaMexico(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[5], +m[6], +m[7])))
    : { year: +m[1], month: +m[2] - 1, day: +m[3] };
  return instanteLocal(partes, 23, 59);
};

/**
 * RRULE de Google -> patron del CRM (semanal por dias). Lo que el CRM no sabe
 * repetir (cada 2 semanas, mensual, un numero de veces…) entra como un solo
 * evento con una nota.
 */
const recurrenciaDesdeGoogle = (recurrence, fechaInicio, fechaFin, todoElDia) => {
  const regla = (recurrence || []).find((r) => r.startsWith('RRULE:'));
  if (!regla) return {};
  const partes = Object.fromEntries(regla.slice(6).split(';').map((p) => p.split('=')));
  const simple = Number(partes.INTERVAL || 1) === 1 && !partes.COUNT;
  let dias = null;
  if (partes.FREQ === 'WEEKLY' && simple) {
    dias = partes.BYDAY
      ? partes.BYDAY.split(',').map((c) => DAY_CODE.indexOf(c.replace(/^[+-]?\d+/, ''))).filter((d) => d >= 0)
      : [diaSemanaLocal(fechaInicio)];
  } else if (partes.FREQ === 'DAILY' && simple) {
    dias = [0, 1, 2, 3, 4, 5, 6];
  }
  if (!dias || dias.length === 0) {
    return { nota: `${NOTA_RECURRENCIA} (${regla.slice(6)}); en el CRM aparece solo la primera vez.` };
  }
  let horaInicio = todoElDia ? '00:00' : horaLocal(fechaInicio);
  let horaFin = todoElDia ? '23:59' : horaLocal(fechaFin);
  if (horaFin <= horaInicio) { horaInicio = horaInicio === '23:59' ? '23:58' : horaInicio; horaFin = '23:59'; }
  return {
    patron: { tipo: 'semanal', dias: [...new Set(dias)].sort((a, b) => a - b), horaInicio, horaFin },
    hasta: partes.UNTIL ? finDeUntil(partes.UNTIL) : null,
  };
};

/** Evento de Google -> campos del modelo Evento (sin dueño ni ids). */
const datosDesdeGoogle = (item) => {
  const inicio = item.start;
  if (!inicio || (!inicio.date && !inicio.dateTime)) return null;
  const todoElDia = Boolean(inicio.date);
  let fechaInicio;
  let fechaFin;
  if (todoElDia) {
    fechaInicio = instanteLocal(partesDeClave(inicio.date), 0, 0);
    // En Google el fin de un evento de dia completo es el dia siguiente al ultimo.
    const ultimo = partesDeClave(item.end?.date || diaSiguiente(inicio.date));
    fechaFin = instanteLocal({ ...ultimo, day: ultimo.day - 1 }, 23, 59);
  } else {
    fechaInicio = new Date(inicio.dateTime);
    fechaFin = item.end?.dateTime ? new Date(item.end.dateTime) : fechaInicio;
  }
  if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) return null;

  const datos = {
    titulo: (item.summary || '(Sin título)').slice(0, 255),
    descripcion: limpiarDescripcion(item.description),
    ubicacion: item.location ? String(item.location).slice(0, 255) : null,
    fechaInicio,
    fechaFin,
    todoElDia,
  };
  if (item.reminders && !item.reminders.useDefault) {
    const aviso = (item.reminders.overrides || []).find((o) => o.method === 'popup') || item.reminders.overrides?.[0];
    datos.alertaMinutos = aviso ? Number(aviso.minutes) || null : null;
  }
  const rec = recurrenciaDesdeGoogle(item.recurrence, fechaInicio, fechaFin, todoElDia);
  datos.esRecurrente = Boolean(rec.patron);
  datos.patronRecurrencia = rec.patron ? JSON.stringify(rec.patron) : null;
  datos.fechaFinRecurr = rec.hasta || null;
  if (rec.nota) datos.descripcion = [datos.descripcion, rec.nota].filter(Boolean).join('\n\n');
  return datos;
};

// ── OAuth ────────────────────────────────────────────────────────────────────

const postForm = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'Error de Google');
    // Codigo OAuth ('invalid_grant', 'invalid_client'...) para decidir que hacer arriba
    error.code = typeof data.error === 'string' ? data.error : null;
    throw error;
  }
  return data;
};

// Deja al usuario como desconectado de Google. Se usa cuando Google ya no
// acepta el refresh token (revocado, caducado, contrasena cambiada): seguir
// guardandolo solo producia errores en cada sincronizacion y `getConnectionStatus`
// decia "conectado" sin serlo.
const limpiarTokensGoogle = async (usuarioId) => {
  try {
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        // El correo se conserva a proposito: con el, `getConnectionStatus`
        // devuelve `desconectado` + `email` y el frontend puede decir
        // "la conexion caduco, vuelve a conectar" en vez de "no conectado".
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
        googleCalendarSyncToken: null,
      },
    });
  } catch (error) {
    console.warn('[google-calendar] No se pudieron limpiar los tokens:', error.message);
  }
};

// Los tokens de Google se guardan cifrados (cifrado.utils, como los de Drive):
// con la base o un respaldo no se llega al calendario de nadie. Los guardados
// antes en claro se leen tal cual y quedan cifrados en la siguiente
// renovacion (cada hora como mucho, con la sincronizacion).
const leerToken = (valor) => {
  if (!valor || !String(valor).startsWith('v1:')) return valor || null;
  try {
    return descifrar(valor);
  } catch (_error) {
    return null; // clave cambiada: como si no estuviera conectado
  }
};
const conTokensLegibles = (usuario) => usuario && {
  ...usuario,
  googleAccessToken: leerToken(usuario.googleAccessToken),
  googleRefreshToken: leerToken(usuario.googleRefreshToken),
};

const saveGoogleTokens = async (usuarioId, tokenData) => {
  const accessToken = tokenData.access_token || null;
  const refreshToken = tokenData.refresh_token || null;
  const expiresIn = Number(tokenData.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + Math.max(expiresIn - 60, 0) * 1000) : null;
  const profile = accessToken
    ? await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((res) => res.ok ? res.json() : null).catch(() => null)
    : null;

  return prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      googleCalendarEmail: profile?.email || undefined,
      googleAccessToken: accessToken ? cifrar(accessToken) : null,
      googleRefreshToken: refreshToken ? cifrar(refreshToken) : undefined,
      googleTokenExpiresAt: expiresAt,
    },
    select: {
      googleCalendarEmail: true,
      googleTokenExpiresAt: true,
      googleRefreshToken: true,
    },
  });
};

const exchangeCodeForTokens = async (code) => postForm(GOOGLE_TOKEN_URL, {
  code,
  client_id: credencialesGoogle().clientId,
  client_secret: credencialesGoogle().clientSecret,
  redirect_uri: 'postmessage',
  grant_type: 'authorization_code',
});

const refreshAccessToken = async (usuario) => {
  if (!usuario.googleRefreshToken) {
    // Sin refresh token no hay forma de renovar: la conexion queda inservible
    await limpiarTokensGoogle(usuario.id);
    throw new Error('La cuenta de Google no tiene refresh token; hay que volver a conectar');
  }

  let tokenData;
  try {
    tokenData = await postForm(GOOGLE_TOKEN_URL, {
      client_id: credencialesGoogle().clientId,
      client_secret: credencialesGoogle().clientSecret,
      refresh_token: usuario.googleRefreshToken,
      grant_type: 'refresh_token',
    });
  } catch (error) {
    if (error.code === 'invalid_grant') {
      // Google revoco o caduco el refresh token: desconectar en vez de reintentar para siempre
      await limpiarTokensGoogle(usuario.id);
      const desconectado = new Error('Google revoco el acceso; hay que volver a conectar Google Calendar');
      desconectado.code = 'google_desconectado';
      throw desconectado;
    }
    throw error;
  }

  const updated = await saveGoogleTokens(usuario.id, {
    ...tokenData,
    refresh_token: usuario.googleRefreshToken,
  });

  return {
    accessToken: tokenData.access_token,
    email: updated.googleCalendarEmail || usuario.googleCalendarEmail,
  };
};

const getValidAccessToken = async (usuarioId) => {
  const usuario = conTokensLegibles(await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      id: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
      googleCalendarEmail: true,
    },
  }));

  if (!usuario?.googleAccessToken && !usuario?.googleRefreshToken) return null;

  const stillValid = usuario.googleAccessToken
    && usuario.googleTokenExpiresAt
    && usuario.googleTokenExpiresAt > new Date();

  if (stillValid) {
    return {
      accessToken: usuario.googleAccessToken,
      email: usuario.googleCalendarEmail,
    };
  }

  return refreshAccessToken(usuario);
};

// Renueva el access token sin mirar `googleTokenExpiresAt`. Google puede
// rechazar un token que segun nuestra fecha sigue vigente (revocado desde la
// cuenta, cambio de contrasena...), y `getValidAccessToken` lo devolvia tal cual.
const forzarRenovacionAccessToken = async (usuarioId) => {
  const usuario = conTokensLegibles(await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      id: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleCalendarEmail: true,
    },
  }));
  if (!usuario?.googleRefreshToken) {
    if (usuario?.googleAccessToken) await limpiarTokensGoogle(usuarioId);
    return null;
  }
  return refreshAccessToken(usuario);
};

const googleCalendarRequest = async (usuarioId, path, options = {}) => {
  const token = await getValidAccessToken(usuarioId);
  if (!token?.accessToken) return null;

  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    const refreshed = await forzarRenovacionAccessToken(usuarioId);
    if (!refreshed?.accessToken) return null;

    const retry = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${refreshed.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    return retry;
  }

  return response;
};

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Peticion a la API de Calendar: reintenta 429 y 5xx, devuelve el Response si
 * es correcto o su estado esta en `permitidos`, null si la persona no tiene
 * conexion, y lanza con el mensaje de Google en lo demas.
 */
const pedirCalendar = async (usuarioId, path, { metodo = 'GET', cuerpo, permitidos = [] } = {}) => {
  for (let intento = 1; ; intento += 1) {
    const res = await googleCalendarRequest(usuarioId, path, {
      method: metodo,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (!res) return null;
    if (res.ok || permitidos.includes(res.status)) return res;
    if ((res.status === 429 || res.status >= 500) && intento < 3) { await esperar(400 * 2 ** intento); continue; }
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.error?.message || `Google Calendar respondio ${res.status}`);
    error.status = res.status;
    throw error;
  }
};

// ── Calendario "OMNIS CRM" de cada persona ───────────────────────────────────

const nombreCalendario = () => configuracion().marca?.nombreSistema || 'OMNIS CRM';
// En la descripcion del calendario: al reconectar la misma cuenta se reconoce
// el que ya existia en vez de crear otro.
const marcaCalendario = () => {
  let host = 'crm';
  try { host = new URL(process.env.FRONTEND_URL || 'http://crm').host; } catch (_e) { /* se queda 'crm' */ }
  return `[crm-sync:${host}]`;
};

const buscarCalendarioExistente = async (usuarioId) => {
  const marca = marcaCalendario();
  let pageToken;
  do {
    const res = await pedirCalendar(usuarioId, `/users/me/calendarList?minAccessRole=owner&maxResults=250${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`);
    if (!res) return null;
    const data = await res.json();
    const encontrado = (data.items || []).find((c) => String(c.description || '').includes(marca));
    if (encontrado) return encontrado.id;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return null;
};

// Los eventos que se sincronizaron cuando todo iba al calendario principal
// pasan al del CRM (mismo id). Si ya no estan ahi, se suben de nuevo.
const moverEventosAlCalendario = async (usuarioId, calendarioId) => {
  const eventos = await prisma.evento.findMany({
    where: { usuarioId, googleCalendarEventId: { not: null } },
    select: { id: true, googleCalendarEventId: true },
  });
  for (const evento of eventos) {
    try {
      const res = await pedirCalendar(
        usuarioId,
        `/calendars/primary/events/${enc(evento.googleCalendarEventId)}/move?destination=${enc(calendarioId)}&sendUpdates=none`,
        { metodo: 'POST', permitidos: [400, 403, 404, 410] },
      );
      if (!res) return;
      if (res.ok) {
        const data = await res.json();
        await prisma.evento.update({ where: { id: evento.id }, data: { googleEtag: data.etag || null } });
        continue;
      }
      // ¿Ya estaba en el calendario del CRM (reconexion)?
      const ahi = await pedirCalendar(usuarioId, `/calendars/${enc(calendarioId)}/events/${enc(evento.googleCalendarEventId)}`, { permitidos: [404, 410] });
      if (ahi && !ahi.ok) {
        await prisma.evento.update({ where: { id: evento.id }, data: { googleCalendarEventId: null, googleEtag: null } });
      }
    } catch (error) {
      console.warn('[google-calendar] No se pudo mover el evento', evento.id, error.message);
    }
  }
};

// "Proyecto: X" son filas que pinta la agenda como bloque de proyecto
// (ver agenda.controller): no van a Google.
const esFilaDeProyecto = { titulo: { startsWith: 'Proyecto:' }, tipo: 'dia_completo' };

/** Eventos propios (recientes o futuros) que nunca llegaron a Google. */
const subirPendientes = async (usuarioId, calendario) => {
  const desde = new Date(Date.now() - DIAS_PENDIENTES * 24 * 60 * 60 * 1000);
  const eventos = await prisma.evento.findMany({
    where: {
      usuarioId,
      googleCalendarEventId: null,
      NOT: esFilaDeProyecto,
      OR: [{ fechaInicio: { gte: desde } }, { fechaFin: { gte: desde } }, { esRecurrente: true, OR: [{ fechaFinRecurr: null }, { fechaFinRecurr: { gte: desde } }] }],
    },
    select: { id: true },
    orderBy: { fechaInicio: 'asc' },
    take: MAX_PENDIENTES,
  });
  for (const evento of eventos) {
    // Con el calendario ya resuelto: pedirlo otra vez esperaria a esta misma preparacion.
    // eslint-disable-next-line no-use-before-define
    try { await syncEventoToGoogle(evento.id, calendario); } catch (error) { console.warn('[google-calendar] No se pudo subir', evento.id, error.message); }
  }
};

const prepararCalendario = async (usuarioId) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { googleCalendarCrmId: true } });
  if (usuario?.googleCalendarCrmId) {
    const res = await pedirCalendar(usuarioId, `/calendars/${enc(usuario.googleCalendarCrmId)}`, { permitidos: [404, 410] });
    if (!res) return null;
    if (res.ok) return usuario.googleCalendarCrmId;
    // Lo borraron en Google: se crea otro y se vuelve a subir lo del CRM.
    await prisma.evento.updateMany({ where: { usuarioId, googleCalendarEventId: { not: null } }, data: { googleCalendarEventId: null, googleEtag: null } });
  }

  let id = await buscarCalendarioExistente(usuarioId);
  if (!id) {
    const res = await pedirCalendar(usuarioId, '/calendars', {
      metodo: 'POST',
      cuerpo: {
        summary: nombreCalendario(),
        description: `Eventos de ${nombreCalendario()}: lo que cambies aquí se refleja en el CRM y al revés. ${marcaCalendario()}`,
        timeZone: zonaHoraria(),
      },
    });
    if (!res) return null;
    id = (await res.json()).id;
  }
  await prisma.usuario.update({ where: { id: usuarioId }, data: { googleCalendarCrmId: id, googleCalendarSyncToken: null } });
  await moverEventosAlCalendario(usuarioId, id);
  await subirPendientes(usuarioId, id);
  return id;
};

// Una sola preparacion a la vez por persona (no crear dos calendarios si la
// agenda y el temporizador llegan juntos).
const preparando = new Map();
const asegurarCalendarioCrm = (usuarioId) => {
  if (!preparando.has(usuarioId)) {
    preparando.set(usuarioId, prepararCalendario(usuarioId).finally(() => preparando.delete(usuarioId)));
  }
  return preparando.get(usuarioId);
};

// ── Estado, conectar y desconectar ───────────────────────────────────────────

const getConnectionStatus = async (usuarioId) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      googleCalendarEmail: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
      googleCalendarCrmId: true,
      googleCalendarSyncEn: true,
    },
  });

  const configured = isGoogleCalendarConfigured();
  const connected = !!(usuario?.googleRefreshToken || usuario?.googleAccessToken);
  let estado = 'desconectado';
  if (!configured) estado = 'no_configurado';
  else if (connected) estado = 'conectado';

  return {
    configured,
    connected,
    // 'conectado' | 'desconectado' | 'no_configurado'. Tras un invalid_grant los
    // tokens se borran y aqui vuelve a salir 'desconectado'.
    estado,
    email: usuario?.googleCalendarEmail || null,
    expiresAt: usuario?.googleTokenExpiresAt || null,
    calendario: usuario?.googleCalendarCrmId ? nombreCalendario() : null,
    sincronizadoEn: usuario?.googleCalendarSyncEn || null,
    clientId: credencialesGoogle().clientId,
    scope: GOOGLE_SCOPE,
  };
};

const connectGoogleCalendar = async ({ usuarioId, code }) => {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Google Calendar no esta configurado en el servidor');
  }

  const tokenData = await exchangeCodeForTokens(code);
  const usuario = await saveGoogleTokens(usuarioId, tokenData);
  // Si cambio de cuenta, el calendario y la marca de la anterior ya no sirven.
  await prisma.usuario.update({ where: { id: usuarioId }, data: { googleCalendarCrmId: null, googleCalendarSyncToken: null } });

  // Crear el calendario, mover lo anterior y la primera lectura pueden tardar
  // con muchos eventos: siguen en segundo plano.
  // eslint-disable-next-line no-use-before-define
  setImmediate(() => { sincronizarDesdeGoogle(usuarioId).catch((error) => console.warn('[google-calendar] Primera sincronizacion:', error.message)); });

  return {
    connected: true,
    email: usuario.googleCalendarEmail || null,
    expiresAt: usuario.googleTokenExpiresAt || null,
    calendario: nombreCalendario(),
  };
};

const disconnectGoogleCalendar = async (usuarioId) => {
  const usuario = conTokensLegibles(await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { googleAccessToken: true, googleRefreshToken: true },
  }));

  const token = usuario?.googleRefreshToken || usuario?.googleAccessToken;
  if (token) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (error) {
      console.warn('[google-calendar] No se pudo revocar el token:', error.message);
    }
  }

  // El calendario se queda en Google (es de la persona); al reconectar la misma
  // cuenta se reconoce por su descripcion.
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      googleCalendarEmail: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
      googleCalendarCrmId: null,
      googleCalendarSyncToken: null,
    },
  });
};

// ── CRM -> Google ────────────────────────────────────────────────────────────

const getEventoForSync = async (eventoId) => prisma.evento.findUnique({
  where: { id: eventoId },
  include: {
    usuario: { select: { id: true, email: true, nombre: true } },
    proyecto: { select: { id: true, nombre: true } },
    invitados: {
      include: {
        usuario: { select: { id: true, email: true, nombre: true } },
      },
    },
  },
});

/**
 * Escribe un evento propio en el calendario del CRM de su dueño (lo crea o lo
 * actualiza). `calendario` solo lo pasa quien ya lo resolvio (la preparacion
 * del calendario y la lectura de cambios).
 */
const syncEventoToGoogle = async (eventoId, calendarioConocido = null) => {
  const evento = await getEventoForSync(eventoId);
  if (!evento) return null;

  const connection = await getValidAccessToken(evento.usuarioId);
  if (!connection?.accessToken) return null;

  const calendario = calendarioConocido || await asegurarCalendarioCrm(evento.usuarioId);
  if (!calendario) return null;

  let res = null;
  if (evento.googleCalendarEventId) {
    res = await pedirCalendar(
      evento.usuarioId,
      `/calendars/${enc(calendario)}/events/${enc(evento.googleCalendarEventId)}?sendUpdates=none`,
      { metodo: 'PATCH', cuerpo: buildGoogleEventPayload(evento, { parcial: true }), permitidos: [404, 410] },
    );
    // Ya no existe en Google (se borro alla y aun no se leyo): el cambio del CRM
    // es mas nuevo, se crea de nuevo.
    if (res && !res.ok) res = null;
  }
  if (!res) {
    res = await pedirCalendar(evento.usuarioId, `/calendars/${enc(calendario)}/events?sendUpdates=none`, { metodo: 'POST', cuerpo: buildGoogleEventPayload(evento) });
  }
  if (!res) return null;

  const data = await res.json().catch(() => ({}));
  await prisma.evento.update({
    where: { id: evento.id },
    data: { googleCalendarEventId: data.id || evento.googleCalendarEventId, googleEtag: data.etag || null },
  });
  return data;
};

const deleteEventoFromGoogle = async (evento) => {
  if (!evento?.googleCalendarEventId || !evento?.usuarioId) return;
  const usuario = await prisma.usuario.findUnique({ where: { id: evento.usuarioId }, select: { googleCalendarCrmId: true } });
  // Antes del calendario del CRM todo iba al principal.
  const calendarios = [usuario?.googleCalendarCrmId, 'primary'].filter(Boolean);
  for (const calendario of calendarios) {
    const res = await pedirCalendar(
      evento.usuarioId,
      `/calendars/${enc(calendario)}/events/${enc(evento.googleCalendarEventId)}?sendUpdates=none`,
      { metodo: 'DELETE', permitidos: [404, 410] },
    );
    if (!res || res.ok) return;
  }
};

// ── Google -> CRM ────────────────────────────────────────────────────────────

const COLOR_EVENTO = '#2563eb';

/** Aplica un evento que cambio en Google. Devuelve 1 si cambio algo en el CRM. */
const aplicarCambioDeGoogle = async (usuarioId, item, calendario) => {
  // Una ocurrencia editada suelta dentro de una serie: el CRM no guarda
  // excepciones por ocurrencia.
  if (item.recurringEventId) return 0;

  let evento = await prisma.evento.findFirst({ where: { usuarioId, googleCalendarEventId: item.id } });
  const crmId = item.extendedProperties?.private?.crmEventId;
  if (!evento && crmId) evento = await prisma.evento.findFirst({ where: { id: crmId, usuarioId } });

  if (item.status === 'cancelled') {
    if (!evento) return 0;
    // A la papelera del CRM con sus archivos. Al usarlo: papelera llega a
    // drive.service, que carga este archivo.
    const papelera = require('./papelera.service'); // eslint-disable-line global-require
    const completo = await prisma.evento.findUnique({ where: { id: evento.id }, include: { adjuntos: true, invitados: { select: { usuarioId: true, estado: true } } } });
    await papelera.conPapelera({
      tipo: 'evento', modulo: 'agenda', entidadId: evento.id, nombre: evento.titulo, contexto: 'Cancelado en Google Calendar',
      datos: completo, archivos: (completo?.adjuntos || []).map(papelera.archivoDeAdjunto), origen: 'calendar',
    }, () => prisma.evento.delete({ where: { id: evento.id } }));
    return 1;
  }
  if (evento?.googleEtag && evento.googleEtag === item.etag) return 0;

  const datos = datosDesdeGoogle(item);
  if (!datos) return 0;

  if (evento) {
    // Cambio en el CRM que no llego a Google (p. ej. sin conexion): gana el mas nuevo.
    if (evento.googleEtag && item.updated && evento.actualizadoEn > new Date(item.updated)) {
      await syncEventoToGoogle(evento.id, calendario);
      return 0;
    }
    const tipo = datos.todoElDia ? evento.tipo : (evento.tipo === 'dia_completo' ? 'evento' : evento.tipo);
    await prisma.evento.update({
      where: { id: evento.id },
      data: { ...datos, tipo, googleCalendarEventId: item.id, googleEtag: item.etag || null },
    });
    return 1;
  }

  await prisma.evento.create({
    data: {
      ...datos,
      usuarioId,
      creadoPorId: usuarioId,
      tipo: datos.todoElDia ? 'dia_completo' : 'evento',
      color: COLOR_EVENTO,
      googleCalendarEventId: item.id,
      googleEtag: item.etag || null,
      // Como al crearlo en la agenda: el dueño siempre va como invitado aceptado.
      invitados: { create: [{ usuarioId, estado: 'aceptado' }] },
    },
  });
  return 1;
};

const leerCambios = async (usuarioId, calendario, syncToken) => {
  let pageToken;
  let cambios = 0;
  let siguiente = null;
  do {
    const params = new URLSearchParams({ maxResults: '250', showDeleted: 'true' });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await pedirCalendar(usuarioId, `/calendars/${enc(calendario)}/events?${params}`, { permitidos: [410] });
    if (!res) return null;
    if (res.status === 410) return { caducado: true };
    const data = await res.json();
    for (const item of data.items || []) {
      try {
        cambios += await aplicarCambioDeGoogle(usuarioId, item, calendario);
      } catch (error) {
        console.warn('[google-calendar] No se pudo aplicar el cambio', item.id, error.message);
      }
    }
    pageToken = data.nextPageToken;
    siguiente = data.nextSyncToken || siguiente;
  } while (pageToken);
  return { cambios, syncToken: siguiente };
};

const leyendo = new Map();

/**
 * Trae lo que cambio en el calendario del CRM de la persona desde la ultima
 * vez y lo aplica. Devuelve { cambios } (null si no tiene Google conectado).
 */
const sincronizarDesdeGoogle = (usuarioId) => {
  if (!leyendo.has(usuarioId)) {
    const trabajo = (async () => {
      if (!isGoogleCalendarConfigured()) return null;
      const token = await getValidAccessToken(usuarioId);
      if (!token?.accessToken) return null;
      const calendario = await asegurarCalendarioCrm(usuarioId);
      if (!calendario) return null;
      const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true, googleCalendarSyncToken: true } });
      // Lo que llega de Google lo hizo la persona en su Google Calendar.
      const leer = (token) => contexto.ejecutar({ origen: 'calendar', usuario: { id: usuarioId, nombre: usuario?.nombre || null } }, () => leerCambios(usuarioId, calendario, token));
      let resultado = await leer(usuario?.googleCalendarSyncToken || null);
      // Google invalida la marca a veces (410): se vuelve a leer todo.
      if (resultado?.caducado) resultado = await leer(null);
      if (!resultado || resultado.caducado) return null;
      await prisma.usuario.update({
        where: { id: usuarioId },
        data: { googleCalendarSyncToken: resultado.syncToken, googleCalendarSyncEn: new Date() },
      });
      return { cambios: resultado.cambios };
    })().finally(() => leyendo.delete(usuarioId));
    leyendo.set(usuarioId, trabajo);
  }
  return leyendo.get(usuarioId);
};

let temporizador = null;
let corriendo = false;

const sincronizarTodos = async () => {
  if (corriendo || !isGoogleCalendarConfigured()) return;
  corriendo = true;
  try {
    const usuarios = await prisma.usuario.findMany({ where: { googleRefreshToken: { not: null } }, select: { id: true } });
    for (const { id } of usuarios) {
      try { await sincronizarDesdeGoogle(id); } catch (error) { console.warn('[google-calendar] Sincronizacion de', id, error.message); }
    }
  } finally {
    corriendo = false;
  }
};

/** Cada 5 minutos lee los cambios de Google de todas las personas conectadas. */
const iniciarSincronizacionCalendar = () => {
  if (temporizador || process.env.GOOGLE_CALENDAR_SYNC === 'off') return;
  temporizador = setInterval(() => { sincronizarTodos().catch(() => {}); }, INTERVALO_SYNC_MS);
  temporizador.unref?.();
  setTimeout(() => { sincronizarTodos().catch(() => {}); }, 30 * 1000).unref?.();
};

module.exports = {
  credencialesGoogle,
  GOOGLE_SCOPE,
  isGoogleCalendarConfigured,
  getConnectionStatus,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  syncEventoToGoogle,
  deleteEventoFromGoogle,
  sincronizarDesdeGoogle,
  iniciarSincronizacionCalendar,
  // Funciones puras, exportadas para poder probarlas sin Google
  buildGoogleEventPayload,
  datosDesdeGoogle,
  limpiarDescripcion,
  recurrenciaDesdeGoogle,
  toGoogleAllDayRange,
};
