// Reglas de acceso a proyectos y areas. Lo que puede cada persona sale de la
// tabla de permisos de su area y de sus ajustes (utils/permisosArea.utils.js);
// aqui se traduce a "este proyecto si / no".
//
// Alcances (proyectos.ver, proyectos.editar, tareas.crear, ...):
//   propios  proyectos donde es creador o miembro (para ver, tambien donde
//            participa en alguna tarea)
//   area     los de su area, mas los propios
//   todos    cualquiera
//
// Proyectos, personas e invitaciones guardan sus areas en un texto separado
// por comas ("DESARROLLO,MARKETING"). "area" llega a lo que comparte alguna
// area con las de la persona que da ese alcance (areasDelAlcance).
const { alcanceDe, areasDelAlcance, areasDe, areasDeTexto, esAdminGeneral } = require('./permisosArea.utils');

const normalizarAreas = areasDeTexto;

const esAdmin = (usuario) => usuario?.rol === 'ADMIN';

const esAdminGlobal = esAdminGeneral;

/** ¿Comparten alguna area? Cada lado es un texto con comas o una lista. */
const compartenArea = (a, b) => {
  const lista = areasDeTexto(b);
  return areasDeTexto(a).some((area) => lista.includes(area));
};

const proyectoCoincideConArea = (areaProyecto, areasUsuario) => compartenArea(areaProyecto, areasUsuario);

// Filtro de Prisma: el texto de areas del campo incluye alguna de `areas`
// (una clave, un texto con comas o una lista). Sin areas no coincide nada.
const buildFiltroAreaProyecto = (areas, campo = 'area') => ({
  OR: areasDeTexto(areas).flatMap((area) => [
    { [campo]: area },
    { [campo]: { startsWith: `${area},` } },
    { [campo]: { endsWith: `,${area}` } },
    { [campo]: { contains: `,${area},` } },
  ]),
});

// Recorte de los tableros del equipo (inicio del admin, Reportes): el
// administrador general ve todo; cualquier otra persona, solo sus areas.
const buildScopeProyectoParaAdmin = (usuario, campo = 'area') => {
  if (esAdminGlobal(usuario)) return {};
  return buildFiltroAreaProyecto(areasDe(usuario), campo);
};

// Gestion de personas e invitaciones ("usuarios.ver"): con "todos" cualquier
// area; con "area", las suyas cuya tabla lo da; sin ese permiso (las acciones
// tienen el suyo: usuarios.editar, ...), sus areas. Para ver o gestionar a
// alguien basta compartir una de sus areas; para darle areas hay que llegar a
// todas las que se le dan (gestionaTodasLasAreas).
const veTodosLosUsuarios = (usuario) => esAdminGlobal(usuario) || alcanceDe(usuario, 'usuarios.ver') === 'todos';
const areasGestionables = (usuario) => (veTodosLosUsuarios(usuario) ? null
  : alcanceDe(usuario, 'usuarios.ver') === 'area' ? areasDelAlcance(usuario, 'usuarios.ver') : areasDe(usuario));
const gestionaUsuariosDe = (usuario, area) => veTodosLosUsuarios(usuario) || compartenArea(area, areasGestionables(usuario));
const gestionaTodasLasAreas = (usuario, areas) => {
  const lista = areasDeTexto(areas);
  if (!lista.length) return false;
  return veTodosLosUsuarios(usuario) || lista.every((area) => areasGestionables(usuario).includes(area));
};
/** Filtro de Prisma de las personas (o invitaciones) que gestiona. */
const filtroUsuariosGestionados = (usuario, campo = 'area') => (veTodosLosUsuarios(usuario) ? {} : buildFiltroAreaProyecto(areasGestionables(usuario), campo));

/** Miembro explicito del proyecto (`proyecto.miembros` = [{ id }]). */
const esMiembroDe = (usuario, proyecto) => (proyecto?.miembros || []).some((m) => m.id === usuario?.id);

/** ¿El proyecto es de alguna de las areas a las que llega `clave` con alcance "area"? */
const proyectoEnSusAreas = (usuario, proyecto, clave) => proyectoCoincideConArea(proyecto.area, areasDelAlcance(usuario, clave));

/**
 * ¿El alcance de `clave` llega a este proyecto? Para "propios" cuenta ser
 * creador o miembro explicito (el proyecto debe traer `miembros` y `creadorId`).
 */
const alcanzaProyecto = (usuario, proyecto, clave) => {
  const alcance = usuario ? alcanceDe(usuario, clave) : 'ninguno';
  if (!usuario || !proyecto || alcance === 'ninguno') return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && proyectoEnSusAreas(usuario, proyecto, clave)) return true;
  return proyecto.creadorId === usuario.id || esMiembroDe(usuario, proyecto);
};

/** Editar el proyecto (datos, estado, equipo) segun "proyectos.editar". */
const puedeAdministrarProyecto = (usuario, proyecto) => alcanzaProyecto(usuario, proyecto, 'proyectos.editar');

const puedeEliminarProyecto = (usuario, proyecto) => alcanzaProyecto(usuario, proyecto, 'proyectos.eliminar');

/**
 * Accion sobre tareas ("tareas.crear" | "tareas.editar" | "tareas.eliminar").
 * Con "area" o "todos" vale cualquier tarea de esos proyectos. Con "propios"
 * hace falta ser miembro explicito del proyecto y, si hay tarea, que sea suya:
 * sin responsable, asignada a la persona o creada por ella (`tareaEsAccesible`).
 */
const puedeActuarEnTarea = (usuario, proyecto, permiso, tareaEsAccesible = true) => {
  const alcance = alcanceDe(usuario, permiso);
  if (alcance === 'ninguno' || !proyecto) return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && proyectoEnSusAreas(usuario, proyecto, permiso)) return true;
  return esMiembroDe(usuario, proyecto) && tareaEsAccesible;
};

/** Filtro de Prisma con los proyectos que la persona puede ver ("proyectos.ver"). */
const filtroProyectosVisibles = (usuario) => {
  const alcance = alcanceDe(usuario, 'proyectos.ver');
  if (alcance === 'todos') return {};
  if (alcance === 'ninguno') return { id: -1 };
  const propios = [
    { miembros: { some: { id: usuario.id } } },
    { creadorId: usuario.id },
    { tareas: { some: { asignadoId: usuario.id } } },
    { tareas: { some: { asignados: { some: { id: usuario.id } } } } },
    { tareas: { some: { creadorId: usuario.id } } },
  ];
  if (alcance === 'area') return { OR: [...buildFiltroAreaProyecto(areasDelAlcance(usuario, 'proyectos.ver')).OR, ...propios] };
  return { OR: propios };
};

// Regla unica de lectura de un proyecto ("proyectos.ver"). Se usa en todos los
// endpoints que devuelven datos de un proyecto o de sus tareas (comentarios,
// adjuntos, historial, equipo, tareas). Propios = creador, miembro o participa
// en alguna tarea (responsable, co-asignado o creador de la tarea).
// `proyecto` debe traer `id`, `area`, `creadorId` y, opcionalmente,
// `miembros` ([{ id }]). Si no trae `miembros`, se consultan.
const puedeVerProyecto = async (prisma, usuario, proyecto) => {
  if (!usuario || !proyecto) return false;
  const alcance = alcanceDe(usuario, 'proyectos.ver');
  if (alcance === 'ninguno') return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && proyectoEnSusAreas(usuario, proyecto, 'proyectos.ver')) return true;
  if (proyecto.creadorId === usuario.id) return true;

  let miembros = proyecto.miembros;
  if (!Array.isArray(miembros)) {
    const p = await prisma.proyecto.findUnique({
      where: { id: proyecto.id },
      select: { miembros: { select: { id: true } } },
    });
    miembros = p?.miembros || [];
  }
  if (miembros.some((m) => m.id === usuario.id)) return true;

  const participa = await prisma.tarea.findFirst({
    where: {
      proyectoId: proyecto.id,
      OR: [
        { asignadoId: usuario.id },
        { asignados: { some: { id: usuario.id } } },
        { creadorId: usuario.id },
      ],
    },
    select: { id: true },
  });
  return Boolean(participa);
};

// Variante por id: carga lo minimo del proyecto y aplica `puedeVerProyecto`.
// Devuelve { proyecto, permitido }. `proyecto` es null si no existe.
const cargarProyectoVisible = async (prisma, usuario, proyectoId) => {
  const id = parseInt(proyectoId);
  if (isNaN(id)) return { proyecto: null, permitido: false };
  const proyecto = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, nombre: true, area: true, creadorId: true, estado: true, miembros: { select: { id: true } } },
  });
  if (!proyecto) return { proyecto: null, permitido: false };
  return { proyecto, permitido: await puedeVerProyecto(prisma, usuario, proyecto) };
};

module.exports = {
  normalizarAreas,
  puedeVerProyecto,
  cargarProyectoVisible,
  esAdmin,
  esAdminGlobal,
  compartenArea,
  proyectoCoincideConArea,
  proyectoEnSusAreas,
  buildFiltroAreaProyecto,
  buildScopeProyectoParaAdmin,
  veTodosLosUsuarios,
  areasGestionables,
  gestionaUsuariosDe,
  gestionaTodasLasAreas,
  filtroUsuariosGestionados,
  puedeAdministrarProyecto,
  puedeEliminarProyecto,
  puedeActuarEnTarea,
  filtroProyectosVisibles,
};
