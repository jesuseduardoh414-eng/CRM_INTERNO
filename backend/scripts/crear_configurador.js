#!/usr/bin/env node
/**
 * Crea (o restablece) la cuenta CONFIGURADOR de esta instalacion: la que entra
 * al panel de configuracion (marca, colores, login, modulos). La primera se
 * crea aqui a proposito: es la cuenta de quien instala el CRM. Despues, desde
 * el panel (Usuarios y seguridad -> Cuentas de configuracion) se invita a
 * otras. Este script sigue sirviendo para restablecer una si nadie puede entrar.
 *
 * Uso (desde backend/):
 *   npm run crear-configurador -- --email config@empresa.com --nombre "Configuración"
 *   npm run crear-configurador -- --email config@empresa.com --restablecer
 *
 * Genera una contraseña aleatoria fuerte y la muestra UNA sola vez. Si pasas
 * --password "..." se usa esa (debe cumplir la politica de contraseñas).
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { validarPassword, esEmailValido } = require('../src/utils/security.utils');
const { revocarTodas } = require('../src/services/sesiones.service');

const args = process.argv.slice(2);
const leer = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i !== -1 ? args[i + 1] : undefined;
};

// Contraseña de 20 caracteres con mayusculas, minusculas, numeros y simbolos.
const generarPassword = () => {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='];
  const todos = grupos.join('');
  const elegidos = grupos.map((g) => g[crypto.randomInt(g.length)]);
  while (elegidos.length < 20) elegidos.push(todos[crypto.randomInt(todos.length)]);
  for (let i = elegidos.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [elegidos[i], elegidos[j]] = [elegidos[j], elegidos[i]];
  }
  return elegidos.join('');
};

(async () => {
  const email = String(leer('email') || '').toLowerCase().trim();
  const nombre = String(leer('nombre') || 'Configuración del sistema').trim();
  const restablecer = args.includes('--restablecer');
  if (!esEmailValido(email)) {
    console.error('Indica un correo válido: --email config@empresa.com');
    process.exit(1);
  }

  const password = leer('password') || generarPassword();
  const validacion = validarPassword(password, { email, nombre });
  if (!validacion.valido) {
    console.error(`La contraseña no cumple la política:\n - ${validacion.errores.join('\n - ')}`);
    process.exit(1);
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente && existente.rol !== 'CONFIGURADOR') {
    console.error('Ese correo ya pertenece a una cuenta del equipo. Usa otro correo para el configurador.');
    process.exit(1);
  }
  if (existente && !restablecer) {
    console.error('Ya existe un configurador con ese correo. Usa --restablecer para darle una contraseña nueva.');
    process.exit(1);
  }

  const datos = {
    nombre,
    password: await bcrypt.hash(password, 12),
    rol: 'CONFIGURADOR',
    estado: 'activo',
    verificado: true,
    passwordCambiadoEn: new Date(),
    intentosFallidos: 0,
    bloqueadoHasta: null,
  };
  const usuario = existente
    ? await prisma.usuario.update({ where: { id: existente.id }, data: datos })
    : await prisma.usuario.create({ data: { ...datos, email, area: 'ADMINISTRACION' } });
  if (existente) await revocarTodas(usuario.id);

  console.log(`\nCuenta de configuración ${existente ? 'restablecida' : 'creada'}:`);
  console.log(`  Correo:     ${email}`);
  console.log(`  Contraseña: ${password}`);
  console.log('\nGuárdala ahora: no se vuelve a mostrar. Entra por la pantalla de inicio de sesión normal.\n');
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
