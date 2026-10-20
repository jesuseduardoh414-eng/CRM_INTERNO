#!/usr/bin/env node
/**
 * Prepara los dos .zip que se suben al cPanel (pasos en DESPLIEGUE_CPANEL.md):
 *
 *   paquete_cpanel/crm-frontend.zip  -> se descomprime en la carpeta del sitio
 *                                       (public_html de la cuenta del CRM; build de
 *                                       Vite en modo cpanel: API en /api y .htaccess)
 *   paquete_cpanel/crm-backend.zip   -> se descomprime en el Application root de
 *                                       "Setup Node.js App"
 *
 * El backend sale de los archivos que git conoce o que no estan ignorados, asi
 * que nunca viajan node_modules, .env, storage/ (adjuntos, contratos,
 * comprobantes) ni scratch/.
 *
 *   npm run empaquetar:cpanel                  (desde backend/)
 *   npm run empaquetar:cpanel -- --sin-build   (reusa frontend/dist tal cual)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '../..');
const BACKEND = path.join(RAIZ, 'backend');
const FRONTEND = path.join(RAIZ, 'frontend');
const DIST = path.join(FRONTEND, 'dist');
const SALIDA = path.join(RAIZ, 'paquete_cpanel');

// Aunque no esten ignorados, no tienen nada que hacer en el servidor.
const EXCLUIR_BACKEND = [/^\.env$/, /^node_modules\//, /^storage\//, /^uploads\//, /^scratch\//, /^vercel\.json$/];

const fallar = (mensaje) => {
  console.error(`\n[empaquetar] ${mensaje}`);
  process.exit(1);
};

const ejecutar = (comando, args, opciones = {}) => {
  const r = spawnSync(comando, args, { encoding: 'utf8', ...opciones });
  if (r.error) fallar(`No se pudo ejecutar ${comando}: ${r.error.message}`);
  if (r.status !== 0) fallar(`${comando} ${args.join(' ')} termino con codigo ${r.status}\n${r.stderr || ''}`);
  return r.stdout;
};

const listarCarpeta = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const ruta = path.join(dir, e.name);
  return e.isDirectory() ? listarCarpeta(ruta, base) : [path.relative(base, ruta).split(path.sep).join('/')];
});

/** Comprime `archivos` (rutas relativas a `dir`) en `destino`. */
const comprimir = (dir, archivos, destino) => {
  if (process.platform === 'win32') {
    // El tar de Windows (bsdtar) escribe .zip; el de Git Bash (GNU) no.
    const lista = path.join(os.tmpdir(), `crm-cpanel-${process.pid}.txt`);
    fs.writeFileSync(lista, `${archivos.join('\n')}\n`);
    try {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      ejecutar(tar, ['-a', '-c', '-f', destino, '-C', dir, '-T', lista]);
    } finally {
      fs.rmSync(lista, { force: true });
    }
  } else {
    ejecutar('zip', ['-q', '-X', destino, '-@'], { cwd: dir, input: archivos.join('\n') });
  }
};

const megas = (archivo) => `${(fs.statSync(archivo).size / 1024 / 1024).toFixed(1)} MB`;

// ---------- Frontend ----------
if (!process.argv.includes('--sin-build')) {
  console.log('[empaquetar] build del frontend (vite build --mode cpanel)…');
  // Con shell, porque en Windows npm es un .cmd.
  const r = spawnSync('npm run build:cpanel', { cwd: FRONTEND, stdio: 'inherit', shell: true });
  if (r.status !== 0) fallar('El build del frontend fallo (¿falta "npm install" en frontend/?).');
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) fallar('No hay frontend/dist/index.html: corre sin --sin-build.');
if (!fs.existsSync(path.join(DIST, '.htaccess'))) {
  fallar('frontend/dist no trae .htaccess: no es un build de cPanel. Corre sin --sin-build (o "npm run build:cpanel" en frontend/).');
}

fs.mkdirSync(SALIDA, { recursive: true });
const zipFrontend = path.join(SALIDA, 'crm-frontend.zip');
const zipBackend = path.join(SALIDA, 'crm-backend.zip');
fs.rmSync(zipFrontend, { force: true });
fs.rmSync(zipBackend, { force: true });

comprimir(DIST, listarCarpeta(DIST), zipFrontend);

// ---------- Backend ----------
const archivosBackend = ejecutar('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: BACKEND })
  .split('\0')
  .filter(Boolean)
  .filter((ruta) => !EXCLUIR_BACKEND.some((patron) => patron.test(ruta)))
  .filter((ruta) => fs.existsSync(path.join(BACKEND, ruta)))
  .sort();
for (const obligatorio of ['package.json', 'package-lock.json', 'src/server.js', 'prisma/schema.prisma']) {
  if (!archivosBackend.includes(obligatorio)) fallar(`Falta backend/${obligatorio} en el paquete.`);
}
comprimir(BACKEND, archivosBackend, zipBackend);

const relativa = (ruta) => path.relative(RAIZ, ruta).split(path.sep).join('/');
console.log(`
[empaquetar] listo:
  ${relativa(zipFrontend)}  (${megas(zipFrontend)})  -> carpeta del sitio (~/public_html de la cuenta del CRM)
  ${relativa(zipBackend)}   (${megas(zipBackend)}, ${archivosBackend.length} archivos)  -> Application root (p. ej. ~/crm_backend)

Pasos completos en DESPLIEGUE_CPANEL.md. Si cambiaron package.json o las
migraciones: "Run NPM Install" y luego db:migrate desde "Setup Node.js App".`);
