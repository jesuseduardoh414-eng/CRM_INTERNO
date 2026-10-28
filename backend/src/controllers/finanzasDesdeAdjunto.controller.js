// "Mandar a finanzas": copia un archivo de una tarea o de un proyecto a
// Cotizaciones y/o a Gastos variables (pedido del 2026-10-28: el equipo sube
// ahi lo que cotiza). En cada destino va a un registro nuevo o a uno que ya
// existe: cotizacion nueva o version nueva de una existente; gasto variable
// nuevo o comprobante de uno ya registrado. El archivo de la tarea no se toca:
// finanzas guarda su propia copia, con `adjuntoId` y `origen*` para saber de
// donde vino (y marcar el archivo de la tarea con el folio).
//
// Permisos: ver el archivo (como para abrirlo) y, en cada destino, los de
// finanzas: cotizaciones.crear; gastos.VARIABLES.crear para uno nuevo, o
// crear/editar para sumar el comprobante a uno existente. Las validaciones
// son las mismas que al registrar desde finanzas (se reutilizan las de cada
// controlador). Rutas en routes/finanzas.routes.js.
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const almacenamiento = require('../services/almacenamiento.service');
const documentos = require('../services/documentos.service');
const comprobantes = require('../services/comprobantes.service');
const { configEnCache } = require('../services/configuracion.service');
const { puedeVerAdjunto } = require('./archivos.controller');
const cot = require('./finanzasCotizaciones.controller');
const gas = require('./finanzasGastos.controller');
const F = require('../utils/finanzas.utils');

const CATEGORIA = 'VARIABLES';
const MAX_IDS = 200;
// Lo que acepta cada destino, por extension (el contenido se revisa al copiar).
const EXT_COTIZACION = /\.(pdf|jpe?g|png|webp|docx|xlsx|pptx|doc|xls|ppt)$/i;
const EXT_GASTO = /\.(pdf|jpe?g|png|webp)$/i;

const maximoBytes = () => Math.floor((configEnCache().subidas.comprobantesMaxMB || 10) * 1024 * 1024);

const puedeCotizar = (u) => F.puedeFin(u, 'cotizaciones', 'crear');
const puedeGastoNuevo = (u) => F.puedeGasto(u, CATEGORIA, 'crear');
const puedeGastoExistente = (u) => F.puedeGasto(u, CATEGORIA, 'crear') || F.puedeGasto(u, CATEGORIA, 'editar');

const selectEmpresa = { select: F.selectEmpresaCorta };
const selectProyecto = { select: { id: true, nombre: true, clienteId: true, estado: true, cliente: selectEmpresa } };

/** El adjunto con su tarea y su proyecto, si la persona lo ve; null si no. */
const cargarAdjunto = async (id, usuario) => {
  const adjunto = await prisma.adjunto.findUnique({
    where: { id },
    select: {
      id: true, nombre: true, url: true, tipo: true, tamano: true, usuarioId: true, tareaId: true, proyectoId: true, eventoId: true, visibleCliente: true,
      proyecto: selectProyecto,
      tarea: { select: { id: true, titulo: true, proyecto: selectProyecto } },
    },
  });
  // Solo de tareas y proyectos (no de eventos de la agenda).
  if (!adjunto || adjunto.eventoId || (!adjunto.tareaId && !adjunto.proyectoId)) return null;
  if (!(await puedeVerAdjunto(usuario, adjunto))) return null;
  const proyecto = adjunto.tarea?.proyecto || adjunto.proyecto || null;
  return { adjunto, tarea: adjunto.tarea || null, proyecto };
};

/** Columnas de origen para la version o el comprobante. */
const datosOrigen = ({ adjunto, tarea, proyecto }) => ({
  adjuntoId: adjunto.id,
  origenTareaId: tarea?.id ?? null,
  origenProyectoId: proyecto?.id ?? null,
  origen: [tarea?.titulo, proyecto?.nombre].filter(Boolean).join(' · ').slice(0, 255) || null,
});

/** Donde ya esta copiado cada adjunto (solo lo que la persona ve en finanzas). */
const copiasDe = async (ids, usuario) => {
  const salida = Object.fromEntries(ids.map((id) => [id, []]));
  const visibles = F.accesoCotizaciones(usuario);
  const categorias = F.categoriasVisibles(usuario);
  const [versiones, comprobantesGasto] = await Promise.all([
    prisma.versionCotizacion.findMany({
      where: { adjuntoId: { in: ids }, ...(visibles ? { cotizacion: visibles } : {}) },
      select: { adjuntoId: true, numero: true, cotizacion: { select: { id: true, folio: true } } },
      orderBy: { creadoEn: 'asc' },
    }),
    categorias.length
      ? prisma.comprobanteFinanciero.findMany({
        where: { adjuntoId: { in: ids }, gasto: { categoria: { in: categorias } } },
        select: { adjuntoId: true, gasto: { select: { id: true, folio: true, categoria: true } } },
        orderBy: { creadoEn: 'asc' },
      })
      : [],
  ]);
  versiones.forEach((v) => salida[v.adjuntoId]?.push({ tipo: 'cotizacion', id: v.cotizacion.id, folio: v.cotizacion.folio, numero: v.numero }));
  comprobantesGasto.forEach((c) => salida[c.adjuntoId]?.push({ tipo: 'gasto', id: c.gasto.id, folio: c.gasto.folio, categoria: c.gasto.categoria }));
  return salida;
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/desde-adjunto?ids=1,2,3  -> { copias: { [adjuntoId]: [...] } }
// Para marcar en los documentos de una tarea a donde se mandó cada uno.
// ---------------------------------------------------------------------------
const copias = async (req, res) => {
  const ids = [...new Set(String(req.query.ids || '').split(',').map(F.leerId).filter(Boolean))].slice(0, MAX_IDS);
  if (!ids.length) return res.json({ copias: {} });
  try {
    return res.json({ copias: await copiasDe(ids, req.usuario) });
  } catch (error) {
    console.error('[finanzas.desdeAdjunto.copias]', error);
    return res.status(500).json({ error: 'Error al revisar los archivos' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/finanzas/desde-adjunto/:adjuntoId  -> lo que necesita la ventana:
// el archivo, su tarea y proyecto (con su cliente, que se propone), a que
// destinos puede ir y a donde ya se mandó.
// ---------------------------------------------------------------------------
const contexto = async (req, res) => {
  const id = F.leerId(req.params.adjuntoId);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const origen = await cargarAdjunto(id, req.usuario);
    if (!origen) return res.status(404).json({ error: 'Archivo no encontrado' });
    const { adjunto, tarea, proyecto } = origen;
    const u = req.usuario;
    const grande = Number(adjunto.tamano) > maximoBytes();
    const motivo = (permitido, tipoOk) => {
      if (!permitido) return 'permiso';
      if (!tipoOk) return 'tipo';
      return grande ? 'tamano' : null;
    };
    return res.json({
      adjunto: { id: adjunto.id, nombre: adjunto.nombre, tamano: adjunto.tamano },
      tarea: tarea && { id: tarea.id, titulo: tarea.titulo },
      proyecto: proyecto && { id: proyecto.id, nombre: proyecto.nombre, cliente: proyecto.cliente },
      maximoMB: configEnCache().subidas.comprobantesMaxMB || 10,
      destinos: {
        cotizacion: {
          motivo: motivo(puedeCotizar(u), EXT_COTIZACION.test(adjunto.nombre)),
          // Para elegir una existente hay que poder verlas.
          existente: F.puedeVer(u, 'cotizaciones') || Boolean(await prisma.cotizacion.findFirst({ where: F.accesoCotizaciones(u), select: { id: true } })),
          acceso: F.puedeFin(u, 'cotizaciones', 'acceso'),
        },
        gasto: {
          motivo: motivo(puedeGastoExistente(u), EXT_GASTO.test(adjunto.nombre)),
          nuevo: puedeGastoNuevo(u),
          existente: puedeGastoExistente(u) && F.puedeGasto(u, CATEGORIA, 'ver'),
        },
      },
      copias: (await copiasDe([adjunto.id], u))[adjunto.id],
    });
  } catch (error) {
    console.error('[finanzas.desdeAdjunto.contexto]', error);
    return res.status(500).json({ error: 'Error al leer el archivo' });
  }
};

/** Contenido del archivo del adjunto (disco o Google Drive), o { error, estado }. */
const leerContenido = async (adjunto) => {
  const lugar = almacenamiento.desdeUrl(adjunto.url);
  if (!lugar) return { estado: 400, error: 'Este archivo es de antes y no se puede copiar desde aquí: descárgalo y súbelo en finanzas' };
  const archivo = await almacenamiento.leer(lugar.carpeta, lugar.nombre);
  if (!archivo) return { estado: 410, error: 'El archivo ya no está en el servidor' };
  if (archivo.contenido.length > maximoBytes()) {
    return { estado: 400, error: `El archivo pesa más de lo que admite finanzas (${configEnCache().subidas.comprobantesMaxMB || 10} MB)` };
  }
  return { contenido: archivo.contenido };
};

/**
 * Valida el destino Cotizaciones. Devuelve { plan } o agrega errores; con
 * { estado } corta (403/404). Modos: 'nueva' (datos de la cotizacion, monto,
 * nota y acceso) o 'version' (cotizacionId, monto y nota de que cambio).
 */
const prepararCotizacion = async (pedido, contenido, adjunto, usuario, errores) => {
  if (!puedeCotizar(usuario)) return { estado: 403 };
  const ext = documentos.detectar(contenido, adjunto.nombre);
  if (!ext) { errores.push('Para cotizaciones el archivo debe ser PDF, imagen, Word, Excel o PowerPoint'); return {}; }
  const archivo = {
    ext,
    nombreOriginal: documentos.limpiarNombre(adjunto.nombre, ext),
    mime: documentos.TIPOS[ext],
    tamano: contenido.length,
    sha256: documentos.huella(contenido),
  };
  if (pedido.modo === 'version') {
    const cotizacionId = F.leerId(pedido.cotizacionId);
    if (!cotizacionId) { errores.push('Elige la cotización a la que se agrega la versión'); return {}; }
    const actual = await prisma.cotizacion.findFirst({ where: cot.visible(cotizacionId, usuario), select: { id: true, folio: true, moneda: true } });
    if (!actual) return { estado: 404, error: 'Cotización no encontrada' };
    const version = cot.normalizarVersion(pedido, { esOriginal: false });
    errores.push(...version.errores);
    const repetida = await prisma.versionCotizacion.findFirst({ where: { cotizacionId, sha256: archivo.sha256 }, select: { numero: true } });
    if (repetida) errores.push(`Ese archivo ya está en ${actual.folio} como versión ${repetida.numero}`);
    return { plan: { modo: 'version', actual, version, archivo } };
  }
  const { data, errores: erroresDatos } = await cot.normalizar(pedido);
  const version = cot.normalizarVersion(pedido, { esOriginal: true });
  const acceso = await cot.leerAcceso(pedido.acceso, usuario);
  if (acceso.prohibido) return { estado: 403 };
  errores.push(...erroresDatos, ...version.errores, ...acceso.errores);
  return { plan: { modo: 'nueva', data, version, acceso: acceso.acceso, archivo } };
};

/**
 * Valida el destino Gastos variables. Modos: 'nuevo' (los datos del gasto,
 * siempre en la categoria VARIABLES) o 'existente' (gastoId).
 */
const prepararGasto = async (pedido, contenido, usuario, errores) => {
  const mime = comprobantes.detectarMime(contenido);
  if (pedido.modo === 'existente') {
    if (!puedeGastoExistente(usuario)) return { estado: 403 };
    const gastoId = F.leerId(pedido.gastoId);
    if (!gastoId) { errores.push('Elige el gasto al que se agrega el comprobante'); return {}; }
    const actual = await prisma.gasto.findFirst({ where: { id: gastoId, categoria: CATEGORIA }, select: { id: true, folio: true } });
    if (!actual || !F.puedeGasto(usuario, CATEGORIA, 'ver')) return { estado: 404, error: 'Gasto no encontrado' };
    if (!mime) { errores.push('Para gastos el archivo debe ser PDF o imagen (JPG, PNG o WEBP)'); return {}; }
    const repetido = await prisma.comprobanteFinanciero.findFirst({ where: { gastoId, sha256: comprobantes.huella(contenido) }, select: { id: true } });
    if (repetido) errores.push(`Ese archivo ya es comprobante de ${actual.folio}`);
    return { plan: { modo: 'existente', actual, mime } };
  }
  if (!puedeGastoNuevo(usuario)) return { estado: 403 };
  if (!mime) { errores.push('Para gastos el archivo debe ser PDF o imagen (JPG, PNG o WEBP)'); return {}; }
  const { data, errores: erroresDatos } = await gas.normalizar({ ...pedido, categoria: CATEGORIA, estado: 'PENDIENTE' }, { usuario });
  errores.push(...erroresDatos);
  if (!erroresDatos.length) {
    data.estado = 'PENDIENTE';
    errores.push(...gas.validarCoherencia(data));
  }
  return { plan: { modo: 'nuevo', data, mime } };
};

// ---------------------------------------------------------------------------
// POST /api/finanzas/desde-adjunto/:adjuntoId
// { cotizacion?: { modo: 'nueva', ...datos } | { modo: 'version', cotizacionId, monto, nota },
//   gasto?: { modo: 'nuevo', ...datos } | { modo: 'existente', gastoId } }
// Todo o nada: si un destino no pasa, no se guarda ninguno.
// ---------------------------------------------------------------------------
const mandar = async (req, res) => {
  const id = F.leerId(req.params.adjuntoId);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const pedidoCot = req.body?.cotizacion && typeof req.body.cotizacion === 'object' ? req.body.cotizacion : null;
  const pedidoGasto = req.body?.gasto && typeof req.body.gasto === 'object' ? req.body.gasto : null;
  if (!pedidoCot && !pedidoGasto) return res.status(400).json({ error: 'Elige si va a cotizaciones, a gastos variables o a los dos' });
  const u = req.usuario;

  const escritos = [];
  try {
    const origen = await cargarAdjunto(id, u);
    if (!origen) return res.status(404).json({ error: 'Archivo no encontrado' });
    const leido = await leerContenido(origen.adjunto);
    if (leido.error) return res.status(leido.estado).json({ error: leido.error });
    const { contenido } = leido;

    const errores = [];
    const cotizacion = pedidoCot ? await prepararCotizacion(pedidoCot, contenido, origen.adjunto, u, errores) : null;
    const gasto = pedidoGasto ? await prepararGasto(pedidoGasto, contenido, u, errores) : null;
    for (const destino of [cotizacion, gasto]) {
      if (destino?.estado === 403) return F.sinPermiso(res);
      if (destino?.estado === 404) return res.status(404).json({ error: destino.error });
    }
    if (errores.length) return res.status(400).json({ error: 'Revisa los datos', detalles: errores });

    const deOrigen = datosOrigen(origen);
    // Primero las copias en disco; si algo falla despues, se borran.
    if (cotizacion) {
      cotizacion.plan.nombreInterno = await documentos.cotizaciones.guardar(contenido, cotizacion.plan.archivo.ext);
      escritos.push(() => documentos.cotizaciones.borrar(cotizacion.plan.nombreInterno));
    }
    if (gasto) {
      gasto.plan.nombreInterno = await comprobantes.guardar(contenido, gasto.plan.mime);
      escritos.push(() => comprobantes.borrar(gasto.plan.nombreInterno));
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const salida = {};
      if (cotizacion) {
        const { plan } = cotizacion;
        const { ext: _ext, ...archivo } = plan.archivo;
        const fila = {
          monto: plan.version.monto, nota: plan.version.nota, subidoPorId: u.id, archivo: plan.nombreInterno, ...archivo, ...deOrigen,
        };
        if (plan.modo === 'version') {
          // Tocar primero la cotizacion bloquea su fila: otra version a la vez espera.
          await tx.cotizacion.update({ where: { id: plan.actual.id }, data: { actualizadoEn: new Date() } });
          const ultima = await tx.versionCotizacion.aggregate({ where: { cotizacionId: plan.actual.id }, _max: { numero: true } });
          const creada = await tx.versionCotizacion.create({ data: { ...fila, cotizacionId: plan.actual.id, numero: (ultima._max.numero || 0) + 1 } });
          salida.cotizacion = { id: plan.actual.id, folio: plan.actual.folio, numero: creada.numero, moneda: plan.actual.moneda };
        } else {
          const nueva = await tx.cotizacion.create({ data: { ...plan.data, ...cot.datosAcceso(plan.acceso), folio: `TMP-${crypto.randomUUID()}`, creadoPorId: u.id } });
          await tx.versionCotizacion.create({ data: { ...fila, cotizacionId: nueva.id, numero: 1 } });
          const lista = await tx.cotizacion.update({ where: { id: nueva.id }, data: { folio: F.folio('COT', nueva.id, plan.data.fecha) } });
          salida.cotizacion = { id: lista.id, folio: lista.folio, numero: 1, moneda: lista.moneda, titulo: lista.titulo };
        }
      }
      if (gasto) {
        const { plan } = gasto;
        let destino = plan.actual;
        if (plan.modo === 'nuevo') {
          const nuevo = await tx.gasto.create({ data: { ...plan.data, folio: `TMP-${crypto.randomUUID()}`, creadoPorId: u.id } });
          destino = await tx.gasto.update({ where: { id: nuevo.id }, data: { folio: F.folio('GAS', nuevo.id, plan.data.fecha) } });
        } else {
          await tx.gasto.update({ where: { id: destino.id }, data: { actualizadoEn: new Date() } });
        }
        await tx.comprobanteFinanciero.create({
          data: {
            gastoId: destino.id,
            nombreOriginal: comprobantes.limpiarNombre(origen.adjunto.nombre, plan.mime),
            archivo: plan.nombreInterno,
            mime: plan.mime,
            tamano: contenido.length,
            sha256: comprobantes.huella(contenido),
            subidoPorId: u.id,
            ...deOrigen,
          },
        });
        salida.gasto = { id: destino.id, folio: destino.folio, nuevo: plan.modo === 'nuevo', concepto: destino.concepto, monto: destino.monto, moneda: destino.moneda };
      }
      return salida;
    });

    // Bitacora de finanzas, en palabras.
    const deDonde = deOrigen.origen ? ` desde «${deOrigen.origen}»` : '';
    if (resultado.cotizacion) {
      const c = resultado.cotizacion;
      const { plan } = cotizacion;
      const monto = plan.version.monto ? ` por ${plan.version.monto} ${c.moneda}` : '';
      if (plan.modo === 'version') {
        F.registrarFinanzas(u, 'cotizacion', c.id, 'VERSION', `Mandó el archivo "${plan.archivo.nombreOriginal}"${deDonde} como versión ${c.numero} de ${c.folio}${monto}: ${plan.version.nota}`);
      } else {
        const quienes = plan.acceso?.restringido ? `. La ven ${await cot.describirAcceso(plan.acceso)}` : '';
        F.registrarFinanzas(u, 'cotizacion', c.id, 'CREAR', `Registró la cotización ${c.folio} "${c.titulo}" con el archivo "${plan.archivo.nombreOriginal}"${deDonde}${monto}${quienes}`);
      }
    }
    if (resultado.gasto) {
      const g = resultado.gasto;
      F.registrarFinanzas(u, 'gasto', g.id, g.nuevo ? 'CREAR' : 'COMPROBANTE', g.nuevo
        ? `Registró el gasto ${g.folio} (${CATEGORIA}) "${g.concepto}" por ${F.aNumero(g.monto)} ${g.moneda} con el archivo "${origen.adjunto.nombre}"${deDonde}`
        : `Subió el comprobante "${origen.adjunto.nombre}"${deDonde} a ${g.folio}`);
    }

    const folios = [resultado.cotizacion && (cotizacion.plan.modo === 'version' ? `${resultado.cotizacion.folio} (versión ${resultado.cotizacion.numero})` : resultado.cotizacion.folio), resultado.gasto?.folio].filter(Boolean);
    return res.status(201).json({
      mensaje: `Listo: ${folios.join(' y ')}`,
      cotizacion: resultado.cotizacion && { id: resultado.cotizacion.id, folio: resultado.cotizacion.folio, numero: resultado.cotizacion.numero },
      gasto: resultado.gasto && { id: resultado.gasto.id, folio: resultado.gasto.folio },
    });
  } catch (error) {
    await Promise.all(escritos.map((borrar) => borrar().catch(() => {})));
    console.error('[finanzas.desdeAdjunto.mandar]', error);
    return res.status(500).json({ error: 'Error al mandar el archivo a finanzas' });
  }
};

module.exports = { copias, contexto, mandar };
