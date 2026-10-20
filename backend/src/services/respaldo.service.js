/**
 * Respaldo diario de la base en Google Drive (carpeta "Archivos del CRM /
 * Respaldos" de la cuenta conectada, ver drive.service.js).
 *
 * - Una vez al dia, a partir de las 3:00 (hora de la empresa), el servidor
 *   sube a Drive los archivos que hayan quedado en el disco y despues un
 *   respaldo completo de la base: respaldo-AAAA-MM-DD-HHMM.json.gz. Se
 *   conservan los ultimos CONSERVAR; los anteriores van a la papelera de Drive.
 * - Va dentro del proceso (no en un cron de cPanel) porque ahi estan las
 *   variables de entorno; el cron que mantiene despierta la aplicacion basta.
 *   Con varios procesos, la tabla avisos_enviados asegura uno solo por dia.
 * - Formato: JSON con todas las tablas (columnas con su nombre en la base),
 *   portable entre MySQL y PostgreSQL. Se restaura con
 *   `npm run db:copiar -- --desde-respaldo archivo.json.gz` (scripts/copiar_base.js).
 * - RESPALDO_DIARIO=off lo apaga (servidores de prueba).
 */
const zlib = require('zlib');
const { promisify } = require('util');
const prisma = require('../lib/prisma');
const drive = require('./drive.service');
const { pasarDiscoADrive } = require('./almacenHibrido.service');
const { proveedorActivo, POSTGRES } = require('../lib/baseDatos');
const { claveDiaMexico, zonaHoraria } = require('../utils/fechas.utils');
const {
  modelos, tablaDe, columnaDe, camposEscalares, nombreCliente, tablasM2M,
} = require('../utils/esquemaBase.utils');

// Para que pasarDiscoADrive conozca todos los almacenes (cada uno se registra al cargarse).
require('./almacenamiento.service');
require('./comprobantes.service');
require('./contratosArchivos.service');
require('./documentos.service');

const gzip = promisify(zlib.gzip);
const CONSERVAR = 30;
const HORA_RESPALDO = 3;
const REVISAR_CADA_MS = 10 * 60 * 1000;

/** Valor que se puede guardar en JSON y volver a leer sin perder nada. */
const aJson = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return { $b64: Buffer.from(valor).toString('base64') };
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object' && typeof valor.toFixed === 'function' && typeof valor.toJSON === 'function') return valor.toJSON(); // Decimal
  return valor;
};

/** Todas las tablas de la base, como { formato, creado, proveedor, tablas: { tabla: filas } }. */
const exportarBase = async () => {
  const tablas = {};
  let filasTotales = 0;
  for (const modelo of modelos) {
    const campos = camposEscalares(modelo);
    const filas = await prisma[nombreCliente(modelo)].findMany();
    tablas[tablaDe(modelo)] = filas.map((fila) => Object.fromEntries(campos.map((c) => [columnaDe(c), aJson(fila[c.name])])));
    filasTotales += filas.length;
  }
  const citar = proveedorActivo() === POSTGRES ? (n) => `"${n}"` : (n) => `\`${n}\``;
  for (const { tabla } of tablasM2M()) {
    const filas = await prisma.$queryRawUnsafe(`SELECT ${citar('A')} AS ${citar('A')}, ${citar('B')} AS ${citar('B')} FROM ${citar(tabla)} ORDER BY 1, 2`);
    tablas[tabla] = filas.map((f) => ({ A: Number(f.A), B: Number(f.B) }));
    filasTotales += filas.length;
  }
  const ultimaMigracion = await prisma.$queryRawUnsafe(
    `SELECT ${citar('migration_name')} AS nombre FROM ${citar('_prisma_migrations')} WHERE ${citar('finished_at')} IS NOT NULL ORDER BY ${citar('migration_name')} DESC LIMIT 1`,
  ).catch(() => []);
  return {
    formato: 'crm-respaldo',
    version: 1,
    creado: new Date().toISOString(),
    proveedor: proveedorActivo(),
    migracion: ultimaMigracion[0]?.nombre || null,
    filas: filasTotales,
    tablas,
  };
};

const horaLocal = (instante = new Date()) => Number(new Intl.DateTimeFormat('en-US', {
  timeZone: zonaHoraria(), hour: 'numeric', hourCycle: 'h23',
}).format(instante));

const nombreRespaldo = (instante = new Date()) => {
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: zonaHoraria(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(instante).replace(':', '');
  return `respaldo-${claveDiaMexico(instante)}-${hora}.json.gz`;
};

/**
 * Sube a Drive los archivos pendientes del disco y un respaldo de la base.
 * Devuelve { nombre, bytes, filas, archivos, borrados }. Lanza si Drive no
 * esta conectado o falla.
 */
const respaldar = async () => {
  if (!(await drive.activo())) throw new drive.ErrorDrive('Google Drive no está conectado.', 409);
  const archivos = await pasarDiscoADrive();
  const datos = await exportarBase();
  const comprimido = await gzip(Buffer.from(JSON.stringify(datos)));
  const nombre = nombreRespaldo();
  await drive.subir('respaldos', nombre, comprimido, 'application/gzip');

  // Solo se guardan los ultimos CONSERVAR; los demas a la papelera (30 dias).
  const guardados = await drive.listarRespaldos();
  const sobran = guardados.slice(CONSERVAR);
  for (const viejo of sobran) await drive.aPapeleraPorId(viejo.id).catch(() => {});

  await drive.anotar({ ultimoRespaldoEn: new Date(), ultimoRespaldoBytes: comprimido.length, ultimoError: null });
  return { nombre, bytes: comprimido.length, filas: datos.filas, archivos, borrados: sobran.length };
};

// ── Una vez al dia ──────────────────────────────────────────────────────────

/** true si este proceso se quedo con la tarea de hoy (ningun otro la hizo). */
const reservar = async (clave) => {
  try {
    await prisma.avisoEnviado.create({ data: { clave } });
    return true;
  } catch (error) {
    if (error?.code === 'P2002') return false;
    throw error;
  }
};

let enCurso = false;
const revisar = async () => {
  if (enCurso) return;
  enCurso = true;
  try {
    if (!(await drive.activo()) || horaLocal() < HORA_RESPALDO) return;
    if (!(await reservar(`respaldo:${claveDiaMexico()}`))) return;
    const resultado = await respaldar();
    console.log(`[respaldo] ${resultado.nombre} (${Math.round(resultado.bytes / 1024)} KB, ${resultado.filas} filas; ${resultado.archivos.subidos} archivos del disco pasados a Drive)`);
  } catch (error) {
    console.error('[respaldo]', error?.message || error);
    await drive.anotar({ ultimoError: `Respaldo diario: ${String(error?.message || error)}`.slice(0, 500) });
  } finally {
    enCurso = false;
  }
};

let temporizador = null;
const iniciarRespaldoDiario = () => {
  if (temporizador || process.env.RESPALDO_DIARIO === 'off') return;
  temporizador = setInterval(revisar, REVISAR_CADA_MS);
  temporizador.unref?.();
  setTimeout(revisar, 60 * 1000).unref?.();
};

module.exports = { exportarBase, respaldar, iniciarRespaldoDiario, nombreRespaldo, CONSERVAR };
