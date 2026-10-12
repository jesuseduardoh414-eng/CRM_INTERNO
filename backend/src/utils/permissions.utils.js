const normalizarAreas = (value) => String(value || '')
  .split(',')
  .map((area) => area.trim())
  .filter(Boolean);

const esAdmin = (usuario) => usuario?.rol === 'ADMIN';

const esAdminGlobal = (usuario) => esAdmin(usuario) && usuario?.area === 'ADMINISTRACION';

const esAdminDeArea = (usuario) => esAdmin(usuario) && !esAdminGlobal(usuario);

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

const buildScopeProyectoParaAdmin = (usuario, campo = 'area') => {
  if (!esAdmin(usuario)) return null;
  if (esAdminGlobal(usuario)) return {};
  return buildFiltroAreaProyecto(usuario.area, campo);
};

const puedeGestionarArea = (usuario, areaObjetivo) => (
  esAdminGlobal(usuario) || (esAdminDeArea(usuario) && usuario.area === areaObjetivo)
);

const puedeAdministrarProyecto = (usuario, proyecto) => {
  if (!esAdmin(usuario)) return false;
  if (esAdminGlobal(usuario)) return true;
  return proyectoCoincideConArea(proyecto?.area, usuario.area);
};

// Regla unica de lectura de un proyecto. Se usa en todos los endpoints que
// devuelven datos de un proyecto o de sus tareas (comentarios, adjuntos,
// historial, equipo, tareas). Misma regla que `tareas.listar`:
//  - ADMIN global: siempre.
//  - ADMIN de area: solo si el proyecto es de su area.
//  - MIEMBRO: si es miembro, creador del proyecto, o participa en alguna
//    tarea (asignado principal, co-asignado o creador de la tarea). Con el
//    permiso "verTodosProyectos" del panel, cualquiera.
// `proyecto` debe traer `id`, `area`, `creadorId` y, opcionalmente,
// `miembros` ([{ id }]). Si no trae `miembros`, se consultan.
const puedeVerProyecto = async (prisma, usuario, proyecto) => {
  if (!usuario || !proyecto) return false;
  // Permiso del panel: los miembros pueden ver todos los proyectos.
  if (!esAdmin(usuario) && require('../services/configuracion.service').configEnCache().permisos?.verTodosProyectos) return true;
  if (esAdmin(usuario)) return puedeAdministrarProyecto(usuario, proyecto);
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
  esAdminDeArea,
  proyectoCoincideConArea,
  buildFiltroAreaProyecto,
  buildScopeProyectoParaAdmin,
  puedeGestionarArea,
  puedeAdministrarProyecto,
};
