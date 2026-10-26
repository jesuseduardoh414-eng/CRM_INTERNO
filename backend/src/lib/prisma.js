// Instancia singleton de Prisma Client.
//
// Se guarda en `globalThis` para que sobreviva al hot-reload de nodemon en
// desarrollo y a la reutilizacion de modulos entre invocaciones en Vercel
// (serverless): sin esto cada recarga creaba un cliente nuevo y se agotaban
// las conexiones de la base.
//
// El cliente generado (`npm run db:generate`) es de UN solo proveedor (MySQL o
// Postgres, segun DATABASE_URL en ese momento; ver lib/baseDatos.js). Antes de
// abrirlo se comprueba que coincida con la DATABASE_URL actual: el error que
// daria Prisma ("the URL must start with the protocol mysql://") no dice que
// hay que volver a generar el cliente.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { proveedorActivo } = require('./baseDatos');

// El esquema de Postgres declara `directUrl` (conexion directa para las
// migraciones). Solo la usa la CLI, pero si falta se usa la misma DATABASE_URL.
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

const proveedorDelClienteGenerado = () => {
  try {
    const esquema = fs.readFileSync(require.resolve('.prisma/client/schema.prisma'), 'utf8');
    return /provider\s*=\s*"(mysql|postgresql)"/.exec(esquema)?.[1] || null;
  } catch (_e) {
    return null;
  }
};

const comprobarClienteGenerado = () => {
  const esperado = proveedorActivo();
  const generado = proveedorDelClienteGenerado();
  if (generado && generado !== esperado) {
    throw new Error(`El cliente de Prisma esta generado para ${generado} pero DATABASE_URL es de ${esperado}. Ejecuta "npm run db:generate" desde backend/ y vuelve a arrancar.`);
  }
};

if (!globalThis.__prismaCrm) comprobarClienteGenerado();

// El cliente que usa todo el CRM anota cada cambio en el registro de
// actividad (services/registroActividad.service.js); el registro escribe con
// el cliente base para no anotarse a si mismo.
const crearCliente = () => {
  const base = new PrismaClient();
  // eslint-disable-next-line global-require
  return base.$extends(require('../services/registroActividad.service').extension(base));
};

const prisma = globalThis.__prismaCrm || crearCliente();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaCrm = prisma;
}

module.exports = prisma;
