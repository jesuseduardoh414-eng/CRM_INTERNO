/**
 * Avisos por correo de trabajo y agenda, ademas del aviso dentro del CRM:
 *  - al momento: tarea asignada, varias tareas asignadas (importacion),
 *    agregado a un proyecto, invitacion a un evento o reunion;
 *  - programados (cada minuto): recordatorio antes de que empiece un evento
 *    y resumen diario (vencen hoy/mañana, vencidas, proyectos por terminar).
 *
 * Todo es "best effort": un correo que falla nunca rompe la peticion. Cada
 * aviso programado se registra en `avisos_enviados` ANTES de enviarse, asi no
 * se repite aunque haya dos instancias del servidor o un reinicio.
 * Cada tipo se apaga desde el panel (configuracion.avisos.correo*).
 */
const prisma = require('../lib/prisma');
const { configEnCache } = require('./configuracion.service');
const { enviarPlantillaSinBloquear } = require('./email.service');
const { instanteLocal, partesDiaMexico, claveDiaMexico, zonaHoraria } = require('../utils/fechas.utils');
const { ESTADOS_PROYECTO_OCULTOS } = require('../utils/estados.utils');

const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MINUTO_MS;
const PRIORIDADES = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta' };
const ACTIVO = { OR: [{ estado: 'activo' }, { estado: null }] };
// Las filas "Proyecto: X" solo pintan la duracion de un proyecto en la agenda.
const SIN_FILAS_DE_PROYECTO = {
  OR: [
    { tipo: { not: 'dia_completo' } },
    { titulo: { not: { startsWith: 'Proyecto:' } } },
    { invitados: { some: {} } },
  ],
};

const avisos = () => configEnCache().avisos || {};
const urlFrontend = () => String(process.env.FRONTEND_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');

/** Personas activas con correo, sin el autor del cambio. */
const destinatarios = async (ids, actorId = null) => {
  const unicos = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== Number(actorId)))];
  if (!unicos.length) return [];
  return prisma.usuario.findMany({
    where: { id: { in: unicos }, rol: { in: ['ADMIN', 'MIEMBRO'] }, email: { not: '' }, ...ACTIVO },
    select: { id: true, nombre: true, email: true },
  });
};

const nombreDe = async (usuarioId) => (usuarioId
  ? (await prisma.usuario.findUnique({ where: { id: Number(usuarioId) }, select: { nombre: true } }))?.nombre
  : null) || 'Alguien';

const primerNombre = (nombre) => String(nombre || '').trim().split(/\s+/)[0] || '';

// ── Formato de fechas en la zona de la empresa ──────────────────────────────
const fmt = (fecha, opciones) => new Intl.DateTimeFormat('es-MX', { timeZone: zonaHoraria(), ...opciones }).format(new Date(fecha));
const fechaLarga = (fecha) => fmt(fecha, { weekday: 'long', day: 'numeric', month: 'long' });
const horaCorta = (fecha) => fmt(fecha, { hour: '2-digit', minute: '2-digit' });

/** "lunes 12 de octubre, 11:00 a 12:00" (o "todo el día"). */
const describirCuando = ({ fechaInicio, fechaFin, todoElDia }) => {
  if (todoElDia) return `${fechaLarga(fechaInicio)} · todo el día`;
  const mismoDia = fechaFin && claveDiaMexico(fechaFin) === claveDiaMexico(fechaInicio);
  if (!fechaFin) return `${fechaLarga(fechaInicio)}, ${horaCorta(fechaInicio)}`;
  return mismoDia
    ? `${fechaLarga(fechaInicio)}, ${horaCorta(fechaInicio)} a ${horaCorta(fechaFin)}`
    : `${fechaLarga(fechaInicio)} ${horaCorta(fechaInicio)} al ${fechaLarga(fechaFin)} ${horaCorta(fechaFin)}`;
};

const describirLugar = (evento) => {
  if (evento.modalidad === 'virtual') return evento.urlReunion ? `Videollamada: ${evento.urlReunion}` : 'Reunión virtual';
  return evento.ubicacion ? `Lugar: ${evento.ubicacion}` : 'Presencial';
};

// ── Al momento ──────────────────────────────────────────────────────────────

/** Tarea asignada a una o varias personas (sin avisar al autor). */
const avisarTareaAsignada = async ({ usuarioIds = [], actorId, tareaId }) => {
  if (!avisos().correoAsignaciones || !tareaId) return;
  try {
    const [personas, tarea, actor] = await Promise.all([
      destinatarios(usuarioIds, actorId),
      prisma.tarea.findUnique({ where: { id: Number(tareaId) }, select: { id: true, titulo: true, prioridad: true, venceEn: true, proyecto: { select: { id: true, nombre: true } } } }),
      nombreDe(actorId),
    ]);
    if (!tarea) return;
    personas.forEach((p) => enviarPlantillaSinBloquear(p.email, 'tareaAsignada', {
      nombre: primerNombre(p.nombre),
      actor,
      tarea: tarea.titulo,
      proyecto: tarea.proyecto?.nombre || '—',
      prioridad: PRIORIDADES[tarea.prioridad] || tarea.prioridad || 'Media',
      vence: tarea.venceEn ? fechaLarga(tarea.venceEn) : 'sin fecha límite',
    }, { url: `${urlFrontend()}/proyectos/${tarea.proyecto?.id || ''}` }));
  } catch (error) {
    console.error('[avisosCorreo.tareaAsignada]', error?.message || error);
  }
};

/** Varias tareas de golpe (importacion): un solo correo por persona. */
const avisarTareasAsignadas = async ({ porUsuario, proyectoId, proyectoNombre }) => {
  if (!avisos().correoAsignaciones || !porUsuario?.size) return;
  try {
    const personas = await destinatarios([...porUsuario.keys()]);
    personas.forEach((p) => {
      const tareas = porUsuario.get(p.id) || [];
      if (tareas.length === 1) {
        avisarTareaAsignada({ usuarioIds: [p.id], tareaId: tareas[0].id });
        return;
      }
      const detalle = tareas.slice(0, 15).map((t) => `• ${t.titulo}${t.venceEn ? ` — vence ${fechaLarga(t.venceEn)}` : ''}`).join('\n')
        + (tareas.length > 15 ? `\n… y ${tareas.length - 15} más` : '');
      enviarPlantillaSinBloquear(p.email, 'tareasAsignadas', {
        nombre: primerNombre(p.nombre), cantidad: tareas.length, proyecto: proyectoNombre || '—', detalle,
      }, { url: `${urlFrontend()}/proyectos/${proyectoId || ''}` });
    });
  } catch (error) {
    console.error('[avisosCorreo.tareasAsignadas]', error?.message || error);
  }
};

/** Personas agregadas al equipo de un proyecto. */
const avisarProyectoAsignado = async ({ usuarioIds = [], actorId, proyecto }) => {
  if (!avisos().correoAsignaciones || !proyecto?.id) return;
  try {
    const [personas, actor] = await Promise.all([destinatarios(usuarioIds, actorId), nombreDe(actorId)]);
    personas.forEach((p) => enviarPlantillaSinBloquear(p.email, 'proyectoAsignado', {
      nombre: primerNombre(p.nombre), actor, proyecto: proyecto.nombre,
    }, { url: `${urlFrontend()}/proyectos/${proyecto.id}` }));
  } catch (error) {
    console.error('[avisosCorreo.proyectoAsignado]', error?.message || error);
  }
};

/** Invitacion a un evento o reunion. */
const avisarInvitacionEvento = async ({ usuarioIds = [], actorId, eventoId }) => {
  if (!avisos().correoInvitaciones || !eventoId) return;
  try {
    const [personas, evento, actor] = await Promise.all([
      destinatarios(usuarioIds, actorId),
      prisma.evento.findUnique({ where: { id: String(eventoId) } }),
      nombreDe(actorId),
    ]);
    if (!evento) return;
    personas.forEach((p) => enviarPlantillaSinBloquear(p.email, 'eventoInvitacion', {
      nombre: primerNombre(p.nombre), actor, evento: evento.titulo, cuando: describirCuando(evento), lugar: describirLugar(evento),
    }, { url: `${urlFrontend()}/agenda?evento=${evento.id}` }));
  } catch (error) {
    console.error('[avisosCorreo.invitacion]', error?.message || error);
  }
};

// ── Programados ─────────────────────────────────────────────────────────────

/** Registra el aviso; devuelve false si ya se habia enviado. */
const reservar = async (clave) => {
  try {
    await prisma.avisoEnviado.create({ data: { clave: clave.slice(0, 191) } });
    return true;
  } catch (error) {
    if (error?.code === 'P2002') return false;
    throw error;
  }
};

const faltanTexto = (minutos) => {
  if (minutos >= 1440) return `${Math.round(minutos / 1440)} día(s)`;
  if (minutos >= 60) return `${Math.round(minutos / 60)} h`;
  return `${Math.max(1, Math.round(minutos))} minutos`;
};

/** Eventos que empiezan pronto: se avisa al dueño y a los invitados que no rechazaron. */
const revisarRecordatorios = async () => {
  if (!avisos().correoRecordatorios) return;
  const ahora = Date.now();
  const porDefecto = avisos().minutosRecordatorio || 30;
  const eventos = await prisma.evento.findMany({
    where: {
      AND: [
        SIN_FILAS_DE_PROYECTO,
        { patronRecurrencia: null },
        { fechaInicio: { gt: new Date(ahora), lte: new Date(ahora + 2 * DIA_MS) } },
      ],
    },
    include: { invitados: { select: { usuarioId: true, estado: true } } },
  });
  for (const evento of eventos) {
    const minutosAntes = evento.alertaMinutos ?? porDefecto;
    if (!minutosAntes || minutosAntes <= 0) continue;
    const inicio = new Date(evento.fechaInicio).getTime();
    if (ahora < inicio - minutosAntes * MINUTO_MS) continue;
    const ids = [evento.usuarioId, ...evento.invitados.filter((i) => i.estado !== 'rechazado').map((i) => i.usuarioId)];
    const personas = await destinatarios(ids);
    for (const p of personas) {
      if (!(await reservar(`evt:${evento.id}:${evento.fechaInicio.toISOString()}:${p.id}`))) continue;
      enviarPlantillaSinBloquear(p.email, 'eventoRecordatorio', {
        nombre: primerNombre(p.nombre),
        evento: evento.titulo,
        cuando: describirCuando(evento),
        lugar: describirLugar(evento),
        faltan: faltanTexto((inicio - ahora) / MINUTO_MS),
      }, { url: `${urlFrontend()}/agenda?evento=${evento.id}` });
    }
  }
};

/** Una vez al dia, desde la hora configurada, en dias laborales de la empresa. */
const revisarResumenDiario = async () => {
  const cfg = avisos();
  if (!cfg.correoResumenDiario) return;
  const hoy = claveDiaMexico();
  const partesHoy = partesDiaMexico();
  const [h, m] = String(cfg.horaResumen || '08:00').split(':').map(Number);
  if (Date.now() < instanteLocal(partesHoy, h, m).getTime()) return;
  const diaSemana = (() => { const d = new Date(`${hoy}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; })();
  if (!(configEnCache().operacion?.diasLaborales || [1, 2, 3, 4, 5]).includes(diaSemana)) return;
  if (!(await reservar(`resumen:${hoy}`))) return; // un solo barrido por dia

  const finManana = new Date(instanteLocal(partesHoy, 0).getTime() + 2 * DIA_MS - 1);
  const en3Dias = new Date(instanteLocal(partesHoy, 0).getTime() + 4 * DIA_MS - 1);
  const personas = await prisma.usuario.findMany({
    where: { rol: { in: ['MIEMBRO', 'ADMIN'] }, email: { not: '' }, ...ACTIVO },
    select: { id: true, nombre: true, email: true },
  });
  const inicioHoy = instanteLocal(partesHoy, 0);
  const inicioManana = new Date(inicioHoy.getTime() + DIA_MS);

  for (const p of personas) {
    const [tareas, proyectos] = await Promise.all([
      prisma.tarea.findMany({
        where: {
          estado: { not: 'HECHO' },
          venceEn: { not: null, lte: finManana },
          OR: [{ asignadoId: p.id }, { asignados: { some: { id: p.id } } }],
          proyecto: { estado: { notIn: ESTADOS_PROYECTO_OCULTOS } },
        },
        select: { titulo: true, venceEn: true, proyecto: { select: { nombre: true } } },
        orderBy: { venceEn: 'asc' },
        take: 40,
      }),
      prisma.proyecto.findMany({
        where: {
          estado: { notIn: ESTADOS_PROYECTO_OCULTOS },
          fechaFin: { gte: inicioHoy, lte: en3Dias },
          miembros: { some: { id: p.id } },
        },
        select: { nombre: true, fechaFin: true },
      }),
    ]);
    if (!tareas.length && !proyectos.length) continue;

    const grupo = (lista, titulo) => (lista.length
      ? `**${titulo}**\n${lista.slice(0, 10).map((t) => `• ${t.titulo}${t.proyecto?.nombre ? ` (${t.proyecto.nombre})` : ''}`).join('\n')}${lista.length > 10 ? `\n… y ${lista.length - 10} más` : ''}`
      : null);
    const vencidas = tareas.filter((t) => t.venceEn < inicioHoy);
    const deHoy = tareas.filter((t) => t.venceEn >= inicioHoy && t.venceEn < inicioManana);
    const deManana = tareas.filter((t) => t.venceEn >= inicioManana);
    const bloques = [
      grupo(vencidas, `Vencidas (${vencidas.length})`),
      grupo(deHoy, `Vencen hoy (${deHoy.length})`),
      grupo(deManana, `Vencen mañana (${deManana.length})`),
      proyectos.length ? `**Proyectos que terminan pronto**\n${proyectos.map((pr) => `• ${pr.nombre} — ${fechaLarga(pr.fechaFin)}`).join('\n')}` : null,
    ].filter(Boolean);

    if (!(await reservar(`resumen:${hoy}:${p.id}`))) continue;
    enviarPlantillaSinBloquear(p.email, 'resumenDiario', {
      nombre: primerNombre(p.nombre),
      cantidad: tareas.length + proyectos.length,
      detalle: bloques.join('\n\n'),
    }, { url: `${urlFrontend()}/dashboard` });
  }
};

/** Borra el registro de avisos de hace mas de 45 dias. */
const limpiarRegistro = () => prisma.avisoEnviado.deleteMany({ where: { creadoEn: { lt: new Date(Date.now() - 45 * DIA_MS) } } });

let temporizador = null;
let enCurso = false;
const ciclo = async () => {
  if (enCurso) return;
  enCurso = true;
  try {
    await revisarRecordatorios();
    await revisarResumenDiario();
    if (new Date().getMinutes() === 0) await limpiarRegistro();
  } catch (error) {
    console.error('[avisosCorreo.ciclo]', error?.message || error);
  } finally {
    enCurso = false;
  }
};

/** Arranca la revision cada minuto (una vez por proceso). */
const iniciarAvisosProgramados = () => {
  if (temporizador || process.env.AVISOS_CORREO === 'off') return;
  temporizador = setInterval(ciclo, MINUTO_MS);
  temporizador.unref?.();
  setTimeout(ciclo, 15 * 1000).unref?.();
};

module.exports = {
  avisarTareaAsignada,
  avisarTareasAsignadas,
  avisarProyectoAsignado,
  avisarInvitacionEvento,
  revisarRecordatorios,
  revisarResumenDiario,
  iniciarAvisosProgramados,
};
