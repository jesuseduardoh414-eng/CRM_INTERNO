// Reglas de acceso a proyectos y areas. Lo que puede cada persona sale de la
// tabla de permisos de su area y de sus ajustes (utils/permisosArea.utils.js);
// aqui se traduce a "este proyecto si / no".
//
// Alcances (proyectos.ver, proyectos.editar, tareas.crear, ...):
//   propios  proyectos donde es creador o miembro (para ver, tambien donde
//            participa en alguna tarea)
//   area     los de su area, mas los propios
//   todos    cualquiera
const { alcanceDe } = require('./permisosArea.utils');

const normalizarAreas = (value) => String(value || '')
  .split(',')
  .map((area) => area.trim())
  .filter(Boolean);

const esAdmin = (usuario) => usuario?.rol === 'ADMIN';

const esAdminGlobal = (usuario) => esAdmin(usuario) && usuario?.area === 'ADMINISTRACION';

const proyectoCoincideConArea = (areaProyecto, areaUsuario) => {
  if (!areaUsuario) return false;
  return normalizarAreas(areaProyecto).includes(areaUsuario);
};

const buildFiltroAreaProyecto = (area, campo = 'area') => ({
  OR: [
    { [campo]: area },
    { [campo]: { startsWith: `${area},` } },
    { [campo]: { endsWith: `,${area}` } },
    { [campo]: { contains: `,${area},` } },
  ],
});

// Recorte de los tableros del equipo (inicio del admin, Reportes): el
// administrador general ve todo; cualquier otra persona, solo su area.
const buildScopeProyectoParaAdmin = (usuario, campo = 'area') => {
  if (esAdminGlobal(usuario)) return {};
  return buildFiltroAreaProyecto(usuario?.area, campo);
};

// Gestion de personas e invitaciones ("usuarios.ver"): con "todos" cualquier
// area; si no, solo la propia.
const veTodosLosUsuarios = (usuario) => esAdminGlobal(usuario) || alcanceDe(usuario, 'usuarios.ver') === 'todos';
const gestionaUsuariosDe = (usuario, area) => veTodosLosUsuarios(usuario) || (Boolean(area) && area === usuario?.area);

/** Miembro explicito del proyecto (`proyecto.miembros` = [{ id }]). */
const esMiembroDe = (usuario, proyecto) => (proyecto?.miembros || []).some((m) => m.id === usuario?.id);

/**
 * ¿El alcance llega a este proyecto? Para "propios" cuenta ser creador o
 * miembro explicito (el proyecto debe traer `miembros` y `creadorId`).
 */
const alcanzaProyecto = (usuario, proyecto, alcance) => {
  if (!usuario || !proyecto || !alcance || alcance === 'ninguno') return false;
  if (alcance === 'todos') return true;
  if (alcance === 'area' && proyectoCoincideConArea(proyecto.area, usuario.area)) return true;
  return proyecto.creadorId === usuario.id || esMiembroDe(usuario, proyecto);
};

/** Editar el proyecto (datos, estado, equipo) segun "proyectos.editar". */
const puedeAdministrarProyecto = (usuario, proyecto) => alcanzaProyecto(usuario, proyecto, alcanceDe(usuario, 'proyectos.editar'));

const puedeEliminarProyecto = (usuario, proyecto) => alcanzaProyecto(usuario, proyecto, alcanceDe(usuario, 'proyectos.eliminar'));

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
  if (alcance === 'area' && proyectoCoincideConArea(proyecto.area, usuario.area)) return true;
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
  if (alcance === 'area') return { OR: [...buildFiltroAreaProyecto(usuario.area).OR, ...propios] };
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
  if (alcance === 'area' && proyectoCoincideConArea(proyecto.area, usuario.area)) return true;
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
  proyectoCoincideConArea,
  buildFiltroAreaProyecto,
  buildScopeProyectoParaAdmin,
  veTodosLosUsuarios,
  gestionaUsuariosDe,
  puedeAdministrarProyecto,
  puedeEliminarProyecto,
  puedeActuarEnTarea,
  filtroProyectosVisibles,
};
