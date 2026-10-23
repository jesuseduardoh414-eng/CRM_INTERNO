// Lado del equipo del portal de clientes.
//
// Accesos (/api/empresas/:id/accesos, solo administradores): dar acceso al
// portal a un contacto de la empresa (invitación por correo), reenviarla,
// cancelarla y suspender o reactivar cuentas.
//
// Proyecto (/api/proyectos/:id/portal): la conversación con el cliente y los
// documentos compartidos. Lo ve quien puede ver el proyecto y tiene
// "clientes.ver"; compartir o dejar de compartir un archivo, solo un
// administrador del proyecto.
const prisma = require('../lib/prisma');
const { generarInvitacion } = require('./auth.controller');
const correo = require('../services/email.service');
const { esEmailValido } = require('../utils/security.utils');
const { revocarTodas } = require('../services/sesiones.service');
const { invalidarCacheUsuario } = require('../middlewares/auth.middleware');
const { cargarProyectoVisible, puedeAdministrarProyecto } = require('../utils/permissions.utils');
const { puede, sinPermiso } = require('../utils/permisosArea.utils');

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MENSAJE = 4000;

const idDe = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const fallo = (res, error, contexto, mensaje = 'No se pudo completar la operación') => {
  console.error(`[portalEquipo.${contexto}]`, error);
  return res.status(500).json({ error: mensaje });
};

const nombreEmpresa = (empresa) => empresa.nombreComercial || empresa.nombre;

// ===========================================================================
// ACCESOS AL PORTAL (ficha de la empresa)
// ===========================================================================

const cargarEmpresa = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) { res.status(400).json({ error: 'ID no válido' }); return null; }
  const empresa = await prisma.empresa.findUnique({
    where: { id },
    select: { id: true, nombre: true, nombreComercial: true, tipo: true, estado: true },
  });
  if (!empresa) { res.status(404).json({ error: 'No existe esa empresa' }); return null; }
  return empresa;
};

const selectAcceso = { id: true, nombre: true, email: true, estado: true, ultimoLoginEn: true, creadoEn: true };

// GET /api/empresas/:id/accesos
const listarAccesos = async (req, res) => {
  try {
    const empresa = await cargarEmpresa(req, res);
    if (!empresa) return undefined;
    const [usuarios, invitaciones] = await Promise.all([
      prisma.usuario.findMany({ where: { empresaId: empresa.id, rol: 'CLIENTE' }, orderBy: { nombre: 'asc' }, select: selectAcceso }),
      prisma.invitacion.findMany({
        where: { empresaId: empresa.id, rol: 'cliente', estado: { not: 'aceptada' } },
        orderBy: { creadoEn: 'desc' },
        select: { id: true, nombre: true, email: true, estado: true, expiraEn: true, creadoEn: true },
      }),
    ]);
    const ahora = new Date();
    return res.json({
      usuarios,
      invitaciones: invitaciones.map((i) => ({ ...i, vencida: i.expiraEn < ahora || i.estado === 'expirada' })),
    });
  } catch (error) {
    return fallo(res, error, 'listarAccesos');
  }
};

const enviarCorreoInvitacion = async ({ nombre, email, token, empresa }) => {
  try {
    await correo.enviarInvitacionPortal({ nombre, email, token, cliente: nombreEmpresa(empresa) });
    return null;
  } catch (error) {
    console.error('[portalEquipo] No se pudo enviar la invitación:', error?.message || error);
    return 'El acceso se guardó, pero no se pudo enviar el correo. Revisa el correo del sistema y reenvía la invitación.';
  }
};

// POST /api/empresas/:id/accesos   { contactoId } o { nombre, email }
const invitarAcceso = async (req, res) => {
  try {
    const empresa = await cargarEmpresa(req, res);
    if (!empresa) return undefined;
    if (empresa.estado !== 'ACTIVO') return res.status(409).json({ error: 'La empresa está inactiva: actívala antes de dar acceso al portal.' });
    if (empresa.tipo === 'PROVEEDOR') return res.status(409).json({ error: 'El portal es solo para clientes.' });

    let { nombre, email } = req.body || {};
    const contactoId = idDe(req.body?.contactoId);
    if (contactoId) {
      const contacto = await prisma.contactoEmpresa.findFirst({ where: { id: contactoId, empresaId: empresa.id }, select: { nombre: true, email: true } });
      if (!contacto) return res.status(404).json({ error: 'No existe ese contacto' });
      nombre = contacto.nombre;
      email = contacto.email;
    }
    nombre = typeof nombre === 'string' ? nombre.trim().slice(0, 255) : '';
    email = typeof email === 'string' ? email.toLowerCase().trim() : '';
    if (nombre.length < 2) return res.status(400).json({ error: 'Indica el nombre de la persona' });
    if (!esEmailValido(email)) return res.status(400).json({ error: contactoId ? 'El contacto no tiene un correo válido: agrégalo primero.' : 'El correo no tiene un formato válido' });

    const existente = await prisma.usuario.findUnique({ where: { email }, select: { rol: true, empresaId: true } });
    if (existente) {
      const mensaje = existente.rol === 'CLIENTE' && existente.empresaId === empresa.id
        ? 'Esa persona ya tiene acceso al portal.'
        : 'Ese correo ya tiene una cuenta en el sistema. Usa otro correo para el portal.';
      return res.status(409).json({ error: mensaje });
    }

    const { token } = await generarInvitacion({
      nombre, email, area: '', rol: 'cliente', creadoPor: req.usuario.id, empresaId: empresa.id,
    });
    const advertencia = await enviarCorreoInvitacion({ nombre, email, token, empresa });
    return res.status(201).json({ mensaje: `Invitación enviada a ${email}`, ...(advertencia ? { advertencia } : {}) });
  } catch (error) {
    return fallo(res, error, 'invitarAcceso', 'No se pudo enviar la invitación');
  }
};

const cargarInvitacion = async (req, res, empresa) => {
  const { invitacionId } = req.params;
  if (!REGEX_UUID.test(String(invitacionId || ''))) { res.status(400).json({ error: 'Invitación no válida' }); return null; }
  const invitacion = await prisma.invitacion.findFirst({ where: { id: invitacionId, empresaId: empresa.id, rol: 'cliente' } });
  if (!invitacion) { res.status(404).json({ error: 'No existe esa invitación' }); return null; }
  if (invitacion.estado === 'aceptada') { res.status(409).json({ error: 'Esa invitación ya se aceptó' }); return null; }
  return invitacion;
};

// POST /api/empresas/:id/accesos/invitaciones/:invitacionId/reenviar
const reenviarAcceso = async (req, res) => {
  try {
    const empresa = await cargarEmpresa(req, res);
    if (!empresa) return undefined;
    if (empresa.estado !== 'ACTIVO') return res.status(409).json({ error: 'La empresa está inactiva.' });
    const invitacion = await cargarInvitacion(req, res, empresa);
    if (!invitacion) return undefined;
    const { token } = await generarInvitacion({
      nombre: invitacion.nombre, email: invitacion.email, area: '', rol: 'cliente', creadoPor: req.usuario.id, empresaId: empresa.id,
    });
    const advertencia = await enviarCorreoInvitacion({ nombre: invitacion.nombre, email: invitacion.email, token, empresa });
    if (advertencia) return res.status(502).json({ error: advertencia });
    return res.json({ mensaje: 'Invitación reenviada' });
  } catch (error) {
    return fallo(res, error, 'reenviarAcceso');
  }
};

// DELETE /api/empresas/:id/accesos/invitaciones/:invitacionId
const cancelarInvitacion = async (req, res) => {
  try {
    const empresa = await cargarEmpresa(req, res);
    if (!empresa) return undefined;
    const invitacion = await cargarInvitacion(req, res, empresa);
    if (!invitacion) return undefined;
    await prisma.invitacion.delete({ where: { id: invitacion.id } });
    return res.json({ mensaje: 'Invitación cancelada' });
  } catch (error) {
    return fallo(res, error, 'cancelarInvitacion');
  }
};

// PUT /api/empresas/:id/accesos/:usuarioId   { estado: 'activo' | 'inactivo' }
const cambiarEstadoAcceso = async (req, res) => {
  const usuarioId = idDe(req.params.usuarioId);
  const estado = req.body?.estado;
  if (!usuarioId) return res.status(400).json({ error: 'ID no válido' });
  if (!['activo', 'inactivo'].includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  try {
    const empresa = await cargarEmpresa(req, res);
    if (!empresa) return undefined;
    const usuario = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId: empresa.id, rol: 'CLIENTE' }, select: { id: true } });
    if (!usuario) return res.status(404).json({ error: 'No existe ese acceso' });
    await prisma.usuario.update({ where: { id: usuarioId }, data: { estado } });
    if (estado === 'inactivo') await revocarTodas(usuarioId);
    invalidarCacheUsuario(usuarioId);
    return res.json({ mensaje: estado === 'activo' ? 'Acceso reactivado' : 'Acceso suspendido' });
  } catch (error) {
    return fallo(res, error, 'cambiarEstadoAcceso');
  }
};

/**
 * Suspende todos los accesos al portal de una empresa (al borrarla del
 * directorio). Las cuentas no se borran: conservan su historial de mensajes.
 */
const suspenderAccesosEmpresa = async (empresaId) => {
  const usuarios = await prisma.usuario.findMany({ where: { empresaId, rol: 'CLIENTE' }, select: { id: true } });
  if (!usuarios.length) return;
  await prisma.usuario.updateMany({ where: { id: { in: usuarios.map((u) => u.id) } }, data: { estado: 'inactivo' } });
  await Promise.all(usuarios.map((u) => revocarTodas(u.id)));
  usuarios.forEach((u) => invalidarCacheUsuario(u.id));
};

// ===========================================================================
// PORTAL DESDE EL PROYECTO (pestaña "Cliente" del detalle)
// ===========================================================================

const selectMensaje = {
  id: true, contenido: true, deCliente: true, creadoEn: true,
  autor: { select: { id: true, nombre: true, puesto: true, fotoPerfilUrl: true } },
};

// La pestaña "Cliente" (quien es el cliente, sus contactos y la conversacion)
// es del directorio de clientes: solo para quien tiene "clientes.ver", como
// el cliente en el resto del proyecto. Decision del usuario (2026-10-23).
const sinClientes = (req, res) => {
  if (puede(req.usuario, 'clientes.ver')) return false;
  sinPermiso(res);
  return true;
};

// GET /api/proyectos/:id/portal
const verPortalProyecto = async (req, res) => {
  if (sinClientes(req, res)) return undefined;
  try {
    const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, req.params.id);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!permitido) return res.status(403).json({ error: 'No tienes permiso para ver este proyecto' });

    const datos = await prisma.proyecto.findUnique({
      where: { id: proyecto.id },
      select: { cliente: { select: { id: true, nombre: true, nombreComercial: true, estado: true, tipo: true } } },
    });
    const cliente = datos?.cliente || null;
    const [mensajes, accesos, compartidos] = await Promise.all([
      prisma.mensajePortal.findMany({ where: { proyectoId: proyecto.id }, orderBy: { creadoEn: 'asc' }, take: 500, select: selectMensaje }),
      cliente
        ? prisma.usuario.findMany({ where: { empresaId: cliente.id, rol: 'CLIENTE', estado: 'activo' }, select: { id: true, nombre: true, ultimoLoginEn: true } })
        : [],
      prisma.adjunto.count({ where: { proyectoId: proyecto.id, tareaId: null, eventoId: null, visibleCliente: true } }),
    ]);
    return res.json({
      cliente: cliente ? { id: cliente.id, nombre: nombreEmpresa(cliente), activo: cliente.estado === 'ACTIVO' && cliente.tipo !== 'PROVEEDOR' } : null,
      accesos,
      documentosCompartidos: compartidos,
      mensajes,
      puedeCompartir: puedeAdministrarProyecto(req.usuario, proyecto),
    });
  } catch (error) {
    return fallo(res, error, 'verPortalProyecto', 'No se pudo cargar la información del cliente');
  }
};

// POST /api/proyectos/:id/portal/mensajes   { contenido }
const responderCliente = async (req, res) => {
  if (sinClientes(req, res)) return undefined;
  const contenido = typeof req.body?.contenido === 'string' ? req.body.contenido.replace(/\r\n/g, '\n').trim() : '';
  if (!contenido) return res.status(400).json({ error: 'Escribe un mensaje' });
  if (contenido.length > MAX_MENSAJE) return res.status(400).json({ error: `El mensaje no puede pasar de ${MAX_MENSAJE} caracteres` });
  try {
    const { proyecto, permitido } = await cargarProyectoVisible(prisma, req.usuario, req.params.id);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!permitido) return res.status(403).json({ error: 'No tienes permiso para escribir en este proyecto' });
    const { clienteId } = await prisma.proyecto.findUnique({ where: { id: proyecto.id }, select: { clienteId: true } });
    if (!clienteId) return res.status(409).json({ error: 'El proyecto no tiene un cliente asignado' });

    const mensaje = await prisma.mensajePortal.create({
      data: { proyectoId: proyecto.id, autorId: req.usuario.id, contenido, deCliente: false },
      select: selectMensaje,
    });

    // Aviso dentro del portal y por correo a cada contacto con acceso activo.
    const contactos = await prisma.usuario.findMany({
      where: { empresaId: clienteId, rol: 'CLIENTE', estado: 'activo' },
      select: { id: true, nombre: true, email: true },
    });
    if (contactos.length) {
      prisma.notificacion.createMany({
        data: contactos.map((c) => ({
          usuarioId: c.id,
          mensaje: `${req.usuario.nombre} te escribió en "${proyecto.nombre}"`,
          tipo: 'MENSAJE_PORTAL',
          proyectoId: proyecto.id,
          actorNombre: req.usuario.nombre,
        })),
      }).catch((error) => console.error('[portalEquipo.notificar]', error));
      contactos.forEach((c) => correo.avisarMensajePortal({
        nombre: c.nombre, email: c.email, actor: req.usuario.nombre, proyecto: proyecto.nombre, proyectoId: proyecto.id, mensaje: contenido,
      }));
    }
    return res.status(201).json({ mensaje, avisados: contactos.length });
  } catch (error) {
    return fallo(res, error, 'responderCliente', 'No se pudo enviar el mensaje');
  }
};

// PATCH /api/proyectos/adjuntos/:id/visible-cliente   { visible: boolean }
const compartirDocumento = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  if (typeof req.body?.visible !== 'boolean') return res.status(400).json({ error: 'Indica si el archivo es visible o no' });
  try {
    const adjunto = await prisma.adjunto.findUnique({
      where: { id },
      select: { id: true, tareaId: true, eventoId: true, proyecto: { select: { id: true, area: true, clienteId: true } } },
    });
    if (!adjunto || !adjunto.proyecto) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (adjunto.tareaId || adjunto.eventoId) return res.status(400).json({ error: 'Solo se pueden compartir los archivos del proyecto' });
    if (!puedeAdministrarProyecto(req.usuario, adjunto.proyecto)) {
      return res.status(403).json({ error: 'Solo un administrador del proyecto puede compartir archivos con el cliente' });
    }
    if (req.body.visible && !adjunto.proyecto.clienteId) {
      return res.status(409).json({ error: 'Asigna un cliente al proyecto antes de compartir archivos' });
    }
    const actualizado = await prisma.adjunto.update({ where: { id }, data: { visibleCliente: req.body.visible }, select: { id: true, visibleCliente: true } });
    return res.json({ adjunto: actualizado });
  } catch (error) {
    return fallo(res, error, 'compartirDocumento');
  }
};

module.exports = {
  listarAccesos,
  invitarAcceso,
  reenviarAcceso,
  cancelarInvitacion,
  cambiarEstadoAcceso,
  suspenderAccesosEmpresa,
  verPortalProyecto,
  responderCliente,
  compartirDocumento,
};
