// Directorio de clientes y proveedores (/api/empresas). Solo administradores:
// datos fiscales y comerciales. Cada ficha reúne sus contactos, contratos y
// proyectos.
const prisma = require('../lib/prisma');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const { esEmailValido } = require('../utils/security.utils');
const { puede } = require('../utils/permisosArea.utils');
const { filtroProyectosVisibles } = require('../utils/permissions.utils');
const { moduloActivo } = require('../services/configuracion.service');

const TIPOS = ['CLIENTE', 'PROVEEDOR', 'AMBOS'];
const ESTADOS = ['ACTIVO', 'INACTIVO'];
const REGEX_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const ESTADOS_CONTRATO_VIGENTES = ['VIGENTE', 'EN_REVISION'];

class ErrorDatos extends Error {
  constructor(errores) { super(errores.join('. ')); this.errores = errores; }
}

const texto = (valor, max) => {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = String(valor).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return limpio ? limpio.slice(0, max) : null;
};

/** Normaliza los datos de una empresa. `parcial` = edición (solo lo que venga). */
const normalizarEmpresa = (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('nombre')) {
    const nombre = texto(body.nombre, 255);
    if (!nombre || nombre.length < 2) errores.push('El nombre o razón social es obligatorio');
    else data.nombre = nombre;
  }
  if (!parcial || viene('tipo')) {
    const tipo = String(body.tipo || 'CLIENTE').toUpperCase();
    if (!TIPOS.includes(tipo)) errores.push('El tipo debe ser cliente, proveedor o ambos');
    else data.tipo = tipo;
  }
  if (viene('estado')) {
    const estado = String(body.estado || '').toUpperCase();
    if (!ESTADOS.includes(estado)) errores.push('Estado no válido');
    else data.estado = estado;
  }
  if (viene('rfc')) {
    const rfc = body.rfc ? String(body.rfc).toUpperCase().replace(/[\s-]/g, '') : null;
    if (rfc && !REGEX_RFC.test(rfc)) errores.push('El RFC no tiene un formato válido (12 o 13 caracteres)');
    else data.rfc = rfc;
  }
  if (viene('email')) {
    const email = texto(body.email, 191);
    if (email && !esEmailValido(email)) errores.push('El correo no es válido');
    else data.email = email ? email.toLowerCase() : null;
  }
  if (viene('sitioWeb')) {
    const sitio = texto(body.sitioWeb, 255);
    if (sitio && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(sitio)) errores.push('El sitio web no es válido');
    else data.sitioWeb = sitio;
  }
  if (viene('nombreComercial')) data.nombreComercial = texto(body.nombreComercial, 255);
  if (viene('sector')) data.sector = texto(body.sector, 80);
  if (viene('telefono')) data.telefono = texto(body.telefono, 40);
  if (viene('direccion')) data.direccion = texto(body.direccion, 500);
  if (viene('ciudad')) data.ciudad = texto(body.ciudad, 120);
  if (viene('notas')) data.notas = texto(body.notas, 10000);

  if (errores.length) throw new ErrorDatos(errores);
  return data;
};

const normalizarContacto = (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;
  if (!parcial || viene('nombre')) {
    const nombre = texto(body.nombre, 255);
    if (!nombre) errores.push('El nombre del contacto es obligatorio');
    else data.nombre = nombre;
  }
  if (viene('email')) {
    const email = texto(body.email, 191);
    if (email && !esEmailValido(email)) errores.push('El correo del contacto no es válido');
    else data.email = email ? email.toLowerCase() : null;
  }
  if (viene('puesto')) data.puesto = texto(body.puesto, 120);
  if (viene('telefono')) data.telefono = texto(body.telefono, 40);
  if (viene('notas')) data.notas = texto(body.notas, 5000);
  if (viene('principal')) data.principal = body.principal === true || body.principal === 'true';
  if (errores.length) throw new ErrorDatos(errores);
  return data;
};

const responderError = (res, error, contexto) => {
  if (error instanceof ErrorDatos) return res.status(400).json({ error: error.message, detalles: error.errores });
  console.error(`[empresas.${contexto}]`, error);
  return res.status(500).json({ error: 'No se pudo completar la operación' });
};

const idDe = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** Avance de un proyecto (tareas hechas / total). */
const conAvance = (proyecto) => {
  const total = proyecto.tareas.length;
  const hechas = proyecto.tareas.filter((t) => t.estado === 'HECHO').length;
  const { tareas: _t, ...resto } = proyecto;
  return { ...resto, tareas: total, tareasHechas: hechas, avance: total ? Math.round((hechas / total) * 100) : 0 };
};

// GET /api/empresas?q=&tipo=&estado=&pagina=&limite=
const listar = async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').toUpperCase();
    // "Clientes" incluye a quien es ambas cosas; igual con proveedores.
    const filtroTipo = tipo === 'CLIENTE' ? { tipo: { in: ['CLIENTE', 'AMBOS'] } }
      : tipo === 'PROVEEDOR' ? { tipo: { in: ['PROVEEDOR', 'AMBOS'] } }
        : null;
    const estado = String(req.query.estado || '').toUpperCase();
    const where = combinarWhere(
      construirBusqueda(req.query.q, ['nombre', 'nombreComercial', 'rfc', 'email', 'ciudad', 'sector']),
      filtroTipo,
      ESTADOS.includes(estado) ? { estado } : null,
    );
    const empresas = await prisma.empresa.findMany({
        where,
        orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
        include: {
          contactos: { where: { principal: true }, take: 1, select: { id: true, nombre: true, email: true, telefono: true } },
          contratos: { select: { estado: true, monto: true, moneda: true, tipo: true } },
          _count: { select: { contratos: true, proyectos: true, contactos: true } },
        },
      });
    const datos = empresas.map(({ contactos, contratos, _count, ...e }) => ({
      ...e,
      contactoPrincipal: contactos[0] || null,
      totalContratos: _count.contratos,
      totalProyectos: _count.proyectos,
      totalContactos: _count.contactos,
      contratosVigentes: contratos.filter((c) => ESTADOS_CONTRATO_VIGENTES.includes(c.estado)).length,
    }));
    const { items, meta } = paginar(datos, parsearPaginacion(req.query, { limitePorDefecto: 25 }));
    return res.json({ empresas: items, meta, total: datos.length });
  } catch (error) {
    return responderError(res, error, 'listar');
  }
};

// GET /api/empresas/resumen — cifras para la cabecera del directorio
const resumen = async (_req, res) => {
  try {
    const [clientes, proveedores, inactivas, proyectosConCliente] = await Promise.all([
      prisma.empresa.count({ where: { tipo: { in: ['CLIENTE', 'AMBOS'] }, estado: 'ACTIVO' } }),
      prisma.empresa.count({ where: { tipo: { in: ['PROVEEDOR', 'AMBOS'] }, estado: 'ACTIVO' } }),
      prisma.empresa.count({ where: { estado: 'INACTIVO' } }),
      prisma.proyecto.count({ where: { clienteId: { not: null } } }),
    ]);
    return res.json({ clientes, proveedores, inactivas, proyectosConCliente });
  } catch (error) {
    return responderError(res, error, 'resumen');
  }
};

// GET /api/empresas/catalogo?tipo=CLIENTE — lista corta para selects
const catalogo = async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').toUpperCase();
    const where = tipo === 'CLIENTE' ? { tipo: { in: ['CLIENTE', 'AMBOS'] } }
      : tipo === 'PROVEEDOR' ? { tipo: { in: ['PROVEEDOR', 'AMBOS'] } }
        : {};
    const empresas = await prisma.empresa.findMany({
      where,
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, nombreComercial: true, tipo: true, estado: true, rfc: true, email: true, telefono: true },
    });
    return res.json({ empresas });
  } catch (error) {
    return responderError(res, error, 'catalogo');
  }
};

// GET /api/empresas/:id
const obtener = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  try {
    // Contratos (con montos) solo para quien los ve en su modulo, y de los
    // proyectos solo los que la persona ve.
    const veContratos = puede(req.usuario, 'contratos.ver') && await moduloActivo('contratos');
    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        creadoPor: { select: { id: true, nombre: true } },
        contactos: { orderBy: [{ principal: 'desc' }, { nombre: 'asc' }] },
        contratos: {
          ...(veContratos ? {} : { where: { id: -1 } }),
          orderBy: { creadoEn: 'desc' },
          select: { id: true, folio: true, titulo: true, tipo: true, estado: true, monto: true, moneda: true, fechaInicio: true, fechaFin: true },
        },
        proyectos: {
          where: filtroProyectosVisibles(req.usuario),
          orderBy: { creadoEn: 'desc' },
          select: { id: true, nombre: true, estado: true, area: true, fechaInicio: true, fechaFin: true, tareas: { select: { estado: true } } },
        },
      },
    });
    if (!empresa) return res.status(404).json({ error: 'No existe esa empresa' });
    return res.json({ empresa: { ...empresa, proyectos: empresa.proyectos.map(conAvance) } });
  } catch (error) {
    return responderError(res, error, 'obtener');
  }
};

// POST /api/empresas  (puede traer `contactos: [...]` para darlos de alta juntos)
const crear = async (req, res) => {
  try {
    const data = normalizarEmpresa(req.body);
    const contactos = Array.isArray(req.body?.contactos)
      ? req.body.contactos.slice(0, 20).map((c) => normalizarContacto(c))
      : [];
    if (contactos.length && !contactos.some((c) => c.principal)) contactos[0].principal = true;
    const empresa = await prisma.empresa.create({
      data: { ...data, creadoPorId: req.usuario.id, contactos: contactos.length ? { create: contactos } : undefined },
      include: { contactos: true },
    });
    return res.status(201).json({ mensaje: 'Empresa creada', empresa });
  } catch (error) {
    return responderError(res, error, 'crear');
  }
};

// PUT /api/empresas/:id
const editar = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  try {
    const data = normalizarEmpresa(req.body, { parcial: true });
    const existe = await prisma.empresa.findUnique({ where: { id }, select: { id: true, tipo: true } });
    if (!existe) return res.status(404).json({ error: 'No existe esa empresa' });
    // Si deja de ser cliente, sus proyectos quedan sin cliente.
    if (data.tipo === 'PROVEEDOR' && existe.tipo !== 'PROVEEDOR') {
      await prisma.proyecto.updateMany({ where: { clienteId: id }, data: { clienteId: null } });
    }
    const empresa = await prisma.empresa.update({ where: { id }, data });
    return res.json({ mensaje: 'Cambios guardados', empresa });
  } catch (error) {
    return responderError(res, error, 'editar');
  }
};

// DELETE /api/empresas/:id — solo si no tiene contratos (para no perder el vínculo)
const eliminar = async (req, res) => {
  const id = idDe(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id }, select: { id: true, _count: { select: { contratos: true } } } });
    if (!empresa) return res.status(404).json({ error: 'No existe esa empresa' });
    if (empresa._count.contratos > 0) {
      return res.status(409).json({ error: `Tiene ${empresa._count.contratos} contrato(s): márcala como inactiva en lugar de borrarla.` });
    }
    // Sus contactos con acceso al portal quedan suspendidos (no se borran).
    await require('./portalEquipo.controller').suspenderAccesosEmpresa(id);
    await prisma.empresa.delete({ where: { id } });
    return res.json({ mensaje: 'Empresa eliminada' });
  } catch (error) {
    return responderError(res, error, 'eliminar');
  }
};

// Solo un contacto principal por empresa.
const fijarPrincipal = (tx, empresaId, contactoId) => tx.contactoEmpresa.updateMany({
  where: { empresaId, NOT: { id: contactoId } },
  data: { principal: false },
});

// POST /api/empresas/:id/contactos
const crearContacto = async (req, res) => {
  const empresaId = idDe(req.params.id);
  if (!empresaId) return res.status(400).json({ error: 'ID no válido' });
  try {
    const data = normalizarContacto(req.body);
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, _count: { select: { contactos: true } } } });
    if (!empresa) return res.status(404).json({ error: 'No existe esa empresa' });
    if (empresa._count.contactos === 0) data.principal = true;
    const contacto = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.contactoEmpresa.create({ data: { ...data, empresaId } });
      if (nuevo.principal) await fijarPrincipal(tx, empresaId, nuevo.id);
      return nuevo;
    });
    return res.status(201).json({ mensaje: 'Contacto agregado', contacto });
  } catch (error) {
    return responderError(res, error, 'crearContacto');
  }
};

// PUT /api/empresas/contactos/:contactoId
const editarContacto = async (req, res) => {
  const id = idDe(req.params.contactoId);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  try {
    const data = normalizarContacto(req.body, { parcial: true });
    const existente = await prisma.contactoEmpresa.findUnique({ where: { id }, select: { empresaId: true } });
    if (!existente) return res.status(404).json({ error: 'No existe ese contacto' });
    const contacto = await prisma.$transaction(async (tx) => {
      const actualizado = await tx.contactoEmpresa.update({ where: { id }, data });
      if (data.principal) await fijarPrincipal(tx, existente.empresaId, id);
      return actualizado;
    });
    return res.json({ mensaje: 'Contacto actualizado', contacto });
  } catch (error) {
    return responderError(res, error, 'editarContacto');
  }
};

// DELETE /api/empresas/contactos/:contactoId
const eliminarContacto = async (req, res) => {
  const id = idDe(req.params.contactoId);
  if (!id) return res.status(400).json({ error: 'ID no válido' });
  try {
    const contacto = await prisma.contactoEmpresa.findUnique({ where: { id } });
    if (!contacto) return res.status(404).json({ error: 'No existe ese contacto' });
    await prisma.$transaction(async (tx) => {
      await tx.contactoEmpresa.delete({ where: { id } });
      // Si era el principal, pasa a otro.
      if (contacto.principal) {
        const otro = await tx.contactoEmpresa.findFirst({ where: { empresaId: contacto.empresaId }, orderBy: { creadoEn: 'asc' } });
        if (otro) await tx.contactoEmpresa.update({ where: { id: otro.id }, data: { principal: true } });
      }
    });
    return res.json({ mensaje: 'Contacto eliminado' });
  } catch (error) {
    return responderError(res, error, 'eliminarContacto');
  }
};

module.exports = { listar, resumen, catalogo, obtener, crear, editar, eliminar, crearContacto, editarContacto, eliminarContacto };
