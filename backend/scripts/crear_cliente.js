#!/usr/bin/env node
/**
 * Crea (o restablece) una cuenta del portal de clientes (rol CLIENTE) sin
 * pasar por la invitación por correo. Útil para pruebas o cuando el correo
 * del sistema aún no está configurado. Lo normal es dar el acceso desde la
 * ficha del cliente (Clientes y proveedores -> Acceso al portal).
 *
 * Uso (desde backend/):
 *   npm run crear-cliente -- --empresa 5 --email ana@cliente.com --nombre "Ana López"
 *   npm run crear-cliente -- --empresa 5 --email ana@cliente.com --restablecer
 *
 * Genera una contraseña aleatoria fuerte y la muestra UNA sola vez. Si pasas
 * --password "..." se usa esa (debe cumplir la política de contraseñas).
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

const generarPassword = () => {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='];
  const todos = grupos.join('');
  const elegidos = grupos.map((g) => g[crypto.randomInt(g.length)]);
  while (elegidos.length < 16) elegidos.push(todos[crypto.randomInt(todos.length)]);
  for (let i = elegidos.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [elegidos[i], elegidos[j]] = [elegidos[j], elegidos[i]];
  }
  return elegidos.join('');
};

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

(async () => {
  const empresaId = Number.parseInt(leer('empresa'), 10);
  const email = String(leer('email') || '').toLowerCase().trim();
  const restablecer = args.includes('--restablecer');
  if (!Number.isInteger(empresaId)) salir('Indica el id de la empresa: --empresa 5 (está en la URL de su ficha, /clientes/5)');
  if (!esEmailValido(email)) salir('Indica un correo válido: --email persona@cliente.com');

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, tipo: true, estado: true } });
  if (!empresa) salir(`No existe la empresa ${empresaId}.`);
  if (empresa.tipo === 'PROVEEDOR') salir('Esa empresa es proveedor: el portal es solo para clientes.');
  if (empresa.estado !== 'ACTIVO') salir('Esa empresa está inactiva: actívala antes de darle acceso.');

  const nombre = String(leer('nombre') || `Contacto ${empresa.nombre}`).trim().slice(0, 255);
  const password = leer('password') || generarPassword();
  const validacion = validarPassword(password, { email, nombre });
  if (!validacion.valido) salir(`La contraseña no cumple la política:\n - ${validacion.errores.join('\n - ')}`);

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente && existente.rol !== 'CLIENTE') salir('Ese correo ya pertenece a una cuenta del equipo. Usa otro correo.');
  if (existente && !restablecer) salir('Ya existe una cuenta de cliente con ese correo. Usa --restablecer para darle una contraseña nueva.');

  const datos = {
    nombre,
    password: await bcrypt.hash(password, 12),
    rol: 'CLIENTE',
    empresaId: empresa.id,
    estado: 'activo',
    verificado: true,
    passwordCambiadoEn: new Date(),
    intentosFallidos: 0,
    bloqueadoHasta: null,
  };
  const usuario = existente
    ? await prisma.usuario.update({ where: { id: existente.id }, data: datos })
    : await prisma.usuario.create({ data: { ...datos, email, area: '' } });
  if (existente) await revocarTodas(usuario.id);

  console.log('\nCuenta del portal de clientes lista.');
  console.log(`  Empresa:    ${empresa.nombre}`);
  console.log(`  Correo:     ${email}`);
  console.log(`  Contraseña: ${password}`);
  console.log('\nGuárdala ahora: no se vuelve a mostrar.\n');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
