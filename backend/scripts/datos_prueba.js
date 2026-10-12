#!/usr/bin/env node
/**
 * Carga datos de prueba para recorrer el CRM y el portal de clientes con una
 * cuenta de cada rol. Solo crea las cuentas que no existan: a las que ya
 * existen no les cambia la contraseña ni nada más.
 *
 * Uso (desde backend/):
 *   npm run datos-prueba              crea lo que falte (no cambia contraseñas)
 *   npm run datos-prueba -- --borrar  quita los proyectos, empresas y cuentas de prueba
 *
 * Se puede correr varias veces: lo que ya existe no se duplica.
 * No manda correos: escribe directo en la base, y las reuniones llevan
 * alertaMinutos 0 para que el recordatorio por correo las ignore.
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { validarPassword } = require('../src/utils/security.utils');

const PASSWORD = 'Prueba-Crm#2026';
const DIA = 24 * 60 * 60 * 1000;
const hoy = new Date();
hoy.setHours(12, 0, 0, 0);
const enDias = (n, hora = 12) => {
  const d = new Date(hoy.getTime() + n * DIA);
  d.setHours(hora, 0, 0, 0);
  return d;
};

const EMPRESA_DEMO = 5; // Servicios de Maquinaria del Bajío (ya existe)
const PROYECTO_DEMO = 26; // ServMaq24 (ya existe)

const CUENTAS = [
  { email: 'admin.prueba@omnis.local', nombre: 'Administrador de prueba', rol: 'ADMIN', area: 'ADMINISTRACION' },
  { email: 'miembro.prueba@omnis.local', nombre: 'Mariana Ortiz (prueba)', rol: 'MIEMBRO', area: 'DESARROLLO' },
  { email: 'diseno.prueba@omnis.local', nombre: 'Luis Herrera (prueba)', rol: 'MIEMBRO', area: 'MARKETING' },
  { email: 'config@omnis.local', nombre: 'Configuración OMNIS', rol: 'CONFIGURADOR', area: 'ADMINISTRACION' },
  { email: 'cliente.demo@servmaq.mx', nombre: 'Laura Martínez', rol: 'CLIENTE', area: '', empresa: 'demo' },
  { email: 'cliente.altamira@omnis.local', nombre: 'Ricardo Salinas (prueba)', rol: 'CLIENTE', area: '', empresa: 'altamira' },
];

const EMPRESA_ALTAMIRA = {
  nombre: 'Constructora Altamira S.A. de C.V. (prueba)',
  nombreComercial: 'Altamira',
  tipo: 'CLIENTE',
  rfc: 'CAL150820QX3',
  sector: 'Construcción',
  email: 'contacto@altamira.local',
  telefono: '442 310 2200',
  ciudad: 'Querétaro',
  notas: 'Empresa de prueba creada por scripts/datos_prueba.js',
};

const PROYECTOS = [
  {
    clave: 'web',
    nombre: 'Renovación del sitio web ServMaq (prueba)',
    descripcion: 'Nuevo sitio con catálogo de maquinaria, cotizador y blog.',
    empresa: 'demo', area: 'DESARROLLO', estado: 'ACTIVO', inicio: -21, fin: 35,
    tareas: [
      ['Levantamiento de requerimientos', 'HECHO', -18, 'miembro'],
      ['Mapa del sitio y arquitectura', 'HECHO', -14, 'miembro'],
      ['Diseño de la página de inicio', 'HECHO', -9, 'diseno'],
      ['Diseño del catálogo de maquinaria', 'EN_PROGRESO', 3, 'diseno'],
      ['Maquetado de la página de inicio', 'EN_PROGRESO', 5, 'miembro'],
      ['Cotizador en línea', 'PENDIENTE', 12, 'miembro'],
      ['Migración del blog', 'PENDIENTE', 18, 'miembro'],
      ['Pruebas en celular', 'PENDIENTE', 26, 'diseno'],
      ['Publicación', 'PENDIENTE', 35, 'miembro'],
      ['Ajustes de textos del catálogo', 'PENDIENTE', -2, 'diseno'],
    ],
  },
  {
    clave: 'expo',
    nombre: 'Campaña Expo Maquinaria 2026 (prueba)',
    descripcion: 'Campaña en redes y material impreso para la Expo Maquinaria.',
    empresa: 'demo', area: 'MARKETING', estado: 'TERMINADO', inicio: -90, fin: -30,
    tareas: [
      ['Concepto de campaña', 'HECHO', -80, 'diseno'],
      ['Piezas para redes', 'HECHO', -60, 'diseno'],
      ['Lonas y folletos', 'HECHO', -45, 'diseno'],
      ['Reporte de resultados', 'HECHO', -31, 'miembro'],
    ],
  },
  {
    clave: 'altamira',
    nombre: 'Identidad de marca Altamira (prueba)',
    descripcion: 'Logotipo, manual de marca y papelería.',
    empresa: 'altamira', area: 'MARKETING', estado: 'ACTIVO', inicio: -10, fin: 20,
    tareas: [
      ['Investigación de marca', 'HECHO', -6, 'diseno'],
      ['Propuestas de logotipo', 'EN_PROGRESO', 2, 'diseno'],
      ['Manual de marca', 'PENDIENTE', 12, 'diseno'],
      ['Papelería', 'PENDIENTE', 18, 'miembro'],
    ],
  },
];

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

// ── Archivos de ejemplo en el disco (como los que sube el equipo) ──────────

const directorioAdjuntos = () => (process.env.ADJUNTOS_DIR
  ? path.resolve(process.env.ADJUNTOS_DIR)
  : path.resolve(__dirname, '../storage/adjuntos'));

// PDF de una página con unas líneas de texto (sin dependencias).
const pdfSimple = (lineas) => {
  const texto = lineas
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 60 ${740 - i * 26} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`)
    .join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let salida = '%PDF-1.4\n';
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(salida, 'latin1'));
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(salida, 'latin1');
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  salida += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(salida, 'latin1');
};

const guardarArchivo = async (contenido, ext) => {
  const carpeta = path.join(directorioAdjuntos(), 'adjuntos');
  await fs.mkdir(carpeta, { recursive: true });
  const nombre = `${crypto.randomUUID()}${ext}`;
  await fs.writeFile(path.join(carpeta, nombre), contenido);
  return { url: `/api/archivos/adjuntos/${nombre}`, tamano: contenido.length };
};

// ── Cuentas ────────────────────────────────────────────────────────────────

const prepararCuentas = async (empresas) => {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const ids = {};
  for (const c of CUENTAS) {
    const existente = await prisma.usuario.findUnique({ where: { email: c.email } });
    if (existente && existente.rol !== c.rol) salir(`${c.email} ya existe con otro rol (${existente.rol}); no se toca.`);
    // Una cuenta que ya existía conserva su contraseña (la persona puede
    // tenerla guardada); solo las cuentas nuevas llevan la de prueba.
    if (existente) {
      ids[c.email] = existente.id;
      continue;
    }
    const usuario = await prisma.usuario.create({
      data: {
        email: c.email, nombre: c.nombre, rol: c.rol, area: c.area,
        password: hash, estado: 'activo', verificado: true, passwordCambiadoEn: new Date(),
        ...(c.empresa ? { empresaId: empresas[c.empresa] } : {}),
      },
    });
    ids[c.email] = usuario.id;
  }
  return {
    admin: ids['admin.prueba@omnis.local'],
    miembro: ids['miembro.prueba@omnis.local'],
    diseno: ids['diseno.prueba@omnis.local'],
    clienteDemo: ids['cliente.demo@servmaq.mx'],
  };
};

// ── Carga ──────────────────────────────────────────────────────────────────

const cargar = async () => {
  const demo = await prisma.empresa.findUnique({ where: { id: EMPRESA_DEMO } });
  if (!demo) salir(`No existe la empresa ${EMPRESA_DEMO} (Servicios de Maquinaria del Bajío).`);
  if (!(await prisma.proyecto.findUnique({ where: { id: PROYECTO_DEMO } }))) salir(`No existe el proyecto ${PROYECTO_DEMO} (ServMaq24).`);

  let altamira = await prisma.empresa.findFirst({ where: { nombre: EMPRESA_ALTAMIRA.nombre } });
  if (!altamira) {
    altamira = await prisma.empresa.create({ data: EMPRESA_ALTAMIRA });
    await prisma.contactoEmpresa.create({
      data: { empresaId: altamira.id, nombre: 'Ricardo Salinas', puesto: 'Director comercial', email: 'cliente.altamira@omnis.local', telefono: '442 310 2201', principal: true },
    });
  }
  const empresas = { demo: EMPRESA_DEMO, altamira: altamira.id };
  const u = await prepararCuentas(empresas);
  const equipo = { miembro: u.miembro, diseno: u.diseno };

  // ServMaq24: el equipo de prueba entra como miembro
  await prisma.proyecto.update({
    where: { id: PROYECTO_DEMO },
    data: { miembros: { connect: [{ id: u.admin }, { id: u.miembro }, { id: u.diseno }] } },
  });

  const proyectos = { servmaq: PROYECTO_DEMO };
  for (const p of PROYECTOS) {
    let proyecto = await prisma.proyecto.findFirst({ where: { nombre: p.nombre } });
    if (!proyecto) {
      proyecto = await prisma.proyecto.create({
        data: {
          nombre: p.nombre, descripcion: p.descripcion, estado: p.estado, area: p.area,
          fechaInicio: enDias(p.inicio, 9), fechaFin: enDias(p.fin, 18),
          creadorId: u.admin, clienteId: empresas[p.empresa],
          miembros: { connect: [{ id: u.admin }, { id: u.miembro }, { id: u.diseno }] },
        },
      });
      let numero = 1;
      for (const [titulo, estado, vence, quien] of p.tareas) {
        await prisma.tarea.create({
          data: {
            titulo, estado, numeroActividad: numero++, prioridad: vence < 4 && estado !== 'HECHO' ? 'ALTA' : 'MEDIA',
            proyectoId: proyecto.id, asignadoId: equipo[quien], creadorId: u.admin,
            fechaInicio: enDias(Math.max(p.inicio, vence - 7), 9),
            venceEn: enDias(vence, 18),
            completadoEn: estado === 'HECHO' ? enDias(vence - 1, 16) : null,
          },
        });
      }
    }
    proyectos[p.clave] = proyecto.id;
  }

  // Documentos compartidos con el cliente (archivos reales en el disco)
  const documentos = [
    ['Propuesta técnica sitio web.pdf', proyectos.web, ['Propuesta técnica - Sitio web ServMaq', 'Alcance: catálogo, cotizador y blog.', 'Entrega estimada: 5 semanas.', 'Documento de prueba.']],
    ['Cronograma de trabajo.pdf', proyectos.web, ['Cronograma de trabajo', 'Semana 1-2: diseño', 'Semana 3-4: desarrollo', 'Semana 5: pruebas y publicación']],
    ['Reporte mensual septiembre.pdf', proyectos.servmaq, ['Reporte mensual - Septiembre', 'Alcance en redes: 48,200', 'Interacciones: 3,950', 'Cotizaciones recibidas: 27']],
    ['Reporte final Expo Maquinaria.pdf', proyectos.expo, ['Reporte final - Expo Maquinaria 2026', 'Visitas al stand: 1,240', 'Prospectos captados: 186']],
    ['Propuestas de logotipo.pdf', proyectos.altamira, ['Propuestas de logotipo - Altamira', 'Tres rutas creativas para revisión.']],
  ];
  for (const [nombre, proyectoId, lineas] of documentos) {
    if (await prisma.adjunto.findFirst({ where: { nombre, proyectoId } })) continue;
    const { url, tamano } = await guardarArchivo(pdfSimple(lineas), '.pdf');
    await prisma.adjunto.create({ data: { nombre, url, tipo: 'application/pdf', tamano, usuarioId: u.admin, proyectoId, visibleCliente: true } });
  }
  // Uno interno, para comprobar que el cliente no lo ve
  if (!(await prisma.adjunto.findFirst({ where: { nombre: 'Notas internas de costos.txt', proyectoId: proyectos.web } }))) {
    const { url, tamano } = await guardarArchivo(Buffer.from('Costos internos del proyecto (no compartir con el cliente).\n'), '.txt');
    await prisma.adjunto.create({ data: { nombre: 'Notas internas de costos.txt', url, tipo: 'text/plain', tamano, usuarioId: u.admin, proyectoId: proyectos.web, visibleCliente: false } });
  }

  // Reuniones con el cliente (alertaMinutos 0: sin recordatorio por correo)
  const reuniones = [
    ['Revisión de avances del sitio (prueba)', EMPRESA_DEMO, proyectos.web, 2, 10, 'virtual', null, 'https://meet.google.com/abc-defg-hij'],
    ['Presentación del catálogo (prueba)', EMPRESA_DEMO, proyectos.web, 9, 16, 'presencial', 'Oficinas ServMaq, León, Gto.', null],
    ['Junta de arranque del sitio (prueba)', EMPRESA_DEMO, proyectos.web, -20, 11, 'virtual', null, 'https://meet.google.com/xyz-abcd-efg'],
    ['Reporte mensual de redes (prueba)', EMPRESA_DEMO, proyectos.servmaq, 5, 12, 'virtual', null, 'https://meet.google.com/lmn-opqr-stu'],
    ['Revisión de logotipos (prueba)', altamira.id, proyectos.altamira, 3, 13, 'presencial', 'Oficinas Altamira, Querétaro', null],
  ];
  for (const [titulo, empresaId, proyectoId, dia, hora, modalidad, ubicacion, urlReunion] of reuniones) {
    if (await prisma.evento.findFirst({ where: { titulo, empresaId } })) continue;
    await prisma.evento.create({
      data: {
        titulo, empresaId, proyectoId, modalidad, ubicacion, urlReunion,
        descripcion: 'Reunión de prueba con el cliente.',
        tipo: 'evento', usuarioId: u.admin, creadoPorId: u.admin, alertaMinutos: 0,
        fechaInicio: enDias(dia, hora), fechaFin: enDias(dia, hora + 1), color: '#10233f',
      },
    });
  }

  // Mensajes del portal (conversación de ida y vuelta)
  const conversaciones = [
    [proyectos.web, [
      [u.admin, false, -6, 'Hola Laura, ya está listo el diseño de la página de inicio. Lo puedes ver en la propuesta técnica.'],
      [u.clienteDemo, true, -5, '¡Se ve muy bien! ¿Podemos agregar un botón de WhatsApp en la parte superior?'],
      [u.miembro, false, -5, 'Claro, lo agregamos en el maquetado de esta semana.'],
      [u.clienteDemo, true, -1, 'Perfecto. ¿El cotizador podrá mandar la cotización por correo?'],
    ]],
    [proyectos.servmaq, [
      [u.admin, false, -3, 'Compartimos el reporte de septiembre en Documentos.'],
      [u.clienteDemo, true, -2, 'Gracias, lo reviso con dirección.'],
    ]],
    [proyectos.altamira, [
      [u.admin, false, -2, 'Ricardo, subimos las tres propuestas de logotipo.'],
    ]],
  ];
  for (const [proyectoId, mensajes] of conversaciones) {
    if (await prisma.mensajePortal.count({ where: { proyectoId } })) continue;
    for (const [autorId, deCliente, dia, contenido] of mensajes) {
      await prisma.mensajePortal.create({ data: { proyectoId, autorId, deCliente, contenido, creadoEn: enDias(dia, 10 + (deCliente ? 3 : 0)) } });
    }
  }

  // Contratos (además del CTR-2026-0003 que ya existe)
  const contratos = [
    {
      titulo: 'Desarrollo del sitio web corporativo (prueba)', estado: 'VIGENTE', empresaId: EMPRESA_DEMO, proyectoId: proyectos.web,
      categoria: 'SERVICIOS', monto: 85000, periodicidadPago: 'POR_ENTREGABLE', fechaFirma: enDias(-25), fechaInicio: enDias(-21), fechaFin: enDias(60),
      contraparteNombre: demo.nombre, contraparteRfc: demo.rfc, contraparteContacto: 'Laura Martínez',
    },
    {
      titulo: 'Acuerdo de confidencialidad (prueba)', estado: 'EN_REVISION', empresaId: EMPRESA_DEMO, proyectoId: null,
      categoria: 'CONFIDENCIALIDAD', monto: null, periodicidadPago: null, fechaFirma: null, fechaInicio: enDias(0), fechaFin: enDias(365),
      contraparteNombre: demo.nombre, contraparteRfc: demo.rfc, contraparteContacto: 'Laura Martínez',
    },
    {
      titulo: 'Campaña Expo Maquinaria 2026 (prueba)', estado: 'TERMINADO', empresaId: EMPRESA_DEMO, proyectoId: proyectos.expo,
      categoria: 'SERVICIOS', monto: 42000, periodicidadPago: 'UNICO', fechaFirma: enDias(-95), fechaInicio: enDias(-90), fechaFin: enDias(-30),
      contraparteNombre: demo.nombre, contraparteRfc: demo.rfc, contraparteContacto: 'Laura Martínez',
    },
    {
      titulo: 'Identidad de marca (prueba)', estado: 'VIGENTE', empresaId: altamira.id, proyectoId: proyectos.altamira,
      categoria: 'SERVICIOS', monto: 38000, periodicidadPago: 'POR_ENTREGABLE', fechaFirma: enDias(-12), fechaInicio: enDias(-10), fechaFin: enDias(20),
      contraparteNombre: altamira.nombre, contraparteRfc: altamira.rfc, contraparteContacto: 'Ricardo Salinas',
    },
  ];
  for (const c of contratos) {
    if (await prisma.contrato.findFirst({ where: { titulo: c.titulo, empresaId: c.empresaId } })) continue;
    const creado = await prisma.contrato.create({
      data: {
        ...c, tipo: 'CLIENTE', folio: `TMP-${crypto.randomUUID()}`, moneda: 'MXN', incluyeIva: false,
        descripcion: 'Contrato de prueba.', responsableId: u.admin, creadoPorId: u.admin,
      },
    });
    await prisma.contrato.update({ where: { id: creado.id }, data: { folio: `CTR-${hoy.getFullYear()}-${String(creado.id).padStart(4, '0')}` } });
  }

  // Avisos sin leer para el cliente demo
  if (!(await prisma.notificacion.count({ where: { usuarioId: u.clienteDemo } }))) {
    await prisma.notificacion.createMany({
      data: [
        { usuarioId: u.clienteDemo, tipo: 'MENSAJE_PORTAL', proyectoId: proyectos.web, actorNombre: 'Mariana Ortiz (prueba)', mensaje: `Mariana Ortiz (prueba) te escribió en "${PROYECTOS[0].nombre}"` },
        { usuarioId: u.clienteDemo, tipo: 'MENSAJE_PORTAL', proyectoId: proyectos.servmaq, actorNombre: 'Administrador de prueba', mensaje: 'Administrador de prueba te escribió en "ServMaq24"' },
      ],
    });
  }

  console.log('\nDatos de prueba listos. Contraseña de las cuentas nuevas:', PASSWORD);
  console.table(CUENTAS.map(({ email, rol, empresa }) => ({ correo: email, rol, empresa: empresa === 'demo' ? demo.nombre : empresa ? altamira.nombre : '' })));
};

// ── Borrado ────────────────────────────────────────────────────────────────

const borrar = async () => {
  const nombres = PROYECTOS.map((p) => p.nombre);
  const proyectos = await prisma.proyecto.findMany({ where: { nombre: { in: nombres } }, select: { id: true } });
  const ids = proyectos.map((p) => p.id);
  await prisma.contrato.deleteMany({ where: { titulo: { endsWith: '(prueba)' } } });
  await prisma.evento.deleteMany({ where: { titulo: { endsWith: '(prueba)' } } });
  await prisma.mensajePortal.deleteMany({ where: { proyectoId: { in: [...ids, PROYECTO_DEMO] } } });
  await prisma.adjunto.deleteMany({ where: { proyectoId: { in: ids } } });
  await prisma.adjunto.deleteMany({ where: { proyectoId: PROYECTO_DEMO, nombre: 'Reporte mensual septiembre.pdf' } });
  await prisma.notificacion.deleteMany({ where: { proyectoId: { in: ids } } });
  await prisma.tarea.deleteMany({ where: { proyectoId: { in: ids } } });
  await prisma.proyecto.deleteMany({ where: { id: { in: ids } } });
  await prisma.empresa.deleteMany({ where: { nombre: EMPRESA_ALTAMIRA.nombre } });
  await prisma.usuario.updateMany({
    where: { email: { in: ['miembro.prueba@omnis.local', 'diseno.prueba@omnis.local', 'cliente.altamira@omnis.local'] } },
    data: { estado: 'inactivo' },
  });
  console.log('Datos de prueba quitados (las cuentas de prueba nuevas quedan desactivadas).');
};

(async () => {
  const problema = validarPassword(PASSWORD, {});
  if (!problema.valido) salir(`La contraseña de prueba no cumple la política:\n - ${problema.errores.join('\n - ')}`);
  if (process.argv.includes('--borrar')) await borrar();
  else await cargar();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
