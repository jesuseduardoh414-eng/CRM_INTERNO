// Agenda: calendario de la empresa (festivos, no laborables, cierres...),
// vista de equipo para administradores y sugerencia de horarios libres para
// reuniones. Todas las fechas de día viajan como 'YYYY-MM-DD' en la zona de
// la empresa.
const prisma = require('../lib/prisma');
const { instanteLocal, partesDiaMexico, claveDiaMexico } = require('../utils/fechas.utils');
const { puede, alcanceDe } = require('../utils/permisosArea.utils');
const { configEnCache } = require('../services/configuracion.service');
const { feriadosMexico } = require('./agenda.controller');
const { horarioDelDia } = require('../utils/horarios.utils');
const FIN_INDEFINIDO = '2099-12-31';

const DIA_MS = 24 * 60 * 60 * 1000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
// 'homeoffice' y 'especial' son laborables: solo informan.
const TIPOS_DIA_EMPRESA = ['festivo', 'no_laboral', 'cierre', 'puente', 'homeoffice', 'especial'];
// Tipos que hacen que nadie trabaje ese día ('especial' solo informa).
const TIPOS_DIA_SIN_TRABAJO = ['festivo', 'no_laboral', 'cierre', 'puente'];
// Días personales que impiden agendar a la persona (home office no).
const TIPOS_PERSONALES_AUSENTE = ['vacacion', 'permiso', 'descanso', 'incapacidad', 'festivo'];
const MAX_DIAS_EQUIPO = 42;
const MAX_DIAS_CALENDARIO = 400;
const ACTIVO = { OR: [{ estado: 'activo' }, { estado: null }] };

// ── Utilidades de días civiles ──────────────────────────────────────────────
const claveDe = (fecha) => fecha.toISOString().slice(0, 10); // columnas @db.Date
const fechaDeClave = (clave) => new Date(`${clave}T12:00:00.000Z`);
const sumarDias = (clave, n) => claveDe(new Date(fechaDeClave(clave).getTime() + n * DIA_MS));
const partesDeClave = (clave) => {
  const [year, mes, day] = clave.split('-').map(Number);
  return { year, month: mes - 1, day };
};
const diaSemana = (clave) => { const d = fechaDeClave(clave).getUTCDay(); return d === 0 ? 7 : d; }; // 1 = lunes
// '2026-13-01' daria Invalid Date y toISOString lanzaria: se revisa antes.
const esFechaValida = (clave) => {
  if (!REGEX_FECHA.test(String(clave || ''))) return false;
  const fecha = fechaDeClave(clave);
  return !Number.isNaN(fecha.getTime()) && claveDe(fecha) === clave;
};
const minutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };

/** Rango ?desde&hasta en claves; por defecto la semana actual (lunes a domingo). */
const leerRango = (query, maxDias, porDefectoDias = 7) => {
  const hoy = claveDiaMexico();
  const lunes = sumarDias(hoy, 1 - diaSemana(hoy));
  const desde = esFechaValida(query.desde) ? query.desde : lunes;
  const hasta = esFechaValida(query.hasta) ? query.hasta : sumarDias(desde, porDefectoDias - 1);
  if (hasta < desde) return { error: 'La fecha final es anterior a la inicial' };
  const dias = Math.round((fechaDeClave(hasta) - fechaDeClave(desde)) / DIA_MS) + 1;
  if (dias > maxDias) return { error: `El rango no puede pasar de ${maxDias} días` };
  return { desde, hasta, dias };
};

/**
 * Áreas cuyos días ve el usuario: todas con "agenda.diasEmpresa" = todos (el
 * administrador general siempre); los demás, empresa + su área.
 */
const diasDeTodas = (usuario) => alcanceDe(usuario, 'agenda.diasEmpresa') === 'todos';
const filtroAreaVisible = (usuario) => (diasDeTodas(usuario)
  ? {}
  : { OR: [{ area: null }, { area: usuario.area }] });

/**
 * Días de la empresa dentro del rango, uno por fecha. Los que se repiten cada
 * año se proyectan a cada año del rango; los feriados oficiales se agregan si
 * el panel no los apagó (operacion.feriadosOficiales).
 */
const diasEmpresaEnRango = async (desde, hasta, filtroArea = {}) => {
  const registros = await prisma.diaEmpresa.findMany({
    where: {
      AND: [
        filtroArea,
        { OR: [
          { repetirAnual: true },
          { fechaInicio: { lte: fechaDeClave(hasta) }, fechaFin: { gte: fechaDeClave(desde) } },
        ] },
      ],
    },
    orderBy: { fechaInicio: 'asc' },
  });
  const salida = [];
  const anios = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a += 1) anios.push(a);

  for (const r of registros) {
    const inicio = claveDe(r.fechaInicio);
    const fin = claveDe(r.fechaFin);
    const largo = Math.round((fechaDeClave(fin) - fechaDeClave(inicio)) / DIA_MS);
    // Repeticion semanal dentro del periodo (p. ej. "cada viernes"); null = todos.
    const semana = Array.isArray(r.diasSemana) && r.diasSemana.length ? r.diasSemana.map(Number) : null;
    const arranques = r.repetirAnual && !semana ? anios.map((a) => `${a}${inicio.slice(4)}`) : [inicio];
    for (const arranque of arranques) {
      if (!esFechaValida(arranque)) continue; // 29 de febrero en año no bisiesto
      const ultimo = sumarDias(arranque, largo);
      const primero = arranque > desde ? arranque : desde;
      const tope = ultimo < hasta ? ultimo : hasta;
      for (let fecha = primero; fecha <= tope; fecha = sumarDias(fecha, 1)) {
        if (semana && !semana.includes(diaSemana(fecha))) continue;
        salida.push({
          id: r.id, fecha, tipo: r.tipo, nombre: r.nombre, descripcion: r.descripcion,
          area: r.area, repetirAnual: r.repetirAnual, diasSemana: semana, fechaInicio: inicio, fechaFin: fin === FIN_INDEFINIDO ? null : fin, oficial: false,
        });
      }
    }
  }

  if (configEnCache().operacion?.feriadosOficiales !== false) {
    const ocupadas = new Set(salida.filter((d) => !d.area).map((d) => d.fecha));
    for (const anio of anios) {
      for (const f of feriadosMexico(anio)) {
        const fecha = claveDe(f.fecha);
        if (fecha < desde || fecha > hasta || ocupadas.has(fecha)) continue;
        salida.push({ id: `oficial-${fecha}`, fecha, tipo: 'festivo', nombre: f.descripcion, descripcion: null, area: null, repetirAnual: true, oficial: true });
      }
    }
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
};

// ── GET /api/agenda/dias-empresa?desde=&hasta= ──────────────────────────────
const listarDiasEmpresa = async (req, res) => {
  const rango = leerRango(req.query, MAX_DIAS_CALENDARIO, 31);
  if (rango.error) return res.status(400).json({ error: rango.error });
  try {
    const dias = await diasEmpresaEnRango(rango.desde, rango.hasta, filtroAreaVisible(req.usuario));
    return res.json({ desde: rango.desde, hasta: rango.hasta, dias, puedeEditar: puede(req.usuario, 'agenda.diasEmpresa') });
  } catch (error) {
    console.error('[agenda.diasEmpresa]', error);
    return res.status(500).json({ error: 'No se pudo leer el calendario de la empresa' });
  }
};

// ── GET /api/agenda/dias-empresa/registros — lista para administrar ─────────
const registrosDiasEmpresa = async (req, res) => {
  try {
    const registros = await prisma.diaEmpresa.findMany({
      where: filtroAreaVisible(req.usuario),
      orderBy: [{ repetirAnual: 'desc' }, { fechaInicio: 'asc' }],
      include: { creadoPor: { select: { id: true, nombre: true } } },
    });
    return res.json({
      registros: registros.map((r) => {
        const fin = claveDe(r.fechaFin);
        return { ...r, fechaInicio: claveDe(r.fechaInicio), fechaFin: fin === FIN_INDEFINIDO ? null : fin, sinFin: fin === FIN_INDEFINIDO };
      }),
      feriadosOficiales: configEnCache().operacion?.feriadosOficiales !== false,
    });
  } catch (error) {
    console.error('[agenda.registrosDiasEmpresa]', error);
    return res.status(500).json({ error: 'No se pudo leer el calendario de la empresa' });
  }
};

// ── POST /api/agenda/dias-empresa (admin) ───────────────────────────────────
const crearDiaEmpresa = async (req, res) => {
  const { fechaInicio, fechaFin, tipo, nombre, descripcion, repetirAnual, area, diasSemana } = req.body || {};
  const semana = Array.isArray(diasSemana)
    ? [...new Set(diasSemana.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort()
    : [];
  // Repeticion semanal sin fecha de fin = todas las semanas desde la de inicio.
  const sinFin = semana.length > 0 && (req.body?.sinFin === true || !fechaFin);
  const fin = sinFin ? FIN_INDEFINIDO : (fechaFin || fechaInicio);
  if (!esFechaValida(fechaInicio) || !esFechaValida(fin)) return res.status(400).json({ error: 'Fechas no válidas (usa YYYY-MM-DD)' });
  if (fin < fechaInicio) return res.status(400).json({ error: 'La fecha final es anterior a la inicial' });
  // Con repeticion semanal el periodo puede ser largo (p. ej. todos los viernes del año).
  const maxPeriodo = semana.length ? 366 : 60;
  if (!sinFin && (fechaDeClave(fin) - fechaDeClave(fechaInicio)) / DIA_MS > maxPeriodo) return res.status(400).json({ error: `Un periodo no puede pasar de ${maxPeriodo} días` });
  if (!TIPOS_DIA_EMPRESA.includes(tipo)) return res.status(400).json({ error: 'Tipo de día no válido' });
  const nombreLimpio = String(nombre || '').trim().slice(0, 120);
  if (nombreLimpio.length < 2) return res.status(400).json({ error: 'Ponle un nombre (por ejemplo, Día de la Independencia)' });

  // Con alcance "area" solo se marcan días de la propia área; con "todos",
  // para la empresa o el área que se elija.
  let areaFinal = area ? String(area).toUpperCase() : null;
  if (!diasDeTodas(req.usuario)) areaFinal = req.usuario.area;
  if (areaFinal && !configEnCache().reglas.areas.some((a) => a.clave === areaFinal)) {
    return res.status(400).json({ error: 'Área no válida' });
  }
  try {
    const dia = await prisma.diaEmpresa.create({
      data: {
        fechaInicio: fechaDeClave(fechaInicio),
        fechaFin: fechaDeClave(fin),
        tipo,
        nombre: nombreLimpio,
        descripcion: descripcion ? String(descripcion).trim().slice(0, 2000) || null : null,
        // Lo semanal ya se repite solo; "cada año" aplica a fechas sueltas.
        repetirAnual: !semana.length && (repetirAnual === true || repetirAnual === 'true'),
        diasSemana: semana.length && semana.length < 7 ? semana : undefined,
        area: areaFinal,
        creadoPorId: req.usuario.id,
      },
    });
    return res.status(201).json({ mensaje: 'Día agregado al calendario de la empresa', dia: { ...dia, fechaInicio, fechaFin: fin } });
  } catch (error) {
    console.error('[agenda.crearDiaEmpresa]', error);
    return res.status(500).json({ error: 'No se pudo guardar el día' });
  }
};

// ── DELETE /api/agenda/dias-empresa/:id (admin) ─────────────────────────────
const eliminarDiaEmpresa = async (req, res) => {
  try {
    const dia = await prisma.diaEmpresa.findUnique({ where: { id: String(req.params.id) } });
    if (!dia) return res.status(404).json({ error: 'No existe ese día' });
    if (!diasDeTodas(req.usuario) && dia.area !== req.usuario.area) {
      return res.status(403).json({ error: 'Solo puedes quitar los días de tu área' });
    }
    await prisma.diaEmpresa.delete({ where: { id: dia.id } });
    return res.json({ mensaje: 'Día quitado del calendario' });
  } catch (error) {
    console.error('[agenda.eliminarDiaEmpresa]', error);
    return res.status(500).json({ error: 'No se pudo quitar el día' });
  }
};

// ── Horario de cada persona (o el de la empresa si no tiene uno propio) ─────
const horariosDe = async (ids) => {
  const op = configEnCache().operacion;
  const propios = await prisma.configuracionLaboral.findMany({ where: { usuarioId: { in: ids } } });
  const porUsuario = new Map(propios.map((c) => [c.usuarioId, c]));
  return new Map(ids.map((id) => {
    const c = porUsuario.get(id);
    const valido = (h, def) => (REGEX_HORA.test(h || '') ? h : def);
    return [id, {
      diasLaborales: Array.isArray(c?.diasLaborales) ? c.diasLaborales.map(Number) : (op.diasLaborales || [1, 2, 3, 4, 5]),
      horaEntrada: valido(c?.horaEntrada, op.horaEntrada || '09:00'),
      horaSalida: valido(c?.horaSalida, op.horaSalida || '18:00'),
      horaComidaInicio: valido(c?.horaComidaInicio, op.horaComidaInicio || '14:00'),
      horaComidaFin: valido(c?.horaComidaFin, op.horaComidaFin || '15:00'),
      horariosPorDia: (c ? c.horariosPorDia : op.horariosPorDia) || {},
    }];
  }));
};

// Las filas 'Proyecto: X' (todo el dia, sin invitados) solo pintan la duracion
// de un proyecto en la agenda: no son reuniones ni deben bloquear horarios.
const SIN_FILAS_DE_PROYECTO = {
  OR: [
    { tipo: { not: 'dia_completo' } },
    { titulo: { not: { startsWith: 'Proyecto:' } } },
    { invitados: { some: {} } },
  ],
};

/** Eventos (propios o donde es invitado y no rechazó) que tocan el rango. */
const eventosDe = (ids, inicio, fin) => prisma.evento.findMany({
  where: {
    fechaInicio: { lte: fin },
    OR: [{ fechaFin: { gte: inicio } }, { fechaFin: null, fechaInicio: { gte: inicio } }],
    AND: [SIN_FILAS_DE_PROYECTO, { OR: [
      { usuarioId: { in: ids } },
      { invitados: { some: { usuarioId: { in: ids }, estado: { not: 'rechazado' } } } },
    ] }],
  },
  select: {
    id: true, titulo: true, tipo: true, modalidad: true, fechaInicio: true, fechaFin: true, todoElDia: true, color: true, usuarioId: true,
    invitados: { select: { usuarioId: true, estado: true } },
  },
  orderBy: { fechaInicio: 'asc' },
});

// ── GET /api/agenda/equipo?desde=&hasta= (admin) ────────────────────────────
// Cada persona con sus tareas, reuniones y ausencias en el rango.
const agendaEquipo = async (req, res) => {
  const rango = leerRango(req.query, MAX_DIAS_EQUIPO);
  if (rango.error) return res.status(400).json({ error: rango.error });
  try {
    const personas = await prisma.usuario.findMany({
      where: {
        rol: { in: ['MIEMBRO', 'ADMIN'] },
        ...ACTIVO,
        ...(alcanceDe(req.usuario, 'agenda.equipo') === 'todos' ? {} : { area: req.usuario.area }),
      },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, area: true, rol: true, fotoPerfilUrl: true },
    });
    const ids = personas.map((p) => p.id);
    const inicio = instanteLocal(partesDeClave(rango.desde), 0);
    const fin = new Date(instanteLocal(partesDeClave(sumarDias(rango.hasta, 1)), 0).getTime() - 1);

    const [horarios, eventos, tareas, especiales, diasEmpresa] = await Promise.all([
      horariosDe(ids),
      ids.length ? eventosDe(ids, inicio, fin) : [],
      ids.length ? prisma.tarea.findMany({
        where: {
          OR: [{ asignadoId: { in: ids } }, { asignados: { some: { id: { in: ids } } } }],
          AND: [
            { OR: [{ estado: { not: 'HECHO' } }, { completadoEn: { gte: inicio, lte: fin } }] },
            { OR: [
              { venceEn: { gte: inicio, lte: fin } },
              { fechaInicio: { lte: fin }, venceEn: { gte: inicio } },
            ] },
          ],
        },
        select: {
          id: true, titulo: true, estado: true, prioridad: true, fechaInicio: true, venceEn: true, completadoEn: true,
          asignadoId: true, asignados: { select: { id: true } }, proyecto: { select: { id: true, nombre: true } },
        },
        orderBy: { venceEn: 'asc' },
      }) : [],
      ids.length ? prisma.diaEspecial.findMany({
        where: { usuarioId: { in: ids }, fecha: { gte: fechaDeClave(rango.desde), lte: fechaDeClave(rango.hasta) } },
        select: { id: true, usuarioId: true, fecha: true, tipo: true, descripcion: true, horaInicio: true, horaFin: true },
      }) : [],
      diasEmpresaEnRango(rango.desde, rango.hasta, filtroAreaVisible(req.usuario)),
    ]);

    const resultado = personas.map((p) => ({
      ...p,
      horario: horarios.get(p.id),
      eventos: eventos
        .filter((e) => e.usuarioId === p.id || e.invitados.some((i) => i.usuarioId === p.id && i.estado !== 'rechazado'))
        .map(({ invitados, usuarioId, ...e }) => ({
          ...e,
          propio: usuarioId === p.id,
          estadoInvitacion: invitados.find((i) => i.usuarioId === p.id)?.estado || null,
        })),
      tareas: tareas
        .filter((t) => t.asignadoId === p.id || t.asignados.some((a) => a.id === p.id))
        .map(({ asignados, asignadoId, ...t }) => t),
      diasEspeciales: especiales
        .filter((d) => d.usuarioId === p.id)
        .map(({ usuarioId, fecha, ...d }) => ({ ...d, fecha: claveDe(fecha) })),
    }));
    return res.json({ desde: rango.desde, hasta: rango.hasta, diasEmpresa, personas: resultado });
  } catch (error) {
    console.error('[agenda.equipo]', error);
    return res.status(500).json({ error: 'No se pudo cargar la agenda del equipo' });
  }
};

// ── GET /api/agenda/sugerir-horarios ────────────────────────────────────────
// ?usuarios_ids=1,2&desde=YYYY-MM-DD&dias=7&duracion=60&excluir_id=<evento>
// Huecos en que todos (incluido quien organiza) están libres: dentro del
// horario laboral de cada uno, fuera de la comida, sin reuniones, sin
// ausencias y sin días no laborables de la empresa.
const sugerirHorarios = async (req, res) => {
  const ids = [...new Set([req.usuario.id, ...String(req.query.usuarios_ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)])].slice(0, 30);
  const duracion = Math.min(480, Math.max(15, Number.parseInt(req.query.duracion, 10) || 60));
  const dias = Math.min(14, Math.max(1, Number.parseInt(req.query.dias, 10) || 7));
  const hoy = claveDiaMexico();
  const desde = esFechaValida(req.query.desde) && req.query.desde >= hoy ? req.query.desde : hoy;
  const hasta = sumarDias(desde, dias - 1);
  const maximo = Math.min(20, Math.max(1, Number.parseInt(req.query.max, 10) || 8));
  try {
    const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids }, rol: { in: ['ADMIN', 'MIEMBRO'] } }, select: { id: true, nombre: true, area: true } });
    const idsValidos = usuarios.map((u) => u.id);
    const inicioRango = instanteLocal(partesDeClave(desde), 0);
    const finRango = instanteLocal(partesDeClave(sumarDias(hasta, 1)), 0);
    const [horarios, eventos, especiales, diasEmpresa] = await Promise.all([
      horariosDe(idsValidos),
      eventosDe(idsValidos, inicioRango, finRango),
      prisma.diaEspecial.findMany({
        where: { usuarioId: { in: idsValidos }, fecha: { gte: fechaDeClave(desde), lte: fechaDeClave(hasta) }, tipo: { in: TIPOS_PERSONALES_AUSENTE } },
        select: { usuarioId: true, fecha: true, horaInicio: true, horaFin: true },
      }),
      diasEmpresaEnRango(desde, hasta, {}),
    ]);
    const excluir = String(req.query.excluir_id || '').split('_')[0];
    const ocupados = eventos.filter((e) => e.id !== excluir);
    const ausentes = new Set(especiales.filter((d) => !d.horaInicio).map((d) => `${d.usuarioId}|${claveDe(d.fecha)}`));
    // Ausencias de solo unas horas: bloquean ese tramo, no el dia.
    const parciales = especiales.filter((d) => d.horaInicio && d.horaFin)
      .map((d) => ({ fecha: claveDe(d.fecha), desde: minutos(d.horaInicio), hasta: minutos(d.horaFin) }));
    const ahora = Date.now() + 15 * 60 * 1000;

    const slots = [];
    for (let i = 0; i < dias && slots.length < maximo; i += 1) {
      const clave = sumarDias(desde, i);
      const cierreEmpresa = diasEmpresa.some((d) => d.fecha === clave && TIPOS_DIA_SIN_TRABAJO.includes(d.tipo)
        && (!d.area || usuarios.some((u) => u.area === d.area)));
      if (cierreEmpresa) continue;
      // Ventana común: la entrada más tarde y la salida más temprana.
      let inicioMin = 0;
      let finMin = 24 * 60;
      const comidas = [];
      let todos = true;
      for (const u of usuarios) {
        // Horario de ese dia de la semana (p. ej. sabado medio turno).
        const h = horarioDelDia(horarios.get(u.id), diaSemana(clave));
        if (!h.laboral || ausentes.has(`${u.id}|${clave}`)) { todos = false; break; }
        inicioMin = Math.max(inicioMin, minutos(h.entrada));
        finMin = Math.min(finMin, minutos(h.salida));
        if (h.comidaInicio && h.comidaFin) comidas.push([minutos(h.comidaInicio), minutos(h.comidaFin)]);
      }
      if (!todos || finMin - inicioMin < duracion) continue;

      const partes = partesDeClave(clave);
      const delDia = ocupados.filter((e) => {
        const ini = new Date(e.fechaInicio).getTime();
        const fin = e.fechaFin ? new Date(e.fechaFin).getTime() : ini + 60 * 60 * 1000;
        return ini < instanteLocal(partes, 24).getTime() && fin > instanteLocal(partes, 0).getTime();
      });
      if (delDia.some((e) => e.todoElDia)) continue;

      for (let m = inicioMin; m + duracion <= finMin && slots.length < maximo; m += 30) {
        const ini = instanteLocal(partes, Math.floor(m / 60), m % 60);
        const fin = new Date(ini.getTime() + duracion * 60000);
        if (ini.getTime() < ahora) continue;
        if (comidas.some(([a, b]) => m < b && m + duracion > a)) continue;
        if (parciales.some((p) => p.fecha === clave && m < p.hasta && m + duracion > p.desde)) continue;
        const choca = delDia.some((e) => {
          const eIni = new Date(e.fechaInicio).getTime();
          const eFin = e.fechaFin ? new Date(e.fechaFin).getTime() : eIni + 60 * 60 * 1000;
          return eIni < fin.getTime() && eFin > ini.getTime();
        });
        if (!choca) {
          slots.push({ inicio: ini.toISOString(), fin: fin.toISOString(), fecha: clave });
          m += duracion - 30; // el siguiente hueco empieza al terminar este
        }
      }
    }
    return res.json({ desde, hasta, duracion, participantes: usuarios.map((u) => ({ id: u.id, nombre: u.nombre })), slots });
  } catch (error) {
    console.error('[agenda.sugerirHorarios]', error);
    return res.status(500).json({ error: 'No se pudieron calcular horarios libres' });
  }
};

module.exports = {
  TIPOS_DIA_EMPRESA,
  diasEmpresaEnRango,
  listarDiasEmpresa,
  registrosDiasEmpresa,
  crearDiaEmpresa,
  eliminarDiaEmpresa,
  agendaEquipo,
  sugerirHorarios,
};
