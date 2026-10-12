#!/usr/bin/env node
/**
 * Genera prisma/postgres/schema.prisma a partir de prisma/schema.prisma.
 *
 * La fuente unica del modelo es prisma/schema.prisma (escrita para MySQL).
 * Prisma no admite mas de un proveedor por esquema, asi que la version para
 * PostgreSQL (Supabase, Postgres local) se genera desde ahi con estos cambios:
 *   - datasource: provider postgresql + directUrl (DIRECT_URL, la conexion
 *     directa que usan las migraciones; si falta se usa DATABASE_URL).
 *   - tipos nativos que Postgres no tiene: @db.LongText / MediumText /
 *     TinyText -> @db.Text; @db.*Blob -> @db.ByteA; @db.TinyInt -> @db.SmallInt;
 *     @db.Unsigned* -> entero normal; @db.DateTime(n) -> @db.Timestamp(n).
 * Cualquier otro @db.* que no este en la lista de admitidos hace fallar la
 * generacion a proposito: mejor avisar aqui que dejar un esquema que Postgres
 * no entienda.
 *
 * Lo ejecutan solos scripts/prisma.js (npm run db:generate / db:migrate) y
 * scripts/nueva_migracion_postgres.js. A mano: npm run db:schema:postgres.
 */
const fs = require('fs');
const path = require('path');
const { rutaEsquema, MYSQL, POSTGRES } = require('../src/lib/baseDatos');

const REEMPLAZOS = [
  [/@db\.(LongText|MediumText|TinyText)\b/g, '@db.Text'],
  [/@db\.(LongBlob|MediumBlob|TinyBlob|Blob)\b/g, '@db.ByteA'],
  [/@db\.TinyInt\b(\(\d+\))?/g, '@db.SmallInt'],
  [/[ \t]*@db\.Unsigned(TinyInt|SmallInt|Int|BigInt)\b/g, ''],
  [/@db\.DateTime(\(\d+\))?/g, '@db.Timestamp$1'],
];

// Tipos nativos de Postgres que puede llevar el esquema generado.
const ADMITIDOS = new Set([
  'VarChar', 'Char', 'Text', 'Date', 'Time', 'Timestamp', 'Timestamptz', 'Decimal',
  'ByteA', 'SmallInt', 'Integer', 'BigInt', 'Boolean', 'DoublePrecision', 'Real',
  'Json', 'JsonB', 'Uuid', 'Inet',
]);

const CABECERA = `// ESTE ARCHIVO SE GENERA SOLO: NO LO EDITES. Sale de prisma/schema.prisma
// (la fuente unica del modelo, escrita para MySQL) al correr
// \`npm run db:generate\`, \`npm run db:migrate\` o \`npm run db:schema:postgres\`
// (scripts/generar_schema_postgres.js). Los cambios al modelo van en
// prisma/schema.prisma; las migraciones de Postgres, en prisma/postgres/migrations/.
//
// Diferencias con el esquema MySQL (las aplica el generador):
// - provider postgresql y directUrl: DIRECT_URL es la conexion directa (sin
//   pgbouncer) que usan las migraciones; si falta se usa DATABASE_URL.
// - @db.LongText -> @db.Text y @db.MediumBlob -> @db.ByteA (tipos de MySQL que
//   Postgres no tiene). Los Json van como jsonb.
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}`;

const transformar = (fuente) => {
  const texto = fuente.replace(/\r\n/g, '\n');

  if (!/provider\s*=\s*"mysql"/.test(texto)) {
    throw new Error('prisma/schema.prisma debe tener provider = "mysql": es la fuente unica y de ella se genera la version Postgres.');
  }

  // Sustituye el bloque `datasource db { ... }` y los comentarios pegados
  // encima (que describen la base MySQL) por la cabecera de Postgres.
  const lineas = texto.split('\n');
  const inicioDatasource = lineas.findIndex((l) => /^datasource\s+db\s*\{/.test(l));
  if (inicioDatasource === -1) throw new Error('No se encontro el bloque "datasource db" en prisma/schema.prisma.');
  let finDatasource = inicioDatasource;
  while (finDatasource < lineas.length && !/^\}/.test(lineas[finDatasource])) finDatasource += 1;
  let inicioComentarios = inicioDatasource;
  while (inicioComentarios > 0 && /^\s*\/\//.test(lineas[inicioComentarios - 1])) inicioComentarios -= 1;

  // Los tipos se convierten ANTES de poner la cabecera: esta menciona los
  // nombres de MySQL a modo de explicacion y no debe tocarse.
  let cuerpo = lineas.filter((_l, i) => i < inicioComentarios || i > finDatasource).join('\n');
  for (const [patron, reemplazo] of REEMPLAZOS) cuerpo = cuerpo.replace(patron, reemplazo);

  const desconocidos = [...cuerpo.matchAll(/@db\.([A-Za-z]+)/g)]
    .map((m) => m[1])
    .filter((tipo) => !ADMITIDOS.has(tipo));
  if (desconocidos.length) {
    throw new Error(`El esquema usa tipos nativos sin equivalente en Postgres: ${[...new Set(desconocidos)].map((t) => `@db.${t}`).join(', ')}. Agrega la regla en scripts/generar_schema_postgres.js.`);
  }

  const lineasFinales = cuerpo.split('\n');
  lineasFinales.splice(inicioComentarios, 0, ...CABECERA.split('\n'));
  const resultado = lineasFinales.join('\n');
  return resultado.endsWith('\n') ? resultado : `${resultado}\n`;
};

/** Escribe prisma/postgres/schema.prisma. Devuelve { ruta, cambiado }. */
const generarEsquemaPostgres = () => {
  const origen = rutaEsquema(MYSQL);
  const destino = rutaEsquema(POSTGRES);
  const generado = transformar(fs.readFileSync(origen, 'utf8'));
  let actual = null;
  try { actual = fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n'); } catch (_e) { /* no existe aun */ }
  if (actual === generado) return { ruta: destino, cambiado: false };
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, generado, 'utf8');
  return { ruta: destino, cambiado: true };
};

module.exports = { generarEsquemaPostgres, transformar };

if (require.main === module) {
  try {
    const { ruta, cambiado } = generarEsquemaPostgres();
    console.log(`${cambiado ? 'Actualizado' : 'Sin cambios'}: ${path.relative(process.cwd(), ruta)}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
