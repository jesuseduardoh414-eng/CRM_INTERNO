// Contratos con clientes y proveedores (solo administradores).
//
// Rutas en routes/contratos.routes.js. Todas pasan por verificarToken +
// soloAdmin. Los PDF se guardan en disco (services/contratosArchivos.service.js).
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { claveDiaMexico } = require('../utils/fechas.utils');
const { parsearPaginacion, paginar, construirBusqueda, combinarWhere } = require('../utils/paginacion.utils');
const { esEmailValido } = require('../utils/security.utils');
const archivos = require('../services/contratosArchivos.service');

const TIPOS = ['CLIENTE', 'PROVEEDOR'];
const ESTADOS = ['BORRADOR', 'EN_REVISION', 'VIGENTE', 'TERMINADO', 'CANCELADO'];
const CATEGORIAS = ['SERVICIOS', 'COMPRAVENTA', 'ARRENDAMIENTO', 'CONFIDENCIALIDAD', 'LICENCIA', 'OBRA', 'CONSULTORIA', 'MARCO', 'OTRO'];
const MONEDAS = ['MXN', 'USD', 'EUR'];
const PERIODICIDADES = ['UNICO', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'POR_ENTREGABLE'];
const TIPOS_DOCUMENTO = ['FIRMADO', 'BORRADOR', 'ANEXO', 'CONVENIO', 'OTRO'];
// RFC mexicano: 3 letras (moral) o 4 (fisica), fecha AAMMDD y homoclave.
const REGEX_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const selectUsuarioCorto = { id: true, nombre: true, email: true };

const selectEmpresa = { id: true, nombre: true, nombreComercial: true, tipo: true, rfc: true };

const incluirListado = {
  proyecto: { select: { id: true, nombre: true } },
  empresa: { select: selectEmpresa },
  responsable: { select: selectUsuarioCorto },
  _count: { select: { archivos: true } },
};

const incluirDetalle = {
  proyecto: { select: { id: true, nombre: true } },
  empresa: { select: selectEmpresa },
  responsable: { select: selectUsuarioCorto },
  creadoPor: { select: selectUsuarioCorto },
  archivos: {
    orderBy: { creadoEn: 'desc' },
    select: {
      id: true, nombreOriginal: true, tamano: true, sha256: true, tipoDocumento: true, creadoEn: true,
      subidoPor: { select: selectUsuarioCorto },
    },
  },
};

// ---------------------------------------------------------------------------
// Fechas y estado calculado
// ---------------------------------------------------------------------------

/** Date de una columna @db.Date -> 'AAAA-MM-DD' (Prisma la devuelve a medianoche UTC). */
const fechaATexto = (fecha) => (fecha ? new Date(fecha).toISOString().slice(0, 10) : null);

const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

/**
 * Estado que se muestra: el guardado, salvo que un contrato vigente ya haya
 * pasado su fecha de fin (VENCIDO). `porVencer` marca los vigentes que vencen
 * dentro de sus `diasAviso`. Los de renovacion automatica no "vencen".
 */
const calcularVigencia = (contrato, hoy = claveDiaMexico()) => {
  const fin = fechaATexto(contrato.fechaFin);
  const diasRestantes = fin ? diasEntre(hoy, fin) : null;
  let estadoEfectivo = contrato.estado;
  let porVencer = false;
  if (contrato.estado === 'VIGENTE' && fin && !contrato.renovacionAutomatica) {
    if (diasRestantes < 0) estadoEfectivo = 'VENCIDO';
    else if (diasRestantes <= contrato.diasAviso) porVencer = true;
  }
  return { estadoEfectivo, porVencer, diasRestantes };
};

const serializar = (contrato, hoy) => {
  const { _count, ...resto } = contrato;
  return {
    ...resto,
    monto: contrato.monto === null || contrato.monto === undefined ? null : Number(contrato.monto),
    fechaFirma: fechaATexto(contrato.fechaFirma),
    fechaInicio: fechaATexto(contrato.fechaInicio),
    fechaFin: fechaATexto(contrato.fechaFin),
    totalArchivos: _count?.archivos ?? contrato.archivos?.length ?? 0,
    ...calcularVigencia(contrato, hoy),
  };
};

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

const textoOpcional = (valor, max) => {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = String(valor).trim();
  if (!limpio) return null;
  return limpio.slice(0, max);
};

/**
 * Normaliza y valida el cuerpo. Con `parcial` (editar) solo se validan los
 * campos que vienen. Devuelve { data, errores }.
 */
const normalizar = async (body = {}, { parcial = false } = {}) => {
  const errores = [];
  const data = {};
  const viene = (campo) => body[campo] !== undefined;

  if (!parcial || viene('titulo')) {
    const titulo = textoOpcional(body.titulo, 255);
    if (!titulo || titulo.length < 3) errores.push('El título es obligatorio (mínimo 3 caracteres)');
    else data.titulo = titulo;
  }
  if (!parcial || viene('tipo')) {
    const tipo = String(body.tipo || '').toUpperCase();
    if (!TIPOS.includes(tipo)) errores.push('El tipo debe ser cliente o proveedor');
    else data.tipo = tipo;
  }
  // Contraparte del directorio: si viene, sus datos llenan los campos
  // contraparte* que no se manden (quedan como foto al firmar).
  let empresa = null;
  if (viene('empresaId')) {
    if (!body.empresaId) {
      data.empresaId = null;
    } else {
      const id = Number.parseInt(body.empresaId, 10);
      empresa = Number.isInteger(id)
        ? await prisma.empresa.findUnique({ where: { id }, include: { contactos: { where: { principal: true }, take: 1 } } })
        : null;
      if (!empresa) errores.push('La empresa seleccionada no existe');
      else data.empresaId = empresa.id;
    }
  }
  if (empresa) {
    const contacto = empresa.contactos[0];
    if (!body.contraparteNombre) body.contraparteNombre = empresa.nombre;
    if (body.contraparteRfc === undefined && empresa.rfc) body.contraparteRfc = empresa.rfc;
    if (body.contraparteContacto === undefined && contacto) body.contraparteContacto = contacto.nombre;
    if (body.contraparteEmail === undefined && (contacto?.email || empresa.email)) body.contraparteEmail = contacto?.email || empresa.email;
    if (body.contraparteTelefono === undefined && (contacto?.telefono || empresa.telefono)) body.contraparteTelefono = contacto?.telefono || empresa.telefono;
  }
  if (!parcial || viene('contraparteNombre')) {
    const nombre = textoOpcional(body.contraparteNombre, 255);
    if (!nombre) errores.push('La contraparte (razón social o nombre) es obligatoria');
    else data.contraparteNombre = nombre;
  }
  if (viene('estado')) {
    const estado = String(body.estado || '').toUpperCase();
    if (!ESTADOS.includes(estado)) errores.push('Estado no válido');
    else data.estado = estado;
  }
  if (viene('categoria')) {
    const categoria = body.categoria ? String(body.categoria).toUpperCase() : null;
    if (categoria && !CATEGORIAS.includes(categoria)) errores.push('Categoría no válida');
    else data.categoria = categoria;
  }
  if (viene('contraparteRfc')) {
    const rfc = body.contraparteRfc ? String(body.contraparteRfc).toUpperCase().replace(/[\s-]/g, '') : null;
    if (rfc && !REGEX_RFC.test(rfc)) errores.push('El RFC no tiene un formato válido (12 o 13 caracteres)');
    else data.contraparteRfc = rfc;
  }
  if (viene('contraparteEmail')) {
    const email = textoOpcional(body.contraparteEmail, 191);
    if (email && !esEmailValido(email)) errores.push('El correo de la contraparte no es válido');
    else data.contraparteEmail = email ? email.toLowerCase() : null;
  }
  if (viene('contraparteContacto')) data.contraparteContacto = textoOpcional(body.contraparteContacto, 255);
  if (viene('contraparteTelefono')) data.contraparteTelefono = textoOpcional(body.contraparteTelefono, 40);
  if (viene('descripcion')) data.descripcion = textoOpcional(body.descripcion, 10000);
  if (viene('notas')) data.notas = textoOpcional(body.notas, 10000);

  if (viene('monto')) {
    if (body.monto === null || body.monto === '') {
      data.monto = null;
    } else {
      const monto = Number(body.monto);
      if (!Number.isFinite(monto) || monto < 0 || monto > 999999999999) errores.push('El monto debe ser un número positivo');
      else data.monto = Math.round(monto * 100) / 100;
    }
  }
  if (viene('moneda')) {
    const moneda = String(body.moneda || '').toUpperCase();
    if (!MONEDAS.includes(moneda)) errores.push('Moneda no válida');
    else data.moneda = moneda;
  }
  if (viene('incluyeIva')) data.incluyeIva = body.incluyeIva === true || body.incluyeIva === 'true';
  if (viene('periodicidadPago')) {
    const periodicidad = body.periodicidadPago ? String(body.periodicidadPago).toUpperCase() : null;
    if (periodicidad && !PERIODICIDADES.includes(periodicidad)) errores.push('Periodicidad de pago no válida');
    else data.periodicidadPago = periodicidad;
  }

  for (const campo of ['fechaFirma', 'fechaInicio', 'fechaFin']) {
    if (!viene(campo)) continue;
    const valor = body[campo];
    if (!valor) { data[campo] = null; continue; }
    if (!REGEX_FECHA.test(String(valor)) || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) {
      errores.push(`Fecha no válida en ${campo}`);
    } else {
      data[campo] = new Date(`${valor}T00:00:00Z`);
    }
  }
  if (data.fechaInicio && data.fechaFin && data.fechaFin < data.fechaInicio) {
    errores.push('La fecha de fin no puede ser anterior a la de inicio');
  }

  if (viene('renovacionAutomatica')) data.renovacionAutomatica = body.renovacionAutomatica === true || body.renovacionAutomatica === 'true';
  if (viene('diasAviso')) {
    const dias = Number.parseInt(body.diasAviso, 10);
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) errores.push('Los días de aviso deben estar entre 0 y 365');
    else data.diasAviso = dias;
  }

  if (viene('proyectoId')) {
    if (!body.proyectoId) {
      data.proyectoId = null;
    } else {
      const id = Number.parseInt(body.proyectoId, 10);
      const existe = Number.isInteger(id) && await prisma.proyecto.findUnique({ where: { id }, select: { id: true } });
      if (!existe) errores.push('El proyecto seleccionado no existe');
      else data.proyectoId = id;
    }
  }
  if (viene('responsableId')) {
    if (!body.responsableId) {
      data.responsableId = null;
    } else {
      const id = Number.parseInt(body.responsableId, 10);
      const existe = Number.isInteger(id) && await prisma.usuario.findUnique({ where: { id }, select: { id: true } });
      if (!existe) errores.push('El responsable seleccionado no existe');
      else data.responsableId = id;
    }
  }

  return { data, errores };
};

const leerId = (valor) => {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// ---------------------------------------------------------------------------
// GET /api/contratos
// ?q= &tipo= &estado= (incluye VENCIDO y POR_VENCER) &proyectoId= &empresaId= &page= &limit=
// ---------------------------------------------------------------------------
const listar = async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').toUpperCase();
    const estado = String(req.query.estado || '').toUpperCase();
    const proyectoId = leerId(req.query.proyectoId);
    const empresaId = leerId(req.query.empresaId);

    const where = combinarWhere(
      construirBusqueda(req.query.q, ['folio', 'titulo', 'contraparteNombre', 'contraparteRfc', 'contraparteContacto']),
      TIPOS.includes(tipo) ? { tipo } : null,
      ESTADOS.includes(estado) ? { estado } : null,
      // Vencido y por vencer se calculan; en la consulta se acota a vigentes.
      ['VENCIDO', 'POR_VENCER'].includes(estado) ? { estado: 'VIGENTE' } : null,
      proyectoId ? { proyectoId } : null,
      empresaId ? { empresaId } : null,
    );

    const contratos = await prisma.contrato.findMany({
      where,
      include: incluirListado,
      orderBy: [{ creadoEn: 'desc' }],
    });

    const hoy = claveDiaMexico();
    let lista = contratos.map((c) => serializar(c, hoy));
    if (estado === 'VENCIDO') lista = lista.filter((c) => c.estadoEfectivo === 'VENCIDO');
    if (estado === 'POR_VENCER') lista = lista.filter((c) => c.porVencer);
    // "Vigente" excluye los que ya vencieron aunque sigan guardados como VIGENTE.
    if (estado === 'VIGENTE') lista = lista.filter((c) => c.estadoEfectivo === 'VIGENTE');

    const { items, meta } = paginar(lista, parsearPaginacion(req.query, { limitePorDefecto: 20 }));
    return res.json(meta ? { contratos: items, meta } : { contratos: items });
  } catch (error) {
    console.error('[contratos.listar]', error);
    return res.status(500).json({ error: 'Error al listar contratos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/contratos/resumen  -> indicadores de la cabecera
// ---------------------------------------------------------------------------
const resumen = async (_req, res) => {
  try {
    const contratos = await prisma.contrato.findMany({
      select: { id: true, folio: true, titulo: true, tipo: true, estado: true, contraparteNombre: true, monto: true, moneda: true, fechaFin: true, renovacionAutomatica: true, diasAviso: true },
    });
    const hoy = claveDiaMexico();
    const conteo = { total: contratos.length, vigentes: 0, porVencer: 0, vencidos: 0, enProceso: 0, clientes: 0, proveedores: 0 };
    const montos = {}; // { MXN: { CLIENTE: n, PROVEEDOR: n } }
    const proximos = [];

    contratos.forEach((c) => {
      const v = calcularVigencia(c, hoy);
      if (c.tipo === 'CLIENTE') conteo.clientes += 1; else conteo.proveedores += 1;
      if (v.estadoEfectivo === 'VIGENTE') {
        conteo.vigentes += 1;
        if (c.monto !== null) {
          montos[c.moneda] = montos[c.moneda] || { CLIENTE: 0, PROVEEDOR: 0 };
          montos[c.moneda][c.tipo] += Number(c.monto);
        }
      }
      if (v.porVencer) {
        conteo.porVencer += 1;
        proximos.push({ id: c.id, folio: c.folio, titulo: c.titulo, contraparteNombre: c.contraparteNombre, tipo: c.tipo, fechaFin: fechaATexto(c.fechaFin), diasRestantes: v.diasRestantes });
      }
      if (v.estadoEfectivo === 'VENCIDO') conteo.vencidos += 1;
      if (['BORRADOR', 'EN_REVISION'].includes(c.estado)) conteo.enProceso += 1;
    });

    proximos.sort((a, b) => a.diasRestantes - b.diasRestantes);
    return res.json({ conteo, montosVigentes: montos, proximosAVencer: proximos.slice(0, 8) });
  } catch (error) {
    console.error('[contratos.resumen]', error);
    return res.status(500).json({ error: 'Error al calcular el resumen' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/contratos/catalogos -> proyectos y personas para los selectores
// ---------------------------------------------------------------------------
const catalogos = async (_req, res) => {
  try {
    const [proyectos, usuarios] = await Promise.all([
      prisma.proyecto.findMany({ select: { id: true, nombre: true, estado: true }, orderBy: { nombre: 'asc' } }),
      prisma.usuario.findMany({
        where: { OR: [{ estado: 'activo' }, { estado: null }], rol: { in: ['ADMIN', 'MIEMBRO'] } },
        select: { id: true, nombre: true, area: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return res.json({ proyectos, usuarios });
  } catch (error) {
    console.error('[contratos.catalogos]', error);
    return res.status(500).json({ error: 'Error al cargar los catálogos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/contratos/:id
// ---------------------------------------------------------------------------
const obtener = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const contrato = await prisma.contrato.findUnique({ where: { id }, include: incluirDetalle });
    if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
    return res.json({ contrato: serializar(contrato) });
  } catch (error) {
    console.error('[contratos.obtener]', error);
    return res.status(500).json({ error: 'Error al obtener el contrato' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/contratos
// ---------------------------------------------------------------------------
const crear = async (req, res) => {
  try {
    const { data, errores } = await normalizar(req.body);
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del contrato', detalles: errores });

    const anio = new Date().getUTCFullYear();
    // El folio sale del id: se crea con uno temporal unico y se corrige en la
    // misma transaccion, asi dos altas simultaneas nunca chocan.
    const contrato = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.contrato.create({
        data: { ...data, folio: `TMP-${crypto.randomUUID()}`, creadoPorId: req.usuario.id },
      });
      return tx.contrato.update({
        where: { id: nuevo.id },
        data: { folio: `CTR-${anio}-${String(nuevo.id).padStart(4, '0')}` },
        include: incluirDetalle,
      });
    });

    return res.status(201).json({ mensaje: `Contrato ${contrato.folio} creado`, contrato: serializar(contrato) });
  } catch (error) {
    console.error('[contratos.crear]', error);
    return res.status(500).json({ error: 'Error al crear el contrato' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/contratos/:id
// ---------------------------------------------------------------------------
const editar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const actual = await prisma.contrato.findUnique({ where: { id }, select: { id: true, fechaInicio: true, fechaFin: true } });
    if (!actual) return res.status(404).json({ error: 'Contrato no encontrado' });

    const { data, errores } = await normalizar(req.body, { parcial: true });
    // Coherencia de fechas contra lo que ya estaba guardado.
    const inicio = data.fechaInicio !== undefined ? data.fechaInicio : actual.fechaInicio;
    const fin = data.fechaFin !== undefined ? data.fechaFin : actual.fechaFin;
    if (inicio && fin && fin < inicio && !errores.some((e) => e.includes('anterior'))) {
      errores.push('La fecha de fin no puede ser anterior a la de inicio');
    }
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos del contrato', detalles: errores });

    const contrato = await prisma.contrato.update({ where: { id }, data, include: incluirDetalle });
    return res.json({ mensaje: 'Contrato actualizado', contrato: serializar(contrato) });
  } catch (error) {
    console.error('[contratos.editar]', error);
    return res.status(500).json({ error: 'Error al actualizar el contrato' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/contratos/:id  (borra tambien sus PDF del disco)
// ---------------------------------------------------------------------------
const eliminar = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const contrato = await prisma.contrato.findUnique({ where: { id }, select: { id: true, folio: true, archivos: { select: { archivo: true } } } });
    if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

    await prisma.contrato.delete({ where: { id } });
    await Promise.all(contrato.archivos.map((a) => archivos.borrar(a.archivo).catch((error) => {
      console.error('[contratos.eliminar] No se pudo borrar el archivo', a.archivo, error?.message);
    })));
    return res.json({ mensaje: `Contrato ${contrato.folio} eliminado` });
  } catch (error) {
    console.error('[contratos.eliminar]', error);
    return res.status(500).json({ error: 'Error al eliminar el contrato' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/contratos/:id/archivos  (multipart: archivo + tipoDocumento)
// ---------------------------------------------------------------------------
const subirArchivo = async (req, res) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo PDF' });

  const tipoDocumento = String(req.body?.tipoDocumento || 'FIRMADO').toUpperCase();
  if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) return res.status(400).json({ error: 'Tipo de documento no válido' });
  if (!archivos.esPdfValido(req.file.buffer)) {
    return res.status(400).json({ error: 'El archivo no es un PDF válido o está dañado' });
  }

  let nombreInterno = null;
  try {
    const contrato = await prisma.contrato.findUnique({ where: { id }, select: { id: true } });
    if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

    const sha256 = archivos.huella(req.file.buffer);
    const duplicado = await prisma.contratoArchivo.findFirst({ where: { contratoId: id, sha256 }, select: { nombreOriginal: true } });
    if (duplicado) {
      return res.status(409).json({ error: `Este PDF ya está cargado en el contrato (${duplicado.nombreOriginal})` });
    }

    nombreInterno = await archivos.guardar(req.file.buffer);
    const registro = await prisma.contratoArchivo.create({
      data: {
        contratoId: id,
        nombreOriginal: archivos.limpiarNombre(req.file.originalname),
        archivo: nombreInterno,
        tamano: req.file.size,
        sha256,
        tipoDocumento,
        subidoPorId: req.usuario.id,
      },
      select: {
        id: true, nombreOriginal: true, tamano: true, sha256: true, tipoDocumento: true, creadoEn: true,
        subidoPor: { select: selectUsuarioCorto },
      },
    });
    await prisma.contrato.update({ where: { id }, data: { actualizadoEn: new Date() } });
    return res.status(201).json({ mensaje: 'PDF cargado', archivo: registro });
  } catch (error) {
    // Si el registro fallo despues de escribir en disco, no se deja basura.
    if (nombreInterno) await archivos.borrar(nombreInterno).catch(() => {});
    console.error('[contratos.subirArchivo]', error);
    return res.status(500).json({ error: 'Error al guardar el PDF' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/contratos/archivos/:archivoId  (?descargar=1 para bajarlo)
// ---------------------------------------------------------------------------
const verArchivo = async (req, res) => {
  const { archivoId } = req.params;
  if (!REGEX_UUID.test(String(archivoId || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const registro = await prisma.contratoArchivo.findUnique({ where: { id: archivoId } });
    if (!registro) return res.status(404).json({ error: 'Archivo no encontrado' });

    let contenido;
    try {
      contenido = await archivos.leer(registro.archivo);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(410).json({ error: 'El PDF ya no está en el servidor' });
      throw error;
    }

    const disposicion = req.query.descargar ? 'attachment' : 'inline';
    const nombreAscii = registro.nombreOriginal.replace(/[^\x20-\x7e]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(contenido.length),
      'Content-Disposition': `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(registro.nombreOriginal)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(contenido);
  } catch (error) {
    console.error('[contratos.verArchivo]', error);
    return res.status(500).json({ error: 'Error al leer el PDF' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/contratos/archivos/:archivoId
// ---------------------------------------------------------------------------
const eliminarArchivo = async (req, res) => {
  const { archivoId } = req.params;
  if (!REGEX_UUID.test(String(archivoId || ''))) return res.status(400).json({ error: 'ID de archivo inválido' });
  try {
    const registro = await prisma.contratoArchivo.findUnique({ where: { id: archivoId } });
    if (!registro) return res.status(404).json({ error: 'Archivo no encontrado' });
    await prisma.contratoArchivo.delete({ where: { id: archivoId } });
    await archivos.borrar(registro.archivo);
    return res.json({ mensaje: 'PDF eliminado' });
  } catch (error) {
    console.error('[contratos.eliminarArchivo]', error);
    return res.status(500).json({ error: 'Error al eliminar el PDF' });
  }
};

module.exports = {
  listar,
  resumen,
  catalogos,
  obtener,
  crear,
  editar,
  eliminar,
  subirArchivo,
  verArchivo,
  eliminarArchivo,
};
