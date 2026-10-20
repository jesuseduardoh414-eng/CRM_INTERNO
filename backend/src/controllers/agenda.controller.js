// Controlador de Agenda Personal y Compartida
const prisma = require('../lib/prisma');
const {
  isGoogleCalendarConfigured,
  getConnectionStatus,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  syncEventoToGoogle,
  deleteEventoFromGoogle,
} = require('../services/google-calendar.service');
const { ESTADOS_PROYECTO_OCULTOS } = require('../utils/estados.utils');
const { instanteLocal, partesDiaMexico, claveDiaMexico } = require('../utils/fechas.utils');
const { cargarProyectoVisible } = require('../utils/permissions.utils');
const { puede } = require('../utils/permisosArea.utils');
const { borrarBlobs } = require('../utils/blob.utils');
const { configEnCache } = require('../services/configuracion.service');
const { categoriasVisibles } = require('../utils/finanzas.utils');

const DIAS_LABORALES_DEFAULT = [1, 2, 3, 4, 5];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Tope de dias que se aceptan en un rango (listar, dias especiales). Sin esto
// una peticion con un rango de anos recorria dia a dia y tumbaba la funcion.
const MAX_DIAS_RANGO = 366;
// Hasta cuanto tiempo adelante se buscan eventos con alerta. Cada evento aplica
// despues su propio `alertaMinutos`; esto solo acota la consulta.
const VENTANA_RECORDATORIOS_MS = 7 * ONE_DAY_MS;
// Un evento sin `alertaMinutos` guardado (filas antiguas) avisa 15 min antes;
// `alertaMinutos = 0` significa "sin alerta".
const ALERTA_MINUTOS_DEFAULT = 15;
const TIPOS_EVENTO = ['evento', 'reunion', 'recordatorio', 'dia_completo', 'actividad'];
const MODALIDADES_EVENTO = ['presencial', 'virtual'];
// Mismo catalogo que TIPOS_DIA en ModalConfiguracionAgenda.jsx
// Días personales. Los festivos y no laborables de todos van en el calendario
// de la empresa (dias_empresa); 'festivo' queda por compatibilidad.
const TIPOS_DIA_ESPECIAL = ['vacacion', 'permiso', 'descanso', 'incapacidad', 'homeoffice', 'cumpleanos', 'festivo'];
// Dias laborales como los guarda el frontend: 1 = lunes ... 7 = domingo
const DIAS_SEMANA_LABORAL = [1, 2, 3, 4, 5, 6, 7];
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGEX_FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_CATEGORIA = {
  tarea: '#16a34a',
  reunion: '#7c3aed',
  evento: '#2563eb',
  gasto: '#d97706',
};

const getColorCategoria = (tipo) => COLOR_CATEGORIA[tipo] || COLOR_CATEGORIA.evento;

/** Instante -> medianoche UTC de su dia civil en la zona de la empresa (como se guarda un @db.Date). */
const diaCivilUtc = (instante) => {
  const { year, month, day } = partesDiaMexico(instante);
  return new Date(Date.UTC(year, month, day));
};

const syncEventoBestEffort = async (eventoId) => {
  try {
    await syncEventoToGoogle(eventoId);
  } catch (error) {
    console.warn('[agenda.google.sync]', error.message);
  }
};

const deleteEventoGoogleBestEffort = async (evento) => {
  try {
    await deleteEventoFromGoogle(evento);
  } catch (error) {
    console.warn('[agenda.google.delete]', error.message);
  }
};

// ── Validacion y normalizacion de entrada ────────────────────────────────────

// Texto recortado; tolera que llegue null, un numero o cualquier otra cosa.
const textoLimpio = (valor) => {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
};
const textoOpcional = (valor) => textoLimpio(valor) || null;

// Date valida o null. `new Date('basura')` da NaN y antes se colaba hasta Prisma.
const parsearFecha = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const esUrlReunionValida = (url) => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// Las ocurrencias de un evento recurrente se identifican como "<uuid>_YYYY-MM-DD"
// y el frontend puede mandar ese id al borrar o editar. Devuelve el uuid base,
// o null si no es un id valido (antes un id mal formado reventaba en Postgres).
const idBaseEvento = (raw) => {
  const base = String(raw || '').split('_')[0];
  return REGEX_UUID.test(base) ? base : null;
};

const parsearHora = (valor, porDefecto) => {
  const texto = REGEX_HORA.test(String(valor || '')) ? String(valor) : porDefecto;
  return texto.split(':').map(Number);
};

const parsearAlertaMinutos = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const minutos = parseInt(valor, 10);
  return Number.isInteger(minutos) && minutos >= 0 ? minutos : null;
};

const parsearEnteros = (lista) => (Array.isArray(lista) ? lista : [])
  .map((valor) => parseInt(valor, 10))
  .filter((numero) => Number.isInteger(numero));

// Prisma lanza P2025 cuando update/delete no encuentra la fila.
const esErrorNoEncontrado = (error) => error?.code === 'P2025';

// Valida un rango [desde, hasta] ya parseado: fechas validas, orden correcto y
// no mas de MAX_DIAS_RANGO dias. Devuelve el mensaje de error o null.
const validarRango = (desde, hasta) => {
  if (!desde || !hasta) return 'Fechas invalidas';
  if (hasta < desde) return 'La fecha de fin debe ser posterior o igual a la de inicio';
  if (hasta.getTime() - desde.getTime() > MAX_DIAS_RANGO * ONE_DAY_MS) {
    return `El rango no puede superar ${MAX_DIAS_RANGO} dias`;
  }
  return null;
};

// Patron semanal: { tipo:'semanal', dias:[0..6] (0 = domingo), horaInicio:'HH:MM', horaFin:'HH:MM' }.
// Devuelve { patron } normalizado o { error }.
const normalizarPatronRecurrencia = (patron) => {
  if (!patron || typeof patron !== 'object') return { error: 'Patron de recurrencia requerido' };
  const dias = [...new Set(parsearEnteros(patron.dias).filter((dia) => dia >= 0 && dia <= 6))].sort((a, b) => a - b);
  if (dias.length === 0) return { error: 'El patron de recurrencia necesita al menos un dia de la semana' };
  const horaInicio = patron.horaInicio ? String(patron.horaInicio) : '00:00';
  const horaFin = patron.horaFin ? String(patron.horaFin) : '23:59';
  if (!REGEX_HORA.test(horaInicio) || !REGEX_HORA.test(horaFin)) {
    return { error: 'Las horas del patron deben tener formato HH:MM' };
  }
  if (horaFin <= horaInicio) return { error: 'La hora de fin del patron debe ser posterior a la de inicio' };
  return { patron: { tipo: 'semanal', dias, horaInicio, horaFin } };
};

// Deja solo los ids que existen en la tabla de usuarios: un id inventado
// hacia fallar la creacion anidada de invitados con un 500.
const filtrarUsuariosExistentes = async (ids) => {
  if (ids.length === 0) return [];
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids }, rol: { in: ['ADMIN', 'MIEMBRO'] } }, select: { id: true } });
  return usuarios.map((usuario) => usuario.id);
};

// `sincronizarCalendarioProyecto` (proyectos.controller) inserta una fila
// Evento "Proyecto: X" por miembro: tipo dia_completo y sin invitados (un
// evento creado por una persona siempre lleva al menos a su creador como
// invitado). La agenda ya pinta cada proyecto como bloque virtual
// `proyecto-<id>` a partir de la tabla de proyectos, asi que esas filas solo
// duplicaban, y ademas seguian saliendo cuando el proyecto terminaba o se
// borraba (quedan huerfanas con proyectoId null). Se excluyen en todas las
// consultas de eventos. Es la negacion de (dia_completo AND "Proyecto:" AND sin invitados).
const SIN_FILAS_DE_PROYECTO = {
  OR: [
    { tipo: { not: 'dia_completo' } },
    { titulo: { not: { startsWith: 'Proyecto:' } } },
    { invitados: { some: {} } },
  ],
};

// Fechas de tareas y proyectos (todo el dia): si vienen a medianoche UTC, al
// convertirlas a hora de Mexico (UTC-6) caen en el dia anterior. Se mueven a
// mediodia (o al final del dia) para que caigan en el dia correcto.
const ajustarFechaTodoElDia = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    date.setUTCHours(endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return date;
};

const getFinTareaParaDisponibilidad = (tarea) => (
  tarea.venceEn ? tarea.venceEn : new Date(tarea.fechaInicio.getTime() + ONE_DAY_MS)
);

// ── Feriados de Mexico ───────────────────────────────────────────────────────

// N-esimo lunes de un mes (mes 0-11), a medianoche UTC.
const nesimoLunes = (anio, mes, n) => {
  const primero = new Date(Date.UTC(anio, mes, 1));
  const diasHastaLunes = (8 - primero.getUTCDay()) % 7;
  return new Date(Date.UTC(anio, mes, 1 + diasHastaLunes + (n - 1) * 7));
};

// Constitucion, Natalicio de Juarez y Revolucion son lunes moviles por ley
// (primer lunes de febrero, tercer lunes de marzo y tercer lunes de noviembre);
// antes estaban clavados en el 2, el 16 y el 16. El resto son fechas fijas.
const feriadosMexico = (anio) => [
  { id: 'f1', fecha: new Date(Date.UTC(anio, 0, 1)), descripcion: 'Año Nuevo' },
  { id: 'f2', fecha: nesimoLunes(anio, 1, 1), descripcion: 'Día de la Constitución' },
  { id: 'f3', fecha: nesimoLunes(anio, 2, 3), descripcion: 'Natalicio de Benito Juárez' },
  { id: 'f4', fecha: new Date(Date.UTC(anio, 4, 1)), descripcion: 'Día del Trabajo' },
  { id: 'f5', fecha: new Date(Date.UTC(anio, 8, 16)), descripcion: 'Día de la Independencia' },
  { id: 'f6', fecha: new Date(Date.UTC(anio, 8, 20)), descripcion: 'Fundación de Monterrey' },
  { id: 'f7', fecha: nesimoLunes(anio, 10, 3), descripcion: 'Aniversario de la Revolución' },
  { id: 'f8', fecha: new Date(Date.UTC(anio, 11, 25)), descripcion: 'Navidad' },
].map((feriado) => ({ ...feriado, tipo: 'festivo' }));

// ── Utilidad: expandir evento recurrente en ocurrencias ──────────────────────
//
// Todo se calcula en dia civil de Mexico (UTC-6 fijo, igual que fechas.utils).
// El servidor corre en UTC, asi que con `setHours`/`getDay` un evento semanal
// de 09:00 salia a las 03:00 y cerca de medianoche cambiaba de dia de semana.
function expandirRecurrente(evento, desdeDate, hastaDate) {
  if (!evento.patronRecurrencia) return [];
  let patron;
  try {
    patron = typeof evento.patronRecurrencia === 'string'
      ? JSON.parse(evento.patronRecurrencia)
      : evento.patronRecurrencia;
  } catch {
    return [];
  }

  const diasSemana = parsearEnteros(patron?.dias).filter((dia) => dia >= 0 && dia <= 6); // 0 = domingo
  if (diasSemana.length === 0) return [];
  const [hi, mi] = parsearHora(patron.horaInicio, '00:00');
  const [hf, mf] = parsearHora(patron.horaFin, '23:59');

  const desde = new Date(Math.max(desdeDate.getTime(), new Date(evento.fechaInicio).getTime()));
  let hasta = new Date(hastaDate);
  if (evento.fechaFinRecurr) {
    // La fecha de fin es inclusiva y se guarda como 'YYYY-MM-DD' (medianoche UTC):
    // se lleva al final de ese dia, igual que hace el servicio de Google.
    const finRecurr = new Date(evento.fechaFinRecurr);
    finRecurr.setUTCHours(23, 59, 59, 999);
    if (finRecurr < hasta) hasta = finRecurr;
  }
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || hasta < desde) return [];

  // 00:00 Mexico de un dia civil, en milisegundos UTC
  const inicioDiaMexicoMs = (partes) => instanteLocal(partes, 0).getTime();

  const ocurrencias = [];
  const ultimoMs = inicioDiaMexicoMs(partesDiaMexico(hasta));
  let cursorMs = inicioDiaMexicoMs(partesDiaMexico(desde));
  let vueltas = 0;

  while (cursorMs <= ultimoMs && vueltas <= MAX_DIAS_RANGO) {
    const { year, month, day } = partesDiaMexico(cursorMs);
    const diaSemana = new Date(Date.UTC(year, month, day)).getUTCDay();
    if (diasSemana.includes(diaSemana)) {
      ocurrencias.push({
        ...evento,
        id: `${evento.id}_${claveDiaMexico(cursorMs)}`,
        fechaInicio: instanteLocal({ year, month, day }, hi, mi),
        fechaFin: instanteLocal({ year, month, day }, hf, mf),
        esOcurrencia: true,
        eventoBaseId: evento.id,
      });
    }
    cursorMs += ONE_DAY_MS;
    vueltas += 1;
  }
  return ocurrencias;
}

// Condiciones comunes para traer los recurrentes que pueden tener ocurrencias
// en [desde, hasta]. El dia extra en fechaFinRecurr evita perder el ultimo dia
// (se guarda a medianoche UTC y `desde` suele venir ya entrado el dia).
const whereRecurrentesVigentes = (desde, hasta) => [
  { patronRecurrencia: { not: null } },
  { fechaInicio: { lte: hasta } },
  {
    OR: [
      { fechaFinRecurr: null },
      { fechaFinRecurr: { gte: new Date(desde.getTime() - ONE_DAY_MS) } },
    ],
  },
];

// ── GET /api/agenda ──────────────────────────────────────────────────────────
// Listar eventos del usuario (propios + globales + invitado), mas sus tareas y
// un bloque virtual por proyecto activo en el que participa.
const listar = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;
  const usuarioId = req.usuario.id;

  try {
    const hoy = partesDiaMexico();
    const desde = fecha_inicio
      ? parsearFecha(fecha_inicio)
      : new Date(Date.UTC(hoy.year, hoy.month, 1));
    const hasta = fecha_fin
      ? parsearFecha(fecha_fin)
      : new Date(Date.UTC(hoy.year, hoy.month + 2, 0, 23, 59, 59, 999));
    const errorRango = validarRango(desde, hasta);
    if (errorRango) return res.status(400).json({ error: errorRango });

    const visibilidad = {
      OR: [
        { usuarioId },
        { esGlobal: true },
        { invitados: { some: { usuarioId } } },
      ],
    };
    const includeEvento = {
      creador:   { select: { id: true, nombre: true, email: true } },
      invitados: { include: { usuario: { select: { id: true, nombre: true, email: true } } } },
      proyecto:  { select: { id: true, nombre: true } },
      empresa:   { select: { id: true, nombre: true, nombreComercial: true } },
    };

    // Gastos pendientes con fecha limite: solo de las categorias que la
    // persona puede ver en Finanzas (bloque virtual `gasto-<id>`).
    const categoriasGasto = configEnCache().modulos?.finanzas === false ? [] : categoriasVisibles(req.usuario);

    const [eventosNormales, eventosRecurrentes, tareas, proyectos, gastosPendientes] = await Promise.all([
      // Eventos puntuales dentro del rango
      prisma.evento.findMany({
        where: {
          AND: [
            visibilidad,
            SIN_FILAS_DE_PROYECTO,
            { patronRecurrencia: null },
            { fechaInicio: { lte: hasta } },
            {
              OR: [
                { fechaFin: { gte: desde } },
                { fechaFin: null, fechaInicio: { gte: desde } },
              ],
            },
          ],
        },
        include: includeEvento,
        orderBy: { fechaInicio: 'asc' },
      }),
      // Eventos recurrentes vigentes en el rango (se expanden en JS)
      prisma.evento.findMany({
        where: { AND: [visibilidad, ...whereRecurrentesVigentes(desde, hasta)] },
        include: includeEvento,
      }),
      // Tareas relacionadas al usuario que cruzan con el rango consultado
      prisma.tarea.findMany({
        where: {
          AND: [
            {
              OR: [
                { asignadoId: usuarioId },
                { asignados: { some: { id: usuarioId } } },
                { creadorId: usuarioId },
              ],
            },
            { fechaInicio: { lte: hasta } },
            {
              OR: [
                { venceEn: { gte: desde } },
                { venceEn: null, fechaInicio: { gte: desde } },
              ],
            },
          ],
        },
        include: { proyecto: { select: { id: true, nombre: true } } },
      }),
      // Proyectos activos en los que participa: se pintan como bloque virtual
      prisma.proyecto.findMany({
        where: {
          AND: [
            { estado: { notIn: ESTADOS_PROYECTO_OCULTOS } },
            { fechaInicio: { lte: hasta } },
            {
              OR: [
                { fechaFin: { gte: desde } },
                { fechaFin: null, fechaInicio: { gte: desde } },
              ],
            },
            {
              OR: [
                { miembros: { some: { id: usuarioId } } },
                { creadorId: usuarioId },
                { tareas: { some: { asignadoId: usuarioId } } },
                { tareas: { some: { asignados: { some: { id: usuarioId } } } } },
                { tareas: { some: { creadorId: usuarioId } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          nombre: true,
          estado: true,
          fechaInicio: true,
          fechaFin: true,
          creadoEn: true,
        },
      }),
      // fechaLimite es @db.Date (medianoche UTC del dia civil): el rango, que
      // llega en instantes, se pasa a dias civiles de la empresa. Ampliarlo un
      // dia por lado traia vencimientos fuera de la vista (y los contaba).
      categoriasGasto.length
        ? prisma.gasto.findMany({
          where: {
            estado: 'PENDIENTE',
            categoria: { in: categoriasGasto },
            fechaLimite: { gte: diaCivilUtc(desde), lte: diaCivilUtc(hasta) },
          },
          select: { id: true, folio: true, concepto: true, categoria: true, monto: true, moneda: true, fechaLimite: true, proveedorNombre: true },
        })
        : Promise.resolve([]),
    ]);

    // Mapear tareas a formato evento
    const eventosTareas = tareas.map((t) => ({
      id: `tarea-${t.id}`,
      titulo: `TAREA: ${t.titulo}`,
      tipo: 'tarea',
      fechaInicio: ajustarFechaTodoElDia(t.fechaInicio),
      fechaFin: ajustarFechaTodoElDia(t.venceEn || t.fechaInicio, true),
      todoElDia: true,
      color: getColorCategoria('tarea'),
      proyecto: t.proyecto,
      esLectura: true,
    }));

    const eventosProyectos = proyectos.map((proyecto) => ({
      id: `proyecto-${proyecto.id}`,
      titulo: `Proyecto: ${proyecto.nombre}`,
      tipo: 'proyecto',
      estado: proyecto.estado,
      fechaInicio: ajustarFechaTodoElDia(proyecto.fechaInicio || proyecto.creadoEn),
      fechaFin: ajustarFechaTodoElDia(proyecto.fechaFin || proyecto.fechaInicio || proyecto.creadoEn, true),
      todoElDia: true,
      color: getColorCategoria('evento'),
      proyecto: { id: proyecto.id, nombre: proyecto.nombre },
      esLectura: true,
    }));

    const eventosGastos = gastosPendientes.map((g) => ({
      id: `gasto-${g.id}`,
      titulo: `Gasto: ${g.concepto}`,
      tipo: 'gasto',
      fechaInicio: ajustarFechaTodoElDia(g.fechaLimite),
      fechaFin: ajustarFechaTodoElDia(g.fechaLimite, true),
      todoElDia: true,
      color: getColorCategoria('gasto'),
      gasto: {
        id: g.id,
        folio: g.folio,
        categoria: g.categoria,
        monto: Number(g.monto),
        moneda: g.moneda,
        proveedorNombre: g.proveedorNombre,
        fechaLimite: g.fechaLimite.toISOString().slice(0, 10),
      },
      esLectura: true,
    }));

    // Expandir recurrentes en el rango
    const expandidos = eventosRecurrentes.flatMap((e) => expandirRecurrente(e, desde, hasta));

    const resultado = [...eventosNormales, ...eventosProyectos, ...eventosTareas, ...eventosGastos, ...expandidos].sort(
      (a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio)
    );

    return res.json({ eventos: resultado });
  } catch (error) {
    console.error('[agenda.listar]', error);
    return res.status(500).json({ error: 'Error al listar la agenda' });
  }
};

// Notificar a invitados (interno). `invitadosIds` son los ids a avisar; con
// `esGlobal` se avisa a todas las cuentas activas menos al creador.
async function crearNotificacionesInvitados(eventoId, creadorId, invitadosIds, tituloEvento, esGlobal = false, proyectoId = null) {
  try {
    const cid = parseInt(creadorId, 10);
    const creador = await prisma.usuario.findUnique({ where: { id: cid }, select: { nombre: true } });
    const nombreCreador = creador?.nombre || 'Un miembro';

    let ids = [];
    if (esGlobal) {
      // Solo cuentas activas: a quien esta dado de baja o pendiente no se le avisa
      const usuarios = await prisma.usuario.findMany({
        where: { id: { not: cid }, estado: 'activo', rol: { in: ['ADMIN', 'MIEMBRO'] } },
        select: { id: true },
      });
      ids = usuarios.map((usuario) => usuario.id);
    } else {
      ids = parsearEnteros(invitadosIds).filter((id) => id !== cid);
    }

    if (ids.length === 0 || !configEnCache().avisos.recordatorios) return;

    // Enviar una por una para asegurar el trigger de Supabase Realtime
    await Promise.all(ids.map((uid) =>
      prisma.notificacion.create({
        data: {
          usuarioId: uid,
          tipo: 'recordatorio',
          mensaje: `${nombreCreador} te ha invitado a: ${tituloEvento}`,
          leida: false,
          eventoId,
          proyectoId,
        },
      })
    ));
    console.log(`[Notif] ${ids.length} alertas enviadas individualmente.`);
  } catch (err) {
    console.error('[Notif] Error:', err);
  }
}

// ── POST /api/agenda ─────────────────────────────────────────────────────────
// Reunión con un cliente (aparece en su portal). Solo quien ve el directorio
// de clientes ("clientes.ver") y solo empresas que sean clientes. Devuelve { empresaId } o { error, status }.
const resolverEmpresaEvento = async (usuario, valor) => {
  if (valor === null || valor === '') return { empresaId: null };
  if (!puede(usuario, 'clientes.ver')) return { error: 'No tienes permiso para ligar una reunión a un cliente', status: 403 };
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Cliente no válido', status: 400 };
  const empresa = await prisma.empresa.findUnique({ where: { id }, select: { id: true, tipo: true } });
  if (!empresa || empresa.tipo === 'PROVEEDOR') return { error: 'Cliente no encontrado', status: 404 };
  return { empresaId: empresa.id };
};

const crear = async (req, res) => {
  const {
    titulo, descripcion, tipo, fecha_inicio, fecha_fin, todo_el_dia,
    alerta_minutos, es_compartido, es_global, proyecto_id, invitados_ids,
    es_recurrente, patron_recurrencia, fecha_fin_recurrencia,
    modalidad, ubicacion, url_reunion, instrucciones_acceso, empresa_id,
  } = req.body || {};
  const usuarioId = req.usuario.id;

  try {
    const tituloFinal = textoLimpio(titulo);
    if (!tituloFinal) return res.status(400).json({ error: 'El titulo es obligatorio' });
    if (!TIPOS_EVENTO.includes(tipo)) return res.status(400).json({ error: 'Tipo de evento invalido' });
    if (!fecha_inicio) return res.status(400).json({ error: 'La fecha de inicio es obligatoria' });

    const fechaInicioDate = parsearFecha(fecha_inicio);
    if (!fechaInicioDate) return res.status(400).json({ error: 'Fecha de inicio invalida' });
    let fechaFinDate = null;
    if (fecha_fin) {
      fechaFinDate = parsearFecha(fecha_fin);
      if (!fechaFinDate) return res.status(400).json({ error: 'Fecha de fin invalida' });
    }
    if (fechaFinDate && fechaFinDate < fechaInicioDate) {
      return res.status(400).json({ error: 'La fecha de fin debe ser posterior o igual a la fecha de inicio' });
    }

    const modalidadFinal = modalidad || 'presencial';
    if (!MODALIDADES_EVENTO.includes(modalidadFinal)) {
      return res.status(400).json({ error: 'Modalidad invalida' });
    }
    const urlReunion = textoOpcional(url_reunion);
    if (urlReunion && !esUrlReunionValida(urlReunion)) {
      return res.status(400).json({ error: 'El enlace de la reunion debe empezar por http:// o https://' });
    }

    // Recurrencia: si es recurrente, el patron es obligatorio
    let patronFinal = null;
    let fechaFinRecurrDate = null;
    if (es_recurrente) {
      const { patron, error } = normalizarPatronRecurrencia(patron_recurrencia);
      if (error) return res.status(400).json({ error });
      patronFinal = JSON.stringify(patron);
      if (fecha_fin_recurrencia) {
        fechaFinRecurrDate = parsearFecha(fecha_fin_recurrencia);
        if (!fechaFinRecurrDate) return res.status(400).json({ error: 'Fecha de fin de recurrencia invalida' });
      }
    }

    // Proyecto (opcional): tiene que existir y ser visible para quien crea
    let proyectoId = null;
    let miembrosProyecto = [];
    if (proyecto_id !== undefined && proyecto_id !== null && proyecto_id !== '') {
      const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, proyecto_id);
      if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!permitido) return res.status(403).json({ error: 'No tienes acceso a ese proyecto' });
      proyectoId = proyecto.id;
      miembrosProyecto = proyecto.miembros.map((miembro) => miembro.id);
    }

    let empresaId = null;
    if (empresa_id !== undefined) {
      const resultado = await resolverEmpresaEvento(req.usuario, empresa_id);
      if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
      empresaId = resultado.empresaId;
    }

    // Publicar un evento para todo el equipo pide "agenda.eventosEmpresa"
    const esGlobal = puede(req.usuario, 'agenda.eventosEmpresa') ? !!es_global : false;
    const esCompartido = !!es_compartido;
    const todoElDia = tipo === 'dia_completo' ? true : todo_el_dia === true;

    // Invitados: el creador siempre va dentro (aceptado). Si es compartido se
    // suman los ids enviados y, si hay proyecto, sus miembros.
    const idsInvitados = new Set();
    if (esCompartido) {
      parsearEnteros(invitados_ids).forEach((uid) => idsInvitados.add(uid));
      miembrosProyecto.forEach((uid) => idsInvitados.add(uid));
    }
    idsInvitados.delete(usuarioId);
    const invitadosValidos = await filtrarUsuariosExistentes([...idsInvitados]);
    const listadoInvitados = [
      { usuarioId, estado: 'aceptado' },
      ...invitadosValidos.map((uid) => ({ usuarioId: uid, estado: 'pendiente' })),
    ];

    const evento = await prisma.evento.create({
      data: {
        usuarioId,
        creadoPorId:         usuarioId,
        titulo:              tituloFinal,
        descripcion:         textoOpcional(descripcion),
        tipo,
        modalidad:           modalidadFinal,
        ubicacion:           textoOpcional(ubicacion),
        urlReunion,
        instruccionesAcceso: textoOpcional(instrucciones_acceso),
        fechaInicio:         fechaInicioDate,
        fechaFin:            fechaFinDate,
        todoElDia,
        color:               getColorCategoria(tipo),
        alertaMinutos:       parsearAlertaMinutos(alerta_minutos),
        esCompartido,
        esGlobal,
        proyectoId,
        empresaId,
        esRecurrente:        !!patronFinal,
        patronRecurrencia:   patronFinal,
        fechaFinRecurr:      fechaFinRecurrDate,
        invitados:           { create: listadoInvitados },
      },
      include: { invitados: true },
    });

    // Avisar antes de responder para que la invitacion llegue aunque se cierre la pestana
    if (esGlobal || invitadosValidos.length > 0) {
      await crearNotificacionesInvitados(evento.id, usuarioId, invitadosValidos, evento.titulo, esGlobal, evento.proyectoId || null);
      if (!esGlobal) require('../services/avisosCorreo.service').avisarInvitacionEvento({ usuarioIds: invitadosValidos, actorId: usuarioId, eventoId: evento.id });
    }

    await syncEventoBestEffort(evento.id);

    return res.status(201).json({ evento });
  } catch (error) {
    console.error('[agenda.crear]', error);
    return res.status(500).json({ error: 'Error al crear el evento' });
  }
};

// ── PUT /api/agenda/:id ──────────────────────────────────────────────────────
//
// Limitacion conocida: un evento recurrente no tiene excepciones por
// ocurrencia. Editar "una" ocurrencia edita toda la serie, y la fecha base de
// la serie se conserva aunque el cliente mande la fecha de la ocurrencia.
const editar = async (req, res) => {
  const id = idBaseEvento(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador de evento invalido' });
  const usuarioId = req.usuario.id;
  const {
    titulo, descripcion, tipo, fecha_inicio, fecha_fin, todo_el_dia,
    alerta_minutos, es_compartido, es_global, proyecto_id, invitados_ids,
    es_recurrente, patron_recurrencia, fecha_fin_recurrencia,
    modalidad, ubicacion, url_reunion, instrucciones_acceso, empresa_id,
  } = req.body || {};

  try {
    const existente = await prisma.evento.findUnique({
      where: { id },
      include: { invitados: { select: { id: true, usuarioId: true } } },
    });
    if (!existente) return res.status(404).json({ error: 'Evento no encontrado' });
    if (existente.usuarioId !== usuarioId && existente.creadoPorId !== usuarioId) {
      return res.status(403).json({ error: 'No tienes permiso para editar este evento' });
    }

    // Campos de texto y catalogo
    let tituloFinal = existente.titulo;
    if (titulo !== undefined) {
      tituloFinal = textoLimpio(titulo);
      if (!tituloFinal) return res.status(400).json({ error: 'El titulo es obligatorio' });
    }
    let tipoFinal = existente.tipo;
    if (tipo) {
      if (!TIPOS_EVENTO.includes(tipo)) return res.status(400).json({ error: 'Tipo de evento invalido' });
      tipoFinal = tipo;
    }
    let modalidadFinal = existente.modalidad;
    if (modalidad) {
      if (!MODALIDADES_EVENTO.includes(modalidad)) return res.status(400).json({ error: 'Modalidad invalida' });
      modalidadFinal = modalidad;
    }
    let urlReunionFinal = existente.urlReunion;
    if (url_reunion !== undefined) {
      urlReunionFinal = textoOpcional(url_reunion);
      if (urlReunionFinal && !esUrlReunionValida(urlReunionFinal)) {
        return res.status(400).json({ error: 'El enlace de la reunion debe empezar por http:// o https://' });
      }
    }

    // Recurrencia
    const esRecurrenteFinal = es_recurrente !== undefined ? !!es_recurrente : existente.esRecurrente;
    let patronFinal = existente.patronRecurrencia;
    let fechaFinRecurrFinal = existente.fechaFinRecurr;
    if (!esRecurrenteFinal) {
      patronFinal = null;
      fechaFinRecurrFinal = null;
    } else {
      if (patron_recurrencia !== undefined && patron_recurrencia !== null) {
        const { patron, error } = normalizarPatronRecurrencia(patron_recurrencia);
        if (error) return res.status(400).json({ error });
        patronFinal = JSON.stringify(patron);
      }
      if (!patronFinal) return res.status(400).json({ error: 'Patron de recurrencia requerido' });
      if (fecha_fin_recurrencia !== undefined) {
        if (!fecha_fin_recurrencia) {
          fechaFinRecurrFinal = null;
        } else {
          fechaFinRecurrFinal = parsearFecha(fecha_fin_recurrencia);
          if (!fechaFinRecurrFinal) return res.status(400).json({ error: 'Fecha de fin de recurrencia invalida' });
        }
      }
    }

    // Fechas
    let fechaInicioFinal = existente.fechaInicio;
    let fechaFinFinal = existente.fechaFin;
    if (fecha_inicio !== undefined) {
      fechaInicioFinal = parsearFecha(fecha_inicio);
      if (!fechaInicioFinal) return res.status(400).json({ error: 'Fecha de inicio invalida' });
    }
    if (fecha_fin !== undefined) {
      if (fecha_fin === null || fecha_fin === '') {
        fechaFinFinal = null;
      } else {
        fechaFinFinal = parsearFecha(fecha_fin);
        if (!fechaFinFinal) return res.status(400).json({ error: 'Fecha de fin invalida' });
      }
    }
    // Al editar una ocurrencia el frontend manda la fecha de ESA ocurrencia.
    // `fechaInicio` es el arranque de toda la serie: si se guardara, la serie
    // entera se moveria a ese dia. Si el evento ya era recurrente y lo sigue
    // siendo, y la fecha enviada cae en otro dia que la base, se conserva la base.
    if (
      existente.patronRecurrencia &&
      esRecurrenteFinal &&
      fecha_inicio !== undefined &&
      claveDiaMexico(fechaInicioFinal) !== claveDiaMexico(existente.fechaInicio)
    ) {
      fechaInicioFinal = existente.fechaInicio;
      fechaFinFinal = existente.fechaFin;
    }
    if (fechaFinFinal && fechaFinFinal < fechaInicioFinal) {
      return res.status(400).json({ error: 'La fecha de fin debe ser posterior o igual a la fecha de inicio' });
    }

    // Proyecto: si cambia, tiene que ser visible para quien edita
    let proyectoIdFinal = existente.proyectoId;
    if (proyecto_id !== undefined) {
      if (proyecto_id === null || proyecto_id === '') {
        proyectoIdFinal = null;
      } else {
        const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, proyecto_id);
        if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
        if (!permitido) return res.status(403).json({ error: 'No tienes acceso a ese proyecto' });
        proyectoIdFinal = proyecto.id;
      }
    }

    let empresaIdFinal = existente.empresaId;
    if (empresa_id !== undefined && (empresa_id ?? null) !== existente.empresaId) {
      const resultado = await resolverEmpresaEvento(req.usuario, empresa_id);
      if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
      empresaIdFinal = resultado.empresaId;
    }

    // Marcar un evento como global pide "agenda.eventosEmpresa"
    const esGlobalFinal = puede(req.usuario, 'agenda.eventosEmpresa')
      ? (es_global !== undefined ? !!es_global : existente.esGlobal)
      : false;
    const esCompartidoFinal = es_compartido !== undefined ? !!es_compartido : existente.esCompartido;
    let todoElDiaFinal = todo_el_dia !== undefined ? !!todo_el_dia : existente.todoElDia;
    if (tipoFinal === 'dia_completo') todoElDiaFinal = true;

    // Invitados: solo se tocan si el cliente manda la lista. El propietario
    // siempre queda dentro; quien ya estaba conserva su respuesta.
    let invitadosData = null;
    let invitadosNuevos = [];
    if (Array.isArray(invitados_ids)) {
      const propietarioId = existente.usuarioId;
      const deseados = new Set(
        esCompartidoFinal ? await filtrarUsuariosExistentes(parsearEnteros(invitados_ids)) : []
      );
      deseados.delete(propietarioId);
      const actuales = new Set(existente.invitados.map((invitado) => invitado.usuarioId));
      invitadosNuevos = [...deseados].filter((uid) => !actuales.has(uid));
      const aQuitar = existente.invitados
        .filter((invitado) => invitado.usuarioId !== propietarioId && !deseados.has(invitado.usuarioId))
        .map((invitado) => invitado.id);
      const aCrear = invitadosNuevos.map((uid) => ({ usuarioId: uid, estado: 'pendiente' }));
      if (!actuales.has(propietarioId)) aCrear.push({ usuarioId: propietarioId, estado: 'aceptado' });

      invitadosData = {};
      if (aQuitar.length > 0) invitadosData.deleteMany = { id: { in: aQuitar } };
      if (aCrear.length > 0) invitadosData.create = aCrear;
      if (Object.keys(invitadosData).length === 0) invitadosData = null;
    }

    const evento = await prisma.evento.update({
      where: { id },
      data: {
        titulo:              tituloFinal,
        descripcion:         descripcion !== undefined ? textoOpcional(descripcion) : existente.descripcion,
        tipo:                tipoFinal,
        modalidad:           modalidadFinal,
        ubicacion:           ubicacion !== undefined ? textoOpcional(ubicacion) : existente.ubicacion,
        urlReunion:          urlReunionFinal,
        instruccionesAcceso: instrucciones_acceso !== undefined ? textoOpcional(instrucciones_acceso) : existente.instruccionesAcceso,
        fechaInicio:         fechaInicioFinal,
        fechaFin:            fechaFinFinal,
        todoElDia:           todoElDiaFinal,
        color:               getColorCategoria(tipoFinal),
        alertaMinutos:       alerta_minutos !== undefined ? parsearAlertaMinutos(alerta_minutos) : existente.alertaMinutos,
        esCompartido:        esCompartidoFinal,
        esGlobal:            esGlobalFinal,
        proyectoId:          proyectoIdFinal,
        empresaId:           empresaIdFinal,
        esRecurrente:        esRecurrenteFinal,
        patronRecurrencia:   patronFinal,
        fechaFinRecurr:      fechaFinRecurrFinal,
        ...(invitadosData ? { invitados: invitadosData } : {}),
      },
      include: { invitados: true },
    });

    if (invitadosNuevos.length > 0) {
      await crearNotificacionesInvitados(evento.id, usuarioId, invitadosNuevos, evento.titulo, false, evento.proyectoId || null);
      require('../services/avisosCorreo.service').avisarInvitacionEvento({ usuarioIds: invitadosNuevos, actorId: usuarioId, eventoId: evento.id });
    }

    await syncEventoBestEffort(evento.id);

    return res.json({ evento });
  } catch (error) {
    if (esErrorNoEncontrado(error)) return res.status(404).json({ error: 'Evento no encontrado' });
    console.error('[agenda.editar]', error);
    return res.status(500).json({ error: 'Error al editar el evento' });
  }
};

// ── PATCH /api/agenda/:id/responder ──────────────────────────────────────────
const responderInvitacion = async (req, res) => {
  const id = idBaseEvento(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador de evento invalido' });
  const { estado } = req.body || {}; // 'aceptado', 'rechazado'
  const usuarioId = req.usuario.id;

  if (!['aceptado', 'rechazado'].includes(estado)) {
    return res.status(400).json({ error: 'Estado de respuesta inválido' });
  }

  try {
    const invitacion = await prisma.eventoInvitado.findFirst({
      where: { eventoId: id, usuarioId },
    });

    if (!invitacion) {
      return res.status(404).json({ error: 'No tienes una invitación para este evento' });
    }

    await prisma.eventoInvitado.update({
      where: { id: invitacion.id },
      data: { estado, visto: true },
    });

    return res.json({ ok: true });
  } catch (error) {
    if (esErrorNoEncontrado(error)) return res.status(404).json({ error: 'No tienes una invitación para este evento' });
    console.error('[agenda.responder]', error);
    return res.status(500).json({ error: 'Error al responder invitación' });
  }
};

// ── GET /api/agenda/invitaciones/pendientes ──────────────────────────────────
const invitacionesPendientes = async (req, res) => {
  const usuarioId = req.usuario.id;

  try {
    const pendientes = await prisma.eventoInvitado.findMany({
      where: { usuarioId, estado: 'pendiente' },
      include: {
        evento: {
          include: {
            creador: { select: { nombre: true } },
          },
        },
      },
    });
    return res.json({ pendientes });
  } catch (error) {
    console.error('[agenda.pendientes]', error);
    return res.status(500).json({ error: 'Error al obtener invitaciones' });
  }
};

// ── DELETE /api/agenda/:id ───────────────────────────────────────────────────
// Un id de ocurrencia ("<uuid>_YYYY-MM-DD") borra la serie completa: no hay
// excepciones por ocurrencia.
const eliminar = async (req, res) => {
  const id = idBaseEvento(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador de evento invalido' });
  const usuarioId = req.usuario.id;

  try {
    const evento = await prisma.evento.findUnique({
      where: { id },
      include: { adjuntos: { select: { url: true } } },
    });
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

    if (evento.creadoPorId === usuarioId || evento.usuarioId === usuarioId) {
      // Es el creador -> eliminar todo (invitados y adjuntos caen en cascada)
      await deleteEventoGoogleBestEffort(evento);
      await prisma.evento.delete({ where: { id } });
      // Los archivos viven en Vercel Blob: sin esto quedaban huerfanos
      await borrarBlobs(evento.adjuntos.map((adjunto) => adjunto.url));
      return res.json({ ok: true, mensaje: 'Evento eliminado para todos' });
    }

    // Es invitado -> solo salir del evento
    const invitacion = await prisma.eventoInvitado.findFirst({
      where: { eventoId: id, usuarioId },
    });
    if (invitacion) {
      await prisma.eventoInvitado.delete({ where: { id: invitacion.id } });
      return res.json({ ok: true, mensaje: 'Has salido del evento' });
    }
    return res.status(403).json({ error: 'No tienes permiso para eliminar este evento' });
  } catch (error) {
    if (esErrorNoEncontrado(error)) return res.status(404).json({ error: 'Evento no encontrado' });
    console.error('[agenda.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el evento' });
  }
};

// ── GET /api/agenda/disponibilidad ───────────────────────────────────────────
// Devuelve un bloque "ocupado" por persona y elemento (evento, tarea o
// proyecto) que cruza con el rango. De los demas usuarios solo se ven los
// bloques; el titulo y el proyecto se muestran unicamente al propio usuario o
// a un ADMIN.
const consultarDisponibilidad = async (req, res) => {
  const { usuarios_ids, inicio, fin, excluir_id, excluir_proyecto_id, sin_proyectos } = req.query;
  // Para una reunion, estar en un proyecto no es estar ocupado (sin_proyectos=1);
  // el formulario de proyectos si necesita ver esos cruces.
  const incluirProyectos = sin_proyectos !== '1';
  if (!usuarios_ids || !inicio) return res.status(400).json({ error: 'Faltan parámetros' });

  try {
    const ids = [...new Set(parsearEnteros(String(usuarios_ids).split(',')))];
    if (ids.length === 0) return res.status(400).json({ error: 'usuarios_ids invalido' });

    const start = parsearFecha(inicio);
    const end = fin ? parsearFecha(fin) : (start ? new Date(start.getTime() + ONE_DAY_MS) : null);
    if (!start || !end || end <= start) {
      return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    let excluirEventoId = null;
    if (excluir_id) {
      excluirEventoId = idBaseEvento(excluir_id);
      if (!excluirEventoId) return res.status(400).json({ error: 'excluir_id invalido' });
    }
    let excluirProyectoId = null;
    if (excluir_proyecto_id) {
      excluirProyectoId = parseInt(excluir_proyecto_id, 10);
      if (!Number.isInteger(excluirProyectoId)) return res.status(400).json({ error: 'excluir_proyecto_id invalido' });
    }

    const proyectoNoOculto = { estado: { notIn: ESTADOS_PROYECTO_OCULTOS } };

    const [eventos, tareas, proyectos] = await Promise.all([
      prisma.evento.findMany({
        where: {
          AND: [
            excluirEventoId ? { id: { not: excluirEventoId } } : {},
            SIN_FILAS_DE_PROYECTO,
            // Un evento ligado a un proyecto terminado o archivado ya no ocupa
            { OR: [{ proyectoId: null }, { proyecto: proyectoNoOculto }] },
            {
              OR: [
                { usuarioId: { in: ids } },
                { invitados: { some: { usuarioId: { in: ids }, estado: 'aceptado' } } },
              ],
            },
            { fechaInicio: { lt: end } },
            { fechaFin: { gt: start } },
          ],
        },
        select: {
          id: true,
          titulo: true,
          fechaInicio: true,
          fechaFin: true,
          usuarioId: true,
          proyectoId: true,
          invitados: {
            where: { usuarioId: { in: ids }, estado: 'aceptado' },
            select: { usuarioId: true },
          },
        },
      }),
      prisma.tarea.findMany({
        where: {
          proyectoId: excluirProyectoId ? { not: excluirProyectoId } : undefined,
          proyecto: proyectoNoOculto,
          // Responsable = asignado principal o co-asignado (misma regla que el
          // resto del sistema). Antes solo se miraba `asignadoId`.
          AND: [
            { OR: [{ asignadoId: { in: ids } }, { asignados: { some: { id: { in: ids } } } }] },
            {
              // Cruce de rangos: periodo consultado contra periodo real de cada tarea.
              OR: [
                { venceEn: { gt: start } },
                { venceEn: null, fechaInicio: { gte: start } },
              ],
            },
          ],
          estado: { in: ['PENDIENTE', 'EN_PROGRESO'] },
          fechaInicio: { lt: end },
        },
        select: {
          id: true,
          titulo: true,
          fechaInicio: true,
          venceEn: true,
          asignadoId: true,
          asignados: { select: { id: true } },
          proyectoId: true,
          proyecto: { select: { nombre: true } },
        },
      }),
      !incluirProyectos ? [] : prisma.proyecto.findMany({
        where: {
          id: excluirProyectoId ? { not: excluirProyectoId } : undefined,
          ...proyectoNoOculto,
          miembros: { some: { id: { in: ids } } },
          fechaInicio: { lt: end },
          OR: [
            { fechaFin: null },
            { fechaFin: { gt: start } },
          ],
        },
        select: {
          id: true,
          nombre: true,
          fechaInicio: true,
          fechaFin: true,
          miembros: {
            where: { id: { in: ids } },
            select: { id: true },
          },
        },
      }),
    ]);

    // Un evento ocupa a su dueno y a cada invitado que acepto: un bloque por persona
    const conflictosEventos = eventos.flatMap((evento) => {
      const personas = new Set(evento.invitados.map((invitado) => invitado.usuarioId));
      if (ids.includes(evento.usuarioId)) personas.add(evento.usuarioId);
      return [...personas].map((uid) => ({
        id: uid === evento.usuarioId ? evento.id : `${evento.id}-${uid}`,
        titulo: evento.titulo,
        fechaInicio: evento.fechaInicio,
        fechaFin: evento.fechaFin,
        usuarioId: uid,
        proyectoId: evento.proyectoId,
        tipo: 'evento',
      }));
    });

    const conflictos = [
      ...conflictosEventos,
      // Un bloque por cada responsable consultado (principal o co-asignado).
      ...tareas.flatMap((tarea) => {
        const responsables = new Set([tarea.asignadoId, ...(tarea.asignados || []).map((a) => a.id)].filter(Boolean));
        return [...responsables].filter((uid) => ids.includes(uid)).map((uid) => ({
        id: `tarea-${tarea.id}-${uid}`,
        titulo: `Tarea: ${tarea.titulo}`,
        fechaInicio: tarea.fechaInicio,
        fechaFin: getFinTareaParaDisponibilidad(tarea),
        usuarioId: uid,
        proyectoId: tarea.proyectoId,
        proyecto: tarea.proyecto,
        tipo: 'tarea',
        }));
      }),
      ...proyectos.flatMap((proyecto) => proyecto.miembros.map((miembro) => ({
        id: `proyecto-${proyecto.id}-${miembro.id}`,
        titulo: `Proyecto: ${proyecto.nombre}`,
        fechaInicio: proyecto.fechaInicio,
        fechaFin: proyecto.fechaFin,
        usuarioId: miembro.id,
        proyectoId: proyecto.id,
        tipo: 'proyecto',
      }))),
    ];

    // Privacidad: de los demas solo se devuelve el bloque ocupado, sin titulo
    // (salvo a quien ve la agenda del equipo)
    const solicitanteEsAdmin = puede(req.usuario, 'agenda.equipo');
    const ocultarDetalle = (conflicto) => (
      solicitanteEsAdmin || conflicto.usuarioId === req.usuario.id
        ? conflicto
        : {
          id: conflicto.id,
          titulo: 'Ocupado',
          fechaInicio: conflicto.fechaInicio,
          fechaFin: conflicto.fechaFin,
          usuarioId: conflicto.usuarioId,
          proyectoId: conflicto.proyectoId ?? null,
          tipo: conflicto.tipo,
        }
    );

    return res.json({ conflictos: conflictos.map(ocultarDetalle) });
  } catch (error) {
    console.error('[agenda.disponibilidad]', error);
    return res.status(500).json({ error: 'Error al consultar disponibilidad' });
  }
};

// ── CALENDARIO LABORAL ───────────────────────────────────────────────────────

const getConfigLaboral = async (req, res) => {
  const usuarioId = req.usuario.id;
  try {
    let config = await prisma.configuracionLaboral.findUnique({ where: { usuarioId } });
    if (!config) {
      // Valores por defecto
      // Horario por defecto de la empresa (panel de configuración).
      const op = configEnCache().operacion;
      config = {
        diasLaborales: op.diasLaborales || DIAS_LABORALES_DEFAULT,
        horaEntrada: op.horaEntrada,
        horaSalida: op.horaSalida,
        horaComidaInicio: op.horaComidaInicio,
        horaComidaFin: op.horaComidaFin,
        horariosPorDia: op.horariosPorDia || {},
      };
    }
    return res.json({ config: { ...config, horariosPorDia: config.horariosPorDia || {} } });
  } catch (error) {
    console.error('[agenda.getConfig]', error);
    return res.status(500).json({ error: 'Error al obtener configuracion' });
  }
};

const updateConfigLaboral = async (req, res) => {
  const usuarioId = req.usuario.id;
  const {
    dias_laborales = DIAS_LABORALES_DEFAULT,
    hora_entrada = '09:00',
    hora_salida = '18:00',
    hora_comida_inicio = '14:00',
    hora_comida_fin = '15:00',
    horarios_por_dia,
  } = req.body || {};
  const { horarios: horariosPorDia, error: errorHorarios } = require('../utils/horarios.utils').validarHorariosPorDia(horarios_por_dia);
  if (errorHorarios) return res.status(400).json({ error: errorHorarios });

  if (!Array.isArray(dias_laborales)) {
    return res.status(400).json({ error: 'dias_laborales debe ser una lista' });
  }
  const diasLaborales = [...new Set(parsearEnteros(dias_laborales))].sort((a, b) => a - b);
  if (diasLaborales.length !== dias_laborales.length || diasLaborales.some((dia) => !DIAS_SEMANA_LABORAL.includes(dia))) {
    return res.status(400).json({ error: 'dias_laborales solo admite dias del 1 (lunes) al 7 (domingo)' });
  }

  const horas = { hora_entrada, hora_salida, hora_comida_inicio, hora_comida_fin };
  const horaInvalida = Object.entries(horas).find(([, valor]) => !REGEX_HORA.test(String(valor)));
  if (horaInvalida) {
    return res.status(400).json({ error: `${horaInvalida[0]} debe tener formato HH:MM` });
  }
  if (hora_salida <= hora_entrada) {
    return res.status(400).json({ error: 'La hora de salida debe ser posterior a la de entrada' });
  }
  if (hora_comida_fin <= hora_comida_inicio) {
    return res.status(400).json({ error: 'El fin de la comida debe ser posterior a su inicio' });
  }

  try {
    const datos = {
      diasLaborales,
      horaEntrada: hora_entrada,
      horaSalida: hora_salida,
      horaComidaInicio: hora_comida_inicio,
      horaComidaFin: hora_comida_fin,
      // Solo los dias laborales que tienen horario propio.
      horariosPorDia: Object.fromEntries(Object.entries(horariosPorDia).filter(([dia]) => diasLaborales.includes(Number(dia)))),
    };
    const config = await prisma.configuracionLaboral.upsert({
      where: { usuarioId },
      update: datos,
      create: { usuarioId, ...datos },
    });
    return res.json({ config });
  } catch (error) {
    console.error('[agenda.updateConfig]', error);
    return res.status(500).json({ error: 'Error al actualizar configuracion' });
  }
};

// ── DÍAS ESPECIALES ──────────────────────────────────────────────────────────

const listarDiasEspeciales = async (req, res) => {
  const usuarioId = req.usuario.id;
  const { mes, anio } = req.query;

  const mesNum = mes ? parseInt(mes, 10) : null;
  const anioNum = anio ? parseInt(anio, 10) : null;
  if ((mes && (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12)) || (anio && !Number.isInteger(anioNum))) {
    return res.status(400).json({ error: 'mes o anio invalidos' });
  }

  try {
    const where = { usuarioId };
    if (mesNum && anioNum) {
      where.fecha = {
        gte: new Date(Date.UTC(anioNum, mesNum - 1, 1)),
        lte: new Date(Date.UTC(anioNum, mesNum, 0)),
      };
    }

    // Solo los días personales: los feriados oficiales y los de la empresa
    // salen de GET /api/agenda/dias-empresa.
    const dias = await prisma.diaEspecial.findMany({ where, orderBy: { fecha: 'asc' } });
    return res.json({ dias });
  } catch (error) {
    console.error('[agenda.listarDias]', error);
    return res.status(500).json({ error: 'Error al listar días especiales' });
  }
};

// Dia civil de una entrada: 'YYYY-MM-DD' se toma tal cual; un instante se
// traduce a dia de Mexico. Devuelve { year, month, day } o null.
const diaCivilDesdeEntrada = (valor) => {
  const texto = String(valor || '');
  if (REGEX_FECHA_CIVIL.test(texto)) {
    const [year, mes, day] = texto.split('-').map(Number);
    const fecha = new Date(Date.UTC(year, mes - 1, day));
    // Rechaza fechas imposibles como 2026-02-31 (Date.UTC las desborda al mes siguiente)
    if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== day) return null;
    return { year, month: mes - 1, day };
  }
  const fecha = parsearFecha(valor);
  return fecha ? partesDiaMexico(fecha) : null;
};

const crearDiaEspecial = async (req, res) => {
  const usuarioId = req.usuario.id;
  const { fecha, fecha_inicio, fecha_fin, tipo, descripcion, hora_inicio, hora_fin, dias_semana } = req.body || {};

  try {
    // Solo una parte del dia (permiso de 10:00 a 12:00): las dos horas o ninguna.
    const conHoras = Boolean(hora_inicio || hora_fin);
    if (conHoras && (!REGEX_HORA.test(String(hora_inicio || '')) || !REGEX_HORA.test(String(hora_fin || '')) || hora_fin <= hora_inicio)) {
      return res.status(400).json({ error: 'Horario no válido: la hora final debe ser posterior a la inicial' });
    }
    // Repeticion semanal: solo los dias de la semana elegidos dentro del rango (1 = lunes).
    const diasSemana = Array.isArray(dias_semana)
      ? [...new Set(dias_semana.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      : [];
    const inicioBase = fecha_inicio || fecha;
    const finBase = fecha_fin || fecha_inicio || fecha;

    if (!inicioBase || !finBase || !tipo) {
      return res.status(400).json({ error: 'fecha, tipo y rango son requeridos' });
    }
    if (!TIPOS_DIA_ESPECIAL.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de día invalido' });
    }

    const inicio = diaCivilDesdeEntrada(inicioBase);
    const fin = diaCivilDesdeEntrada(finBase);
    if (!inicio || !fin) {
      return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    // Mediodia UTC: la columna es @db.Date y asi guarda el dia correcto
    const cursor = new Date(Date.UTC(inicio.year, inicio.month, inicio.day, 12));
    const ultimo = new Date(Date.UTC(fin.year, fin.month, fin.day, 12));
    if (ultimo < cursor) {
      return res.status(400).json({ error: 'La fecha fin debe ser posterior o igual a la fecha inicio' });
    }
    if (ultimo.getTime() - cursor.getTime() > MAX_DIAS_RANGO * ONE_DAY_MS) {
      return res.status(400).json({ error: `El rango no puede superar ${MAX_DIAS_RANGO} dias` });
    }

    const descripcionFinal = textoOpcional(descripcion);
    const fechas = [];
    while (cursor <= ultimo) {
      const dia = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
      if (!diasSemana.length || diasSemana.includes(dia)) {
        fechas.push({
          usuarioId,
          fecha: new Date(cursor),
          tipo,
          descripcion: descripcionFinal,
          horaInicio: conHoras ? hora_inicio : null,
          horaFin: conHoras ? hora_fin : null,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (!fechas.length) {
      return res.status(400).json({ error: 'Ningún día del rango coincide con los días de la semana elegidos' });
    }

    await prisma.diaEspecial.createMany({
      data: fechas,
      skipDuplicates: true,
    });

    return res.status(201).json({ creados: fechas.length });
  } catch (error) {
    console.error('[agenda.crearDia]', error);
    return res.status(500).json({ error: 'Error al crear día especial' });
  }
};

const eliminarDiaEspecial = async (req, res) => {
  const { id } = req.params;
  const usuarioId = req.usuario.id;

  // Los feriados globales llegan con ids 'f1'..'f8' y no existen en la tabla
  if (!REGEX_UUID.test(String(id || ''))) {
    return res.status(400).json({ error: 'Identificador de día especial invalido' });
  }

  try {
    const dia = await prisma.diaEspecial.findUnique({ where: { id } });
    if (!dia || dia.usuarioId !== usuarioId) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }

    await prisma.diaEspecial.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (error) {
    if (esErrorNoEncontrado(error)) return res.status(404).json({ error: 'Día especial no encontrado' });
    console.error('[agenda.eliminarDia]', error);
    return res.status(500).json({ error: 'Error al eliminar' });
  }
};

// ── GOOGLE CALENDAR ──────────────────────────────────────────────────────────

const getGoogleCalendarStatus = async (req, res) => {
  try {
    const status = await getConnectionStatus(req.usuario.id);
    return res.json(status);
  } catch (error) {
    console.error('[agenda.google.status]', error);
    return res.status(500).json({ error: 'Error al consultar Google Calendar' });
  }
};

const connectGoogleCalendarController = async (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: 'Codigo de autorizacion requerido' });
  }
  if (!isGoogleCalendarConfigured()) {
    return res.status(503).json({ error: 'Google Calendar no esta configurado en el servidor' });
  }

  try {
    const connection = await connectGoogleCalendar({ usuarioId: req.usuario.id, code });
    return res.json(connection);
  } catch (error) {
    console.error('[agenda.google.connect]', error);
    return res.status(500).json({ error: 'No se pudo conectar Google Calendar' });
  }
};

const disconnectGoogleCalendarController = async (req, res) => {
  try {
    await disconnectGoogleCalendar(req.usuario.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[agenda.google.disconnect]', error);
    return res.status(500).json({ error: 'No se pudo desconectar Google Calendar' });
  }
};

// ── GET /api/agenda/recordatorios ────────────────────────────────────────────
// Eventos (de cualquier tipo) cuya alerta ya toca: faltan como mucho
// `alertaMinutos` para que empiecen. Incluye las ocurrencias de los recurrentes.
const recordatoriosProximos = async (req, res) => {
  const usuarioId = req.usuario.id;
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + VENTANA_RECORDATORIOS_MS);

  try {
    const visibilidad = {
      OR: [
        { usuarioId },
        { invitados: { some: { usuarioId, estado: { not: 'rechazado' } } } },
      ],
    };
    // alertaMinutos null = valor por defecto; 0 = sin alerta
    const conAlerta = { OR: [{ alertaMinutos: null }, { alertaMinutos: { gt: 0 } }] };

    const [puntuales, recurrentes] = await Promise.all([
      prisma.evento.findMany({
        where: {
          AND: [
            visibilidad,
            conAlerta,
            SIN_FILAS_DE_PROYECTO,
            { patronRecurrencia: null },
            { fechaInicio: { gte: ahora, lte: limite } },
          ],
        },
      }),
      prisma.evento.findMany({
        where: { AND: [visibilidad, conAlerta, ...whereRecurrentesVigentes(ahora, limite)] },
      }),
    ]);

    const candidatos = [
      ...puntuales,
      ...recurrentes.flatMap((evento) => expandirRecurrente(evento, ahora, limite)),
    ];

    const recordatorios = candidatos
      .filter((evento) => {
        const minutos = evento.alertaMinutos ?? ALERTA_MINUTOS_DEFAULT;
        const faltanMs = new Date(evento.fechaInicio).getTime() - ahora.getTime();
        return minutos > 0 && faltanMs >= 0 && faltanMs <= minutos * 60 * 1000;
      })
      .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    return res.json({ recordatorios });
  } catch (error) {
    console.error('[agenda.recordatorios]', error);
    return res.status(500).json({ error: 'Error al consultar recordatorios' });
  }
};


module.exports = {
  feriadosMexico,
  listar,
  crear,
  editar,
  responderInvitacion,
  invitacionesPendientes,
  eliminar,
  consultarDisponibilidad,
  getConfigLaboral,
  updateConfigLaboral,
  listarDiasEspeciales,
  crearDiaEspecial,
  eliminarDiaEspecial,
  getGoogleCalendarStatus,
  connectGoogleCalendarController,
  disconnectGoogleCalendarController,
  recordatoriosProximos,
  // Funciones puras, exportadas para poder probarlas sin base de datos
  expandirRecurrente,
  feriadosMexico,
  idBaseEvento,
  normalizarPatronRecurrencia,
};
