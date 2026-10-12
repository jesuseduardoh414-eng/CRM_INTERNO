# CRM - Deploy

Este repositorio esta organizado como monorepo con dos proyectos separados:

- `frontend/`: app React + Vite (pensada para Vercel)
- `backend/`: API Express + Prisma sobre **MySQL/MariaDB o PostgreSQL** (pensada
  para Render, Vercel o cPanel; la base puede estar en Supabase, en XAMPP o en
  la MySQL del cPanel)

## Marca (OMNIS)

El CRM usa la identidad **OMNIS · Proyectos Globales**: marino `#10233f` y dorado
`#c9a227`. Los logos listos para la web estan en `frontend/public/brand/`
(horizontal marino y crema, vertical, circulo marino/dorado y `favicon.svg`);
los originales (`.ai` y PNG) estan en `LOGOD/`, fuera del build. Los colores
salen de las variables `--color-primary` / `--color-gold` de
`frontend/src/index.css` (en tema oscuro el primario es el dorado), asi que
para ajustar la paleta basta con tocar ese archivo.

## Base de datos: MySQL o PostgreSQL

El mismo codigo corre sobre las dos bases. **El proveedor lo decide el prefijo
de `DATABASE_URL`** (`mysql://` o `postgresql://`): con eso `npm run db:generate`
y `npm run db:migrate` eligen solos el esquema, la carpeta de migraciones y el
cliente de Prisma (`backend/scripts/prisma.js`).

| | MySQL / MariaDB | PostgreSQL |
|---|---|---|
| Donde | XAMPP en local, MySQL del cPanel | Supabase, Postgres local |
| Esquema | `backend/prisma/schema.prisma` (**la fuente unica**, se edita este) | `backend/prisma/postgres/schema.prisma` (**generado**, no se edita) |
| Migraciones | `backend/prisma/migrations/` | `backend/prisma/postgres/migrations/` |

Prisma solo admite un proveedor por esquema, por eso el de Postgres se genera
a partir del de MySQL (`scripts/generar_schema_postgres.js`: cambia el
`provider`, agrega `directUrl` y traduce `@db.LongText` / `@db.MediumBlob`, que
Postgres no tiene). Se regenera solo en cada `db:generate` / `db:migrate`; a
mano, `npm run db:schema:postgres`. Las dos unicas consultas con SQL propio
de cada base (actividad por mes del inicio y las busquedas sin distinguir
mayusculas) se resuelven en `src/lib/baseDatos.js` y `src/utils/paginacion.utils.js`.

Comandos (desde `backend/`, todos respetan `DATABASE_URL`):

```bash
npm run db:generate              # genera el cliente de Prisma del proveedor actual
npm run db:migrate               # aplica las migraciones pendientes (prisma migrate deploy)
npm run db:status                # que migraciones hay aplicadas
npm run db:migrate:dev -- --name x   # crea una migracion nueva (MySQL en XAMPP)
npm run db:migracion:postgres -- x   # crea la migracion equivalente para Postgres
npm run db:copiar -- --desde URL     # copia los datos de otra base a la de DATABASE_URL
npm run db:studio                # Prisma Studio
```

> Al cambiar `DATABASE_URL` de una base a otra hay que volver a correr
> `npm run db:generate`: el cliente generado es de un solo proveedor y el
> servidor avisa si no coincide.

### Local con XAMPP (MySQL)

1. Arranca MySQL desde el panel de XAMPP.
2. Crea la base (phpMyAdmin o consola):
   ```sql
   CREATE DATABASE crm_interno CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
3. En `backend/.env`: `DATABASE_URL=mysql://root:@localhost:3306/crm_interno`
   (el root de XAMPP no lleva clave por defecto).
4. Desde `backend/`:
   ```bash
   npm install
   npm run db:migrate     # crea las tablas
   npm run db:generate    # cliente de Prisma para MySQL
   npm run dev
   ```

### Supabase (PostgreSQL)

1. Crea el proyecto en [supabase.com](https://supabase.com) y guarda la clave de
   la base. Si reutilizas el proyecto antiguo del CRM (esquema de mayo-agosto
   de 2026), **vacialo primero**: en *SQL Editor* ejecuta
   `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (las migraciones nuevas
   parten de cero; los datos se traen despues con `db:copiar`).
2. En *Project Settings > Database > Connection string* copia las dos
   conexiones del **pooler** (son las que funcionan por IPv4; la "directa"
   `db.PROYECTO.supabase.co` es solo IPv6 y ni Render ni Vercel la alcanzan):
   - *Transaction pooler* (puerto 6543) → `DATABASE_URL`, con `?pgbouncer=true`
     al final (en Vercel ademas `&connection_limit=1`).
   - *Session pooler* (puerto 5432) → `DIRECT_URL` (la usan las migraciones).
   ```env
   DATABASE_URL=postgresql://postgres.PROYECTO:CLAVE@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://postgres.PROYECTO:CLAVE@aws-0-REGION.pooler.supabase.com:5432/postgres
   ```
   Si la clave lleva `@`, `:` o `/`, codificala (`@` = `%40`).
3. Desde `backend/` con ese `.env`:
   ```bash
   npm run db:migrate     # 2 migraciones: esquema completo + RLS
   npm run db:generate
   ```
   La segunda migracion activa *Row Level Security* en todas las tablas: en
   Supabase toda tabla de `public` queda expuesta por su API REST con la clave
   `anon` (publica), y con RLS sin politicas nadie ve nada por ahi. Al backend
   no le afecta (entra como `postgres`, dueño de las tablas). Por lo mismo
   `VITE_ENABLE_REALTIME` debe seguir en `false`.
4. Para traer los datos que hoy estan en XAMPP, ver *Copiar datos entre bases*.

Con un Postgres propio (local o en otro servidor) es lo mismo sin `DIRECT_URL`:
`DATABASE_URL=postgresql://postgres:CLAVE@localhost:5432/crm_interno`.

### Copiar datos entre bases

`backend/scripts/copiar_base.js` copia todas las tablas de una base a otra, en
cualquier combinacion de MySQL y PostgreSQL, conservando ids y fechas. El
**destino es la base de `DATABASE_URL`** (ya migrada y con el cliente generado)
y el origen se pasa con `--desde`. El origen solo se lee.

```bash
# XAMPP -> Supabase (DATABASE_URL apunta a Supabase)
npm run db:copiar -- --desde "mysql://root:@localhost:3306/crm_interno"
# Supabase -> MySQL del cPanel (DATABASE_URL apunta al cPanel)
npm run db:copiar -- --desde "postgresql://postgres.PROYECTO:CLAVE@aws-0-REGION.pooler.supabase.com:5432/postgres"
# si el destino ya tiene datos:
npm run db:copiar -- --desde "..." --reemplazar
```

Las tablas y relaciones salen del esquema de Prisma, asi que no hay listas que
mantener; el orden de carga respeta las llaves foraneas (los ciclos, como
usuarios ↔ empresas, se rellenan en una segunda pasada); en Postgres ajusta las
secuencias al terminar; y acaba comparando los conteos de las dos bases.
Tambien sirve con la Supabase antigua como origen (las columnas que ya no
existen se ignoran, y las tablas que el origen aun no tiene se copian vacias).

### Cambios en el modelo (hay que migrar las dos bases)

1. Edita `backend/prisma/schema.prisma` (la version Postgres se regenera sola).
2. Migracion MySQL, con `DATABASE_URL` de XAMPP:
   `npm run db:migrate:dev -- --name nombre_del_cambio`.
3. Migracion Postgres: `npm run db:migracion:postgres -- nombre_del_cambio`.
   Compara una base Postgres real (`--url ...`, o `DIRECT_URL`/`DATABASE_URL`)
   con el esquema nuevo y guarda el SQL en `prisma/postgres/migrations/`; sin
   base a mano, `--desde-git` compara con el esquema del ultimo commit.
   Revisa el SQL (Prisma no migra datos, solo estructura) y aplicalo con
   `npm run db:migrate`.
4. Commitea el esquema y las dos migraciones juntas.

## Despliegue: Render (API) + Vercel (frontend) + Supabase (base)

### Backend en Render

El archivo `render.yaml` de la raiz describe el servicio: *New > Blueprint* en
Render y elige el repositorio. O creado a mano como *Web Service* con:

- *Root Directory* `backend`, Node 22 (lo fija `engines` del `package.json`).
- *Build command* `npm ci && npm run build` (genera el cliente de Prisma del
  proveedor de `DATABASE_URL`).
- *Start command* `npm run start:render` (aplica las migraciones pendientes y
  arranca; `npm start` solo arranca).
- *Health check path* `/api/health`.
- Variables (detalle en `backend/.env.example`): `DATABASE_URL` y `DIRECT_URL`
  de Supabase (o una `mysql://` accesible por internet), `JWT_SECRET`,
  `AUTH_ENCRYPTION_KEY`, `FRONTEND_URL` (la URL del frontend en Vercel, sin
  barra final), `NODE_ENV=production`, y las de correo o Google si se usan.

A tener en cuenta:

- **Plan gratuito:** el servicio se duerme tras unos minutos sin trafico (la
  primera peticion tarda ~30 s) y **el disco se borra en cada despliegue**:
  adjuntos, fotos de perfil, PDF de contratos y comprobantes de finanzas se
  pierden. Para conservarlos hace falta un disco persistente (de pago) montado
  p. ej. en `/var/data` y `ADJUNTOS_DIR=/var/data/adjuntos`,
  `CONTRATOS_DIR=/var/data/contratos`, `COMPROBANTES_DIR=/var/data/comprobantes`
  (ya va comentado en `render.yaml`).
- Los avisos por correo programados (recordatorios, resumen diario) corren
  mientras el servicio esta despierto.
- Render pone `PORT` y actua de proxy; el servidor ya confia en el
  (`trust proxy`) para que el limite de intentos vea la IP real.

### Frontend en Vercel

- Proyecto nuevo con *Root Directory* = `frontend` (Vite se detecta solo;
  `frontend/vercel.json` ya reescribe las rutas de la SPA a `index.html`).
- Variables (detalle en `frontend/.env.example`):
  - `VITE_API_URL=https://crm-backend.onrender.com/api` (la URL del servicio de
    Render, con `/api` al final)
  - `VITE_GOOGLE_CLIENT_ID` (opcional, Google Calendar en Mi Agenda)
  - `VITE_ENABLE_REALTIME=false` y `VITE_SUPABASE_*` vacias
- En Render, `FRONTEND_URL` debe ser el dominio de produccion de Vercel (lista
  blanca de CORS y base de los enlaces de los correos). Los *preview
  deployments* de Vercel tienen otro dominio y CORS los rechaza.

### Backend en Vercel (alternativa a Render)

`backend/vercel.json` sigue valiendo: proyecto con *Root Directory* `backend`;
`vercel-build` genera el cliente de Prisma del proveedor de `DATABASE_URL`. En
serverless conviene `DATABASE_URL` con `?pgbouncer=true&connection_limit=1`
(Supabase). Limitaciones: Vercel no aplica migraciones (`npm run db:migrate`
desde tu maquina), el disco es de solo lectura (no se pueden subir adjuntos,
contratos ni comprobantes de finanzas) y no corren los avisos programados por correo.

### Produccion en cPanel (MySQL)

1. **MySQL:** en *Bases de datos MySQL* crea la base y un usuario con todos los
   privilegios. cPanel les antepone el prefijo de la cuenta
   (`cuenta_crm`, `cuenta_usuario`).
2. **Backend:** en *Setup Node.js App* crea una aplicacion con Node 22,
   *Application root* = la carpeta donde subiste `backend/` y
   *Application startup file* = `src/server.js`. En *Environment variables*
   define las de `backend/.env.example`, con
   `DATABASE_URL=mysql://cuenta_usuario:CLAVE@localhost:3306/cuenta_crm`
   y `NODE_ENV=production`.
3. Pulsa *Run NPM Install* y luego, desde la terminal de cPanel con el entorno
   de la app activado (el panel muestra el comando `source .../activate`):
   ```bash
   cd backend
   npm run db:migrate
   npm run db:generate
   ```
   Para subir los datos, `npm run db:copiar -- --desde "..."` ahi mismo (o un
   volcado con `mysqldump` importado en phpMyAdmin).
4. **Frontend:** `npm run build` en `frontend/` y sube el contenido de `dist/`
   a `public_html` (o un subdominio). `VITE_API_URL` debe apuntar a la URL
   publica del backend con `/api` al final, y `FRONTEND_URL` del backend a la
   del frontend.
5. Si `prisma generate` falla en el servidor por el motor de consultas, agrega
   el `binaryTargets` que indique el error al bloque `generator` de
   `backend/prisma/schema.prisma` (en cPanel suele ser `rhel-openssl-3.0.x` o
   `rhel-openssl-1.1.x`).

> Las migraciones solo se aplican solas en Render (`start:render`). En el
> resto de entornos: `npm run db:migrate` desde `backend/`.

## Archivos adjuntos y fotos de perfil

Los adjuntos (tareas, proyectos, eventos), las fotos de perfil, los PDF de
contratos y los comprobantes de finanzas se guardan en el **disco del
servidor** (`ADJUNTOS_DIR`, `CONTRATOS_DIR` y `COMPROBANTES_DIR`, por defecto
`backend/storage/`), asi que necesitan un servidor con disco propio: cPanel, o
Render con disco persistente. Los archivos antiguos que quedaron en Vercel
Blob se siguen sirviendo por su URL y se borran con `BLOB_READ_WRITE_TOKEN` si
se elimina el adjunto.

- Limite por archivo configurable en el panel (4 MB si el backend esta en
  Vercel, que corta las peticiones en 4.5 MB). Foto de perfil: 2 MB.
  Comprobantes de pagos y gastos: 10 MB por defecto (`subidas.comprobantesMaxMB`).
- Solo se aceptan tipos conocidos (PDF, imagenes, Office, texto, CSV, JSON,
  ZIP); HTML/SVG/JS quedan fuera a proposito. Los comprobantes solo admiten
  PDF, JPG, PNG y WEBP, y el tipo se comprueba por el contenido del archivo.

## Finanzas (Ventas, Tesoreria y Gastos)

Modulo agregado el 2026-10-12 a partir de la "Carta a Santa Claus":

- **Ventas**: pagos recibidos (cliente, cuenta destino, metodo, comprobante).
- **Tesoreria**: la bolsa de ingresos (pagos registrados en MXN) se reparte en
  partidas creadas libremente (Marketing, Caja chica, Ahorro…). Cada partida
  muestra asignado, gastado, comprometido (gastos pendientes) y disponible.
- **Gastos**: seis categorias (Presupuesto General, Presupuesto Oficina,
  Nomina, Gastos fijos, Gastos variables, Otros) con partida, fecha limite
  (sale en la Agenda mientras este pendiente), comprobantes y "duplicar al
  mes siguiente"; mas el **Informe** meses × partidas (o × categorias) con
  Excel.
- **Permisos por persona**: en Usuarios, el administrador global da a cada
  cuenta un nivel (sin acceso / ver / editar) en Ventas, Tesoreria, cada
  categoria de gastos y el Informe. Se guarda en `usuarios.permisos_finanzas`
  y lo comprueba el servidor en cada peticion (`/api/finanzas`).
- El **portal de clientes se retiro** (el CRM es solo de uso interno): el
  modulo `portalClientes` queda apagado siempre, desaparece de Configuracion
  y las cuentas CLIENTE ya no pueden entrar. Sus tablas y pantallas se
  conservan en el codigo por si vuelve.

Migraciones: `20261012160000_finanzas` (MySQL y Postgres). Solo agregan tablas
y una columna.
