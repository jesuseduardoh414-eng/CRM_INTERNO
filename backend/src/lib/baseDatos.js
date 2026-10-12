/**
 * Proveedor de base de datos (MySQL o PostgreSQL) segun DATABASE_URL.
 *
 * El CRM corre igual sobre MySQL/MariaDB (XAMPP, cPanel) que sobre PostgreSQL
 * (Supabase, Postgres local). Prisma solo admite un proveedor por esquema, asi
 * que hay dos: `prisma/schema.prisma` (MySQL, la fuente unica que se edita) y
 * `prisma/postgres/schema.prisma` (generado a partir del primero por
 * scripts/generar_schema_postgres.js), cada uno con su carpeta `migrations`.
 *
 * Este modulo no depende de nada (ni de @prisma/client) porque lo usan los
 * scripts que corren ANTES de generar el cliente (scripts/prisma.js).
 *
 * Se puede forzar con DB_PROVIDER=mysql|postgresql; si no, se deduce del
 * prefijo de la URL (mysql:// o postgresql://, que es lo que exige Prisma).
 */
const path = require('path');

const MYSQL = 'mysql';
const POSTGRES = 'postgresql';

const detectarProveedor = (url) => {
  const texto = String(url || '').trim();
  if (/^mysql:\/\//i.test(texto)) return MYSQL;
  if (/^postgres(ql)?:\/\//i.test(texto)) return POSTGRES;
  return null;
};

const normalizarProveedor = (valor) => {
  const v = String(valor || '').trim().toLowerCase();
  if (['mysql', 'mariadb'].includes(v)) return MYSQL;
  if (['postgres', 'postgresql', 'supabase', 'pg'].includes(v)) return POSTGRES;
  return null;
};

let enCache = null;

/** 'mysql' | 'postgresql'. Lanza un error claro si no se puede saber. */
const proveedorActivo = () => {
  if (enCache) return enCache;
  if (process.env.DB_PROVIDER) {
    const forzado = normalizarProveedor(process.env.DB_PROVIDER);
    if (!forzado) throw new Error(`DB_PROVIDER="${process.env.DB_PROVIDER}" no es valido: usa mysql o postgresql.`);
    enCache = forzado;
    return forzado;
  }
  const detectado = detectarProveedor(process.env.DATABASE_URL);
  if (!detectado) {
    throw new Error('DATABASE_URL debe empezar por mysql:// (MySQL/MariaDB) o postgresql:// (Postgres/Supabase). Revisa backend/.env.example.');
  }
  enCache = detectado;
  return detectado;
};

const esPostgres = () => proveedorActivo() === POSTGRES;
const esMysql = () => proveedorActivo() === MYSQL;

const DIRECTORIO_PRISMA = path.resolve(__dirname, '../../prisma');

/** Ruta absoluta del schema.prisma del proveedor (junto a el vive `migrations/`). */
const rutaEsquema = (proveedor = proveedorActivo()) => (proveedor === POSTGRES
  ? path.join(DIRECTORIO_PRISMA, 'postgres', 'schema.prisma')
  : path.join(DIRECTORIO_PRISMA, 'schema.prisma'));

module.exports = {
  MYSQL,
  POSTGRES,
  DIRECTORIO_PRISMA,
  detectarProveedor,
  normalizarProveedor,
  proveedorActivo,
  esPostgres,
  esMysql,
  rutaEsquema,
};
