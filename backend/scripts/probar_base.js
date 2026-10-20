#!/usr/bin/env node
/**
 * Prueba la conexion a MySQL con la DATABASE_URL de la aplicacion y dice por
 * que falla, sin mostrar la contraseña. Pensado para cPanel: Setup Node.js
 * App → Run JS script → db:probar (las variables de la aplicacion ya estan
 * cargadas). Tambien sirve en local: npm run db:probar.
 *
 * Intenta tres caminos: tal como esta la URL, por 127.0.0.1 y por el socket
 * de MySQL. El mensaje de MySQL dice con que usuario y desde que host lo vio
 * ('usuario'@'localhost' o @'127.0.0.1'), que es lo que distingue una
 * contraseña equivocada de un permiso que solo vale para otro host.
 */
require('dotenv').config();
const fs = require('fs');

const SOCKETS = ['/var/lib/mysql/mysql.sock', '/tmp/mysql.sock', '/var/run/mysqld/mysqld.sock'];

const decodificar = (texto) => {
  try { return decodeURIComponent(texto); } catch (_e) { return texto; }
};

const main = async () => {
  const url = process.env.DATABASE_URL || '';
  console.log('DATABASE_URL definida:', url ? 'sí' : 'NO');
  const m = /^mysql:\/\/([^:]+):(.*)@([^@/:?]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url.trim());
  if (!m) {
    console.log('La DATABASE_URL no tiene el formato mysql://usuario:clave@host:3306/base');
    if (url !== url.trim()) console.log('Ojo: tiene espacios al inicio o al final.');
    return;
  }
  const [, usuarioCrudo, claveCruda, host, puerto, base, consulta] = m;
  const usuario = decodificar(usuarioCrudo);
  const clave = decodificar(claveCruda);
  const params = new URLSearchParams(consulta || '');
  console.log(`Usuario: ${usuario} · Host: ${host} · Puerto: ${puerto || '(sin puerto)'} · Base: ${decodificar(base)}`);
  console.log(`Contraseña: ${clave.length} caracteres`
    + `${/\s/.test(clave) ? ' · TIENE ESPACIOS' : ''}`
    + `${/[^A-Za-z0-9]/.test(clave) ? ' · tiene símbolos' : ' · solo letras y números'}`
    + `${clave === 'TUCLAVE' || clave === 'CLAVE' ? ' · ¡ES EL TEXTO DE EJEMPLO, NO LA CONTRASEÑA!' : ''}`);
  if (params.get('socket')) console.log(`Socket en la URL: ${params.get('socket')}`);
  if (url !== url.trim()) console.log('Ojo: la DATABASE_URL tiene espacios al inicio o al final.');

  const mysql = require('mysql2/promise');
  const intentos = [
    { nombre: 'tal como está la URL', opciones: params.get('socket') ? { socketPath: params.get('socket') } : { host, port: Number(puerto || 3306) } },
    { nombre: 'por 127.0.0.1', opciones: { host: '127.0.0.1', port: Number(puerto || 3306) } },
    ...SOCKETS.filter((s) => fs.existsSync(s)).map((s) => ({ nombre: `por el socket ${s}`, opciones: { socketPath: s } })),
  ];
  if (!SOCKETS.some((s) => fs.existsSync(s))) console.log('No se encontró el socket de MySQL en las rutas comunes.');

  let funciono = null;
  for (const { nombre, opciones } of intentos) {
    try {
      const conexion = await mysql.createConnection({ ...opciones, user: usuario, password: clave, database: decodificar(base), connectTimeout: 8000 });
      const [[fila]] = await conexion.query('SELECT CURRENT_USER() AS usuario');
      await conexion.end();
      console.log(`OK   ${nombre}: conectado como ${fila.usuario}`);
      if (!funciono) funciono = { nombre, opciones };
    } catch (error) {
      console.log(`FALLA ${nombre}: [${error.code || 'error'}] ${error.message}`);
    }
  }

  if (!funciono) {
    console.log('\nNinguno funcionó. Si todos dicen "Access denied for user ...@\'localhost\'", la contraseña de la URL no es la del usuario de MySQL.');
  } else if (funciono.opciones.socketPath && !params.get('socket')) {
    console.log(`\nUsa el socket en la DATABASE_URL: mysql://${usuarioCrudo}:CLAVE@localhost/${base}?socket=${funciono.opciones.socketPath}&connection_limit=5`);
  } else if (funciono.opciones.host === '127.0.0.1' && host !== '127.0.0.1') {
    console.log(`\nUsa 127.0.0.1 en la DATABASE_URL: mysql://${usuarioCrudo}:CLAVE@127.0.0.1:${puerto || 3306}/${base}?connection_limit=5`);
  } else {
    console.log('\nLa DATABASE_URL funciona tal como está.');
  }
};

main().catch((error) => {
  console.error('Error inesperado:', error.message);
  process.exit(1);
});
