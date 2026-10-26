/**
 * Registro de actividad: quien creo, cambio o borro que, cuando y desde donde,
 * en todos los modulos. Se ve en el panel de configuracion (pedido del
 * 2026-10-26, "como en el CRM original de Redfor").
 *
 * No hace falta llamarlo desde los controladores: `extension(base)` envuelve
 * el cliente de Prisma (lib/prisma.js) y anota cada create/update/upsert/
 * delete (y sus versiones Many) de los modelos de MODELOS. En las ediciones
 * compara la fila antes y despues y guarda cada campo que cambio con su valor
 * anterior y el nuevo. Solo anota cuando hay un contexto (lib/contexto.js):
 * una peticion con sesion o una tarea de fondo que lo abre (Google Drive o
 * Calendar). El login, la recuperacion de contraseña y los avisos programados
 * no tienen contexto y no se anotan.
 *
 * Los cambios de una peticion se escriben al terminar la respuesta, de una
 * vez y fuera de su tiempo: si la respuesta es un error 5xx (la transaccion
 * suele haberse deshecho) no se escribe nada. Un fallo al escribir el
 * registro nunca rompe la peticion.
 */
const contexto = require('../lib/contexto');
const { contiene } = require('../utils/paginacion.utils');

const recortar = (texto, max = 120) => {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const unir = (...partes) => partes.filter(Boolean).join(' · ');

// Campos que nunca se anotan (tecnicos o que cambian solos).
const IGNORAR = new Set([
  'id', 'creadoEn', 'actualizadoEn', 'driveCarpetaId', 'driveArchivoId', 'googleCalendarEventId', 'googleEtag',
  'desdeDrive', 'url', 'archivo', 'huella',
]);
// Campos cuyo valor no se guarda, solo que cambiaron.
const OCULTO = /password|token|secreto|cifrad|codigosRespaldo|fotoPerfilUrl|sha256/i;
const OCULTO_TEXTO = '(cambió)';

/**
 * Modelos que se anotan. modulo: filtro del panel; tipo: que es (lo traduce
 * el panel); nombre(fila): como se muestra; ignorar: campos propios que no
 * se anotan; soloAltasYBajas: las ediciones no se anotan (cambian solas).
 */
const MODELOS = {
  Proyecto: { modulo: 'proyectos', tipo: 'proyecto', nombre: (r) => r.nombre },
  PlantillaProyecto: { modulo: 'proyectos', tipo: 'plantilla', nombre: (r) => r.nombre },
  Tarea: { modulo: 'tareas', tipo: 'tarea', nombre: (r) => r.titulo },
  Comentario: { modulo: 'tareas', tipo: 'comentario', nombre: (r) => recortar(r.contenido, 80) },
  Adjunto: { modulo: 'archivos', tipo: 'archivo', nombre: (r) => r.nombre },
  Empresa: { modulo: 'clientes', tipo: 'cliente', nombre: (r) => r.nombreComercial || r.nombre },
  ContactoEmpresa: { modulo: 'clientes', tipo: 'contacto', nombre: (r) => r.nombre },
  Contrato: { modulo: 'contratos', tipo: 'contrato', nombre: (r) => unir(r.folio, r.titulo) },
  ContratoArchivo: { modulo: 'contratos', tipo: 'archivoContrato', nombre: (r) => r.nombreOriginal },
  Evento: { modulo: 'agenda', tipo: 'evento', nombre: (r) => r.titulo },
  DiaEmpresa: { modulo: 'agenda', tipo: 'diaEmpresa', nombre: (r) => r.nombre },
  DiaEspecial: { modulo: 'agenda', tipo: 'diaEspecial', nombre: (r) => r.descripcion || r.tipo },
  ConfiguracionLaboral: { modulo: 'agenda', tipo: 'horario', nombre: () => null },
  CuentaFinanciera: { modulo: 'finanzas', tipo: 'cuenta', nombre: (r) => r.nombre },
  PresupuestoCategoria: { modulo: 'finanzas', tipo: 'presupuesto', nombre: (r) => `${r.categoria} ${String(r.mes).padStart(2, '0')}/${r.anio}` },
  Pago: { modulo: 'finanzas', tipo: 'pago', nombre: (r) => unir(r.folio, r.concepto) },
  Gasto: { modulo: 'finanzas', tipo: 'gasto', nombre: (r) => unir(r.folio, r.concepto) },
  ComprobanteFinanciero: { modulo: 'finanzas', tipo: 'comprobante', nombre: (r) => r.nombreOriginal },
  Cotizacion: { modulo: 'cotizaciones', tipo: 'cotizacion', nombre: (r) => unir(r.folio, r.titulo) },
  VersionCotizacion: { modulo: 'cotizaciones', tipo: 'versionCotizacion', nombre: (r) => unir(`v${r.numero}`, r.nombreOriginal) },
  ArticuloConocimiento: { modulo: 'conocimiento', tipo: 'articulo', nombre: (r) => r.titulo },
  ArchivoConocimiento: { modulo: 'conocimiento', tipo: 'archivoConocimiento', nombre: (r) => r.nombreOriginal },
  Usuario: {
    modulo: 'usuarios',
    tipo: 'usuario',
    nombre: (r) => r.nombre,
    ignorar: ['resetTokenExpires', 'verificationTokenExpires', 'tokenExpiraEn', 'googleTokenExpiresAt', 'googleCalendarCrmId',
      'googleCalendarSyncToken', 'googleCalendarSyncEn', 'intentosFallidos', 'bloqueadoHasta', 'ultimoLoginEn',
      'verificacionIntentos', 'dosFactoresPendiente', 'dosFactoresUltimoPaso', 'resetToken', 'verificationToken',
      'tokenInvitacion', 'googleAccessToken', 'googleRefreshToken', 'passwordCambiadoEn', 'dosFactoresSecreto', 'codigosRespaldo'],
  },
  Invitacion: { modulo: 'usuarios', tipo: 'invitacion', nombre: (r) => unir(r.nombre, r.email), soloAltasYBajas: true },
  Configuracion: { modulo: 'configuracion', tipo: 'configuracion', nombre: () => null },
  ConfiguracionArchivo: { modulo: 'configuracion', tipo: 'imagenMarca', nombre: (r) => r.clave, ignorar: ['contenido', 'mime'] },
  ConexionDrive: { modulo: 'configuracion', tipo: 'googleDrive', nombre: (r) => r.cuenta, soloAltasYBajas: true },
};

const OPERACIONES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const MAX_FILAS = 200; // en updateMany/deleteMany se anotan una por una hasta aqui

const delegado = (base, modelo) => base[modelo.charAt(0).toLowerCase() + modelo.slice(1)];

/** Valor guardable en JSON: fechas en ISO, decimales como texto, objetos recortados. */
const valor = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `(${v.length} bytes)`;
  if (typeof v === 'object') {
    if (typeof v.toFixed === 'function' && typeof v.toString === 'function' && v.constructor?.name === 'Decimal') return v.toString();
    return recortar(JSON.stringify(v), 300);
  }
  if (typeof v === 'string') return recortar(v, 300);
  return v;
};
const igual = (a, b) => JSON.stringify(valor(a)) === JSON.stringify(valor(b));

/** Hojas distintas entre dos objetos JSON ('marca.nombreSistema'), para la configuracion. */
const hojasDistintas = (antes, despues, prefijo = '', salida = []) => {
  const llaves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
  for (const k of llaves) {
    if (salida.length >= 40) break;
    const a = antes?.[k];
    const d = despues?.[k];
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (a && d && typeof a === 'object' && typeof d === 'object' && !Array.isArray(a) && !Array.isArray(d)) {
      hojasDistintas(a, d, ruta, salida);
    } else if (!igual(a, d)) {
      salida.push({ campo: ruta, antes: OCULTO.test(k) ? null : valor(a), despues: OCULTO.test(k) ? OCULTO_TEXTO : valor(d) });
    }
  }
  return salida;
};

/** Campos que cambiaron entre dos filas, con su valor anterior y el nuevo. */
const cambiosEntre = (modelo, def, antes, despues) => {
  if (!antes || !despues) return [];
  if (modelo === 'Configuracion') return hojasDistintas(antes.datos, despues.datos);
  const ignorar = new Set([...IGNORAR, ...(def.ignorar || [])]);
  const cambios = [];
  for (const campo of Object.keys(despues)) {
    if (ignorar.has(campo) || igual(antes[campo], despues[campo])) continue;
    if (OCULTO.test(campo)) cambios.push({ campo, antes: null, despues: OCULTO_TEXTO });
    else cambios.push({ campo, antes: valor(antes[campo]), despues: valor(despues[campo]) });
  }
  return cambios;
};

const evento = (accion, modelo, def, fila, cambios = null) => ({
  accion,
  modulo: def.modulo,
  tipo: def.tipo,
  entidadId: fila && (fila.id ?? fila.clave) !== undefined && (fila.id ?? fila.clave) !== null ? String(fila.id ?? fila.clave) : null,
  entidadNombre: fila ? (recortar(def.nombre(fila) || '', 255) || null) : null,
  cambios: cambios && cambios.length ? cambios : null,
});

// ── Escribir ────────────────────────────────────────────────────────────────

// Campos que guardan el id de otra cosa: al escribir se agrega su nombre.
const REFERENCIAS = {
  asignadoId: 'usuario', creadorId: 'usuario', responsableId: 'usuario', autorId: 'usuario', usuarioId: 'usuario',
  subidoPorId: 'usuario', creadoPorId: 'usuario', editadoPorId: 'usuario', fijadoPorId: 'usuario',
  clienteId: 'empresa', empresaId: 'empresa', proyectoId: 'proyecto', tareaId: 'tarea', dependeDeId: 'tarea',
  contratoId: 'contrato', cuentaId: 'cuentaFinanciera', cotizacionId: 'cotizacion', articuloId: 'articuloConocimiento',
  pagoId: 'pago', gastoId: 'gasto',
};
const CAMPO_NOMBRE = {
  usuario: 'nombre', empresa: 'nombre', proyecto: 'nombre', tarea: 'titulo', contrato: 'titulo',
  cuentaFinanciera: 'nombre', cotizacion: 'titulo', articuloConocimiento: 'titulo', pago: 'concepto', gasto: 'concepto',
};

const ponerNombres = async (base, eventos) => {
  const pedidos = {}; // delegado -> Set(ids)
  for (const e of eventos) {
    for (const c of e.cambios || []) {
      const d = REFERENCIAS[c.campo];
      if (!d) continue;
      pedidos[d] = pedidos[d] || new Set();
      for (const v of [c.antes, c.despues]) if (Number.isInteger(v)) pedidos[d].add(v);
    }
  }
  const nombres = {};
  await Promise.all(Object.entries(pedidos).map(async ([d, ids]) => {
    if (!ids.size) return;
    const campo = CAMPO_NOMBRE[d];
    const filas = await base[d].findMany({ where: { id: { in: [...ids] } }, select: { id: true, [campo]: true } }).catch(() => []);
    nombres[d] = Object.fromEntries(filas.map((f) => [f.id, f[campo]]));
  }));
  for (const e of eventos) {
    for (const c of e.cambios || []) {
      const d = REFERENCIAS[c.campo];
      if (!d || !nombres[d]) continue;
      if (Number.isInteger(c.antes) && nombres[d][c.antes]) c.antesNombre = nombres[d][c.antes];
      if (Number.isInteger(c.despues) && nombres[d][c.despues]) c.despuesNombre = nombres[d][c.despues];
    }
  }
};

let avisado = false;
const escribir = async (base, ctx) => {
  const eventos = ctx.eventos.splice(0);
  if (!eventos.length) return;
  try {
    await ponerNombres(base, eventos);
    await base.registroActividad.createMany({
      data: eventos.map((e) => ({
        ...e,
        usuarioId: ctx.usuario?.id ?? null,
        usuarioNombre: ctx.usuario?.nombre ?? null,
        origen: ctx.origen || 'usuario',
        ip: ctx.ip ? String(ctx.ip).slice(0, 64) : null,
        cambios: e.cambios ?? undefined,
      })),
    });
  } catch (error) {
    // Sin la migracion aplicada (o la base caida) el CRM sigue funcionando.
    if (!avisado) console.error('[registroActividad] No se pudo escribir el registro:', error.message);
    avisado = true;
  }
};

/** Deja el evento en el contexto; se escribe al terminar la respuesta (o enseguida, en tareas de fondo). */
const anotar = (base, ctx, eventos) => {
  if (!eventos.length) return;
  ctx.eventos.push(...eventos);
  if (ctx.programado) return;
  ctx.programado = true;
  if (ctx.res && !ctx.res.writableFinished) {
    const alTerminar = () => {
      ctx.programado = false;
      if (ctx.res.statusCode >= 500) { ctx.eventos.length = 0; return; }
      setImmediate(() => escribir(base, ctx));
    };
    ctx.res.once('finish', alTerminar);
    return;
  }
  setImmediate(() => { ctx.programado = false; escribir(base, ctx); });
};

// ── Extension de Prisma ─────────────────────────────────────────────────────

const extension = (base) => ({
  name: 'registroActividad',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const def = MODELOS[model];
        const ctx = contexto.actual();
        if (!def || !ctx || !OPERACIONES.has(operation)) return query(args);
        const d = delegado(base, model);
        // La fila despues del cambio (por id; las imagenes de marca usan su clave).
        const releer = (fila) => d.findUnique({ where: fila?.id !== undefined ? { id: fila.id } : args.where }).catch(() => null);

        if (operation === 'create') {
          const res = await query(args);
          anotar(base, ctx, [evento('crear', model, def, { ...(args.data || {}), ...(res || {}) })]);
          return res;
        }
        if (operation === 'createMany') {
          const res = await query(args);
          if (res?.count) anotar(base, ctx, [{ ...evento('crear', model, def, null), entidadNombre: `${res.count}` }]);
          return res;
        }
        if (operation === 'delete') {
          const antes = await d.findUnique({ where: args.where }).catch(() => null);
          const res = await query(args);
          anotar(base, ctx, [evento('eliminar', model, def, antes || res)]);
          return res;
        }
        if (operation === 'deleteMany') {
          const antes = await d.findMany({ where: args?.where, take: MAX_FILAS + 1 }).catch(() => []);
          const res = await query(args);
          if (res?.count) {
            const filas = antes.slice(0, MAX_FILAS).map((f) => evento('eliminar', model, def, f));
            if (res.count > MAX_FILAS) filas.push({ ...evento('eliminar', model, def, null), entidadNombre: `+${res.count - MAX_FILAS}` });
            anotar(base, ctx, filas);
          }
          return res;
        }
        if (def.soloAltasYBajas && operation !== 'upsert') return query(args);
        // Ediciones: si solo cambian campos que no se anotan, ni se mira la fila.
        const datos = args?.data || args?.update || {};
        const ignorar = new Set([...IGNORAR, ...(def.ignorar || [])]);
        if (operation !== 'upsert' && Object.keys(datos).length && Object.keys(datos).every((k) => ignorar.has(k))) return query(args);

        if (operation === 'update' || operation === 'upsert') {
          const antes = await d.findUnique({ where: args.where }).catch(() => null);
          const res = await query(args);
          if (!antes) {
            if (operation === 'upsert') anotar(base, ctx, [evento('crear', model, def, { ...(args.create || {}), ...(res || {}) })]);
            return res;
          }
          if (def.soloAltasYBajas) return res;
          const despues = await releer(antes);
          const cambios = cambiosEntre(model, def, antes, despues);
          if (cambios.length) anotar(base, ctx, [evento('editar', model, def, despues || antes, cambios)]);
          return res;
        }
        // updateMany
        const antes = await d.findMany({ where: args?.where, take: MAX_FILAS }).catch(() => []);
        const res = await query(args);
        if (res?.count && antes.length) {
          const despues = await d.findMany({ where: { id: { in: antes.map((f) => f.id) } } }).catch(() => []);
          const porIdDespues = new Map(despues.map((f) => [f.id, f]));
          const eventos = [];
          for (const f of antes) {
            const nueva = porIdDespues.get(f.id);
            const cambios = cambiosEntre(model, def, f, nueva);
            if (cambios.length) eventos.push(evento('editar', model, def, nueva || f, cambios));
          }
          anotar(base, ctx, eventos);
        }
        return res;
      },
    },
  },
});

// ── Consultar (panel de configuracion) ─────────────────────────────────────

const MODULOS = [...new Set(Object.values(MODELOS).map((m) => m.modulo))];

/**
 * Pagina del registro, de lo mas nuevo a lo mas viejo. filtros: { usuarioId,
 * modulo, accion, q, desde, hasta, antesDe (id para la pagina siguiente) }.
 */
const listar = async (prisma, filtros = {}, limite = 50) => {
  const where = {};
  if (filtros.usuarioId) where.usuarioId = filtros.usuarioId;
  if (filtros.origen) where.origen = filtros.origen;
  if (filtros.modulo) where.modulo = filtros.modulo;
  if (filtros.accion) where.accion = filtros.accion;
  if (filtros.antesDe) where.id = { lt: filtros.antesDe };
  if (filtros.desde || filtros.hasta) {
    where.creadoEn = {};
    if (filtros.desde) where.creadoEn.gte = filtros.desde;
    if (filtros.hasta) where.creadoEn.lt = filtros.hasta;
  }
  if (filtros.q) {
    where.OR = [
      { entidadNombre: contiene(filtros.q) },
      { usuarioNombre: contiene(filtros.q) },
    ];
  }
  const filas = await prisma.registroActividad.findMany({ where, orderBy: { id: 'desc' }, take: limite + 1 });
  return { registros: filas.slice(0, limite), siguiente: filas.length > limite ? filas[limite - 1].id : null };
};

module.exports = { extension, listar, MODELOS, MODULOS, escribir, anotar };
