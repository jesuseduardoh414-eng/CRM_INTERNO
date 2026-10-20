#!/usr/bin/env node
/**
 * Lee por stdin la salida de `cloudlinux-selector get --json --interpreter nodejs`
 * y escribe, para la aplicacion APP_ROOT del usuario actual, una linea
 * `export NOMBRE='valor'` por cada variable de entorno de "Setup Node.js App",
 * lista para `eval` en bash, y al final VARIABLES_APP con los nombres.
 *
 * Lo usa scripts/tras_desplegar.sh. Existe porque en la jaula de CloudLinux no
 * hay /dev/fd y bash no puede leer de `< <(...)`; con `eval "$(...)"` si.
 *
 *   APP_ROOT=crm_backend node scripts/variables_app.js < selector.json
 */
const os = require('os');

const comillas = (texto) => `'${String(texto).replace(/'/g, "'\\''")}'`;

let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (trozo) => { entrada += trozo; });
process.stdin.on('end', () => {
  const usuario = os.userInfo().username;
  const appRoot = process.env.APP_ROOT;
  for (const version of Object.values(JSON.parse(entrada).available_versions || {})) {
    const app = version.users?.[usuario]?.applications?.[appRoot];
    if (!app) continue;
    const variables = app.env_vars || {};
    const nombres = Object.keys(variables).filter((nombre) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre));
    for (const nombre of nombres) process.stdout.write(`export ${nombre}=${comillas(variables[nombre])}\n`);
    process.stdout.write(`VARIABLES_APP=${comillas(nombres.join(' '))}\n`);
    return;
  }
  console.error(`No encontre la aplicacion ${appRoot} de ${usuario} en cloudlinux-selector.`);
  process.exit(1);
});
