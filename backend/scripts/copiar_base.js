#!/usr/bin/env node
/**
 * Copia todos los datos de una base del CRM a otra, entre MySQL y PostgreSQL
 * en cualquier sentido: XAMPP -> Supabase, Supabase -> cPanel, Postgres ->
 * Postgres, etc.
 *
 * Uso, desde backend/. El DESTINO es la base de DATABASE_URL, que ya debe
 * tener las tablas y el cliente generado para ella:
 *
 *   npm run db:migrate && npm run db:generate
 *   npm run db:copiar -- --desde "mysql://root:@localhost:3306/crm_interno"
 *   npm run db:copiar -- --desde "postgresql://..." --reemplazar
 *
 *   --desde URL   base de ORIGEN (mysql:// o postgresql://). Tambien se puede
 *                 poner en .env como ORIGEN_DATABASE_URL.
 *   --desde-respaldo ARCHIVO
 *                 en vez de una base, un respaldo diario de Google Drive
 *                 (respaldo-AAAA-MM-DD-HHMM.json.gz, services/respaldo.service.js):
 *                 asi se restaura un respaldo en una base nueva o vaciada.
 *   --desde-supabase
 *                 lee Supabase por su API (PostgREST) con la llave secreta
 *                 (SUPABASE_URL y SUPABASE_SECRET_KEY en el entorno o en
 *                 .env.migracion), sin la contraseña de la base. La llave
 *                 secreta (service_role / sb_secret_...) se salta RLS.
 *   --reemplazar  si el destino ya tiene filas, las borra antes de copiar.
 *
 * Como funciona:
 * - Tablas, columnas y relaciones salen del esquema de Prisma (DMMF): no hay
 *   listas escritas a mano que se desincronicen al agregar modelos.
 * - El orden de carga se calcula con las llaves foraneas. Las que forman un
 *   ciclo (usuarios <-> empresas) o apuntan a la misma tabla (tareas.dependeDeId)
 *   se insertan en NULL y se rellenan en una segunda pasada.
 * - El origen se lee con el driver crudo (mysql2 o pg) y el destino se escribe
 *   con Prisma, que traduce los tipos (JSON, fechas, booleanos, binarios) a la
 *   base que toque. Las fechas van siempre en UTC: no hay corrimiento de horas.
 * - Se conservan los ids. En Postgres se ajustan las secuencias al terminar
 *   (insertar ids explicitos no las mueve); en MySQL el AUTO_INCREMENT se
 *   ajusta solo.
 * - Una columna que solo exista en el origen se ignora; una que solo exista en
 *   el destino queda con su valor por defecto. Por eso tambien sirve para traer
 *   datos de la Supabase antigua (esquema de agosto de 2026).
 * - Si una fila apunta a un registro que no existe, se pone NULL si el campo
 *   es opcional o se omite la fila si es obligatorio, y se avisa.
 * - Al final compara los conteos de las dos bases y termina con error si no
 *   coinciden (descontando las filas omitidas a proposito).
 * - El origen SOLO SE LEE. La tabla _prisma_migrations no se copia: cada base
 *   lleva su propio historial de migraciones.
 */
require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');
const { Prisma } = require('@prisma/client');
const { detectarProveedor, proveedorActivo, MYSQL, POSTGRES } = require('../src/lib/baseDatos');
const {
  modelos, porNombre, tablaDe, columnaDe, camposEscalares, relacionesConFk, campoId, nombreCliente, esAutoincremental, tablasM2M,
} = require('../src/utils/esquemaBase.utils');

const args = process.argv.slice(2);
const REEMPLAZAR = args.includes('--reemplazar');
const leerOpcion = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const FILAS_POR_LOTE = 200;
// Las fotos de perfil en base64 y los logos pesan mas de 1 MB: los lotes se
// cortan tambien por tamaño para no pasar el max_allowed_packet de MySQL.
const BYTES_POR_LOTE = 2 * 1024 * 1024;

// ── Conexiones de origen ────────────────────────────────────────────────────

const decodificar = (texto) => {
  try { return decodeURIComponent(texto); } catch (_e) { return texto; }
};

// Se parsea a mano porque la clave puede traer `@` sin codificar y la URL
// estandar la partiria mal.
const parsearUrl = (url, etiqueta) => {
  const m = /^(mysql|postgres(?:ql)?):\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url || '');
  if (!m) {
    throw new Error(`${etiqueta} debe tener el formato mysql://usuario:clave@host:3306/base o postgresql://usuario:clave@host:5432/base`);
  }
  const proveedor = m[1] === 'mysql' ? MYSQL : POSTGRES;
  return {
    proveedor,
    user: decodificar(m[2]),
    password: decodificar(m[3]),
    host: m[4],
    port: Number(m[5] || (proveedor === MYSQL ? 3306 : 5432)),
    database: m[6],
    params: new URLSearchParams(m[7] || ''),
  };
};

const abrirOrigen = async (url) => {
  const cfg = parsearUrl(url, 'La URL de origen (--desde)');
  const base = { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database };

  if (cfg.proveedor === MYSQL) {
    const mysql = require('mysql2/promise');
    const quiereSsl = ['ssl-mode', 'sslaccept', 'ssl', 'sslcert'].some((p) => cfg.params.has(p));
    const conexion = await mysql.createConnection({
      ...base,
      timezone: 'Z', // DATETIME se guarda en UTC: leerlo como UTC
      charset: 'utf8mb4',
      ssl: quiereSsl ? { rejectUnauthorized: false } : undefined,
    });
    return {
      proveedor: MYSQL,
      citar: (nombre) => '`' + nombre + '`',
      consultar: async (sql) => (await conexion.query(sql))[0],
      cerrar: () => conexion.end(),
    };
  }

  const { Client, types } = require('pg');
  // Postgres guarda los DateTime de Prisma como `timestamp` sin zona, en UTC.
  // El driver `pg` los interpretaria en la zona local; se fuerza UTC.
  types.setTypeParser(1114, (s) => new Date(`${s.replace(' ', 'T')}Z`));
  types.setTypeParser(1082, (s) => new Date(`${s}T00:00:00Z`)); // date
  types.setTypeParser(20, (s) => Number(s)); // int8 (COUNT)

  // Primero con TLS (Supabase lo exige); si el servidor no lo ofrece, sin el.
  let cliente;
  let ultimoError;
  for (const intento of [{ ...base, ssl: { rejectUnauthorized: false } }, base]) {
    cliente = new Client(intento);
    try {
      await cliente.connect();
      ultimoError = null;
      break;
    } catch (error) {
      ultimoError = error;
      try { await cliente.end(); } catch (_e) { /* nada */ }
    }
  }
  if (ultimoError) throw ultimoError;
  return {
    proveedor: POSTGRES,
    citar: (nombre) => `"${nombre}"`,
    consultar: async (sql) => (await cliente.query(sql)).rows,
    cerrar: () => cliente.end(),
  };
};

/**
 * Un respaldo diario (services/respaldo.service.js) como origen: el mismo
 * contrato que una base (`consultar` entiende las tres consultas que hace este
 * script: SELECT *, COUNT(*) y las columnas A/B de las tablas intermedias).
 * Las fechas vuelven a ser Date y los binarios ({ $b64 }) Buffer.
 */
const abrirRespaldo = (archivo) => {
  const crudo = fs.readFileSync(archivo);
  const texto = (archivo.endsWith('.gz') ? zlib.gunzipSync(crudo) : crudo).toString('utf8');
  const respaldo = JSON.parse(texto, (_clave, valor) => (
    valor && typeof valor === 'object' && typeof valor.$b64 === 'string' ? Buffer.from(valor.$b64, 'base64') : valor
  ));
  if (respaldo?.formato !== 'crm-respaldo' || !respaldo.tablas) throw new Error(`${archivo} no es un respaldo del CRM.`);
  // Fechas: en el JSON van como texto ISO.
  for (const modelo of modelos) {
    const filas = respaldo.tablas[tablaDe(modelo)];
    if (!filas) continue;
    const fechas = camposEscalares(modelo).filter((c) => c.type === 'DateTime').map(columnaDe);
    for (const fila of filas) {
      for (const columna of fechas) if (typeof fila[columna] === 'string') fila[columna] = new Date(fila[columna]);
    }
  }
  const tablaDeConsulta = (sql) => {
    const tabla = /\bFROM\s+(\S+)/i.exec(sql)?.[1];
    if (!tabla || !(tabla in respaldo.tablas)) {
      const error = new Error(`El respaldo no tiene la tabla ${tabla}`);
      error.code = '42P01'; // como Postgres: "no existe", se copia vacia
      throw error;
    }
    return respaldo.tablas[tabla];
  };
  return {
    proveedor: 'respaldo',
    creado: respaldo.creado,
    citar: (nombre) => nombre,
    consultar: async (sql) => {
      const filas = tablaDeConsulta(sql);
      return /COUNT\(\*\)/i.test(sql) ? [{ n: filas.length }] : filas;
    },
    cerrar: async () => {},
  };
};

/**
 * Supabase por su API REST (PostgREST) como origen, con la llave secreta:
 * sirve cuando no se tiene la contraseña de la base. Mismo contrato que las
 * demas: `consultar` entiende SELECT *, COUNT(*) y las columnas A/B de las
 * tablas intermedias. PostgREST devuelve los timestamp sin zona (en la base
 * son UTC), los bytea como '\x…' en hexadecimal y como mucho 1000 filas por
 * peticion: aqui se convierten y se pagina.
 */
const abrirSupabase = ({ url, clave }) => {
  // Supabase muestra la URL a veces con /rest/v1 al final: se acepta igual.
  const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  // http solo para localhost (pruebas con una API falsa).
  if (!/^(https:\/\/[^/]+|http:\/\/localhost(:\d+)?)$/.test(base)) throw new Error('SUPABASE_URL debe ser como https://xxxx.supabase.co');
  if (!clave) throw new Error('Falta SUPABASE_SECRET_KEY (la llave secreta / service_role del proyecto).');
  // Las llaves nuevas (sb_secret_...) no son JWT: van solo en `apikey`.
  const cabeceras = clave.startsWith('eyJ') ? { apikey: clave, Authorization: `Bearer ${clave}` } : { apikey: clave };
  const POR_PAGINA = 1000;
  const porTabla = new Map(modelos.map((m) => [tablaDe(m), m]));

  const pedir = async (tabla, consulta, extra = {}) => {
    const res = await fetch(`${base}/rest/v1/${encodeURIComponent(tabla)}?${consulta}`, { headers: { ...cabeceras, ...extra } });
    if (res.status === 404 || res.status === 400) {
      const cuerpo = await res.json().catch(() => ({}));
      if (/does not exist|Could not find the table|PGRST205|42P01/i.test(JSON.stringify(cuerpo))) {
        const error = new Error(`Supabase no tiene la tabla ${tabla}`);
        error.code = '42P01';
        throw error;
      }
      throw new Error(`Supabase respondió ${res.status} en ${tabla}: ${cuerpo.message || JSON.stringify(cuerpo)}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Supabase rechazó la llave: revisa SUPABASE_SECRET_KEY (debe ser la secreta, no la publica/anon).');
    if (!res.ok) throw new Error(`Supabase respondió ${res.status} en ${tabla}`);
    return res;
  };

  // Valores de PostgREST -> lo que da un driver: fechas UTC y binarios.
  const convertir = (tabla, filas) => {
    const modelo = porTabla.get(tabla);
    if (!modelo) return filas;
    const fechas = camposEscalares(modelo).filter((c) => c.type === 'DateTime').map(columnaDe);
    const binarios = camposEscalares(modelo).filter((c) => c.type === 'Bytes').map(columnaDe);
    for (const fila of filas) {
      for (const c of fechas) {
        if (typeof fila[c] === 'string') fila[c] = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(fila[c]) ? fila[c] : `${fila[c]}Z`);
      }
      for (const c of binarios) {
        if (typeof fila[c] === 'string' && fila[c].startsWith('\\x')) fila[c] = Buffer.from(fila[c].slice(2), 'hex');
      }
    }
    return filas;
  };

  return {
    proveedor: 'supabase',
    citar: (nombre) => nombre,
    consultar: async (sql) => {
      const tabla = /\bFROM\s+(\S+)/i.exec(sql)?.[1];
      if (/COUNT\(\*\)/i.test(sql)) {
        const res = await pedir(tabla, 'select=*', { Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' });
        const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]);
        return [{ n: Number.isFinite(total) ? total : 0 }];
      }
      const modelo = porTabla.get(tabla);
      const orden = modelo ? `${columnaDe(campoId(modelo))}.asc` : 'A.asc,B.asc';
      const filas = [];
      for (let desde = 0; ; desde += POR_PAGINA) {
        const res = await pedir(tabla, `select=*&order=${orden}&limit=${POR_PAGINA}&offset=${desde}`);
        const pagina = await res.json();
        filas.push(...pagina);
        if (pagina.length < POR_PAGINA) break;
      }
      return convertir(tabla, filas);
    },
    cerrar: async () => {},
  };
};

// ── Metadatos del esquema de Prisma (src/utils/esquemaBase.utils.js) ────────

/**
 * Orden de carga: cada modelo despues de los que referencia. Si hay un ciclo
 * (usuarios <-> empresas), entra primero el que pueda dejar en NULL las llaves
 * que faltan (todas opcionales) y se rellenan al final. Las llaves hacia el
 * propio modelo siempre se difieren.
 */
const ordenarModelos = () => {
  const pendientes = modelos.map((m) => m.name);
  const listos = new Set();
  const orden = [];
  const sinResolver = (nombre) => relacionesConFk(porNombre.get(nombre)).filter((r) => r.type !== nombre && !listos.has(r.type));
  const esOpcional = (nombre, rel) => !porNombre.get(nombre).fields.find((f) => f.name === rel.relationFromFields[0]).isRequired;

  while (pendientes.length) {
    let elegido = pendientes.find((n) => sinResolver(n).length === 0);
    const diferidas = new Map(); // campo -> modelo al que apunta
    if (!elegido) {
      elegido = pendientes.find((n) => sinResolver(n).every((r) => esOpcional(n, r)));
      if (!elegido) throw new Error(`Ciclo de llaves foraneas obligatorias entre: ${pendientes.join(', ')}`);
      for (const r of sinResolver(elegido)) diferidas.set(r.relationFromFields[0], r.type);
    }
    for (const r of relacionesConFk(porNombre.get(elegido))) {
      if (r.type === elegido) diferidas.set(r.relationFromFields[0], r.type);
    }
    orden.push({ modelo: porNombre.get(elegido), diferidas });
    listos.add(elegido);
    pendientes.splice(pendientes.indexOf(elegido), 1);
  }
  return orden;
};

// ── Conversion de valores del driver crudo a lo que espera Prisma ───────────

const convertirFila = (modelo, fila, proveedorOrigen) => {
  const datos = {};
  for (const campo of camposEscalares(modelo)) {
    const columna = columnaDe(campo);
    if (!(columna in fila)) continue; // columna que solo existe en el destino
    let valor = fila[columna];
    if (valor === undefined) continue;
    if (campo.type === 'Boolean' && typeof valor === 'number') valor = valor !== 0; // TINYINT(1)
    if (campo.type === 'Json') {
      // MariaDB (XAMPP) devuelve JSON como texto; MySQL 8 y Postgres, ya parseado.
      if (typeof valor === 'string' && proveedorOrigen === MYSQL) valor = JSON.parse(valor);
      if (valor === null) valor = Prisma.DbNull;
    }
    if (campo.type === 'BigInt' && valor !== null) valor = BigInt(valor);
    datos[campo.name] = valor;
  }
  return datos;
};

const tamanoAprox = (dato) => JSON.stringify(dato, (_k, v) => {
  if (Buffer.isBuffer(v)) return v.length;
  if (typeof v === 'bigint') return v.toString();
  return v;
}).length;

const enLotes = (lista) => {
  const lotes = [];
  let actual = [];
  let bytes = 0;
  for (const dato of lista) {
    const peso = tamanoAprox(dato);
    if (actual.length && (actual.length >= FILAS_POR_LOTE || bytes + peso > BYTES_POR_LOTE)) {
      lotes.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(dato);
    bytes += peso;
  }
  if (actual.length) lotes.push(actual);
  return lotes;
};

// ── Destino (Prisma) ────────────────────────────────────────────────────────

const contar = async (ejecutar, citar, tabla) => {
  const filas = await ejecutar(`SELECT COUNT(*) AS n FROM ${citar(tabla)}`);
  return Number(filas[0].n);
};

const vaciarDestino = async ({ destino, citar, orden, m2m }) => {
  // Primero se sueltan las llaves que se rellenan en segunda pasada (ciclos y
  // autorreferencias), luego las tablas intermedias y los modelos al reves.
  for (const { modelo, diferidas } of orden) {
    for (const campo of diferidas.keys()) {
      const columna = columnaDe(modelo.fields.find((f) => f.name === campo));
      await destino.$executeRawUnsafe(`UPDATE ${citar(tablaDe(modelo))} SET ${citar(columna)} = NULL`);
    }
  }
  for (const { tabla } of m2m) await destino.$executeRawUnsafe(`DELETE FROM ${citar(tabla)}`);
  for (const { modelo } of [...orden].reverse()) await destino.$executeRawUnsafe(`DELETE FROM ${citar(tablaDe(modelo))}`);
};

const ajustarSecuencias = async ({ destino, citar }) => {
  for (const modelo of modelos) {
    const pk = campoId(modelo);
    if (!pk || !esAutoincremental(pk)) continue;
    const tabla = citar(tablaDe(modelo));
    const columna = columnaDe(pk);
    await destino.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${tabla}', '${columna}'), COALESCE((SELECT MAX(${citar(columna)}) FROM ${tabla}), 0) + 1, false)`,
    );
  }
};

// ── Copia ───────────────────────────────────────────────────────────────────

// Una tabla que el origen todavia no tiene (le falta una migracion, p. ej. las
// de finanzas) se copia como vacia en vez de cortar la copia a medias.
const tablaNoExiste = (error) => error?.code === 'ER_NO_SUCH_TABLE' || error?.code === '42P01';
const consultarSiExiste = async (origen, sql, tabla) => {
  try {
    return await origen.consultar(sql);
  } catch (error) {
    if (!tablaNoExiste(error)) throw error;
    console.log(`  ${tabla.padEnd(24)} no existe en el origen: se copia vacia`);
    return [];
  }
};

const copiarModelo = async ({ origen, destino, modelo, diferidas, idsPorModelo, omitidas, segundaPasada }) => {
  const tabla = tablaDe(modelo);
  const pk = campoId(modelo);
  const filas = await consultarSiExiste(origen, `SELECT * FROM ${origen.citar(tabla)} ORDER BY ${origen.citar(columnaDe(pk))}`, tabla);
  let datos = filas.map((fila) => convertirFila(modelo, fila, origen.proveedor));

  for (const rel of relacionesConFk(modelo)) {
    const campoFk = rel.relationFromFields[0];
    const escalar = modelo.fields.find((f) => f.name === campoFk);

    if (diferidas.has(campoFk)) {
      datos.forEach((d) => {
        if (d[campoFk] != null) segundaPasada.push({ modelo, id: d[pk.name], campo: campoFk, valor: d[campoFk], tipo: rel.type });
        d[campoFk] = null;
      });
      continue;
    }

    const idsDestino = idsPorModelo.get(rel.type);
    if (!idsDestino) throw new Error(`${modelo.name}.${campoFk} apunta a ${rel.type}, que todavia no se ha copiado (error del orden de carga).`);
    datos = datos.filter((d) => {
      if (d[campoFk] == null || idsDestino.has(d[campoFk])) return true;
      const destinoTabla = tablaDe(porNombre.get(rel.type));
      if (escalar.isRequired) {
        omitidas.push(`${tabla} id=${d[pk.name]}: ${campoFk}=${d[campoFk]} no existe en ${destinoTabla} (fila omitida)`);
        return false;
      }
      omitidas.push(`${tabla} id=${d[pk.name]}: ${campoFk}=${d[campoFk]} no existe en ${destinoTabla} (puesto en NULL)`);
      d[campoFk] = null;
      return true;
    });
  }

  const cliente = destino[nombreCliente(modelo)];
  for (const lote of enLotes(datos)) await cliente.createMany({ data: lote });
  idsPorModelo.set(modelo.name, new Set(datos.map((d) => d[pk.name])));

  console.log(`  ${tabla.padEnd(24)} ${String(datos.length).padStart(6)} de ${String(filas.length).padStart(6)}`);
  return { leidas: filas.length, escritas: datos.length };
};

const rellenarDiferidas = async ({ destino, segundaPasada, idsPorModelo, omitidas }) => {
  let hechas = 0;
  for (const { modelo, id, campo, valor, tipo } of segundaPasada) {
    if (!idsPorModelo.get(modelo.name).has(id)) continue; // la fila se omitio
    if (!idsPorModelo.get(tipo).has(valor)) {
      omitidas.push(`${tablaDe(modelo)} id=${id}: ${campo}=${valor} no existe (puesto en NULL)`);
      continue;
    }
    await destino[nombreCliente(modelo)].update({ where: { [campoId(modelo).name]: id }, data: { [campo]: valor } });
    hechas += 1;
  }
  if (segundaPasada.length) console.log(`  ${'(segunda pasada)'.padEnd(24)} ${String(hechas).padStart(6)} llaves rellenadas`);
};

const copiarM2M = async ({ origen, destino, citar, def, idsPorModelo, omitidas }) => {
  const filas = await consultarSiExiste(origen, `SELECT ${origen.citar('A')} AS "A", ${origen.citar('B')} AS "B" FROM ${origen.citar(def.tabla)} ORDER BY 1, 2`, def.tabla);
  const idsA = idsPorModelo.get(def.modeloA);
  const idsB = idsPorModelo.get(def.modeloB);
  const validas = filas.filter((r) => {
    if (idsA.has(r.A) && idsB.has(r.B)) return true;
    omitidas.push(`${def.tabla}: (${r.A}, ${r.B}) apunta a un registro inexistente (omitida)`);
    return false;
  });
  for (const lote of enLotes(validas)) {
    const valores = Prisma.join(lote.map((r) => Prisma.sql`(${r.A}, ${r.B})`));
    await destino.$executeRaw`INSERT INTO ${Prisma.raw(citar(def.tabla))} (${Prisma.raw(citar('A'))}, ${Prisma.raw(citar('B'))}) VALUES ${valores}`;
  }
  console.log(`  ${def.tabla.padEnd(24)} ${String(validas.length).padStart(6)} de ${String(filas.length).padStart(6)}`);
  return { leidas: filas.length, escritas: validas.length };
};

// ── Programa ────────────────────────────────────────────────────────────────

const main = async () => {
  const archivoRespaldo = leerOpcion('desde-respaldo');
  const desdeSupabase = args.includes('--desde-supabase');
  const sinUrl = Boolean(archivoRespaldo) || desdeSupabase;
  const urlOrigen = sinUrl ? null : leerOpcion('desde') || process.env.ORIGEN_DATABASE_URL;
  if (!sinUrl && !urlOrigen) {
    throw new Error('Falta el origen: --desde "mysql://..." (o ORIGEN_DATABASE_URL en .env), --desde-respaldo respaldo.json.gz o --desde-supabase.');
  }
  if (urlOrigen && !detectarProveedor(urlOrigen)) throw new Error('La URL de origen debe empezar por mysql:// o postgresql://.');
  if (archivoRespaldo && !fs.existsSync(archivoRespaldo)) throw new Error(`No existe el archivo ${archivoRespaldo}.`);

  const proveedorDestino = proveedorActivo(); // valida DATABASE_URL
  const cfgDestino = parsearUrl(process.env.DATABASE_URL, 'DATABASE_URL');
  let cfgOrigen;
  if (archivoRespaldo) cfgOrigen = { host: 'respaldo', database: archivoRespaldo };
  else if (desdeSupabase) cfgOrigen = { host: 'API de Supabase', database: String(process.env.SUPABASE_URL || '').replace(/^https:\/\//, '') };
  else cfgOrigen = parsearUrl(urlOrigen, 'La URL de origen');
  if (!sinUrl && ['host', 'port', 'database'].every((k) => String(cfgOrigen[k]) === String(cfgDestino[k]))) {
    throw new Error('Origen y destino son la misma base. El destino es DATABASE_URL; el origen va en --desde.');
  }

  // Lanza un error claro si el cliente generado no es del proveedor de DATABASE_URL.
  const destino = require('../src/lib/prisma');
  const citar = proveedorDestino === POSTGRES ? (n) => `"${n}"` : (n) => '`' + n + '`';
  let origen;
  if (archivoRespaldo) origen = abrirRespaldo(archivoRespaldo);
  else if (desdeSupabase) {
    origen = abrirSupabase({ url: process.env.SUPABASE_URL, clave: process.env.SUPABASE_SECRET_KEY });
    // Si la API no expone las tablas, cada una pareceria "no existe" y se
    // copiaria todo vacio: mejor parar aqui.
    let usuarios;
    try {
      [{ n: usuarios }] = await origen.consultar('SELECT COUNT(*) AS n FROM usuarios');
    } catch (error) {
      if (error.code === '42P01') throw new Error('La API de Supabase no muestra la tabla usuarios: revisa que la Data API exponga el esquema public.');
      throw error;
    }
    if (!usuarios) throw new Error('Supabase devolvió 0 usuarios: no es la base del CRM o la llave no tiene acceso. No se copia nada.');
    console.log(`Supabase: ${usuarios} usuarios.`);
  } else origen = await abrirOrigen(urlOrigen);
  if (archivoRespaldo) console.log(`Respaldo del ${origen.creado}.`);

  const orden = ordenarModelos();
  const m2m = tablasM2M();
  const tablas = [...orden.map(({ modelo }) => tablaDe(modelo)), ...m2m.map((t) => t.tabla)];
  const contarDestino = (tabla) => contar((sql) => destino.$queryRawUnsafe(sql), citar, tabla);
  const contarOrigen = (tabla) => contar((sql) => consultarSiExiste(origen, sql, tabla).then((f) => (f.length ? f : [{ n: 0 }])), origen.citar, tabla);

  try {
    let totalDestino;
    try {
      totalDestino = (await Promise.all(tablas.map(contarDestino))).reduce((a, b) => a + b, 0);
    } catch (error) {
      throw new Error(`No se pudieron leer las tablas del destino (${error.message}). ¿Ya corriste "npm run db:migrate" con esta DATABASE_URL?`);
    }
    if (totalDestino > 0) {
      if (!REEMPLAZAR) {
        throw new Error(`La base de destino ya tiene ${totalDestino} filas. Vuelve a ejecutar con --reemplazar para borrarlas y copiar de nuevo.`);
      }
      console.log(`Vaciando la base de destino (${totalDestino} filas)...`);
      await vaciarDestino({ destino, citar, orden, m2m });
    }

    console.log(`Copiando de ${origen.proveedor} (${cfgOrigen.host}/${cfgOrigen.database}) a ${proveedorDestino} (${cfgDestino.host}/${cfgDestino.database}):`);
    const idsPorModelo = new Map();
    const omitidas = [];
    const segundaPasada = [];
    const resumen = new Map();

    for (const { modelo, diferidas } of orden) {
      resumen.set(tablaDe(modelo), await copiarModelo({ origen, destino, modelo, diferidas, idsPorModelo, omitidas, segundaPasada }));
    }
    await rellenarDiferidas({ destino, segundaPasada, idsPorModelo, omitidas });
    for (const def of m2m) {
      resumen.set(def.tabla, await copiarM2M({ origen, destino, citar, def, idsPorModelo, omitidas }));
    }
    if (proveedorDestino === POSTGRES) await ajustarSecuencias({ destino, citar });

    if (omitidas.length) {
      console.log(`\nAvisos (${omitidas.length}): filas que apuntaban a registros inexistentes en el origen`);
      omitidas.slice(0, 50).forEach((aviso) => console.log(`  - ${aviso}`));
      if (omitidas.length > 50) console.log(`  ... y ${omitidas.length - 50} mas`);
    }

    // Verificacion: lo que hay en el destino debe ser lo escrito, y lo escrito
    // debe ser lo leido salvo las filas omitidas a proposito.
    console.log('\nVerificacion de conteos (origen -> destino):');
    let diferencias = 0;
    for (const tabla of tablas) {
      const [enOrigen, enDestino] = await Promise.all([contarOrigen(tabla), contarDestino(tabla)]);
      const { escritas } = resumen.get(tabla);
      const conAvisos = omitidas.some((a) => a.startsWith(`${tabla} `) || a.startsWith(`${tabla}:`));
      const ok = enDestino === escritas && (escritas === enOrigen || conAvisos);
      if (!ok) diferencias += 1;
      console.log(`  ${ok ? 'OK ' : '!! '} ${tabla.padEnd(24)} ${String(enOrigen).padStart(6)} -> ${String(enDestino).padStart(6)}`);
    }
    if (diferencias > 0) throw new Error(`${diferencias} tabla(s) no coinciden. Revisa los avisos de arriba.`);
    console.log('\nListo: la base de destino tiene los mismos datos que la de origen.');
  } finally {
    await Promise.allSettled([origen.cerrar(), destino.$disconnect()]);
  }
};

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
