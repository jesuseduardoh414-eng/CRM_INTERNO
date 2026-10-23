# CRM - Deploy

Este repositorio esta organizado como monorepo con dos proyectos separados:

- `frontend/`: app React + Vite
- `backend/`: API Express + Prisma sobre **MySQL/MariaDB o PostgreSQL**

**Produccion: cPanel con MySQL**, en un subdominio del dominio que esta en
Squarespace (`crm.tudominio.com`: frontend y API en el mismo sitio). Guia paso
a paso en [DESPLIEGUE_CPANEL.md](DESPLIEGUE_CPANEL.md). Render, Vercel y
Supabase siguen documentados mas abajo como alternativa.

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

## Despliegue en cPanel (produccion)

Todo en [DESPLIEGUE_CPANEL.md](DESPLIEGUE_CPANEL.md). En corto:

- **DNS:** en Squarespace, un registro `A` `crm` → IP del cPanel (el sitio y
  el correo del dominio no se tocan). En cPanel, el dominio `crm.tudominio.com`
  con AutoSSL.
- **Actualizaciones automaticas:** cada push a `master` despliega por SSH con
  GitHub Actions (`.github/workflows/desplegar-cpanel.yml`: build del frontend,
  rsync, `backend/scripts/tras_desplegar.sh` para npm install / generate /
  migraciones / reinicio con `cloudlinux-selector`). Se activa con el secreto
  `CPANEL_SSH_KEY` y la variable `CPANEL_USER`. Vercel ya no despliega en cada
  push (`git.deploymentEnabled: false`).
- **Paquetes (a mano):** `npm run empaquetar:cpanel` (desde `backend/`) deja en
  `paquete_cpanel/` el frontend compilado con `VITE_API_URL=/api` y su
  `.htaccess` (`frontend/cpanel/.htaccess`: rutas de la SPA, `/api` intacto,
  HTTPS) y el backend sin `node_modules`, `.env` ni `storage/`. El build solo
  del frontend es `npm run build:cpanel` (modo `cpanel`, `frontend/.env.cpanel`).
- **Backend:** *Setup Node.js App* con *Application URL* = `crm.tudominio.com/api`
  (Passenger le pasa la ruta completa, asi que las rutas `/api/...` no cambian),
  *startup file* `src/server.js`, *Run NPM Install* (genera el cliente de
  Prisma) y `db:migrate` con *Run JS script*.
- **Base:** `DATABASE_URL=mysql://CUENTA_crm:CLAVE@localhost:3306/CUENTA_crm?connection_limit=5`
  (el hosting limita las conexiones por usuario). Datos con `db:copiar` desde tu
  PC por *MySQL remoto*, o volcado de solo datos importado en phpMyAdmin.
- **Claves:** `AUTH_ENCRYPTION_KEY` (o `JWT_SECRET` si aquella estaba vacia) debe
  ser la misma del entorno de donde vienen los datos: cifra el 2FA, la clave
  SMTP del panel y los tokens de Google Calendar.
- **Cron** cada 5 minutos a `/api/health`: cPanel duerme la app sin trafico y
  con ella los avisos por correo.

## Alternativa: Render (API) + Vercel (frontend) + Supabase (base)

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

> Las migraciones solo se aplican solas en Render (`start:render`). En el
> resto de entornos: `npm run db:migrate` desde `backend/`.

## Archivos adjuntos y fotos de perfil

Los adjuntos (tareas, proyectos, eventos), las fotos de perfil, los PDF de
contratos, los comprobantes de finanzas, los archivos de las cotizaciones y
los de la base de conocimiento se guardan en el **disco del servidor**
(`ADJUNTOS_DIR`, `CONTRATOS_DIR`, `COMPROBANTES_DIR`, `COTIZACIONES_DIR` y
`CONOCIMIENTO_DIR`, por defecto `backend/storage/`; las dos ultimas, si faltan,
van junto a `COMPROBANTES_DIR` y `ADJUNTOS_DIR`), asi que necesitan un servidor con disco propio: cPanel, o
Render con disco persistente. Los archivos antiguos que quedaron en Vercel
Blob se siguen sirviendo por su URL y se borran con `BLOB_READ_WRITE_TOKEN` si
se elimina el adjunto.

- Limite por archivo configurable en el panel (4 MB si el backend esta en
  Vercel, que corta las peticiones en 4.5 MB). Foto de perfil: 2 MB.
  Comprobantes de pagos y gastos: 10 MB por defecto (`subidas.comprobantesMaxMB`).
- Solo se aceptan tipos conocidos (PDF, imagenes, Office, texto, CSV, JSON,
  ZIP); HTML/SVG/JS quedan fuera a proposito. Los comprobantes solo admiten
  PDF, JPG, PNG y WEBP, y el tipo se comprueba por el contenido del archivo.
  Cotizaciones y base de conocimiento: PDF, imagenes y Office (Word, Excel,
  PowerPoint), tambien comprobados por contenido (`services/documentos.service.js`);
  usan el limite de comprobantes y el de adjuntos respectivamente.
- Adjuntos y fotos se abren por `GET /api/archivos/:carpeta/:nombre` **solo con
  sesion** (cookie httpOnly `crm_archivos`, o el token en las descargas con
  fetch) y con permiso sobre el archivo: fotos, cualquier sesion; adjuntos,
  quien ve la tarea, el proyecto o el evento, quien lo subio, o el cliente si se
  le compartio (`controllers/archivos.controller.js`). Un enlace copiado fuera
  del CRM no funciona; los adjuntos se revalidan en cada uso.

### Google Calendar (en los dos sentidos)

Desde el 2026-10-20, al conectar Google Calendar en su agenda, el CRM crea en
el Google de cada persona un calendario con el nombre del sistema ("OMNIS
CRM") y mueve ahi lo que antes iba a su calendario principal. Lo que se crea,
edita o borra en la agenda llega a ese calendario, y lo que se cambia en ese
calendario desde Google llega a la agenda: `sincronizarDesdeGoogle`
(`services/google-calendar.service.js`) lee los cambios con el `syncToken` de
Google cada 5 minutos para todos (`GOOGLE_CALENDAR_SYNC=off` lo apaga) y al
abrir la agenda (`POST /api/agenda/google-calendar/sync`). Cada evento guarda
el `etag` de la ultima version que el CRM escribio o leyo para no rebotar sus
propios cambios; si los dos lados cambiaron, gana el mas nuevo. Las ediciones
desde el CRM van con PATCH, asi no se pierden los invitados, el Meet o el color
puestos en Google. Repeticiones: semanal y diaria se traducen; las demas
(mensual, cada N semanas, N veces) entran como un solo evento con una nota.
Las ocurrencias editadas sueltas en Google no se copian. Los eventos personales
de los demas calendarios no entran al CRM.

### Google Drive (archivos y respaldo diario)

Desde el 2026-10-16 se puede conectar una cuenta de Google Workspace de la
empresa desde el panel de configuracion (**Google Drive y respaldos**, mismo
cliente OAuth que Google Calendar; desde el 2026-10-20 con permiso `drive`
sobre todo su Drive, antes `drive.file`). Con Drive conectado:

- Los adjuntos de proyectos y tareas van en "Archivos del CRM › Proyectos ›
  proyecto › tarea" con su nombre real y en los dos sentidos
  (`services/driveProyectos.service.js`): su URL es `/api/archivos/drive/<id>`
  y lo que se agrega, renombra, mueve o borra en esas carpetas desde Drive
  cambia el adjunto (lista de cambios de Drive cada 5 minutos,
  `DRIVE_SYNC=off` la apaga, y al abrir los adjuntos). Renombrar o borrar un
  proyecto o tarea renombra o tira su carpeta. Los adjuntos de antes se
  acomodan solos en su carpeta (`ordenarAdjuntos`, o "Ordenar ahora" en el
  panel). Una conexion con el permiso viejo sigue subiendo a las carpetas pero
  no lee lo agregado en Drive hasta reconectar.
- Comprobantes, contratos, cotizaciones, archivos de la base de conocimiento y
  adjuntos de eventos se guardan en una subcarpeta por tipo con su mismo nombre
  interno: la base no cambia. Las
  fotos de perfil siguen en el disco. Al leer se busca en Drive y, si no esta,
  en el disco; si Drive falla al guardar, el archivo va al disco y se sube
  despues. Borrar manda a la papelera de Drive.
- Cada noche (desde las 3:00) se suben los archivos que quedaron en el disco y
  un respaldo completo de la base (`respaldo-AAAA-MM-DD-HHMM.json.gz`, JSON
  portable entre MySQL y Postgres); se conservan 30. Se restaura con
  `npm run db:copiar -- --desde-respaldo archivo.json.gz`.

Codigo: `services/drive.service.js` (API de Drive sin dependencias),
`services/almacenHibrido.service.js` (Drive o disco), `services/respaldo.service.js`
y la tabla `conexion_drive` (migracion `20261018120000_conexion_drive`).
Los pasos de Google Cloud estan en el panel, iguales en Google Drive y en
Google Calendar (`components/configuracion/GuiaGoogleCloud.jsx`: una sola llave
para los dos, caminos Interno/Externo, enlaces directos y valores para copiar)
y resumidos en [DESPLIEGUE_CPANEL.md](DESPLIEGUE_CPANEL.md), paso 13. Para el
camino Externo, Google pide una politica de privacidad: `/privacidad` es
publica (`pages/PrivacidadPage.jsx`).

## Finanzas (Ventas, Tesoreria, Gastos y Cotizaciones)

Modulo agregado el 2026-10-12 a partir de la "Carta a Santa Claus":

- **Ventas**: pagos recibidos (cliente, cuenta destino, metodo, comprobante).
- **Tesoreria**: la bolsa de ingresos (pagos registrados en MXN) y el
  **presupuesto mensual de cada categoria de gastos**, que sale de esa bolsa
  (desde el 2026-10-14; antes eran partidas libres, que quedaron archivadas
  como historial). Cada categoria muestra presupuesto, gastado, pendiente y
  remanente. Reglas (`backend/src/services/presupuestos.service.js`): en un
  mes abierto (el actual o uno futuro) la categoria aparta de la bolsa su
  presupuesto, o lo ya gastado si se paso; al cerrar el mes solo cuenta lo
  gastado y el remanente vuelve a la bolsa. No se puede presupuestar mas de lo
  que hay sin asignar; un gasto sin presupuesto sale directo de la bolsa.
- **Gastos**: seis categorias (Presupuesto General, Presupuesto Oficina,
  Nomina, Gastos fijos, Gastos variables, Otros) con fecha limite (sale en la
  Agenda mientras este pendiente), comprobantes y "duplicar al mes
  siguiente". Cada gasto descuenta del presupuesto de su categoria en el mes
  de su fecha; la pantalla y el formulario muestran cuanto queda. El
  **Informe** compara presupuesto contra gastado (un mes o el año, con
  Excel) y tiene la tabla de lo gastado meses × categorias (y × partidas
  anteriores, si las hubo).
- **Permisos**: casillas `finanzas.*` de la tabla por area y de los ajustes
  por persona (ver la seccion **Permisos** mas abajo): ventas y cada
  categoria de gastos con ver / registrar / editar / eliminar, tesoreria con
  ver / editar, el informe con ver. De fabrica nadie tiene nada salvo el
  administrador general. Lo comprueba el servidor en cada peticion
  (`/api/finanzas`). Los niveles por persona anteriores
  (`usuarios.permisos_finanzas`) siguen contando hasta que se guardan los
  nuevos.
- El **portal de clientes se retiro** (el CRM es solo de uso interno): el
  modulo `portalClientes` queda apagado siempre, desaparece de Configuracion
  y las cuentas CLIENTE ya no pueden entrar. Sus tablas y pantallas se
  conservan en el codigo por si vuelve.

- **Cotizaciones** (2026-10-16): recibidas de proveedores o enviadas a
  clientes, con estado (pendiente, aprobada, rechazada). Cada archivo es una
  **version que no se reemplaza ni se borra**: la 1 es la original y los
  cambios se suben como versiones nuevas con su monto y una nota de que
  cambio. La ficha muestra cuanto cambio contra la original y la anterior, y
  compara lado a lado la original con cualquier version. Permisos
  `finanzas.cotizaciones.*`: ver, crear (subir cotizaciones y versiones),
  editar (corregir datos), aprobar (cambiar el estado) y eliminar; de
  fabrica solo el administrador general corrige, aprueba y elimina.

Migraciones: `20261012160000_finanzas` (tablas y una columna),
`20261014120000_presupuestos_categoria` (tabla `presupuestos_categoria` y
archiva las partidas) y `20261016120000_cotizaciones_conocimiento`, en MySQL
y Postgres.

## Base de conocimiento

Seccion del menu principal (modulo `conocimiento`, se apaga en el panel de
configuracion): articulos con titulo, categoria, resumen, texto con formato
basico tipo Markdown (titulos, negritas, cursivas, listas, citas, enlaces,
codigo; se pinta como elementos de React, nunca como HTML) y archivos
adjuntos, con buscador y filtro por categoria. De fabrica los
**administradores** escriben, editan, destacan o dejan como borrador y **todo
el equipo** lee (permisos `conocimiento.*`, configurables por area).
Rutas: `/api/conocimiento` (`controllers/conocimiento.controller.js`).

- **Subir documentos:** varios archivos de una vez; cada uno queda como un
  articulo propio con su titulo y su categoria (`POST /api/conocimiento/documentos`).
- **Quien ve cada cosa** (permiso `conocimiento.acceso`, de fabrica los
  administradores): un articulo es de todo el equipo o solo de quienes se
  elijan, y cada archivo puede limitarse aun mas. Una regla es una persona,
  toda un area, solo administradores o solo miembros de un area, o los de
  todas las areas. Siempre ven el administrador general, quien escribio el
  articulo y quien subio cada archivo. Lo demas responde 404 y no aparece en
  la lista, las categorias, los conteos ni la busqueda
  (`utils/accesoConocimiento.utils.js`, tabla `accesos_conocimiento`,
  migracion `20261021150000_acceso_conocimiento`).

## Permisos (por area y por persona)

Desde el 2026-10-16 lo que puede hacer cada persona se configura, no esta fijo
en el codigo:

- **Por area** (panel de configuracion → Roles y permisos): para cada area una
  tabla con dos columnas, **Miembros** y **Administradores del area**, con
  casillas si/no o de alcance (*no* / *los suyos* = donde participa / *su
  area* / *todos*) en proyectos, tareas, agenda, clientes, contratos,
  reportes, usuarios, base de conocimiento y finanzas. Se guarda en la
  configuracion (`permisosAreas`, solo lo distinto de fabrica).
- **Por persona** (Usuarios → menu de la persona → Permisos, solo el
  administrador general): excepciones sobre lo que hereda de su area, en
  `usuarios.permisos`.
- El **administrador general** (ADMIN del area de Administracion) siempre puede
  todo y no se configura. Solo el puede invitar o ascender administradores y
  editar o desactivar a otros administradores.
- **Valores de fabrica**: reproducen el comportamiento anterior a esta tabla
  (los interruptores viejos del panel para miembros se toman como punto de
  partida).

Codigo: catalogo y resolucion en `backend/src/utils/permisosArea.utils.js`
(`puede`, `alcanceDe`, `requiere(clave)` en las rutas); el servidor manda
los permisos ya resueltos en `usuario.permisos` y el frontend los lee con
`frontend/src/utils/permisos.js` para mostrar u ocultar menus y botones.
Migracion: `20261017120000_permisos_por_area` (MySQL y Postgres).

## Cuentas de configuracion y administradores

- La **cuenta de configuracion** (rol `CONFIGURADOR`) solo entra al panel de
  configuracion; no ve proyectos ni datos de la empresa. La **primera** se crea
  por consola, desde `backend/`:
  `npm run crear-configurador -- --email config@empresa.com --nombre "Configuracion"`
  (contrasena aleatoria que se muestra una vez; `--restablecer` le da otra y
  le quita la verificacion en dos pasos, por si se perdio el telefono).
- **Administradores y cuentas de configuracion necesitan siempre la
  verificacion en dos pasos** (`utils/politicas.utils.js`, desde el
  2026-10-23): sin ella solo pueden activarla. El panel solo decide si tambien
  la necesitan los miembros.
- Desde el panel (**Usuarios y seguridad**) el configurador invita por correo:
  - **Administradores**, eligiendo el area. Con el area Administracion es el
    **administrador general**.
  - **Otras cuentas de configuracion** (desde el 2026-10-21). Sin area: llevan
    la general, como las del script.
  Si el correo no sale, el panel muestra el enlace para copiarlo. En ambas
  listas puede reenviar o eliminar invitaciones, mandar un enlace de nueva
  contrasena, desbloquear, quitar la 2FA, cerrar sesiones y desactivar (siempre
  queda al menos una cuenta activa de cada tipo; la propia se gestiona en
  **Mi cuenta**).
- Las invitaciones de configuracion no aparecen en **Usuarios** ni se pueden
  reenviar o borrar desde ahi. Si el equipo invita al mismo correo, se guarda
  aparte y gana la primera que se acepte. La lista de invitaciones de Usuarios
  ya no devuelve el token.

Codigo: `backend/src/controllers/configuracionSistema.controller.js`
(`/api/configuracion/administradores` y `/api/configuracion/configuradores`),
aceptacion en `auth.controller.js` (`aceptarInvitacion`), plantilla de correo
`invitacionConfiguracion`; panel en
`frontend/src/components/configuracion/SeccionesSistema.jsx` (`Cuentas`).

## Seguridad

Auditoria del 2026-10-23 (detalle en `CONTEXTO_TRABAJO.md`, seccion 7). Donde
vive cada defensa:

- **Sesion:** access token de 15 min (Authorization) y refresh token rotatorio
  en la cookie httpOnly `crm_refresh` (`Path=/api/auth`, `SameSite=Strict`);
  el JavaScript no lo ve. En localStorage solo queda la marca `crm_refresh=cookie`.
  Archivos con la cookie `crm_archivos`. Todo en `services/sesiones.service.js`.
- **2FA** obligatoria para administradores y configuracion (ver arriba).
- **Contrasenas** con bcrypt, bloqueo progresivo y comprobacion contra
  filtraciones (HIBP); tokens de recuperacion, refresh e invitacion guardados
  como SHA-256; 2FA, SMTP, Drive y Calendar cifrados con `AUTH_ENCRYPTION_KEY`
  (ver la nota sobre las claves en `DESPLIEGUE_CPANEL.md` antes de cambiarla).
- **Limites de peticiones** (`middlewares/rateLimit.middleware.js`): login,
  2FA, recuperacion y un techo general de 2000 peticiones cada 5 min por
  persona (1000 por IP sin sesion).
- **Entrada:** CORS con lista blanca, parametros de URL solo como texto
  (`query parser: simple`), subidas con tipos y tamanos cerrados (multer 2),
  Excel con rango recortado, validacion de correo sin retroceso cuadratico.
- **Navegador:** CSP, HSTS y Permissions-Policy de la SPA en
  `frontend/cpanel/.htaccess`; el build cambia `__CSP_SCRIPTS__` por los hashes
  de los scripts en linea de `index.html`. Un script o servicio externo nuevo
  hay que agregarlo a la CSP. La API lleva las cabeceras de helmet.
- **Bitacora** (`eventos_seguridad`): accesos, 2FA, sesiones y los cambios de
  rol, areas, permisos y estado hechos por otra persona; cada quien la ve en
  Perfil › Seguridad.
