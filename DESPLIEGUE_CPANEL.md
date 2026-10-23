# Subir el CRM a cPanel (MySQL) con el dominio en Squarespace

Guía paso a paso para dejar el CRM en producción en un hosting con cPanel,
usando la MySQL del propio cPanel y un subdominio del dominio que está en
Squarespace. Datos de este despliegue:

- Dominio: `omnispg.com`, en Squarespace. El CRM queda en **`crm.omnispg.com`**.
  Su correo es de Google Workspace y no se toca.
- Hosting: **Verpex**. Si tu acceso es de revendedor (WHM, donde se crean
  usuarios), se crea una cuenta de cPanel solo para el CRM (paso 1).
- `CUENTA` es el usuario de esa cuenta de cPanel: cámbialo por el real.

## Cómo queda montado

```
crm.omnispg.com  (registro A en Squarespace -> IP del servidor de Verpex)
├── /         frontend: archivos estáticos que sirve el servidor web  (~/public_html)
└── /api/...  backend: aplicación de "Setup Node.js App"              (~/crm_backend)
                └── MySQL del cPanel (localhost)
Archivos subidos (adjuntos, contratos, comprobantes):                  ~/crm_archivos
  o, con Google Drive conectado (paso 13): Drive de la empresa, carpeta "Archivos del CRM"
Respaldo diario de la base (paso 13):          Drive, "Archivos del CRM / Respaldos"
```

- **Un solo subdominio para todo.** El frontend llama a la API por `/api`
  (mismo origen): un solo certificado SSL, sin CORS entre dominios.
- **Squarespace solo apunta el subdominio.** El sitio web y el correo del
  dominio (si los tienes en Squarespace, Google Workspace, etc.) no se tocan:
  se agrega un único registro DNS.
- El código ya funciona con MySQL. `backend/prisma/schema.prisma` es el esquema
  MySQL y `prisma/migrations/` sus migraciones. El soporte de PostgreSQL se
  conserva; entre otras cosas, sirve para copiar los datos desde Supabase (paso 6).

## Antes de empezar

- Acceso a **Verpex** (WHM o cPanel) y a la cuenta de **Squarespace** donde
  está el dominio.
- En tu PC: este repositorio con `npm install` hecho en `backend/` y `frontend/`.
- Los valores de **`JWT_SECRET` y `AUTH_ENCRYPTION_KEY`** del entorno de donde
  vienen los datos. Si los datos vienen de Vercel/Supabase, están en Vercel →
  proyecto del backend → *Settings → Environment Variables*. Si vienen de
  XAMPP, están en tu `backend/.env`. Hacen falta en el paso 5.

> **Sobre los dominios `.mx`.** El 14 de octubre de 2026, `omnispg.com.mx` y
> `omnispg.mx` estaban suspendidos por el registrador porque falta verificar el
> correo del titular (nameservers `ns1/ns2.emailverification.info`; el panel
> de Squarespace los muestra como "Activo" de todos modos). Por eso el CRM va
> en `omnispg.com`, que funciona. Para reactivarlos, el titular tiene que
> abrir el correo de verificación del dominio o pedir a Squarespace que lo
> reenvíe; se comprueba con `nslookup -type=NS omnispg.com.mx 8.8.8.8`.

## 1. Cuenta de cPanel en Verpex

Con acceso de revendedor (**WHM**):

1. WHM → **Account Functions → Create a New Account**:
   - *Domain*: `crm.omnispg.com`. Así, la cuenta solo maneja el CRM y no
     intercepta el correo de `omnispg.com` (Google Workspace).
   - *Username*: por ejemplo `crmempresa` (es el `CUENTA` de esta guía).
   - Contraseña y correo de contacto; un paquete con al menos 2–3 GB de disco.
2. Al crearla, WHM muestra la **IP** de la cuenta (también sale en cPanel,
   barra lateral *Información general* → *Dirección IP compartida*). Anótala
   para el paso 2.
3. Entra a la cuenta (WHM → *List Accounts* → botón **CP**) y busca **Node**
   en el buscador de cPanel. **Tiene que aparecer *Setup Node.js App***, con
   Node.js 22 (si solo hay 20, debería funcionar, pero no se ha probado). La
   tabla de precios de Verpex no marca Node.js en sus planes de revendedor: si
   no aparece, pide al soporte de Verpex que lo active en esa cuenta. Si no
   pueden, el backend necesita otro plan (su hosting web con Node.js) o
   quedarse en Render/Vercel.

Si en lugar de WHM entras directo a un **cPanel** que ya tiene otro dominio,
crea ahí el subdominio: **Dominios** → **Crear un nuevo dominio** →
`crm.omnispg.com`, desmarca **Compartir la raíz del documento** y, en el
resto de la guía, usa su carpeta (`~/crm.omnispg.com`) donde dice
`public_html`.

## 2. DNS en Squarespace y certificado

1. En Squarespace: **Dominios** → `omnispg.com` → **DNS** → **Configuración
   de DNS** (*DNS Settings*). Squarespace administra los dominios desde la
   cuenta: el menú de dominios está en la configuración del sitio o en
   `account.squarespace.com/domains`.
2. En **Registros personalizados** (*Custom records*) → **Agregar registro**:

   | Tipo | Host | Datos | TTL |
   |---|---|---|---|
   | `A` | `crm` | IP del paso 1 | el que venga |

3. Guarda. **No borres ni cambies los demás registros**: los predeterminados
   de Squarespace mantienen el sitio web, y los `MX` y el `TXT` de SPF
   mantienen el correo de Google Workspace.
4. Comprueba desde tu PC (puede tardar de minutos a unas horas):
   ```powershell
   nslookup crm.omnispg.com 8.8.8.8
   ```
   Debe responder con la IP de Verpex.
5. En cPanel → **Estado de SSL/TLS** (*SSL/TLS Status*) → marca
   `crm.omnispg.com` → **Ejecutar AutoSSL**. Al terminar,
   `https://crm.omnispg.com` debe abrir sin aviso de seguridad.

## 3. Base de datos MySQL

1. cPanel → **Asistente de bases de datos MySQL** (*MySQL Database Wizard*):
   - Base: `crm` → cPanel la llama `CUENTA_crm`.
   - Usuario: `crm` → `CUENTA_crm`. Genera una contraseña larga. Si lleva
     `@ : / # ? %`, en la URL de abajo hay que codificarlos (`@` = `%40`,
     `:` = `%3A`, `/` = `%2F`, `#` = `%23`, `?` = `%3F`, `%` = `%25`). Lo más
     cómodo es usar solo letras y números.
   - Privilegios: **TODOS** (*ALL PRIVILEGES*).
2. La conexión queda así (anótala para el paso 5):
   ```
   mysql://CUENTA_crm:CLAVE@localhost:3306/CUENTA_crm?connection_limit=5
   ```
   `connection_limit=5` evita que Prisma abra más conexiones de las que el
   hosting permite por usuario. Sin ese parámetro, Prisma calcula el máximo
   según los núcleos del servidor, que en un hosting compartido son muchos.

## 4. Preparar los archivos (en tu PC)

```powershell
cd backend
npm run empaquetar:cpanel
```

Compila el frontend para cPanel (API en `/api` e incluye el `.htaccess`) y deja
dos archivos en `paquete_cpanel/`:

- `crm-frontend.zip`: el contenido de `public_html`.
- `crm-backend.zip`: el backend sin `node_modules`, `.env` ni `storage/`.

## 5. Backend: aplicación Node.js

1. **Administrador de archivos** → en `/home/CUENTA` crea la carpeta
   `crm_backend` (fuera de `public_html`) →
   **Cargar** `crm-backend.zip` → clic derecho → **Extraer** → borra el zip.
2. **Setup Node.js App** → **Create Application**:

   | Campo | Valor |
   |---|---|
   | Node.js version | `22.x` |
   | Application mode | `Production` |
   | Application root | `crm_backend` |
   | Application URL | `crm.omnispg.com` / **`api`** |
   | Application startup file | `src/server.js` |

   La URL **debe** terminar en `api`. El backend atiende `/api/...` y cPanel le
   pasa la ruta completa.

3. En la misma pantalla, en **Environment variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | la del paso 3 |
   | `JWT_SECRET` | ver la nota de abajo |
   | `AUTH_ENCRYPTION_KEY` | ver la nota de abajo |
   | `FRONTEND_URL` | `https://crm.omnispg.com` (sin `/` al final) |
   | `REGISTRO_MODO` | `cerrado` |
   | `ADJUNTOS_DIR` | `/home/CUENTA/crm_archivos/adjuntos` |
   | `CONTRATOS_DIR` | `/home/CUENTA/crm_archivos/contratos` |
   | `COMPROBANTES_DIR` | `/home/CUENTA/crm_archivos/comprobantes` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | solo si se usa Google Calendar |

   El resto de variables opcionales está en `backend/.env.example`. Las
   carpetas de archivos se crean solas; las de cotizaciones y de la base de
   conocimiento quedan en `crm_archivos/cotizaciones` y
   `crm_archivos/conocimiento` sin configurar nada más.

   > **Nota sobre las claves.** Con `AUTH_ENCRYPTION_KEY` se cifran la
   > verificación en dos pasos de cada usuario, la contraseña SMTP guardada en
   > el panel y la conexión con Google Calendar. Si esa variable está vacía, la
   > clave se deriva de `JWT_SECRET`. Por eso:
   > - **Si traes datos** (paso 6): copia `AUTH_ENCRYPTION_KEY` **idéntica** a
   >   la del entorno de origen. Si allí estaba vacía, copia `JWT_SECRET`
   >   idéntico y deja `AUTH_ENCRYPTION_KEY` vacía. Con otra clave, el 2FA, el
   >   SMTP y Google Calendar dejan de funcionar.
   > - **Si empiezas de cero**: genera las dos (distintas) con
   >   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
   > - **Si `JWT_SECRET` es corto** (el servidor avisa al arrancar si tiene
   >   menos de 32 caracteres) y `AUTH_ENCRYPTION_KEY` está vacía, cámbialo
   >   **en este orden** para no perder lo cifrado: (1) pon en
   >   `AUTH_ENCRYPTION_KEY` el valor actual de `JWT_SECRET` seguido de
   >   `|cifrado-2fa` (por ejemplo `miSecretoViejo|cifrado-2fa`: da la misma
   >   clave que antes); (2) pon en `JWT_SECRET` uno nuevo de 48 bytes con el
   >   comando de arriba; (3) **Restart**. Todos tendrán que volver a iniciar
   >   sesión (las sesiones se firman con `JWT_SECRET`); el 2FA, el SMTP y
   >   Google siguen funcionando.

4. **Create**. Después, en la página de la aplicación:
   1. **Run NPM Install**. Instala las dependencias y genera el cliente de
      Prisma para MySQL.
   2. **Run JS script** → elige `db:migrate`. Crea las tablas.
   3. **Restart**.

   Si tu cPanel no tiene *Run JS script*, usa **Terminal**. La página de la
   aplicación muestra arriba el comando `source .../activate` exacto:
   ```bash
   source /home/CUENTA/nodevenv/crm_backend/22/bin/activate && cd ~/crm_backend
   npm run db:migrate
   ```
5. Abre `https://crm.omnispg.com/api/health`. Debe responder
   `{"ok":true,"mensaje":"Servidor CRM funcionando"}`.

## 6. Pasar los datos

Elige de dónde vienen:

- **Supabase**, si el equipo ha estado usando la versión de Vercel. Usa la
  URL del *Session pooler* (puerto 5432), que es la `DIRECT_URL` del backend
  en Vercel.
- **XAMPP**: `mysql://root:@localhost:3306/crm_interno`.

### Opción A (recomendada): copiar directo desde tu PC

1. cPanel → **MySQL remoto** (*Remote MySQL*) → agrega tu IP pública (búscala
   en Google con "cuál es mi IP").
2. En PowerShell, desde `backend/`:
   ```powershell
   $env:DATABASE_URL = "mysql://CUENTA_crm:CLAVE@IP_DEL_SERVIDOR:3306/CUENTA_crm"
   npm run db:status      # debe decir que la base esta al dia (paso 5)
   npm run db:copiar -- --desde "URL_DE_ORIGEN"
   Remove-Item Env:DATABASE_URL
   ```
   La copia conserva ids y fechas y al final compara los conteos de cada
   tabla. Si la base del cPanel ya tiene datos (una prueba anterior), agrega
   `--reemplazar`. El cliente de Prisma de tu PC debe ser el de MySQL, que es
   lo normal si tu `.env` apunta a XAMPP. Si no, corre antes `npm run db:generate`
   con esa misma `DATABASE_URL`, con el backend local detenido.
3. Quita tu IP de **MySQL remoto** al terminar.

### Opción B: sin MySQL remoto (phpMyAdmin)

1. Si el origen es Supabase, cópialo primero a una base vacía de XAMPP:
   ```powershell
   C:\xampp\mysql\bin\mysql.exe -uroot -e "CREATE DATABASE crm_para_cpanel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
   $env:DATABASE_URL = "mysql://root:@localhost:3306/crm_para_cpanel"
   npm run db:migrate
   npm run db:copiar -- --desde "URL_DE_SUPABASE"
   Remove-Item Env:DATABASE_URL
   ```
   Si el origen es XAMPP, usa directamente `crm_interno` en lugar de
   `crm_para_cpanel`.
2. Exporta solo los datos. Las tablas ya existen en el cPanel desde el paso 5:
   ```powershell
   C:\xampp\mysql\bin\mysqldump.exe -uroot --no-create-info --skip-triggers --complete-insert --hex-blob --default-character-set=utf8mb4 --ignore-table=crm_para_cpanel._prisma_migrations --result-file=crm_datos.sql crm_para_cpanel
   ```
3. cPanel → **phpMyAdmin** → base `CUENTA_crm` → **Importar** → `crm_datos.sql`.

### Archivos

Los datos de Vercel no traen archivos: Vercel no guarda nada en disco, y los
adjuntos antiguos de Vercel Blob se siguen viendo por su URL. Si los datos
vienen de XAMPP, sube también el contenido de `backend/storage/` (`adjuntos`,
`contratos`, `comprobantes`) a `/home/CUENTA/crm_archivos/`, en carpetas con
los mismos nombres.

Ojo con los adjuntos: `ADJUNTOS_DIR` apunta a `crm_archivos/adjuntos` y el
CRM agrega dentro sus propias carpetas `adjuntos/` y `perfiles/`, así que un
adjunto debe quedar en `crm_archivos/adjuntos/adjuntos/<uuid>.pdf` (como en
`backend/storage/adjuntos/adjuntos/` de tu PC). Un nivel más arriba da 404:
el 2026-10-20 hubo que mover así los 6 adjuntos copiados de Supabase.

## 7. Frontend

1. **Administrador de archivos** → **Configuración** → marca **Mostrar archivos
   ocultos** (*Show Hidden Files*). Así se ve el `.htaccess`.
2. Entra en `/home/CUENTA/public_html`. Borra lo que haya puesto cPanel
   por defecto (un `index.html` o `default.htm`), **excepto las carpetas
   `api/` y `cgi-bin/`**. `api/` la creó el paso 5 y conecta `/api` con Node.js.
3. **Cargar** `crm-frontend.zip` → **Extraer** (si pregunta, sobrescribe el
   `.htaccess` que hubiera) → borra el zip. Debe quedar `index.html`,
   `.htaccess`, `assets/`, `brand/` y `api/`.
4. Abre `https://crm.omnispg.com` e inicia sesión.

## 8. Mantener la aplicación despierta

cPanel detiene la aplicación Node.js tras unos minutos sin visitas. Mientras
está detenida no salen los recordatorios ni el resumen diario por correo (se
ponen al día cuando vuelve a arrancar). Para evitarlo, cPanel → **Trabajos de
cron** (*Cron Jobs*) → **Una vez cada cinco minutos**, con el comando:

```bash
curl -fsS -o /dev/null https://crm.omnispg.com/api/health >/dev/null 2>&1
```

## 9. Comprobar que todo funciona

- [ ] `https://crm.omnispg.com/api/health` responde `ok`.
- [ ] Inicias sesión y, al recargar una página interna (p. ej. `/finanzas`),
      no aparece un 404. Si aparece, falta el `.htaccess`.
- [ ] Subes un adjunto o un comprobante y lo abres (carpetas de `crm_archivos`).
- [ ] **Perfil → Seguridad → Sesiones** muestra tu IP pública real. Si
      muestra `127.0.0.1` o nada, avisa: el límite de intentos de inicio de
      sesión trataría a todos como una sola IP.
- [ ] Desde el panel de configuración, **Correo y avisos** envía un correo de prueba.
- [ ] Si usan la verificación en dos pasos, alguien que la tenga activa puede
      entrar (confirma que las claves del paso 5 son las correctas).
- [ ] **Administradores y cuentas de configuración necesitan la verificación
      en dos pasos** (siempre, aunque el panel diga otra cosa): la primera vez
      que entren sin ella, el CRM los lleva a activarla con una app de
      códigos (Google Authenticator, Microsoft Authenticator…) y no deja usar
      nada más hasta hacerlo. Avísales antes y que tengan el teléfono a mano.
- [ ] Las fotos y los adjuntos solo se abren con sesión iniciada: un enlace
      `/api/archivos/...` copiado fuera del CRM ya no funciona (es a propósito).
- [ ] Al arrancar, el registro de la aplicación no avisa de `JWT_SECRET` corto
      ni de `AUTH_ENCRYPTION_KEY` vacía; si avisa, sigue la nota sobre las
      claves del paso 5.

## 10. Correo

El servidor SMTP se configura en el panel del CRM (*Correo y avisos*).

- **Recomendado: Google Workspace.** El correo de `omnispg.com` ya está ahí.
  Usa una cuenta de Workspace (por ejemplo `avisos@omnispg.com`) con
  `smtp.gmail.com`, puerto 587 y una **contraseña de aplicación** (cuenta de
  Google → Seguridad → Verificación en dos pasos → Contraseñas de
  aplicaciones). El SPF del dominio ya autoriza a Google: no hay que tocar DNS.
- Algunos hostings bloquean el SMTP hacia servidores externos. Si la prueba
  falla con un *timeout*, pregunta a Verpex si permiten salir por el puerto
  587, o usa un buzón del cPanel. Como la cuenta tiene `crm.omnispg.com` como
  dominio, el buzón sería del estilo `avisos@crm.omnispg.com`. Usa como
  servidor el **nombre del servidor** que muestra cPanel en *Cuentas de correo
  → Conectar dispositivos*, y en cPanel → **Capacidad de entrega del correo**
  (*Email Deliverability*) copia los registros SPF y DKIM que sugiere. Créalos
  como `TXT` en Squarespace con host `crm` (y el `default._domainkey.crm` del
  DKIM). No cambies el SPF de `omnispg.com`, que es el de Google.

## 11. Google Calendar (si se usa)

En Google Cloud Console → *Credenciales* → el cliente OAuth → **Orígenes de
JavaScript autorizados**: agrega `https://crm.omnispg.com`. Detalle en
`backend/DEPLOY_GOOGLE_CALENDAR.md`.

## 12. Dejar Vercel y Supabase

1. Haz los pasos 1 a 9 con una copia de prueba de los datos.
2. Avisa al equipo de un horario de corte y pídeles que dejen de usar la
   dirección vieja.
3. Copia los datos otra vez con `--reemplazar` (paso 6) y comparte la nueva
   dirección.
4. En Vercel, desconecta los dos proyectos del repositorio (*Settings → Git →
   Disconnect*). Si no lo haces, cada push a `master` vuelve a publicar la
   versión vieja contra Supabase. Después pausa o borra los proyectos.
5. Conserva Supabase unas semanas como respaldo antes de borrarlo.

## 13. Google Drive: archivos y respaldo diario

Con Google Drive conectado, los archivos del CRM (adjuntos de tareas y
proyectos, comprobantes, PDF de contratos, cotizaciones y archivos de la base
de conocimiento) se guardan en el Drive de una cuenta de Google Workspace de
la empresa y usan sus 2 TB, no el disco de Verpex. Además, cada noche (a
partir de las 3:00) el CRM sube ahí un respaldo completo de la base y conserva
los últimos 30. Las fotos de perfil se quedan en el disco (pesan poco).

Los adjuntos de proyectos y tareas van en **Archivos del CRM › Proyectos ›
proyecto › tarea** con su nombre real y **en los dos sentidos**: lo que se sube,
renombra, mueve o borra ahí desde Drive también cambia en el CRM (en unos
minutos o al abrir los adjuntos). Para eso el CRM pide permiso sobre **todo el
Drive** de esa cuenta (desde el 2026-10-20; antes era "drive.file", que solo
dejaba ver lo que el CRM creaba): usa una cuenta dedicada al CRM. Una conexión
hecha con el permiso anterior sigue funcionando hacia Drive, y el panel pide
volver a conectar para que funcione también desde Drive. No hacen falta
cuentas de servicio ni claves en el servidor.

**La guía está en el propio panel**, igual en **Google Drive y respaldos** y en
**Google Calendar** (cuenta de configuración): *Cómo crear y conectar la llave
de Google, paso a paso*. Es una sola llave (cliente de OAuth) para las dos
cosas. Está pensada para que la empresa lo haga sola: cada paso abre la
pantalla exacta de Google Cloud y trae listos para copiar el nombre del
proyecto, el nombre de la app, la dirección del CRM (la que tenga el
navegador, p. ej. `https://crm.omnispg.com`), la página de privacidad y el
dominio autorizado. Se escribió recorriendo Google Cloud de verdad el
2026-10-20. Resumen:

1. Entrar a <https://console.cloud.google.com>, de preferencia con la cuenta de
   administrador de Google Workspace (ignorar la prueba de $300: no hace falta
   facturación).
2. Crear el proyecto con **Recurso superior** = el dominio de la empresa (con
   una @gmail.com sale "Sin organización").
3. Habilitar **Google Drive API** y **Google Calendar API**.
4. *Google Auth Platform* → **Comenzar**: nombre de la app, correo, público
   **Interno** (Workspace) o **Externo** (Gmail), contacto, aceptar → Crear.
5. Solo con Externo: *Información de la marca* (página principal, política
   de privacidad `https://crm.omnispg.com/privacidad` y dominio autorizado; sin
   logo) y *Público* → **Publicar app**. En "Prueba" Google corta la conexión
   cada 7 días, y sin la marca el botón sale apagado.
6. *Clientes* → **Crear cliente**: *Aplicación web*, origen de JavaScript
   del CRM, sin redireccionamiento. El secreto solo se ve en esa ventana.
7. Pegar el ID de cliente y el secreto en la guía → **Guardar la llave**.
8. Drive: **Conectar con Google** con la cuenta que guardará los archivos
   (una que no se vaya a borrar, por ejemplo `avisos@omnispg.com`). Calendar:
   cada persona en *Agenda → Configuración de agenda → Conectar Google
   Calendar* (con Externo sale "Google no verificó esta app": *Configuración
   avanzada → Ir a … (no seguro)*).
9. Comprobar: **Respaldar ahora** y un adjunto de prueba en Drive; un evento
   de prueba en el calendario "OMNIS CRM" de Google Calendar, y uno creado allá
   que aparezca en la agenda (Calendar va en los dos sentidos: README, "Google Calendar").

Abajo de la guía hay una lista de errores comunes con su arreglo, y los
errores que devuelve Google al conectar Drive dicen qué paso revisar. Si se
cambia la llave, quien tenía Calendar conectado debe desconectar y volver a
conectar en su agenda.

Al terminar, comprueba que en el Drive de esa cuenta apareció la carpeta
**Archivos del CRM** y pulsa **Respaldar ahora**: en *Respaldos* debe aparecer
`respaldo-AAAA-MM-DD-HHMM.json.gz`.

Si ya había archivos en `~/crm_archivos`, se siguen abriendo desde el disco y
cada noche se suben a Drive (o al momento con **Subir a Drive ahora**); al
comprobar que la copia en Drive es idéntica se borran del disco. Si Google
falla al guardar un archivo, se guarda en el disco y se sube después.

**Cuidado:**

- Desconectar Drive (o borrar esa cuenta de Google) deja los archivos en su
  Drive, pero el CRM no puede abrirlos hasta volver a conectar **la misma
  cuenta**. Si alguien sale de la empresa, en Google Workspace transfiere sus
  archivos antes de borrar la cuenta.
- No muevas ni renombres los archivos dentro de "Archivos del CRM": el CRM los
  busca por su nombre. Lo que se borra en el CRM va a la papelera de Drive
  (30 días para recuperarlo).
- Los respaldos contienen toda la base (también contraseñas cifradas): no
  compartas la carpeta. De vez en cuando descarga uno y guárdalo fuera de
  Google.
- El respaldo nocturno corre dentro de la aplicación: necesita que siga
  despierta (cron del paso 8).

**Restaurar un respaldo** (en una base vacía o con `--reemplazar`):

1. Descarga el `respaldo-....json.gz` de Drive.
2. En una copia del backend con `DATABASE_URL` apuntando a la base destino
   (tu PC con XAMPP o la terminal de cPanel):

   ```bash
   npm run db:migrate
   npm run db:copiar -- --desde-respaldo /ruta/respaldo-AAAA-MM-DD-HHMM.json.gz --reemplazar
   ```

   Al terminar compara las filas tabla por tabla. Los archivos no viajan en el
   respaldo: siguen en Drive, en la misma carpeta.

## Actualizar a una versión nueva

### Automático desde GitHub (recomendado)

Cada push a `master` del repositorio CRM_INTERNO dispara
[.github/workflows/desplegar-cpanel.yml](.github/workflows/desplegar-cpanel.yml)
en GitHub Actions:

1. Revisa (eslint) y compila el frontend para cPanel.
2. Sube el backend por SSH a `~/crm_backend` (solo `src/`, `prisma/`,
   `scripts/`, `assets/` y los `package*.json`; `node_modules` y
   `crm_archivos` no se tocan).
3. En el servidor ([backend/scripts/tras_desplegar.sh](backend/scripts/tras_desplegar.sh))
   hace con el node y las variables de la aplicación lo que harían los botones
   de *Setup Node.js App*, pero solo si hace falta: `npm install` si cambió
   `package-lock.json`, `db:generate` si cambió el esquema y `db:migrate` si
   hay migraciones nuevas. Si no hay nada de eso, no arranca ningún node. Al
   final reinicia con `tmp/restart.txt`. Si un paso falla o no hay procesos
   libres, no reinicia y el siguiente despliegue lo vuelve a intentar.
4. Espera a que `/api/health` diga que corre el commit nuevo (preguntando
   desde el propio servidor), sube el frontend a `public_html` conservando el
   bloque de cPanel del `.htaccess` y comprueba que el sitio sirve la versión
   nueva.

El avance y los errores se ven en GitHub → **Actions**. Para repetir un
despliegue: Actions → *Desplegar en cPanel* → **Run workflow** (con la casilla
para correr también npm install, generate y migraciones).

**Configurarlo (una sola vez):**

1. **Llave SSH**, en PowerShell en tu PC (pulsa Enter dos veces cuando pida
   contraseña, la llave queda sin contraseña):

   ```powershell
   ssh-keygen -t ed25519 -C "github-crm" -f "$env:USERPROFILE\.ssh\crm_cpanel"
   Get-Content "$env:USERPROFILE\.ssh\crm_cpanel.pub" | Set-Clipboard
   ```

2. cPanel → **Acceso SSH** (*SSH Access*) → **Administrar claves SSH** →
   **Importar clave**: nombre `github-crm`, pega la clave **pública** en el
   campo de clave pública → Importar. Vuelve a la lista → **Administrar** →
   **Autorizar**. Si no aparece *Acceso SSH*, pide a Verpex que active el
   acceso por shell de la cuenta.
3. GitHub → CRM_INTERNO → **Settings** → **Secrets and variables** →
   **Actions**:
   - pestaña *Secrets* → **New repository secret** `CPANEL_SSH_KEY` con la
     clave **privada** (`Get-Content "$env:USERPROFILE\.ssh\crm_cpanel" -Raw | Set-Clipboard`);
   - pestaña *Variables* → **New repository variable** `CPANEL_USER` = el
     usuario de cPanel.

   Opcionales (variables): `CPANEL_HOST` (`crm.omnispg.com`),
   `CPANEL_PORT` (`22`), `CPANEL_APP_ROOT` (`crm_backend`),
   `CPANEL_SITIO` (`public_html`), `CPANEL_URL`
   (`https://crm.omnispg.com`) y `CPANEL_KNOWN_HOSTS` si el servidor cambia
   (por defecto se usa [.github/cpanel_known_hosts](.github/cpanel_known_hosts)).

Sin `CPANEL_USER` el workflow no corre. La clave privada solo vive en el
secreto de GitHub (que no se ve en el repositorio aunque sea público) y en tu
PC: si se pierde la PC, quita la clave en cPanel y crea otra.

**Procesos.** En este hosting (CloudLinux) la cuenta tiene un límite de **100
procesos** y cada hilo cuenta como uno. El motor de Prisma abre por defecto un
hilo por núcleo del servidor: el 2026-10-20 la aplicación sola ocupaba ~88, el
`npm install` de un despliegue llegó a 100 y la cuenta se quedó sin poder abrir
nada hasta suspenderla y reactivarla en WHM. Desde entonces `src/server.js` fija
`TOKIO_WORKER_THREADS=2` y `UV_THREADPOOL_SIZE=2` antes de cargar nada (como
MAQSER24, en el mismo servidor), y `tras_desplegar.sh` mira cuántos procesos
usa la cuenta antes de cada paso pesado. Lo que consume se ve en cPanel →
**Uso de recursos** → *Current usage* → *Number of Processes*.

Vercel ya no despliega con cada push (`"git": { "deploymentEnabled": false }`
en los dos `vercel.json`): se queda en la última versión hasta apagarlo.

### A mano (si GitHub no está disponible)

1. En tu PC: `npm run empaquetar:cpanel` (desde `backend/`).
2. Backend: sube `crm-backend.zip` a `crm_backend` y extráelo encima.
   `node_modules` y `crm_archivos` no se tocan. Después:
   - si cambió `package.json` → **Run NPM Install**;
   - si hay migraciones nuevas en `prisma/migrations/` → **Run JS script** → `db:migrate`;
   - siempre → **Restart**.
3. Frontend: sube `crm-frontend.zip` a `public_html` y extráelo
   encima (sin borrar `api/`). Si la aplicación Node.js está en la raíz del
   dominio (*Application URL* vacía), el zip pisa el `.htaccess` donde cPanel
   guarda su bloque `CLOUDLINUX PASSENGER CONFIGURATION` y la API da 404:
   en *Setup Node.js App* pulsa **Edit** → **Save** para que lo vuelva a
   escribir. El despliegue automático conserva ese bloque solo.

Respalda la base (phpMyAdmin → *Exportar*, o *Copias de seguridad* de cPanel)
y la carpeta `crm_archivos` antes de cada actualización con migraciones.
Con Google Drive conectado ya hay un respaldo de cada noche (paso 13).

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `/api/health` da 503 o *Incomplete response* | La aplicación no arranca. Revisa `stderr.log` en `crm_backend` (o el *log* que indique la página de la aplicación): suele ser una variable que falta o una `DATABASE_URL` mal escrita. |
| `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-..."` | Agrega en `backend/prisma/schema.prisma`, bloque `generator client`, `binaryTargets = ["native", "<el runtime del error>"]`, vuelve a empaquetar y subir, y corre **Run NPM Install**. |
| `Too many connections` / `max_user_connections` | Baja `connection_limit` a `3` en `DATABASE_URL`. |
| `Cannot GET /...` al abrir `/api/...` | La *Application URL* no termina en `api`. |
| Un adjunto da 404 (`/api/archivos/adjuntos/…`) | El archivo está un nivel arriba: debe ir en `crm_archivos/adjuntos/adjuntos/` (ver paso 6, *Archivos*). |
| 404 al recargar una página del CRM | Falta `.htaccess` en `public_html` (es un archivo oculto). |
| "Origen no permitido por CORS" al iniciar sesión | `FRONTEND_URL` no es exactamente `https://crm.omnispg.com`. |
| La página abre sin candado o con aviso de certificado | AutoSSL todavía no emitió el certificado (paso 2) o el DNS aún no apunta al cPanel. |
| **Run NPM Install** falla por memoria, con `EAGAIN` o se queda colgado | La cuenta llegó a su límite de **100 procesos** (ver *Procesos* abajo). Detén la aplicación (*Stop App*) antes de instalar, o deja que lo haga el despliegue automático, que solo instala si cambió `package-lock.json` y se frena si no hay margen. |
| SSH dice `exec request failed on channel 0`, cPanel o *Setup Node.js App* no abren (`Unable to fork`) | Procesos agotados y algo colgado ocupándolos. **WHM → Administrar suspensión de cuenta → Suspender y luego Reactivar** la cuenta: mata todos sus procesos (el sitio se cae un minuto). Después la aplicación arranca sola con la primera visita. |
