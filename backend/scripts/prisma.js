#!/usr/bin/env node
/**
 * Lanza la CLI de Prisma con el esquema que toca segun DATABASE_URL:
 *   mysql://       -> prisma/schema.prisma            (migraciones en prisma/migrations)
 *   postgresql://  -> prisma/postgres/schema.prisma   (migraciones en prisma/postgres/migrations;
 *                     el esquema se regenera antes desde prisma/schema.prisma)
 *
 * Asi `npm run db:generate` y `npm run db:migrate` hacen lo correcto en XAMPP,
 * cPanel, Render, Vercel o Supabase sin tocar nada. Para forzar el proveedor
 * sin URL: DB_PROVIDER=mysql|postgresql.
 *
 *   node scripts/prisma.js generate
 *   node scripts/prisma.js migrate deploy
 *   node scripts/prisma.js migrate status
 *   node scripts/prisma.js migrate dev --name cambio   (MySQL en local; para Postgres
 *                                                      usa scripts/nueva_migracion_postgres.js)
 *   node scripts/prisma.js studio
 */
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');
const { proveedorActivo, rutaEsquema, POSTGRES } = require('../src/lib/baseDatos');
const { generarEsquemaPostgres } = require('./generar_schema_postgres');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Uso: node scripts/prisma.js <comando de prisma> [opciones]   (p. ej. generate, migrate deploy, studio)');
  process.exit(1);
}
if (args.some((a) => a === '--schema' || a.startsWith('--schema='))) {
  console.error('No pases --schema: este script lo elige segun DATABASE_URL.');
  process.exit(1);
}

let proveedor;
try {
  proveedor = proveedorActivo();
} catch (error) {
  console.error(`[prisma] ${error.message}`);
  process.exit(1);
}

if (proveedor === POSTGRES) {
  const { cambiado } = generarEsquemaPostgres();
  if (cambiado) console.log('[prisma] prisma/postgres/schema.prisma regenerado desde prisma/schema.prisma');
}

// El esquema Postgres declara directUrl; sin conexion directa se usa la normal.
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

const esquema = rutaEsquema(proveedor);
console.log(`[prisma] proveedor ${proveedor} · esquema ${path.relative(process.cwd(), esquema)}`);

const resultado = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args, '--schema', esquema], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(resultado.status === null ? 1 : resultado.status);
