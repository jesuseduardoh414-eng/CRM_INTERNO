// Controlador de Proyectos
// ADMIN → ve todos los proyectos
// MIEMBRO → solo los proyectos donde tiene tareas asignadas

const prisma = require('../lib/prisma');
const driveProyectos = require('../services/driveProyectos.service');
const { registrarActividad } = require('../utils/logger');
const { sortProyectos } = require('../utils/sort.utils');
const { addDays, buildTemplateTasksFromProject } = require('../utils/plantillas.utils');
const {
  esAdmin,
  esAdminGlobal,
  buildFiltroAreaProyecto,
  filtroProyectosVisibles,
  proyectoCoincideConArea,
  puedeAdministrarProyecto,
  puedeEliminarProyecto,
  cargarProyectoVisible,
} = require('../utils/permissions.utils');
const {
  puede, alcanceDe, areasDe, areasDelAlcance,
} = require('../utils/permisosArea.utils');
const { ESTADOS_PROYECTO, ESTADO_PROYECTO_DEFAULT, normalizarEstadoProyecto, esEstadoProyectoValido } = require('../utils/estados.utils');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere, contiene } = require('../utils/paginacion.utils');
const { subirArchivo, borrarBlobs } = require('../utils/blob.utils');
const { nombreUtf8 } = require('../utils/nombreArchivo.utils');

// Areas del enum `Area` del schema. `Proyecto.area` es texto con varias
// separadas por coma, asi que cada una se valida contra esta lista.
const { areasValidas } = require('../utils/security.utils');
const { configEnCache } = require('../services/configuracion.service');
const papelera = require('../services/papelera.service');

// Aplicar una plantilla grande no cabe en los 5 s por defecto de una
// transaccion interactiva ("Transaction already closed" con ~50 tareas).
const OPCIONES_TRANSACCION_PLANTILLA = { timeout: 30000, maxWait: 10000 };
const LOTE_CREATE_MANY = 100;

// Campos comunes del include
const INCLUDE_PROYECTO = {
  creador: { select: { id: true, nombre: true, area: true } },
  cliente: { select: { id: true, nombre: true, nombreComercial: true } },
  miembros: { select: { id: true, nombre: true, email: true, area: true, rol: true, fotoPerfilUrl: true } },
  _count:  { select: { tareas: true } },
};

const INCLUDE_PLANTILLA = {
  creador: { select: { id: true, nombre: true, area: true } },
  proyectoBase: { select: { id: true, nombre: true } },
  tareas: {
    orderBy: { orden: 'asc' },
    select: {
      id: true,
      clave: true,
      titulo: true,
      descripcion: true,
      prioridad: true,
      orden: true,
      offsetInicioDias: true,
      offsetVenceDias: true,
      dependeDeClave: true,
    },
  },
  _count: { select: { tareas: true } },
};

// ── Validacion de entrada ────────────────────────────────────────────────────
// Se lanza desde los helpers y el controlador la convierte en la respuesta
// HTTP que toque (400 por defecto, 403 para permisos).
class ErrorValidacion extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ErrorValidacion';
    this.status = status;
  }
}

// Validacion → su status; P2025 → 404; P2002 → 409; el resto, 500 generico
// con el detalle solo en el log.
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

// Texto de un campo del body sin suponer que sea string (con JSON puede llegar
// un numero, null o un objeto).
const textoDeCampo = (valor) => {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
};

const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new ErrorValidacion('La lista de miembros no es válida');
  }
};

const normalizarIds = (ids) => [...new Set(ids.map(id => Number(id)).filter(id => !Number.isNaN(id)))];

const areasDeProyecto = (area) => String(area || 'DESARROLLO')
  .split(',')
  .map(a => a.trim().toUpperCase())
  .filter(Boolean);

// Devuelve la lista de areas ya normalizada. Rechaza areas fuera del catalogo
// (400) y, salvo al administrador general, cualquier area que no sea de las
// suyas (403).
const validarAreasProyecto = (area, usuario, mensajePermiso) => {
  const areas = areasDeProyecto(area);
  const validas = areasValidas();
  const invalidas = areas.filter((item) => !validas.includes(item));
  if (invalidas.length > 0) {
    throw new ErrorValidacion(`Área inválida: ${invalidas.join(', ')}. Valores permitidos: ${validas.join(', ')}`);
  }
  if (!esAdminGlobal(usuario) && !areas.every((item) => areasDe(usuario).includes(item))) {
    throw new ErrorValidacion(mensajePermiso, 403);
  }
  return areas;
};

/**
 * Cliente del proyecto (directorio de clientes y proveedores). undefined si no
 * viene, null para quitarlo; solo admite fichas de tipo cliente o ambos. Lo
 * fija quien puede ver el directorio ("clientes.ver"): es confidencial.
 */
const resolverCliente = async (valor, usuario) => {
  if (valor === undefined || !puede(usuario, 'clientes.ver')) return undefined;
  if (valor === null || valor === '' || valor === 'null') return null;
  const id = Number.parseInt(valor, 10);
  const empresa = Number.isInteger(id)
    ? await prisma.empresa.findUnique({ where: { id }, select: { id: true, tipo: true } })
    : null;
  if (!empresa || empresa.tipo === 'PROVEEDOR') throw new ErrorValidacion('El cliente seleccionado no existe');
  return empresa.id;
};

// Fecha del body: undefined si no viene, null si viene vacia, Date si vale.
// Lo demas es un 400 (antes `new Date('basura')` acababa en un 500 de Prisma).
const parsearFechaProyecto = (valor, etiqueta) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' && !(valor instanceof Date)) {
    throw new ErrorValidacion(`La fecha de ${etiqueta} del proyecto no es válida`);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorValidacion(`La fecha de ${etiqueta} del proyecto no es válida`);
  }
  return fecha;
};

// Se compara por dia y no por instante: inicio y fin pueden ser el mismo dia.
const diaUTC = (fecha) => Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());

const validarRangoProyecto = (inicio, fin) => {
  if (inicio && fin && diaUTC(new Date(fin)) < diaUTC(new Date(inicio))) {
    throw new ErrorValidacion('La fecha fin del proyecto no puede ser anterior a la fecha inicio');
  }
};

const getPlantillasDbError = (error, accion = 'operar con las plantillas') => {
  const message = String(error?.message || '');
  const code = error?.code;

  if (
    code === 'P2021'
    || code === 'P2022'
    || message.includes('plantillas_proyecto')
    || message.includes('plantillas_tarea')
    || message.includes('does not exist')
    || message.includes('Unknown argument')
  ) {
    return `Falta aplicar la migracion de plantillas o regenerar Prisma antes de ${accion}. Ejecuta: npx prisma migrate deploy && npx prisma generate`;
  }

  return null;
};

const validarMiembrosPorArea = async (ids) => {
  if (ids.length === 0) return { usuarios: [], invalidos: [] };
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: ids }, rol: { in: ['ADMIN', 'MIEMBRO'] } },
    select: { id: true, nombre: true, area: true, rol: true }
  });
  const idsValidos = new Set(usuarios.map(u => u.id));
  return {
    usuarios,
    invalidos: ids.filter(id => !idsValidos.has(id)),
  };
};

// NOTA sobre el calendario: antes, al crear o editar un proyecto, se generaba
// una fila `Evento` tipo 'dia_completo' ("Proyecto: X") por cada miembro
// (`sincronizarCalendarioProyecto`). Ya no: la agenda deriva ese bloque
// (`proyecto-<id>`) directamente de la tabla Proyecto en `agenda.listar`, y las
// filas antiguas de ese tipo se excluyen en agenda, disponibilidad y
// recordatorios. Por eso aqui no se crean ni se regeneran eventos; al borrar
// un proyecto si se eliminan las filas que pudieran quedar (ver `eliminar`).

const numeroActividadDePlantilla = (tarea) => (
  typeof tarea.numeroActividad === 'number' ? tarea.numeroActividad : (tarea.orden + 1)
);

/**
 * Crea las tareas de una plantilla en el proyecto recien creado, con los
 * mismos desfases de fechas y dependencias de siempre.
 *
 * Las tareas se insertan por lotes con `createMany` en vez de un `create` por
 * tarea, y se leen de vuelta por proyecto (`createManyAndReturn` no existe en
 * MySQL; el proyecto acaba de crearse, asi que sus unicas tareas son estas).
 * Las dependencias se resuelven despues: la clave de cada tarea de plantilla
 * se traduce a id por su numero de actividad, que dentro de una plantilla es
 * unico (orden + 1). Si por datos viejos hubiera numeros repetidos, se vuelve
 * al camino de uno en uno para no cruzar dependencias.
 */
const aplicarPlantillaATareas = async ({ tx, proyecto, plantilla, creadorId }) => {
  if (!plantilla?.tareas?.length) return [];

  const datosDe = (tarea) => ({
    numeroActividad: numeroActividadDePlantilla(tarea),
    titulo: tarea.titulo,
    descripcion: tarea.descripcion,
    prioridad: tarea.prioridad || configEnCache().tareas.prioridadDefecto,
    estado: configEnCache().tareas.estadoInicial,
    fechaInicio: addDays(proyecto.fechaInicio, tarea.offsetInicioDias || 0),
    venceEn: tarea.offsetVenceDias !== null && tarea.offsetVenceDias !== undefined
      ? addDays(proyecto.fechaInicio, tarea.offsetVenceDias)
      : null,
    proyectoId: proyecto.id,
    creadorId,
  });

  const numeros = plantilla.tareas.map(numeroActividadDePlantilla);
  const numerosUnicos = new Set(numeros).size === numeros.length;

  const creadas = [];
  const idByClave = new Map();

  if (numerosUnicos) {
    const filas = plantilla.tareas.map(datosDe);
    for (let i = 0; i < filas.length; i += LOTE_CREATE_MANY) {
      await tx.tarea.createMany({ data: filas.slice(i, i + LOTE_CREATE_MANY) });
    }
    const insertadas = await tx.tarea.findMany({
      where: { proyectoId: proyecto.id },
      select: { id: true, titulo: true, numeroActividad: true },
      orderBy: { id: 'asc' },
    });
    creadas.push(...insertadas);

    const idPorNumero = new Map(creadas.map((tarea) => [tarea.numeroActividad, tarea.id]));
    plantilla.tareas.forEach((tarea) => {
      idByClave.set(tarea.clave, idPorNumero.get(numeroActividadDePlantilla(tarea)));
    });
  } else {
    for (const tarea of plantilla.tareas) {
      const creada = await tx.tarea.create({
        data: datosDe(tarea),
        select: { id: true, titulo: true, numeroActividad: true },
      });
      creadas.push(creada);
      idByClave.set(tarea.clave, creada.id);
    }
  }

  for (const tarea of plantilla.tareas) {
    if (!tarea.dependeDeClave) continue;
    const tareaId = idByClave.get(tarea.clave);
    const dependeDeId = idByClave.get(tarea.dependeDeClave);
    if (!tareaId || !dependeDeId || tareaId === dependeDeId) continue;

    await tx.tarea.update({
      where: { id: tareaId },
      data: { dependeDeId },
    });
  }

  return creadas;
};

// Una tarea cuenta para quien figura como responsable principal o co-asignado,
// una sola vez por tarea.
const tareaEsDe = (tarea, usuarioId) => (
  tarea.asignadoId === usuarioId
  || (tarea.asignados || []).some((asignado) => asignado.id === usuarioId)
);

// €€ GET /api/proyectos €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
// Los que alcanza "proyectos.ver": propios (miembro, creador o participa en
// alguna tarea), los de su area o todos.
const listar = async (req, res) => {
  try {
    const usuarioEsAdmin = esAdmin(req.usuario);
    const veClientes = puede(req.usuario, 'clientes.ver');
    const alcance = filtroProyectosVisibles(req.usuario);

    // Filtros opcionales (?q= &estado= &area= &excluirEstado=). Sin ellos, se
    // comporta exactamente como antes.
    const busqueda = construirBusqueda(req.query.q, ['nombre', 'descripcion']);
    const filtroEstado = req.query.estado
      ? { estado: normalizarEstadoProyecto(req.query.estado) }
      : null;

    // `area` guarda varias areas separadas por coma ("DESARROLLO,MARKETING"),
    // por eso se busca por contenido y no por igualdad. Los cuatro codigos son
    // distintos entre si, ninguno es prefijo de otro, asi que no hay falsos.
    const filtroArea = req.query.area
      ? { area: contiene(String(req.query.area).trim().toUpperCase()) }
      : null;

    // "Todos" en la pantalla de Proyectos significa "todo menos archivados":
    // archivar sirve justamente para sacarlos de la vista diaria. Va como
    // parametro explicito para no cambiar lo que recibe quien llama sin filtros
    // (por ejemplo el gantt del Inicio).
    const clienteFiltro = Number.parseInt(req.query.clienteId, 10);
    const filtroCliente = Number.isInteger(clienteFiltro) ? { clienteId: clienteFiltro } : null;

    const filtroExcluir = req.query.excluirEstado
      ? { NOT: { estado: normalizarEstadoProyecto(req.query.excluirEstado) } }
      : null;

    const where = combinarWhere(alcance, busqueda, filtroEstado, filtroArea, filtroExcluir, filtroCliente);
    const paginacion = parsearPaginacion(req.query);

    const proyectos = await prisma.proyecto.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        ...INCLUDE_PROYECTO,
        tareas: {
          select: { estado: true, asignadoId: true, completadoEn: true, asignados: { select: { id: true } } }
        }
      },
    });

    const proyectosConProgreso = proyectos.map(p => {
      const total = p.tareas.length;
      const hechas = p.tareas.filter(t => t.estado === 'HECHO').length;
      const progreso = total > 0 ? Math.round((hechas / total) * 100) : 0;
      const tareasMiembro = p.tareas.filter((t) => tareaEsDe(t, req.usuario.id));
      const hechasMiembro = tareasMiembro.filter(t => t.estado === 'HECHO').length;
      const progresoMiembro = tareasMiembro.length > 0
        ? Math.round((hechasMiembro / tareasMiembro.length) * 100)
        : 0;

      // Fecha del ultimo cierre real. Sirve para que un proyecto sin fechaFin
      // no tenga que dibujarse con una duracion inventada en la linea de tiempo.
      const cierres = p.tareas
        .map((t) => t.completadoEn)
        .filter(Boolean)
        .map((f) => new Date(f).getTime());
      const ultimaTareaCompletadaEn = cierres.length ? new Date(Math.max(...cierres)) : null;

      // Eliminamos el array de tareas para no sobrecargar la respuesta JSON.
      // El cliente (directorio comercial) solo lo ve quien ve el directorio.
      const { tareas, cliente, ...resto } = p;
      if (veClientes) resto.cliente = cliente;
      return {
        ...resto,
        progreso,
        progresoGeneral: progreso,
        progresoMiembro: usuarioEsAdmin ? null : progresoMiembro,
        tareasMiembro: usuarioEsAdmin ? null : tareasMiembro.length,
        totalTareas: total,
        tareasHechas: hechas,
        ultimaTareaCompletadaEn,
      };
    });

    const { items, meta } = paginar(sortProyectos(proyectosConProgreso), paginacion);

    return res.json({
      proyectos: items,
      filtradoPorUsuario: !usuarioEsAdmin,
      ...(meta && { meta }),
    });
  } catch (error) {
    return responderError(res, error, '[proyectos.listar]');
  }
};

// Areas cuyas plantillas puede ver y usar (filtro sobre `area`, que
// PlantillaProyecto tambien tiene). null = todas, para quien ve todos los
// proyectos. Una plantilla lleva los titulos y descripciones de las tareas
// del proyecto de origen: antes "propios" veia las de todas las areas.
const areasDePlantillas = (usuario) => {
  const alcance = alcanceDe(usuario, 'proyectos.ver');
  if (esAdminGlobal(usuario) || alcance === 'todos') return null;
  return alcance === 'area' ? areasDelAlcance(usuario, 'proyectos.ver') : areasDe(usuario);
};

// GET /api/proyectos/plantillas
const listarPlantillas = async (req, res) => {
  try {
    const areas = areasDePlantillas(req.usuario);
    const plantillas = await prisma.plantillaProyecto.findMany({
      where: areas ? buildFiltroAreaProyecto(areas) : undefined,
      orderBy: [{ creadoEn: 'desc' }],
      include: INCLUDE_PLANTILLA,
    });

    return res.json({
      plantillas: plantillas.map((plantilla) => ({
        ...plantilla,
        totalTareas: plantilla._count?.tareas ?? plantilla.tareas.length,
      })),
    });
  } catch (error) {
    console.error('[plantillas.listar]', error);
    const detalle = getPlantillasDbError(error, 'listar las plantillas');
    if (detalle) {
      return res.status(500).json({ error: detalle });
    }
    return res.status(500).json({ error: 'Error al listar plantillas' });
  }
};

const guardarComoPlantilla = async (req, res) => {
  const proyectoId = parseInt(req.params.id);
  if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID inválido' });

  const nombre = textoDeCampo(req.body?.nombre);
  const descripcion = textoDeCampo(req.body?.descripcion);
  if (!nombre) return res.status(400).json({ error: 'El nombre de la plantilla es requerido' });

  try {
    // Con "tareas.ver" = propios la plantilla solo copia las tareas que la
    // persona ve en el proyecto, igual que la lista de tareas.
    const veTodas = alcanceDe(req.usuario, 'tareas.ver') === 'todos';
    const proyecto = await prisma.proyecto.findUnique({
      where: { id: proyectoId },
      include: {
        miembros: { select: { id: true } },
        tareas: {
          // eslint-disable-next-line global-require
          ...(veTodas ? {} : { where: require('./tareas.controller').visibilidadTareasPara(req.usuario.id) }),
          select: {
            id: true,
            titulo: true,
            descripcion: true,
            prioridad: true,
            fechaInicio: true,
            venceEn: true,
            dependeDeId: true,
            creadoEn: true,
          },
        },
      },
    });

    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const permitido = puedeAdministrarProyecto(req.usuario, proyecto)
      || proyecto.creadorId === req.usuario.id
      || proyecto.miembros.some(m => m.id === req.usuario.id);

    if (!permitido) {
      return res.status(403).json({ error: 'No tienes permiso para crear una plantilla de este proyecto' });
    }

    const tareasPlantilla = buildTemplateTasksFromProject({ proyecto, tareas: proyecto.tareas });

    const plantilla = await prisma.plantillaProyecto.create({
      data: {
        nombre,
        descripcion: descripcion || proyecto.descripcion || null,
        area: proyecto.area || 'DESARROLLO',
        creadorId: req.usuario.id,
        proyectoBaseId: proyecto.id,
        tareas: {
          create: tareasPlantilla,
        },
      },
      include: INCLUDE_PLANTILLA,
    });

    await registrarActividad(
      req.usuario.id,
      proyecto.id,
      'CREAR_PLANTILLA',
      `${req.usuario.nombre} guardó la plantilla "${plantilla.nombre}" desde el proyecto "${proyecto.nombre}"`
    );

    return res.status(201).json({
      mensaje: 'Plantilla guardada correctamente',
      plantilla: {
        ...plantilla,
        totalTareas: plantilla._count?.tareas ?? plantilla.tareas.length,
      },
    });
  } catch (error) {
    console.error('[plantillas.guardarComoPlantilla]', error);
    const detalle = getPlantillasDbError(error, 'guardar la plantilla');
    if (detalle) {
      return res.status(500).json({ error: detalle });
    }
    return res.status(500).json({ error: 'Error al guardar la plantilla' });
  }
};

// €€ GET /api/proyectos/:id/equipo €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
// Devuelve los miembros asignados oficialmente al proyecto.
// Misma regla de lectura que el resto del proyecto (`cargarProyectoVisible`):
// antes solo se validaba a los admins y cualquier miembro podia ver el equipo
// de cualquier proyecto con solo conocer el id.
const equipo = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const { proyecto: visible, permitido } = await cargarProyectoVisible(prisma, req.usuario, id);
    if (!visible) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!permitido) {
      return res.status(403).json({ error: 'No tienes permiso para ver el equipo de este proyecto' });
    }

    const [proyecto, tareas] = await Promise.all([
      prisma.proyecto.findUnique({
        where: { id },
        include: {
          creador: { select: { id: true, nombre: true, area: true, rol: true, email: true, fotoPerfilUrl: true } },
          miembros: {
            select: { id: true, nombre: true, email: true, area: true, rol: true, fotoPerfilUrl: true },
          },
        },
      }),
      prisma.tarea.findMany({
        where: { proyectoId: id },
        select: { estado: true, asignadoId: true, asignados: { select: { id: true } } },
      }),
    ]);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Conteo por miembro: una tarea cuenta si es responsable principal o
    // co-asignado (antes solo se miraba `asignadoId`).
    const miembrosConStats = proyecto.miembros.map(m => {
      const suyas = tareas.filter((t) => tareaEsDe(t, m.id));
      return {
        id:        m.id,
        nombre:    m.nombre,
        email:     m.email,
        area:      m.area,
        rol:       m.rol,
        fotoPerfilUrl: m.fotoPerfilUrl ?? null,
        tareas: {
          total:      suyas.length,
          pendientes: suyas.filter(t => t.estado === 'PENDIENTE').length,
          enProgreso: suyas.filter(t => t.estado === 'EN_PROGRESO').length,
          hechas:     suyas.filter(t => t.estado === 'HECHO').length,
        },
      };
    });

    return res.json({ proyecto, equipo: miembrosConStats });
  } catch (error) {
    return responderError(res, error, '[proyectos.equipo]');
  }
};

// €€ POST /api/proyectos €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const crear = async (req, res) => {
  const body = req.body || {};
  const archivos = Array.isArray(req.files) ? req.files : [];
  const urlsSubidas = [];
  let proyectoCreado = null;

  try {
    const nombre = textoDeCampo(body.nombre);
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del proyecto es requerido' });
    }

    if (body.estado && !esEstadoProyectoValido(body.estado)) {
      return res.status(400).json({ error: `Estado inválido. Valores permitidos: ${ESTADOS_PROYECTO.join(', ')}` });
    }

    const descripcion = textoDeCampo(body.descripcion) || null;
    const primerComentario = textoDeCampo(body.primerComentario);

    // Procesar IDs de miembros (pueden venir como string JSON en multipart)
    const ids = normalizarIds(parseJsonArray(body.miembrosIds));
    const idsProyecto = ids.includes(req.usuario.id) ? ids : [...ids, req.usuario.id];

    // Fuera del administrador general, cada quien crea solo en sus areas (y sin
    // indicarlas, en todas las suyas).
    const areas = validarAreasProyecto(
      body.area || (esAdminGlobal(req.usuario) ? undefined : req.usuario.area),
      req.usuario,
      'Solo puedes crear proyectos en tus áreas',
    );
    const areaProyecto = areas.join(',');

    const { invalidos } = await validarMiembrosPorArea(ids);
    if (invalidos.length > 0) {
      return res.status(400).json({ error: 'Solo puedes asignar miembros válidos al proyecto' });
    }

    const clienteId = await resolverCliente(body.clienteId, req.usuario);
    const fechaInicio = parsearFechaProyecto(body.fechaInicio, 'inicio') || new Date();
    const fechaFin = parsearFechaProyecto(body.fechaFin, 'fin') || null;
    validarRangoProyecto(fechaInicio, fechaFin);

    if (body.plantillaId && configEnCache().modulos.plantillas === false) {
      return res.status(404).json({ error: 'Las plantillas están desactivadas en esta instalación', codigo: 'MODULO_DESACTIVADO' });
    }
    const plantillaIdNum = body.plantillaId ? parseInt(body.plantillaId) : null;
    const plantilla = plantillaIdNum
      ? await prisma.plantillaProyecto.findUnique({
          where: { id: plantillaIdNum },
          include: { tareas: { orderBy: { orden: 'asc' } } },
        })
      : null;

    if (body.plantillaId && (!plantillaIdNum || !plantilla)) {
      return res.status(404).json({ error: 'La plantilla seleccionada no existe' });
    }

    const areasPlantilla = plantilla ? areasDePlantillas(req.usuario) : null;
    if (areasPlantilla && !proyectoCoincideConArea(plantilla.area, areasPlantilla)) {
      return res.status(403).json({ error: 'No tienes permiso para usar plantillas de otra área' });
    }

    // Adjuntos: multer los deja en memoria (serverless, sin disco), asi que se
    // suben a Vercel Blob ANTES de la transaccion y se borran si esta falla.
    // Antes se guardaba `file.filename`, que con memoryStorage no existe.
    const adjuntos = [];
    for (const file of archivos) {
      const url = await subirArchivo(file, 'adjuntos');
      urlsSubidas.push(url);
      adjuntos.push({
        nombre: nombreUtf8(file.originalname),
        url,
        tipo: file.mimetype,
        tamano: file.size,
        usuarioId: req.usuario.id,
      });
    }

    proyectoCreado = await prisma.$transaction(async (tx) => {
      const creado = await tx.proyecto.create({
        data: {
          nombre,
          descripcion,
          estado:      body.estado ? normalizarEstadoProyecto(body.estado) : ESTADO_PROYECTO_DEFAULT,
          area:        areaProyecto,
          fechaInicio,
          fechaFin,
          ...(clienteId ? { clienteId } : {}),
          creadorId:   req.usuario.id,
          miembros: {
            connect: idsProyecto.map(id => ({ id: Number(id) }))
          }
        },
        include: INCLUDE_PROYECTO,
      });

      if (plantilla) {
        await aplicarPlantillaATareas({ tx, proyecto: creado, plantilla, creadorId: req.usuario.id });
      }

      if (primerComentario) {
        await tx.comentario.create({
          data: {
            contenido: primerComentario,
            proyectoId: creado.id,
            autorId: req.usuario.id,
          },
        });
      }

      if (adjuntos.length > 0) {
        await tx.adjunto.createMany({
          data: adjuntos.map((adjunto) => ({ ...adjunto, proyectoId: creado.id })),
        });
      }

      return creado;
    }, OPCIONES_TRANSACCION_PLANTILLA);

    const proyecto = proyectoCreado;

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      proyecto.id,
      'CREAR_PROYECTO',
      `${req.usuario.nombre} creó el proyecto "${proyecto.nombre}" con ${idsProyecto.length} miembros${plantilla ? ` usando la plantilla "${plantilla.nombre}"` : ''}`
    );

    require('../services/avisosCorreo.service').avisarProyectoAsignado({ usuarioIds: idsProyecto, actorId: req.usuario.id, proyecto });

    return res.status(201).json({ mensaje: 'Proyecto creado', proyecto });
  } catch (error) {
    if (!proyectoCreado && urlsSubidas.length > 0) await borrarBlobs(urlsSubidas);
    return responderError(res, error, '[proyectos.crear]');
  }
};

// €€ PUT /api/proyectos/:id €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const editar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const body = req.body || {};

  try {
    if (body.estado && !esEstadoProyectoValido(body.estado)) {
      return res.status(400).json({ error: `Estado inválido. Valores permitidos: ${ESTADOS_PROYECTO.join(', ')}` });
    }

    const existente = await prisma.proyecto.findUnique({
      where: { id },
      include: {
        miembros: { select: { id: true } },
      },
    });
    if (!existente) return res.status(404).json({ error: 'Proyecto no encontrado' });

    if (!puedeAdministrarProyecto(req.usuario, existente)) {
      return res.status(403).json({ error: 'No tienes permiso para editar este proyecto' });
    }

    const nombre = body.nombre !== undefined ? textoDeCampo(body.nombre) : undefined;
    if (nombre !== undefined && !nombre) {
      throw new ErrorValidacion('El nombre del proyecto es requerido');
    }
    const descripcion = body.descripcion !== undefined ? (textoDeCampo(body.descripcion) || null) : undefined;

    // El area y las fechas se validan SIEMPRE. Antes solo se hacia dentro del
    // bloque de `miembrosIds`, asi que un admin de area podia mover el proyecto
    // fuera de su area con solo no mandar la lista de miembros.
    // El permiso de area solo se exige si el conjunto de areas CAMBIA: un
    // proyecto multi-area ("DESARROLLO,MARKETING") lo administra el admin de
    // DESARROLLO, y debe poder archivarlo o editarlo sin tocar el area.
    const areasActuales = areasDeProyecto(existente.area);
    const areas = body.area ? areasDeProyecto(body.area) : areasActuales;
    const validas = areasValidas();
    const areasInvalidas = areas.filter((item) => !validas.includes(item));
    if (areasInvalidas.length > 0) {
      throw new ErrorValidacion(`Área inválida: ${areasInvalidas.join(', ')}. Valores permitidos: ${validas.join(', ')}`);
    }
    const cambiaArea = areas.join(',') !== areasActuales.join(',');
    // Tanto las areas que se ponen como las que se quitan tienen que ser
    // suyas: antes se miraban solo las nuevas, y quien llegaba al proyecto
    // por ser miembro podia sacarlo de un area ajena.
    const tocadas = [...areas.filter((a) => !areasActuales.includes(a)), ...areasActuales.filter((a) => !areas.includes(a))];
    if (cambiaArea && !esAdminGlobal(req.usuario) && !tocadas.every((item) => areasDe(req.usuario).includes(item))) {
      throw new ErrorValidacion('Solo puedes mover el proyecto dentro de tus áreas', 403);
    }

    const fechaInicioNueva = parsearFechaProyecto(body.fechaInicio, 'inicio') || undefined;
    const fechaFinNueva = parsearFechaProyecto(body.fechaFin, 'fin');
    const inicioEfectivo = fechaInicioNueva || existente.fechaInicio;
    const finEfectivo = fechaFinNueva === undefined ? existente.fechaFin : fechaFinNueva;
    validarRangoProyecto(inicioEfectivo, finEfectivo);

    const clienteNuevo = await resolverCliente(body.clienteId, req.usuario);
    const dataUpdate = {
      ...(clienteNuevo !== undefined && { clienteId: clienteNuevo }),
      ...(nombre !== undefined && { nombre }),
      ...(descripcion !== undefined && { descripcion }),
      ...(body.estado && { estado: normalizarEstadoProyecto(body.estado) }),
      ...(body.area && { area: areas.join(',') }),
      ...(fechaInicioNueva && { fechaInicio: fechaInicioNueva }),
      ...(fechaFinNueva !== undefined && { fechaFin: fechaFinNueva }),
    };

    // Actualizar miembros si se envían. El creador siempre se conserva.
    if (body.miembrosIds) {
      const ids = normalizarIds(parseJsonArray(body.miembrosIds));
      const idsProyecto = ids.includes(existente.creadorId) ? ids : [...ids, existente.creadorId];
      const { invalidos } = await validarMiembrosPorArea(ids);
      if (invalidos.length > 0) {
        return res.status(400).json({ error: 'Solo puedes asignar miembros válidos al proyecto' });
      }

      dataUpdate.miembros = {
        set: idsProyecto.map(mid => ({ id: Number(mid) }))
      };
    }

    const proyecto = await prisma.proyecto.update({
      where: { id },
      data: dataUpdate,
      include: INCLUDE_PROYECTO,
    });
    // Su carpeta de Google Drive lleva el mismo nombre (sin esperar a Drive).
    if (proyecto.nombre !== existente.nombre) void driveProyectos.renombrarCarpeta(proyecto.driveCarpetaId, proyecto.nombre);
    // Con otro cliente, los documentos compartidos con el anterior dejan de
    // verse en el portal: el nuevo los veria todos.
    if (clienteNuevo !== undefined && clienteNuevo !== existente.clienteId) {
      await prisma.adjunto.updateMany({ where: { proyectoId: id, visibleCliente: true }, data: { visibleCliente: false } });
    }

    // Aviso por correo solo a quien se acaba de agregar al equipo.
    if (dataUpdate.miembros) {
      const antes = new Set(existente.miembros.map((m) => m.id));
      const nuevos = proyecto.miembros.map((m) => m.id).filter((mid) => !antes.has(mid));
      require('../services/avisosCorreo.service').avisarProyectoAsignado({ usuarioIds: nuevos, actorId: req.usuario.id, proyecto });
    }

    // No se tocan eventos de agenda: el bloque "Proyecto: X" lo deriva la
    // agenda del propio proyecto, asi que un cambio de nombre o fechas se ve
    // reflejado sin regenerar nada (ver la nota junto a `aplicarPlantillaATareas`).

    // Registrar en el Log de Actividad
    await registrarActividad(
      req.usuario.id,
      proyecto.id,
      'EDITAR_PROYECTO',
      `${req.usuario.nombre} actualizó el proyecto "${proyecto.nombre}"`
    );

    return res.json({ mensaje: 'Proyecto actualizado', proyecto });
  } catch (error) {
    return responderError(res, error, '[proyectos.editar]');
  }
};

// €€ DELETE /api/proyectos/:id €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€
const eliminar = async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const existente = await prisma.proyecto.findUnique({
      where: { id },
      select: { id: true, nombre: true, area: true, creadorId: true, driveCarpetaId: true, miembros: { select: { id: true } }, _count: { select: { tareas: true } } },
    });
    if (!existente) return res.status(404).json({ error: 'Proyecto no encontrado' });

    if (!puedeEliminarProyecto(req.usuario, existente)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este proyecto' });
    }

    // Todo el borrado en una transaccion. Las filas `Evento` ligadas al
    // proyecto (las antiguas "Proyecto: X" y cualquier evento con proyectoId)
    // se borran explicitamente: la FK solo las dejaba con proyectoId null y
    // seguian apareciendo como ocupacion huerfana.
    // A la papelera del CRM (services/papelera.service.js): copia del proyecto
    // con sus tareas, comentarios, adjuntos, eventos e historial; sus archivos
    // y su carpeta de Google Drive se mueven a la carpeta Papelera.
    const conAutor = { include: { autor: { select: { nombre: true } } } };
    const [proyecto, tareas, adjuntos, comentarios, eventos, historial] = await Promise.all([
      prisma.proyecto.findUnique({
        where: { id },
        include: { cliente: { select: { nombre: true } }, creador: { select: { nombre: true } }, miembros: { select: { id: true, nombre: true } } },
      }),
      prisma.tarea.findMany({ where: { proyectoId: id }, orderBy: { id: 'asc' } }),
      prisma.adjunto.findMany({ where: { OR: [{ proyectoId: id }, { tarea: { proyectoId: id } }, { evento: { proyectoId: id } }] } }),
      prisma.comentario.findMany({ where: { OR: [{ proyectoId: id }, { tarea: { proyectoId: id } }] }, ...conAutor, orderBy: { creadoEn: 'asc' } }),
      prisma.evento.findMany({ where: { proyectoId: id }, include: { invitados: { select: { usuarioId: true, estado: true } } } }),
      prisma.logActividad.findMany({ where: { proyectoId: id }, include: { usuario: { select: { nombre: true } } }, orderBy: { creadoEn: 'asc' } }),
    ]);
    await papelera.conPapelera({
      tipo: 'proyecto',
      modulo: 'proyectos',
      entidadId: id,
      nombre: existente.nombre,
      contexto: proyecto?.cliente?.nombre ? `Cliente: ${proyecto.cliente.nombre}` : null,
      datos: {
        ...proyecto,
        tareas,
        comentarios: comentarios.map(({ autor, ...c }) => ({ ...c, autorNombre: autor?.nombre || null })),
        adjuntos,
        eventos,
        historial: historial.map(({ usuario, ...h }) => ({ ...h, usuarioNombre: usuario?.nombre || null })),
      },
      archivos: adjuntos.map(papelera.archivoDeAdjunto),
    }, () => prisma.$transaction(async (tx) => {
      await tx.evento.deleteMany({ where: { proyectoId: id } });
      await tx.tarea.deleteMany({ where: { proyectoId: id } });
      await tx.proyecto.delete({ where: { id } });
    }));
    await papelera.carpetaDrive(existente.driveCarpetaId);

    // La bitacora (`logs_actividad`) tiene FK al proyecto con borrado en
    // cascada: no hay donde dejar el apunte en la base (antes se intentaba
    // despues de borrar y fallaba por la FK, asi que nunca quedaba). Se deja
    // en el log del servidor.
    console.info(
      `[auditoria] ${req.usuario.nombre} (id ${req.usuario.id}) eliminó el proyecto "${existente.nombre}" (id ${id}) con ${existente._count.tareas} tareas`
    );

    return res.json({ mensaje: 'Proyecto eliminado correctamente' });
  } catch (error) {
    return responderError(res, error, '[proyectos.eliminar]');
  }
};

module.exports = { listar, equipo, crear, editar, eliminar, listarPlantillas, guardarComoPlantilla };
