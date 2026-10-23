// Punto de entrada del servidor Express

// Hilos. En la jaula de CloudLinux (cPanel) cada hilo cuenta como un proceso y
// la cuenta tiene 100: el motor de Prisma (Rust/Tokio) abre por defecto uno por
// núcleo del servidor, que son decenas, y libuv 4. Con 2 de cada uno sobra para
// el CRM y queda margen para despliegues y otra instancia. Va antes de cargar
// cualquier módulo porque Tokio y libuv leen estas variables al crear sus
// hilos. Se respeta lo que ya fije el entorno.
process.env.TOKIO_WORKER_THREADS ??= '2';
process.env.UV_THREADPOOL_SIZE ??= '2';

const express = require('express');
const cors    = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Sin estas dos variables nada funciona (ni firmar tokens ni abrir la base).
// Mejor fallar al arrancar con un mensaje claro que con errores raros
// en la primera peticion.
const variablesObligatorias = ['JWT_SECRET', 'DATABASE_URL'].filter((nombre) => !process.env[nombre]);
if (variablesObligatorias.length > 0) {
  throw new Error(`Faltan variables de entorno obligatorias: ${variablesObligatorias.join(', ')}. Revisa backend/.env.example.`);
}
// Con un JWT_SECRET corto se pueden adivinar por fuerza bruta las firmas de
// las sesiones (y fabricar una de cualquier persona). Sin AUTH_ENCRYPTION_KEY
// los secretos cifrados (2FA, Google, SMTP) dependen del mismo JWT_SECRET.
// OJO al cambiarlos: con AUTH_ENCRYPTION_KEY vacia, otro JWT_SECRET deja
// ilegible lo ya cifrado. El orden seguro esta en DESPLIEGUE_CPANEL.md.
if (String(process.env.JWT_SECRET).length < 32) {
  console.warn('⚠️  JWT_SECRET tiene menos de 32 caracteres: cámbialo por uno largo y aleatorio siguiendo el orden de DESPLIEGUE_CPANEL.md (nota sobre las claves), para no perder el 2FA ni el SMTP guardados.');
}
if (!process.env.AUTH_ENCRYPTION_KEY) {
  console.warn('⚠️  AUTH_ENCRYPTION_KEY no está definido: los secretos cifrados (2FA, SMTP, Google) usan una clave derivada de JWT_SECRET. No pongas una nueva sin leer DESPLIEGUE_CPANEL.md (nota sobre las claves).');
}

const authRoutes                        = require('./routes/auth.routes');
const proyectosRoutes                   = require('./routes/proyectos.routes');
const { routerProyecto, routerTarea }   = require('./routes/tareas.routes');
const usuariosRoutes                    = require('./routes/usuarios.routes');
const notificacionesRoutes              = require('./routes/notificaciones.routes');
const statsRoutes                       = require('./routes/stats.routes');
const agendaRoutes                      = require('./routes/agenda.routes');
const contratosRoutes                   = require('./routes/contratos.routes');
const configuracionRoutes               = require('./routes/configuracion.routes');

const app  = express();
require('./services/configuracion.service').obtener().catch((error) => {
  console.warn('⚠️  No se pudo precargar la configuración:', error?.message || error);
});
const PORT = process.env.PORT || 3000;

// Confiar en el proxy (Vercel, Render, cPanel) para que express-rate-limit vea la IP real
app.set('trust proxy', 1);

// Parametros de la URL solo como texto (o lista si se repiten). El lector de
// fabrica (qs) convierte `?estado[not]=x` en un objeto, y un objeto que llegue
// a un `where` de Prisma es un operador colado (`not`, `contains`...). El
// frontend arma las URLs con URLSearchParams, asi que no usa esa sintaxis.
app.set('query parser', 'simple');

// Middlewares globales
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      upgradeInsecureRequests: [],
    },
  },
})); // Seguridad de headers

// CORS con lista blanca, siempre. Sin FRONTEND_URL solo valen los origenes de
// desarrollo (antes se aceptaba cualquiera, y con la cookie de sesion eso ya
// no es aceptable).
// Los de desarrollo solo si el frontend no es https (en produccion sobran).
const enProduccionHttps = /^https:/i.test(process.env.FRONTEND_URL || '');
const origenesPermitidos = [
  process.env.FRONTEND_URL,
  ...(enProduccionHttps ? [] : [
    'http://localhost:5173',
    'http://localhost:3000',
    // Vite puede servir en 127.0.0.1 (--host 127.0.0.1): para el navegador es
    // otro origen distinto de localhost.
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ]),
].filter(Boolean).map((origen) => origen.replace(/\/+$/, ''));

if (!process.env.FRONTEND_URL) {
  console.warn('⚠️  FRONTEND_URL no está definido: CORS solo acepta localhost. Defínelo en producción.');
}

app.use(cors({
  origin: (origin, callback) => {
    // Peticiones sin cabecera Origin (curl, health checks, mismo origen) pasan.
    if (!origin || origenesPermitidos.includes(origin)) return callback(null, true);
    const error = new Error('Origen no permitido por CORS');
    error.esErrorCliente = true;
    error.statusCode = 403;
    return callback(error);
  },
  credentials: true,
  // Para que el navegador pueda leer el nombre de archivo en las descargas
  // (`descargarArchivo` del frontend lee Content-Disposition).
  exposedHeaders: ['Content-Disposition'],
}));

// Cuerpo JSON. 1 MB porque la confirmacion de importaciones grandes supera
// los 100 KB que trae express por defecto.
app.use(express.json({ limit: '1mb' }));

// Techo general de peticiones (middlewares/rateLimit.middleware.js).
app.use('/api', require('./middlewares/rateLimit.middleware').limiteGeneral);

// Rutas
app.use('/api/auth',                        authRoutes);
app.use('/api/proyectos',                   proyectosRoutes);
app.use('/api/proyectos/:id/tareas',        routerProyecto); // GET y POST de tareas
app.use('/api/tareas',                      routerTarea);    // PUT, DELETE, PATCH de tareas
app.use('/api/usuarios',                    usuariosRoutes);
app.use('/api/notificaciones',              notificacionesRoutes);
app.use('/api/stats',                       statsRoutes);
app.use('/api/agenda',                      agendaRoutes);
app.use('/api/contratos',                   contratosRoutes);
app.use('/api/configuracion',               configuracionRoutes);
app.use('/api/empresas',                    require('./routes/empresas.routes'));
app.use('/api/reportes',                    require('./routes/reportes.routes'));
app.use('/api/portal',                      require('./routes/portal.routes'));
app.use('/api/finanzas',                    require('./routes/finanzas.routes'));
app.use('/api/conocimiento',                require('./routes/conocimiento.routes'));
app.get('/api/archivos/:carpeta/:nombre',   require('./controllers/archivos.controller').ver);

// Commit desplegado en cPanel (lo escribe scripts/tras_desplegar.sh antes de
// reiniciar): el despliegue automático comprueba con él que ya corre lo nuevo.
const VERSION = (() => {
  try {
    return require('fs').readFileSync(require('path').join(__dirname, '..', '.commit_desplegado'), 'utf8').trim() || null;
  } catch (_e) {
    return null;
  }
})();

// Ruta de salud para verificar que el servidor está corriendo
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mensaje: 'Servidor CRM funcionando', version: VERSION });
});

// Manejador global de errores.
// Solo se exponen mensajes en errores que sabemos que son del cliente
// (multer, JSON mal formado, CORS, filtros de archivo marcados con
// `esErrorCliente`). Todo lo demas responde 500 con un mensaje generico y
// se registra en consola: antes se devolvia `err.message` tal cual y
// filtraba detalles internos (rutas, consultas, nombres de tablas).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;

  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      // El limite depende de la ruta (4 MB adjuntos e importacion, 2 MB foto
      // de perfil), por eso el mensaje no fija la cifra.
      return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Campo de archivo no esperado' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Se enviaron más archivos de los permitidos' });
    }
    return res.status(400).json({ error: 'Error al subir el archivo' });
  }

  // Errores de body-parser (express.json)
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande (máximo 1 MB)' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' });
  }

  // Errores marcados explicitamente como del cliente (filtros de archivo, CORS)
  if (err?.esErrorCliente) {
    const codigo = Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 400;
    return res.status(codigo).json({ error: err.message || 'Petición inválida' });
  }

  console.error('[error no controlado]', err);
  return res.status(500).json({ error: 'Error interno del servidor' });
});

// Inicio del servidor. En Vercel (serverless) no se escucha: Vercel invoca la
// app exportada en cada peticion. Se detecta por VERCEL=1 y, por si el
// proyecto tiene desactivadas las variables de sistema, por la de AWS Lambda
// (donde corren las funciones de Vercel). En cualquier otro sitio (local,
// Render, cPanel) hay que escuchar, tambien en produccion.
// Si JWT_SECRET o AUTH_ENCRYPTION_KEY cambiaron sin seguir el orden de
// DESPLIEGUE_CPANEL.md, los secretos guardados ya no se descifran: el 2FA de
// todos dice "código incorrecto" sin mas pista. Se comprueba uno al arrancar.
const comprobarClaveCifrado = async () => {
  let secreto;
  try {
    secreto = (await require('./lib/prisma').usuario.findFirst({ where: { dosFactoresSecreto: { not: null } }, select: { dosFactoresSecreto: true } }))?.dosFactoresSecreto;
  } catch (_e) {
    return; // sin base todavia: ya lo dira la primera peticion
  }
  if (!secreto) return;
  try {
    require('./utils/cifrado.utils').descifrar(secreto);
  } catch (_e) {
    console.error('❌ La clave de cifrado no coincide con la de los secretos guardados (2FA, SMTP, Google). Vuelve a poner el JWT_SECRET / AUTH_ENCRYPTION_KEY anteriores (ver la nota sobre las claves en DESPLIEGUE_CPANEL.md).');
  }
};

const enServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!enServerless) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor CRM corriendo en el puerto ${PORT}`);
    comprobarClaveCifrado();
    // Recordatorios de eventos y resumen diario por correo (cada minuto).
    require('./services/avisosCorreo.service').iniciarAvisosProgramados();
    // Respaldo diario de la base en Google Drive (si esta conectado).
    require('./services/respaldo.service').iniciarRespaldoDiario();
    // Cambios de Google Calendar hacia la agenda (cada 5 minutos).
    require('./services/google-calendar.service').iniciarSincronizacionCalendar();
    // Cambios en las carpetas de proyectos de Google Drive (cada 5 minutos).
    require('./services/driveProyectos.service').iniciarSincronizacionDrive();
  });
}

// Exportar para Vercel
module.exports = app;
