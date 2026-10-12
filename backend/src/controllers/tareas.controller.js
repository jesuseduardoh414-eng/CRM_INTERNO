// Controlador de Tareas
// GET    /api/proyectos/:id/tareas  → listar tareas de un proyecto
// POST   /api/proyectos/:id/tareas  → crear tarea
// PUT    /api/tareas/:id            → editar tarea
// DELETE /api/tareas/:id            → eliminar tarea
// PATCH  /api/tareas/:id/estado     → actualizar solo el estado

const prisma = require('../lib/prisma');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const { registrarActividad } = require('../utils/logger');
const { sortTareas } = require('../utils/sort.utils');
const { esAdmin, puedeAdministrarProyecto, puedeVerProyecto } = require('../utils/permissions.utils');
const { subirArchivo, borrarBlobs } = require('../utils/blob.utils');

const { configEnCache } = require('../services/configuracion.service');
const { instanteLocal, partesDiaMexico } = require('../utils/fechas.utils');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Catalogos cerrados. En el schema `estado` y `prioridad` son String (no hay
// enum), asi que la lista valida vive aqui, igual que en el importador.
const ESTADOS_TAREA = ['PENDIENTE', 'EN_PROGRESO', 'HECHO'];
const PRIORIDADES_TAREA = ['BAJA', 'MEDIA', 'ALTA'];

// Selector común para incluir datos del asignado sin exponer password
const INCLUDE_ASIGNADO = {
  asignado: {
    select: { id: true, nombre: true, area: true },
  },
  asignados: {
    select: { id: true, nombre: true, area: true },
  },
  creador: {
    select: { id: true, nombre: true, area: true },
  },
};

// Que tareas de un proyecto puede ver un MIEMBRO: las sin responsable, las
// suyas (principal o co-asignado) y las que creo. La misma regla la usa la
// exportacion, por eso se exporta.
const visibilidadTareasPara = (usuarioId) => ({
  OR: [
    { asignadoId: null },
    { asignadoId: usuarioId },
    { asignados: { some: { id: usuarioId } } },
    { creadorId: usuarioId },
  ],
});

const puedeAccederTarea = (tarea, usuarioId) => (
  !tarea.asignadoId
  || tarea.asignadoId === usuarioId
  || tarea.creadorId === usuarioId
  || tarea.asignados?.some((asignado) => asignado.id === usuarioId)
);

// ── Validacion de entrada ────────────────────────────────────────────────────
// Se lanza desde los helpers y el controlador la convierte en 400. Asi la
// validacion vive en un solo sitio y ningun dato malo termina en un 500.
class ErrorValidacion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacion';
    this.status = 400;
  }
}

// Respuesta de error unica: validacion → 400, registro inexistente (P2025) →
// 404, duplicado (P2002) → 409, referencia rota (P2003) → 400. El resto es un
// 500 con mensaje generico; el detalle solo va al log, nunca al cliente.
const responderError = (res, error, contexto) => {
  if (error instanceof ErrorValidacion) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 'P2025') {
    return res.status(404).json({ error: 'El registro ya no existe' });
  }
  if (error?.code === 'P2002') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  }
  if (error?.code === 'P2003') {
    return res.status(400).json({ error: 'Alguno de los datos hace referencia a un registro que no existe' });
  }
  console.error(contexto, error);
  return res.status(500).json({ error: 'Error interno del servidor' });
};

// Texto de un campo del body. Con multipart todo llega como string, pero con
// JSON puede venir un numero, null o un objeto: nunca se llama `.trim()` sobre
// algo que no sea string (antes un `.trim()` fuera del try dejaba la peticion
// colgada sin respuesta).
const textoDeCampo = (valor) => {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
};

// undefined si no viene; si viene, tiene que estar en el catalogo.
const validarEstado = (valor) => {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const estado = String(valor).trim().toUpperCase();
  if (!ESTADOS_TAREA.includes(estado)) {
    throw new ErrorValidacion(`Estado inválido. Debe ser: ${ESTADOS_TAREA.join(', ')}`);
  }
  return estado;
};

const validarPrioridad = (valor) => {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const prioridad = String(valor).trim().toUpperCase();
  if (!PRIORIDADES_TAREA.includes(prioridad)) {
    throw new ErrorValidacion(`Prioridad inválida. Debe ser: ${PRIORIDADES_TAREA.join(', ')}`);
  }
  return prioridad;
};

// Fecha del body: undefined si no viene, null si viene vacia, Date si es
// valida; cualquier otra cosa es un 400 (antes acababa en un 500 de Prisma).
// Las que llegan a medianoche UTC (formato YYYY-MM-DD) se pasan a mediodia
// para que no cambien de dia al mostrarse en Mexico.
const parsearFechaBody = (valor, etiqueta) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' && !(valor instanceof Date)) {
    throw new ErrorValidacion(`La fecha de ${etiqueta} no es válida`);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorValidacion(`La fecha de ${etiqueta} no es válida`);
  }
  if (fecha.getUTCHours() === 0) fecha.setUTCHours(12);
  return fecha;
};

const validarOrdenFechas = (fechaInicio, venceEn) => {
  if (fechaInicio && venceEn && venceEn.getTime() < fechaInicio.getTime()) {
    throw new ErrorValidacion('La fecha límite no puede ser anterior a la fecha de inicio');
  }
};

// `dependeDeId`: undefined si no viene, null para quitar la dependencia, o el
// id de una tarea que exista, sea del mismo proyecto, no sea la propia tarea y
// no cierre un ciclo (A depende de B y B de A).
const resolverDependencia = async (valor, { proyectoId, tareaId = null }) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;

  const dependeDeId = parseInt(valor, 10);
  if (Number.isNaN(dependeDeId) || dependeDeId <= 0) {
    throw new ErrorValidacion('La tarea de la que depende no es válida');
  }
  if (tareaId !== null && dependeDeId === tareaId) {
    throw new ErrorValidacion('Una tarea no puede depender de sí misma');
  }

  const dependencia = await prisma.tarea.findUnique({
    where: { id: dependeDeId },
    select: { id: true, proyectoId: true, dependeDeId: true },
  });
  if (!dependencia || dependencia.proyectoId !== proyectoId) {
    throw new ErrorValidacion('La tarea de la que depende no existe o es de otro proyecto');
  }

  if (tareaId !== null) {
    let actual = dependencia;
    const visitados = new Set([dependeDeId]);
    while (actual?.dependeDeId) {
      if (actual.dependeDeId === tareaId) {
        throw new ErrorValidacion('Esa dependencia crearía un ciclo entre tareas');
      }
      if (visitados.has(actual.dependeDeId)) break;
      visitados.add(actual.dependeDeId);
      actual = await prisma.tarea.findUnique({
        where: { id: actual.dependeDeId },
        select: { dependeDeId: true },
      });
    }
  }

  return dependeDeId;
};

const parseArrayValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [value];
};

const normalizarAsignadoIds = (asignadoIds, asignadoIdFallback = undefined) => {
  if (asignadoIds === undefined) {
    if (asignadoIdFallback === undefined) return undefined;
    if (!asignadoIdFallback) return [];
    const id = parseInt(asignadoIdFallback, 10);
    return Number.isNaN(id) ? [] : [id];
  }

  return [...new Set(
    parseArrayValue(asignadoIds)
      .map((value) => parseInt(value, 10))
      .filter((value) => !Number.isNaN(value))
  )];
};

const normalizarNumeroActividad = (numeroActividad) => {
  if (numeroActividad === undefined) return undefined;
  if (numeroActividad === null || numeroActividad === '') return null;
  const numero = parseInt(numeroActividad, 10);
  return Number.isNaN(numero) || numero <= 0 ? null : numero;
};

const asignadosPertenecenAProyecto = (proyecto, asignadoIds = []) => (
  asignadoIds.every((asignadoId) => proyecto.miembros.some((m) => m.id === asignadoId))
);

// ── Notificaciones ───────────────────────────────────────────────────────────
const crearNotificacion = async (
  usuarioId,
  mensaje,
  tipo,
  {
    tareaId = null,
  } = {}
) => {
  // Avisos de tareas apagados desde el panel de configuración.
  if (!usuarioId || !configEnCache().avisos.tareas) return;
  try {
    await prisma.notificacion.create({
      data: {
        usuarioId,
        mensaje,
        tipo,
        tareaId,
      }
    });
  } catch (error) {
    console.error('[crearNotificacion]', error);
  }
};

// Una notificacion por usuario, nunca al propio actor.
const crearNotificaciones = async ({ usuarioIds = [], actorId, mensaje, tipo, tareaId }) => {
  await Promise.all(
    [...new Set(usuarioIds)]
      .filter((usuarioId) => usuarioId && usuarioId !== actorId)
      .map((usuarioId) => crearNotificacion(usuarioId, mensaje, tipo, { tareaId }))
  );
};

// Todos los responsables de una tarea: el principal (`asignadoId`) mas los
// co-asignados (`asignados`), sin repetidos.
const idsResponsables = (tarea) => [...new Set(
  [tarea?.asignadoId, ...(tarea?.asignados || []).map((asignado) => asignado.id)].filter(Boolean)
)];

// 'URGENTE' solo cuando la tarea es de prioridad alta; si no, el tipo normal.
const tipoNotificacion = (tarea, tipoNormal) => (tarea?.prioridad === 'ALTA' ? 'URGENTE' : tipoNormal);

// ── Fechas en hora de Mexico ─────────────────────────────────────────────────
// En la zona horaria de la empresa (panel de configuración).
const getHoyMexico = () => {
  const { year, month, day } = partesDiaMexico();
  return {
    inicio: instanteLocal({ year, month, day }, 0),
    mediodia: instanteLocal({ year, month, day }, 12),
    indice: Math.floor(Date.UTC(year, month, day) / ONE_DAY_MS),
  };
};

const getPartesFechaMexico = (value = new Date()) => partesDiaMexico(value);

const crearFechaMexico = (partes, hour = 12) => instanteLocal(partes, hour);

const getIndiceDiaMexico = (value) => {
  const { year, month, day } = getPartesFechaMexico(value);
  return Math.floor(Date.UTC(year, month, day) / ONE_DAY_MS);
};

const moverFechaAlDiaActual = (value, dias) => {
  if (!value || dias <= 0) return value;
  const siguiente = new Date(value);
  siguiente.setUTCDate(siguiente.getUTCDate() + dias);
  return crearFechaMexico(getPartesFechaMexico(siguiente), 12);
};

/**
 * Ajuste automatico de fechas segun el estado. Devuelve los campos que hay que
 * cambiar, o null si la tarea ya esta bien. No escribe nada: quien llama
 * decide si va en un update suelto o en una transaccion con las demas.
 *
 * ROLLOVER INTENCIONAL (decision del usuario; commits fe875ba y b45e3f4): una
 * tarea PENDIENTE o EN_PROGRESO cuya fecha limite ya paso se recorre al dia de
 * hoy (hora de Mexico), arrastrando la fecha de inicio el mismo numero de dias.
 * La idea es que lo atrasado aparezca siempre como "para hoy" y no se quede
 * enterrado en fechas viejas. No es un bug: no quitarlo.
 *
 * Para las HECHO la fecha limite se alinea con el dia en que se cerraron. Si
 * no tienen `completadoEn` (datos anteriores a esa columna), se fija UNA sola
 * vez a partir de la fecha limite y esta no se toca. Antes se usaba "ahora"
 * como cierre, asi que la fecha limite de esas tareas se movia a hoy cada vez
 * que alguien abria el proyecto.
 */
const calcularAjusteFechas = (tarea, indiceHoy) => {
  if (!tarea?.venceEn) return null;

  const cambios = {};

  if (tarea.estado === 'HECHO') {
    if (!tarea.completadoEn) {
      const cierre = new Date(tarea.venceEn);
      // Fechas viejas guardadas a medianoche UTC: a mediodia, para que el
      // cierre no caiga en el dia anterior en hora de Mexico.
      if (cierre.getUTCHours() === 0) cierre.setUTCHours(12);
      cambios.completadoEn = cierre;
    } else {
      const venceNormalizado = crearFechaMexico(getPartesFechaMexico(tarea.completadoEn), 12);
      if (new Date(tarea.venceEn).getTime() !== venceNormalizado.getTime()) {
        cambios.venceEn = venceNormalizado;
      }
    }
  } else if (['PENDIENTE', 'EN_PROGRESO'].includes(tarea.estado)) {
    const diasDeDesfase = indiceHoy - getIndiceDiaMexico(tarea.venceEn);
    if (diasDeDesfase > 0) {
      cambios.venceEn = moverFechaAlDiaActual(tarea.venceEn, diasDeDesfase);
      if (tarea.fechaInicio) {
        cambios.fechaInicio = moverFechaAlDiaActual(tarea.fechaInicio, diasDeDesfase);
      }
    }
  }

  return Object.keys(cambios).length > 0 ? cambios : null;
};

// Para una sola tarea (al editar o cambiar de estado).
const normalizarVenceEnPorEstado = async (tarea) => {
  const cambios = calcularAjusteFechas(tarea, getHoyMexico().indice);
  if (!cambios) return tarea;

  await prisma.tarea.update({
    where: { id: tarea.id },
    data: cambios,
  });

  return { ...tarea, ...cambios };
};

// Para listados: se calculan todos los ajustes y se aplican en UNA transaccion,
// solo para las tareas que de verdad cambian. Antes eran N updates sueltos en
// paralelo con Promise.all por cada carga del proyecto.
// Si la transaccion falla, se devuelven las tareas tal cual estaban: un
// listado no debe caerse por un ajuste de fechas; en la siguiente carga se
// vuelve a intentar.
const aplicarAjustesFechas = async (tareas) => {
  const { indice } = getHoyMexico();
  const ajustes = [];

  const ajustadas = tareas.map((tarea) => {
    const cambios = calcularAjusteFechas(tarea, indice);
    if (!cambios) return tarea;
    ajustes.push({ id: tarea.id, cambios });
    return { ...tarea, ...cambios };
  });

  if (ajustes.length === 0) return tareas;

  try {
    await prisma.$transaction(
      ajustes.map(({ id, cambios }) => prisma.tarea.update({ where: { id }, data: cambios }))
    );
  } catch (error) {
    console.error('[tareas.aplicarAjustesFechas]', error);
    return tareas;
  }

  return ajustadas;
};

// €€ GET /api/proyectos/:id/tareas €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
// ADMIN → ve todas las tareas del proyecto
// MIEMBRO → ve las tareas visibles para el (ver `visibilidadTareasPara`)
const listar = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });

  try {
    const proyecto = await prisma.proyecto.findUnique({
      where: { id: proyectoId },
      include: {
        creador: { select: { id: true, nombre: true, area: true } },
        miembros: { select: { id: true, nombre: true, email: true, area: true, rol: true } },
        // El directorio de clientes es solo para administradores.
        ...(esAdmin(req.usuario) ? { cliente: { select: { id: true, nombre: true, nombreComercial: true } } } : {}),
      },
    });
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Misma regla de lectura que el resto de endpoints del proyecto
    const usuarioEsAdmin = esAdmin(req.usuario);
    if (!(await puedeVerProyecto(prisma, req.usuario, proyecto))) {
      return res.status(403).json({ error: 'No tienes permiso para ver las tareas de este proyecto' });
    }

    // Filtros opcionales (?q= &estado= &prioridad=). Sin ellos se comporta como antes.
    // Ojo: solo recortan la lista `tareas`; los contadores de `progreso` se
    // calculan mas abajo sobre otra consulta sin filtrar, y deben seguir asi.
    const busqueda = construirBusqueda(req.query.q, ['titulo', 'descripcion']);
    const filtroEstado = req.query.estado ? { estado: String(req.query.estado).toUpperCase() } : null;
    const filtroPrioridad = req.query.prioridad ? { prioridad: String(req.query.prioridad).toUpperCase() } : null;
    const paginacion = parsearPaginacion(req.query, { limitePorDefecto: 25 });

    const tareas = await prisma.tarea.findMany({
      where: combinarWhere(
        {
          proyectoId,
          ...(usuarioEsAdmin ? {} : visibilidadTareasPara(req.usuario.id)),
        },
        busqueda,
        filtroEstado,
        filtroPrioridad,
      ),
      orderBy: { creadoEn: 'asc' },
      include: INCLUDE_ASIGNADO,
    });

    // Rollover de vencidas y alineacion de cerradas (ver calcularAjusteFechas)
    const tareasNormalizadas = await aplicarAjustesFechas(tareas);

    // Ajustar fechas para evitar desfases de zona horaria (poner a mediodía)
    const tareasAjustadas = tareasNormalizadas.map(t => {
      if (t.venceEn) {
        const d = new Date(t.venceEn);
        if (d.getUTCHours() === 0) d.setUTCHours(12);
        t.venceEn = d;
      }
      if (t.fechaInicio) {
        const d = new Date(t.fechaInicio);
        if (d.getUTCHours() === 0) d.setUTCHours(12);
        t.fechaInicio = d;
      }
      if (t.completadoEn) {
        t.completadoEn = new Date(t.completadoEn);
      }
      return t;
    });

    const todasLasTareas = await prisma.tarea.findMany({
      where: { proyectoId },
      select: { estado: true, asignadoId: true, asignados: { select: { id: true } } },
    });

    const tareasMiembro = todasLasTareas.filter((t) =>
      t.asignadoId === req.usuario.id
      || t.asignados.some((asignado) => asignado.id === req.usuario.id)
    );

    // Stats Generales (Todo el proyecto)
    const totalGeneral = todasLasTareas.length;
    const hechasGeneral = todasLasTareas.filter(t => t.estado === 'HECHO').length;
    const pendientesGeneral = todasLasTareas.filter(t => t.estado === 'PENDIENTE').length;
    const enProgresoGeneral = todasLasTareas.filter(t => t.estado === 'EN_PROGRESO').length;

    // Stats Miembro
    const totalMiembro = tareasMiembro.length;
    const hechasMiembro = tareasMiembro.filter(t => t.estado === 'HECHO').length;
    const pendientesMiembro = tareasMiembro.filter(t => t.estado === 'PENDIENTE').length;
    const enProgresoMiembro = tareasMiembro.filter(t => t.estado === 'EN_PROGRESO').length;

    const paginaTareas = paginar(sortTareas(tareasAjustadas), paginacion);

    return res.json({
      proyecto,
      tareas: paginaTareas.items,
      ...(paginaTareas.meta && { meta: paginaTareas.meta }),
      progreso: {
        general: {
          total: totalGeneral,
          hechas: hechasGeneral,
          pendientes: pendientesGeneral,
          enProgreso: enProgresoGeneral,
          porcentaje: totalGeneral > 0 ? Math.round((hechasGeneral / totalGeneral) * 100) : 0,
        },
        miembro: {
          total: totalMiembro,
          hechas: hechasMiembro,
          pendientes: pendientesMiembro,
          enProgreso: enProgresoMiembro,
          porcentaje: totalMiembro > 0 ? Math.round((hechasMiembro / totalMiembro) * 100) : 0,
        },
      },
      filtradoPorUsuario: !usuarioEsAdmin,
    });
  } catch (error) {
    return responderError(res, error, '[tareas.listar]');
  }
};

// €€ POST /api/proyectos/:id/tareas €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const crear = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });

  const body = req.body || {};
  const archivos = Array.isArray(req.files) ? req.files : [];
  const urlsSubidas = [];
  let tareaCreada = null;

  try {
    const titulo = textoDeCampo(body.titulo);
    if (!titulo) return res.status(400).json({ error: 'El título de la tarea es requerido' });

    const descripcion = textoDeCampo(body.descripcion) || null;
    const primerComentario = textoDeCampo(body.primerComentario);
    const reglas = configEnCache().tareas;
    const estadoFinal = validarEstado(body.estado) ?? reglas.estadoInicial;
    const prioridadFinal = validarPrioridad(body.prioridad) ?? reglas.prioridadDefecto;
    const dInicio = parsearFechaBody(body.fechaInicio, 'inicio') ?? new Date();
    const dVence = parsearFechaBody(body.venceEn, 'límite') ?? null;
    if (!dVence && reglas.exigirFechaLimite) {
      return res.status(400).json({ error: 'La fecha límite es obligatoria' });
    }
    if (body.fechaInicio && body.venceEn) validarOrdenFechas(dInicio, dVence);

    // Verificar que el proyecto existe
    const proyecto = await prisma.proyecto.findUnique({
      where: { id: proyectoId },
      include: { miembros: { select: { id: true } } }
    });
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Si es MIEMBRO, verificar que pertenece a la lista de miembros del proyecto
    if (esAdmin(req.usuario)) {
      if (!puedeAdministrarProyecto(req.usuario, proyecto)) {
        return res.status(403).json({ error: 'No tienes permiso para crear tareas en este proyecto' });
      }
    } else if (!proyecto.miembros.some((m) => m.id === req.usuario.id)) {
      return res.status(403).json({ error: 'No tienes permiso para crear tareas en este proyecto' });
    }

    const asignadoIdsNormalizados = normalizarAsignadoIds(body.asignadoIds, body.asignadoId);
    if (!asignadosPertenecenAProyecto(proyecto, asignadoIdsNormalizados || [])) {
      return res.status(400).json({ error: 'Solo puedes asignar tareas a miembros de este proyecto' });
    }

    // Sin responsable elegido la tarea queda a nombre de quien la crea. Antes se
    // guardaba "sin asignar", pero el panel de actividad igual se la contaba al
    // creador: la tarjeta y los totales decian cosas distintas.
    // Solo si es miembro del proyecto: el selector de responsables unicamente
    // ofrece miembros, asi que un ajeno se perderia al reeditar la tarea.
    // El configurador puede apagarlo (reglas de tareas: asignarAlCreador).
    const creadorEsMiembroDelProyecto = proyecto.miembros.some((m) => m.id === req.usuario.id);
    const asignadosFinales = asignadoIdsNormalizados?.length
      ? asignadoIdsNormalizados
      : (creadorEsMiembroDelProyecto && reglas.asignarAlCreador ? [req.usuario.id] : []);
    const asignadoPrincipalId = asignadosFinales[0] ?? null;
    if (!asignadoPrincipalId && reglas.exigirResponsable) {
      return res.status(400).json({ error: 'Elige un responsable para la tarea' });
    }

    const numeroActividadNormalizado = normalizarNumeroActividad(body.numeroActividad);
    const dependeDeId = await resolverDependencia(body.dependeDeId, { proyectoId });

    // Adjuntos: multer los deja en memoria (serverless, sin disco), asi que se
    // suben a Vercel Blob ANTES de la transaccion. Si la transaccion falla, se
    // borran para no dejar archivos huerfanos. Antes se guardaba
    // `file.filename`, que con memoryStorage no existe: la tarea se creaba y
    // luego Prisma fallaba, asi que el usuario la volvia a crear duplicada.
    const adjuntos = [];
    for (const file of archivos) {
      const url = await subirArchivo(file, 'adjuntos');
      urlsSubidas.push(url);
      adjuntos.push({
        nombre: file.originalname,
        url,
        tipo: file.mimetype,
        tamano: file.size,
        usuarioId: req.usuario.id,
      });
    }

    // Tarea, comentario inicial y adjuntos en una sola transaccion: o se
    // guarda todo o no se guarda nada.
    tareaCreada = await prisma.$transaction(async (tx) => {
      // Sin numero de actividad se toma el siguiente libre del proyecto.
      let numeroActividad = numeroActividadNormalizado;
      if (numeroActividad === undefined || numeroActividad === null) {
        const { _max } = await tx.tarea.aggregate({
          where: { proyectoId },
          _max: { numeroActividad: true },
        });
        numeroActividad = (_max.numeroActividad || 0) + 1;
      }

      const creada = await tx.tarea.create({
        data: {
          titulo,
          descripcion,
          numeroActividad,
          prioridad:   prioridadFinal,
          estado:      estadoFinal,
          completadoEn: estadoFinal === 'HECHO' ? new Date() : null,
          fechaInicio: dInicio,
          venceEn:     dVence,
          proyectoId,
          asignadoId:  asignadoPrincipalId,
          asignados:   {
            connect: asignadosFinales.map((idAsignado) => ({ id: idAsignado })),
          },
          creadorId:   req.usuario.id,
          dependeDeId: dependeDeId ?? null,
        },
        include: INCLUDE_ASIGNADO,
      });

      if (primerComentario) {
        await tx.comentario.create({
          data: {
            contenido: primerComentario,
            tareaId: creada.id,
            autorId: req.usuario.id,
          },
        });
      }

      if (adjuntos.length > 0) {
        await tx.adjunto.createMany({
          data: adjuntos.map((adjunto) => ({ ...adjunto, tareaId: creada.id })),
        });
      }

      return creada;
    });

    const tarea = tareaCreada;

    // Notificar a los responsables que no son quien la crea
    await crearNotificaciones({
      usuarioIds: asignadosFinales,
      actorId: req.usuario.id,
      mensaje: `Te han asignado una nueva tarea: "${tarea.titulo}"`,
      tipo: tipoNotificacion(tarea, 'ASIGNACION'),
      tareaId: tarea.id,
    });
    // Y por correo, por si no entra al CRM (panel: avisos.correoAsignaciones).
    require('../services/avisosCorreo.service').avisarTareaAsignada({ usuarioIds: asignadosFinales, actorId: req.usuario.id, tareaId: tarea.id });

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      proyectoId,
      'CREAR_TAREA',
      `${req.usuario.nombre} creó la tarea "${tarea.titulo}"${archivos.length ? ` con ${archivos.length} archivos` : ''}`,
      tarea.id
    );

    return res.status(201).json({ mensaje: 'Tarea creada exitosamente', tarea });
  } catch (error) {
    if (!tareaCreada && urlsSubidas.length > 0) await borrarBlobs(urlsSubidas);
    return responderError(res, error, '[tareas.crear]');
  }
};

// €€ PUT /api/tareas/:id €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const editar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const body = req.body || {};

  try {
    const existente = await prisma.tarea.findUnique({
      where: { id },
      include: {
        proyecto: { include: { miembros: { select: { id: true } } } },
        asignados: { select: { id: true } },
      }
    });
    if (!existente) return res.status(404).json({ error: 'Tarea no encontrada' });

    // Verificar permisos: ADMIN o miembro con visibilidad sobre esta tarea
    if (esAdmin(req.usuario)) {
      if (!puedeAdministrarProyecto(req.usuario, existente.proyecto)) {
        return res.status(403).json({ error: 'No tienes permiso para editar esta tarea' });
      }
    } else {
      const esMiembro = existente.proyecto.miembros.some(m => m.id === req.usuario.id);
      if (!esMiembro || !puedeAccederTarea(existente, req.usuario.id)) {
        return res.status(403).json({ error: 'No tienes permiso para editar esta tarea' });
      }
    }

    const asignadoIdsNormalizados = normalizarAsignadoIds(body.asignadoIds, body.asignadoId);
    const asignadoPrincipalId = asignadoIdsNormalizados?.[0] ?? null;
    if (asignadoIdsNormalizados !== undefined && !asignadosPertenecenAProyecto(existente.proyecto, asignadoIdsNormalizados)) {
      return res.status(400).json({ error: 'Solo puedes asignar tareas a miembros de este proyecto' });
    }

    const titulo = body.titulo !== undefined ? textoDeCampo(body.titulo) : undefined;
    if (titulo !== undefined && !titulo) {
      throw new ErrorValidacion('El título de la tarea es requerido');
    }
    const descripcion = body.descripcion !== undefined ? (textoDeCampo(body.descripcion) || null) : undefined;
    const estado = validarEstado(body.estado);
    const prioridad = validarPrioridad(body.prioridad);
    const numeroActividadNormalizado = normalizarNumeroActividad(body.numeroActividad);

    const dInicio = body.fechaInicio !== undefined
      ? (parsearFechaBody(body.fechaInicio, 'inicio') ?? new Date())
      : undefined;
    const dVence = parsearFechaBody(body.venceEn, 'límite');
    if (body.fechaInicio && body.venceEn) validarOrdenFechas(dInicio, dVence);

    const dependeDeId = await resolverDependencia(body.dependeDeId, {
      proyectoId: existente.proyectoId,
      tareaId: id,
    });

    const estadoFinal = estado !== undefined ? estado : existente.estado;

    let tarea = await prisma.tarea.update({
      where: { id },
      data: {
        ...(titulo       !== undefined && { titulo }),
        ...(descripcion  !== undefined && { descripcion }),
        ...(body.numeroActividad !== undefined && { numeroActividad: numeroActividadNormalizado }),
        ...(prioridad    !== undefined && { prioridad }),
        ...(estado       !== undefined && { estado }),
        ...(estado !== undefined && {
          completadoEn: estadoFinal === 'HECHO'
            ? (existente.estado === 'HECHO' ? existente.completadoEn || new Date() : new Date())
            : null
        }),
        ...(asignadoIdsNormalizados !== undefined && { asignadoId: asignadoPrincipalId }),
        ...(asignadoIdsNormalizados !== undefined && {
          asignados: {
            set: asignadoIdsNormalizados.map((idAsignado) => ({ id: idAsignado })),
          },
        }),
        ...(dInicio      !== undefined && { fechaInicio: dInicio }),
        ...(dVence       !== undefined && { venceEn: dVence }),
        ...(dependeDeId  !== undefined && { dependeDeId }),
      },
      include: INCLUDE_ASIGNADO,
    });

    tarea = await normalizarVenceEnPorEstado(tarea);

    // Notificar a TODOS los responsables (principal y co-asignados), nunca a
    // quien edita. Los recien asignados reciben el aviso de asignacion; los
    // que ya estaban, el de cambio de estado o de actualizacion.
    const responsablesAntes = new Set(idsResponsables(existente));
    const responsablesAhora = idsResponsables(tarea);
    const recienAsignados = responsablesAhora.filter((usuarioId) => !responsablesAntes.has(usuarioId));
    const yaAsignados = responsablesAhora.filter((usuarioId) => responsablesAntes.has(usuarioId));

    await crearNotificaciones({
      usuarioIds: recienAsignados,
      actorId: req.usuario.id,
      mensaje: `Te han asignado la tarea: "${tarea.titulo}"`,
      tipo: tipoNotificacion(tarea, 'ASIGNACION'),
      tareaId: tarea.id,
    });
    require('../services/avisosCorreo.service').avisarTareaAsignada({ usuarioIds: recienAsignados, actorId: req.usuario.id, tareaId: tarea.id });

    await crearNotificaciones({
      usuarioIds: yaAsignados,
      actorId: req.usuario.id,
      mensaje: existente.estado !== tarea.estado
        ? `El estado de tu tarea "${tarea.titulo}" cambió a ${tarea.estado}`
        : `Se actualizó la información de tu tarea: "${tarea.titulo}"`,
      tipo: tipoNotificacion(tarea, 'ESTADO'),
      tareaId: tarea.id,
    });

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      tarea.proyectoId,
      'EDITAR_TAREA',
      `${req.usuario.nombre} editó la tarea "${tarea.titulo}"`,
      tarea.id
    );

    return res.json({ mensaje: 'Tarea actualizada', tarea });
  } catch (error) {
    return responderError(res, error, '[tareas.editar]');
  }
};

/**
 * Borra tareas con todo lo que cuelga de ellas. Va por conjuntos para servir
 * igual al borrado suelto y al de varias a la vez.
 *
 * Las notificaciones no se borran, se desligan: el aviso ya lo recibio alguien
 * y quitarselo de la campana seria mas raro que dejarlo sin enlace.
 *
 * Devuelve las URLs de los adjuntos borrados para que, una vez confirmada la
 * transaccion, quien llama los quite tambien de Vercel Blob (si no, quedaban
 * huerfanos y publicos).
 */
const borrarTareasEnCascada = async (tx, ids) => {
  const adjuntos = await tx.adjunto.findMany({
    where: { tareaId: { in: ids } },
    select: { url: true },
  });

  await tx.tarea.updateMany({
    where: { dependeDeId: { in: ids } },
    data: { dependeDeId: null },
  });

  await tx.comentario.deleteMany({ where: { tareaId: { in: ids } } });
  await tx.adjunto.deleteMany({ where: { tareaId: { in: ids } } });
  await tx.logActividad.deleteMany({ where: { tareaId: { in: ids } } });
  await tx.notificacion.updateMany({
    where: { tareaId: { in: ids } },
    data: { tareaId: null },
  });

  await tx.tarea.deleteMany({ where: { id: { in: ids } } });

  return adjuntos.map((adjunto) => adjunto.url);
};

// €€ DELETE /api/tareas/:id €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const eliminar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

  try {
    const existente = await prisma.tarea.findUnique({
      where: { id },
      include: {
        proyecto: { include: { miembros: { select: { id: true } } } },
        asignados: { select: { id: true } },
      }
    });
    if (!existente) return res.status(404).json({ error: 'Tarea no encontrada' });

    // Verificar permisos: ADMIN o miembro con visibilidad sobre esta tarea
    if (esAdmin(req.usuario)) {
      if (!puedeAdministrarProyecto(req.usuario, existente.proyecto)) {
        return res.status(403).json({ error: 'No tienes permiso para eliminar esta tarea' });
      }
    } else {
      const esMiembro = existente.proyecto.miembros.some(m => m.id === req.usuario.id);
      if (!esMiembro || !puedeAccederTarea(existente, req.usuario.id)) {
        return res.status(403).json({ error: 'No tienes permiso para eliminar esta tarea' });
      }
    }

    const urlsAdjuntos = await prisma.$transaction((tx) => borrarTareasEnCascada(tx, [id]));
    await borrarBlobs(urlsAdjuntos);

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      existente.proyectoId,
      'ELIMINAR_TAREA',
      `${req.usuario.nombre} eliminó la tarea "${existente.titulo}"`
    );
    return res.json({ mensaje: 'Tarea eliminada' });
  } catch (error) {
    return responderError(res, error, '[tareas.eliminar]');
  }
};

// POST /api/tareas/eliminar-multiples   body: { ids: [1, 2, 3] }
// Borrado en bloque desde la vista de lista o el Kanban, para no ir de una en
// una. Cada tarea pasa por el mismo permiso que el borrado suelto: las que no
// se pueden tocar se omiten y se informan, en vez de tumbar toda la operacion.
const LIMITE_BORRADO_MASIVO = 200;

const eliminarVarias = async (req, res) => {
  // `parseArrayValue` devuelve undefined si no viene nada: sin el `?? []` un
  // cuerpo vacio lanzaba fuera del try y la peticion quedaba sin respuesta.
  const ids = [...new Set(
    (parseArrayValue(req.body?.ids) ?? [])
      .map((valor) => parseInt(valor, 10))
      .filter((valor) => !Number.isNaN(valor))
  )];

  if (!ids.length) return res.status(400).json({ error: 'No se recibió ninguna tarea' });
  if (ids.length > LIMITE_BORRADO_MASIVO) {
    return res.status(400).json({
      error: `Solo puedes eliminar ${LIMITE_BORRADO_MASIVO} tareas a la vez`,
    });
  }

  try {
    const tareas = await prisma.tarea.findMany({
      where: { id: { in: ids } },
      include: {
        proyecto: { include: { miembros: { select: { id: true } } } },
        asignados: { select: { id: true } },
      },
    });
    if (!tareas.length) return res.status(404).json({ error: 'No se encontró ninguna de las tareas' });

    const permitidas = tareas.filter((tarea) => (
      esAdmin(req.usuario)
        ? puedeAdministrarProyecto(req.usuario, tarea.proyecto)
        : tarea.proyecto.miembros.some((m) => m.id === req.usuario.id)
          && puedeAccederTarea(tarea, req.usuario.id)
    ));
    if (!permitidas.length) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar estas tareas' });
    }

    const idsPermitidos = permitidas.map((tarea) => tarea.id);
    const urlsAdjuntos = await prisma.$transaction((tx) => borrarTareasEnCascada(tx, idsPermitidos));
    await borrarBlobs(urlsAdjuntos);

    // Un apunte por proyecto y no uno por tarea: el registro sirve para saber
    // que paso, no para dejar treinta lineas casi identicas seguidas.
    const titulosPorProyecto = new Map();
    permitidas.forEach((tarea) => {
      const acumulado = titulosPorProyecto.get(tarea.proyectoId) || [];
      acumulado.push(tarea.titulo);
      titulosPorProyecto.set(tarea.proyectoId, acumulado);
    });

    for (const [proyectoId, titulos] of titulosPorProyecto) {
      const detalle = titulos.length === 1 ? `la tarea "${titulos[0]}"` : `${titulos.length} tareas`;
      await registrarActividad(
        req.usuario.id,
        proyectoId,
        'ELIMINAR_TAREA',
        `${req.usuario.nombre} eliminó ${detalle}`
      );
    }

    return res.json({
      ids: idsPermitidos,
      eliminadas: idsPermitidos.length,
      omitidas: ids.length - idsPermitidos.length,
    });
  } catch (error) {
    return responderError(res, error, '[tareas.eliminarVarias]');
  }
};

// €€ PATCH /api/tareas/:id/estado €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const actualizarEstado = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

  const estado = typeof req.body?.estado === 'string' ? req.body.estado.trim().toUpperCase() : null;
  if (!ESTADOS_TAREA.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Debe ser: ${ESTADOS_TAREA.join(', ')}` });
  }

  try {
    const existente = await prisma.tarea.findUnique({
      where: { id },
      include: {
        proyecto: { include: { miembros: { select: { id: true } } } },
        asignados: { select: { id: true } },
      }
    });
    if (!existente) return res.status(404).json({ error: 'Tarea no encontrada' });

    // Verificar permisos: ADMIN o miembro con visibilidad sobre esta tarea
    if (esAdmin(req.usuario)) {
      if (!puedeAdministrarProyecto(req.usuario, existente.proyecto)) {
        return res.status(403).json({ error: 'No tienes permiso para actualizar esta tarea' });
      }
    } else {
      const esMiembro = existente.proyecto.miembros.some(m => m.id === req.usuario.id);
      if (!esMiembro || !puedeAccederTarea(existente, req.usuario.id)) {
        return res.status(403).json({ error: 'No tienes permiso para actualizar esta tarea' });
      }
    }

    let tarea = await prisma.tarea.update({
      where: { id },
      data:  {
        estado,
        completadoEn: estado === 'HECHO' ? new Date() : null,
      },
      include: INCLUDE_ASIGNADO,
    });

    tarea = await normalizarVenceEnPorEstado(tarea);

    // Notificar el cambio de estado a todos los responsables, salvo a quien lo hizo
    await crearNotificaciones({
      usuarioIds: idsResponsables(tarea),
      actorId: req.usuario.id,
      mensaje: `El estado de tu tarea "${tarea.titulo}" cambió a ${tarea.estado}`,
      tipo: tipoNotificacion(tarea, 'ESTADO'),
      tareaId: tarea.id,
    });

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      tarea.proyectoId,
      'CAMBIO_ESTADO',
      `${req.usuario.nombre} cambió el estado de "${tarea.titulo}" a ${tarea.estado}`,
      tarea.id
    );

    return res.json({ mensaje: 'Estado actualizado', tarea });
  } catch (error) {
    return responderError(res, error, '[tareas.actualizarEstado]');
  }
};

module.exports = {
  listar,
  crear,
  editar,
  eliminar,
  eliminarVarias,
  actualizarEstado,
  visibilidadTareasPara,
};
