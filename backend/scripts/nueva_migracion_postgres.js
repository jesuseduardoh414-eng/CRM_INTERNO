#!/usr/bin/env node
/**
 * Crea una migracion de PostgreSQL con los cambios hechos en prisma/schema.prisma.
 *
 * En MySQL (XAMPP) las migraciones se crean con `npm run db:migrate:dev -- --name X`,
 * que necesita una base sombra que XAMPP si deja crear. Con Supabase no hay
 * base sombra, asi que aqui se calcula la diferencia entre una base Postgres
 * real (con todas las migraciones ya aplicadas) y el esquema nuevo, y se guarda
 * como una migracion mas en prisma/postgres/migrations/. Despues se aplica con
 * `npm run db:migrate` (con DATABASE_URL apuntando a Postgres).
 *
 *   npm run db:migracion:postgres -- nombre_del_cambio
 *   npm run db:migracion:postgres -- nombre_del_cambio --url postgresql://...
 *   npm run db:migracion:postgres -- nombre_del_cambio --desde-git
 *
 *   --url        base Postgres con la que comparar. Si no se pasa, se usa
 *                DIRECT_URL o DATABASE_URL (deben ser postgresql://).
 *   --desde-git  sin base: compara con prisma/postgres/schema.prisma tal como
 *                quedo en el ultimo commit. Vale mientras cada cambio del
 *                modelo se commitee junto con su migracion.
 *
 * Cada cambio del modelo necesita las dos migraciones (MySQL y Postgres) para
 * que el CRM siga pudiendo instalarse en cualquiera de las dos bases.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectarProveedor, rutaEsquema, POSTGRES } = require('../src/lib/baseDatos');
const { generarEsquemaPostgres } = require('./generar_schema_postgres');

const args = process.argv.slice(2);
const leerOpcion = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const nombre = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');

const salir = (mensaje) => {
  console.error(`Error: ${mensaje}`);
  process.exit(1);
};

if (!nombre) salir('Falta el nombre de la migracion. Ejemplo: npm run db:migracion:postgres -- agregar_campo_x');
if (!/^[a-z0-9_]+$/i.test(nombre)) salir('El nombre solo puede llevar letras, numeros y guiones bajos.');

const esquemaPostgres = rutaEsquema(POSTGRES);
const carpetaMigraciones = path.join(path.dirname(esquemaPostgres), 'migrations');
const cli = require.resolve('prisma/build/index.js');

const { cambiado } = generarEsquemaPostgres();
if (cambiado) console.log('prisma/postgres/schema.prisma regenerado desde prisma/schema.prisma');

// ── Con que se compara ───────────────────────────────────────────────────────
let origen;
let descripcionOrigen;
let temporal = null;

if (args.includes('--desde-git')) {
  const git = spawnSync('git', ['show', 'HEAD:./' + path.relative(process.cwd(), esquemaPostgres).split(path.sep).join('/')], {
    encoding: 'utf8',
  });
  if (git.status === 0 && git.stdout.trim()) {
    temporal = path.join(os.tmpdir(), `crm-schema-anterior-${process.pid}.prisma`);
    fs.writeFileSync(temporal, git.stdout, 'utf8');
    origen = ['--from-schema-datamodel', temporal];
    descripcionOrigen = 'prisma/postgres/schema.prisma del ultimo commit';
  } else {
    origen = ['--from-empty'];
    descripcionOrigen = 'una base vacia (no hay version anterior en git)';
  }
} else {
  const url = leerOpcion('url') || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (detectarProveedor(url) !== POSTGRES) {
    salir('Hace falta una base Postgres con la que comparar: pasa --url postgresql://... o pon DATABASE_URL/DIRECT_URL de Postgres. Sin base, usa --desde-git.');
  }
  origen = ['--from-url', url];
  descripcionOrigen = 'la base Postgres indicada';
}

// ── Diferencia ──────────────────────────────────────────────────────────────
const diff = spawnSync(process.execPath, [
  cli, 'migrate', 'diff', ...origen, '--to-schema-datamodel', esquemaPostgres, '--script', '--exit-code',
], { encoding: 'utf8', env: process.env });
if (temporal) fs.rmSync(temporal, { force: true });

// --exit-code: 0 sin cambios, 2 con cambios, otro = error.
if (diff.status === 0) {
  console.log(`Sin cambios: el esquema ya coincide con ${descripcionOrigen}.`);
  process.exit(0);
}
if (diff.status !== 2) {
  process.stderr.write(diff.stderr || diff.stdout || '');
  salir('prisma migrate diff fallo (ver arriba).');
}

// ── Guardar la migracion ────────────────────────────────────────────────────
const ahora = new Date();
const marca = ahora.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const carpeta = path.join(carpetaMigraciones, `${marca}_${nombre}`);
fs.mkdirSync(carpeta, { recursive: true });
const sql = `-- Generada por scripts/nueva_migracion_postgres.js el ${ahora.toISOString().slice(0, 10)}
-- comparando ${descripcionOrigen} con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
${diff.stdout.replace(/\r\n/g, '\n').trim()}
`;
fs.writeFileSync(path.join(carpeta, 'migration.sql'), sql, 'utf8');

console.log(`Migracion creada: ${path.relative(process.cwd(), path.join(carpeta, 'migration.sql'))}`);
console.log('Siguiente paso: revisa el SQL y aplicala con DATABASE_URL de Postgres: npm run db:migrate');
