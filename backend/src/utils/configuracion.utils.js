/**
 * Configuracion de la instalacion (marca, colores, login, modulos y reglas).
 *
 * La base guarda un JSON; aqui estan los valores por defecto (la marca OMNIS
 * actual) y la validacion. Todo lo que llega del panel pasa por `validar`,
 * que devuelve SIEMPRE un objeto completo: campo que falte o no sea valido se
 * queda con el valor anterior o el de fabrica.
 *
 * Textos del login en null = usar los textos por defecto del idioma activo
 * (el frontend tiene versiones en español e ingles).
 */

const { PLANTILLAS, CAMPOS_TEXTO, camposDe } = require('./plantillasCorreo');

// Areas de fabrica. ADMINISTRACION es el area general: sus administradores ven
// todo el CRM, por eso no se puede quitar (si se puede renombrar).
const AREAS = ['DESARROLLO', 'ADMINISTRACION', 'COMUNICACION', 'MARKETING'];
const AREA_GENERAL = 'ADMINISTRACION';
const MAX_AREAS = 20;
const COLORES_AREA = ['#2563eb', '#f59e0b', '#8b5cf6', '#db2777', '#0d9488', '#ea580c', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#ca8a04', '#64748b'];
const AREAS_DEFECTO = [
  { clave: 'DESARROLLO', nombre: null, color: '#2563eb' },
  { clave: 'ADMINISTRACION', nombre: null, color: '#f59e0b' },
  { clave: 'COMUNICACION', nombre: null, color: '#8b5cf6' },
  { clave: 'MARKETING', nombre: null, color: '#db2777' },
];
const ICONOS_BENEFICIO = ['proyectos', 'agenda', 'seguridad', 'equipo', 'contratos', 'graficas', 'mensajes', 'estrella'];
const IDIOMAS = ['es', 'en'];
const TEMAS = ['sistema', 'claro', 'oscuro'];
// Modulos que se pueden apagar. Apagado = desaparece del menu y la API responde
// 404 MODULO_DESACTIVADO.
const MODULOS = ['contratos', 'clientes', 'portalClientes', 'agenda', 'plantillas', 'importar', 'reporteDiario', 'googleCalendar', 'adjuntos', 'comentarios'];
// Lo que puede hacer un MIEMBRO (los administradores siempre pueden).
const PERMISOS = ['crearProyectos', 'verTodosProyectos', 'crearTareas', 'editarTareas', 'borrarTareas', 'guardarPlantillas', 'subirAdjuntos'];
const SEGURIDAD_SMTP = ['starttls', 'ssl', 'ninguna'];
const REGEX_HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;
const REGEX_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Imagenes de marca que se pueden subir y para que sirve cada una.
const ARCHIVOS_MARCA = {
  logoClaro: { maxBytes: 1024 * 1024, mimes: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] },  // sobre fondo claro
  logoOscuro: { maxBytes: 1024 * 1024, mimes: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] }, // sobre fondo oscuro (menu, login)
  isotipo: { maxBytes: 512 * 1024, mimes: ['image/svg+xml', 'image/png', 'image/webp'] },                   // simbolo cuadrado (menu colapsado)
  favicon: { maxBytes: 256 * 1024, mimes: ['image/svg+xml', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'] },
  fondoLogin: { maxBytes: 3 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  // Logo para la cabecera de los correos. Solo PNG/JPG: Gmail y Outlook no
  // muestran SVG ni (Outlook) WEBP.
  logoCorreo: { maxBytes: 512 * 1024, mimes: ['image/png', 'image/jpeg'] },
};

// Diseño de los correos: opciones cerradas.
const CABECERAS_CORREO = ['color', 'blanco', 'franja'];
const LOGOS_CORREO = ['auto', 'texto'];
const ESQUINAS_CORREO = ['redondeadas', 'rectas'];
const BOTONES_CORREO = ['redondeado', 'recto', 'pildora'];

const DEFECTO = Object.freeze({
  marca: {
    nombreSistema: 'OMNIS CRM',
    nombreCorto: 'OMNIS',
    nombreEmpresa: 'OMNIS Proyectos Globales',
    eslogan: 'CRM interno',
  },
  colores: {
    primario: '#10233f',
    acento: '#c9a227',
    // En oscuro los fondos se tiñen con el color primario (azul noche en OMNIS).
    tenirModoOscuro: true,
  },
  login: {
    etiqueta: null,
    titulo: null,
    texto: null,
    mostrarBeneficios: true,
    beneficios: [
      { icono: 'proyectos', titulo: null, texto: null },
      { icono: 'agenda', titulo: null, texto: null },
      { icono: 'seguridad', titulo: null, texto: null },
    ],
    mostrarAnillo: true,
  },
  modulos: {
    contratos: true, clientes: true, portalClientes: true, agenda: true, plantillas: true, importar: true,
    reporteDiario: true, googleCalendar: true, adjuntos: true, comentarios: true,
  },
  // Permisos de los miembros. Los valores de fabrica son el comportamiento
  // que el CRM tenia antes de poder configurarlo.
  permisos: {
    crearProyectos: false,     // crear proyectos de su area
    verTodosProyectos: false,  // ver todos los proyectos, no solo en los que participa
    crearTareas: true,         // crear e importar tareas en proyectos donde es miembro
    editarTareas: true,        // editar y mover sus tareas (propias, asignadas o sin asignar)
    borrarTareas: true,        // borrar esas mismas tareas
    guardarPlantillas: false,  // guardar un proyecto suyo como plantilla
    subirAdjuntos: true,       // subir archivos a tareas y proyectos
  },
  // Reglas al crear tareas (manual, importacion y plantillas).
  tareas: {
    estadoInicial: 'PENDIENTE',
    prioridadDefecto: 'MEDIA',
    exigirFechaLimite: false,
    exigirResponsable: false,
    asignarAlCreador: true,    // sin responsable -> se asigna a quien la crea (si es miembro)
    diasPorVencer: 2,          // se marca "por vencer" cuando faltan estos dias o menos
  },
  // Servidor de correo (SMTP). host null = sin configurar. La contraseña se
  // guarda cifrada (AES-256-GCM) y nunca sale de la API.
  correo: {
    host: null,
    puerto: 587,
    seguridad: 'starttls',     // 'starttls' (587) | 'ssl' (465) | 'ninguna'
    usuario: null,
    remitenteEmail: null,
    passwordCifrada: null,
  },
  // Diseño de los correos que envia el sistema. Los colores null usan los de
  // la marca; los textos null, los de fabrica.
  disenoCorreo: {
    cabecera: 'color',        // 'color' (fondo del color principal) | 'blanco' | 'franja' (barra arriba)
    logo: 'auto',             // 'auto' (logo si hay uno compatible) | 'texto'
    logoAltura: 36,           // px
    alineacion: 'izquierda',  // 'izquierda' | 'centro' (cabecera)
    esquinas: 'redondeadas',
    boton: 'redondeado',
    colorFondo: '#f3f5f9',    // fondo alrededor de la tarjeta
    colorBoton: null,         // null = color principal
    pieTexto: null,           // null = "Correo automático de {sistema}. No respondas a este mensaje."
    direccion: null,
    telefono: null,
    sitioWeb: null,
    textoLegal: null,
  },
  // Textos propios por plantilla: { invitacion: { asunto, titulo, cuerpo, boton, nota } }.
  textosCorreo: {},
  reglas: {
    idiomaPorDefecto: 'es',
    temaPorDefecto: 'sistema',
    remitenteCorreo: null,
    // nombre null = nombre de fabrica traducido (solo las cuatro de fabrica).
    areas: AREAS_DEFECTO,
  },
  // Reglas de acceso. Se aplican en login, middleware, sesiones e invitaciones.
  seguridad: {
    passwordMin: 10,
    dosFactores: 'ninguno', // 'ninguno' | 'admins' | 'todos'
    sesionHoras: 12,        // sesion normal
    recordarDias: 30,       // "mantener sesion"; 0 = no se ofrece
    intentosBloqueo: 5,
    bloqueoMinutos: 15,
    invitacionHoras: 48,
    registro: null,         // null = REGISTRO_MODO del entorno (por defecto cerrado)
    dominiosRegistro: null, // 'empresa.com, otra.mx'; null = REGISTRO_DOMINIOS
  },
  // Subidas de archivos. Se aplican en los middlewares de subida.
  subidas: {
    adjuntosMaxMB: 4,
    tiposAdjuntos: { pdf: true, imagenes: true, office: true, texto: true, comprimidos: true },
    fotoPerfilMaxMB: 2,
    contratosMaxMB: 25,
  },
  // Avisos que genera el sistema.
  avisos: {
    tareas: true,           // asignaciones y cambios de tareas
    comentarios: true,      // comentarios en tareas
    recordatorios: true,    // eventos de agenda compartidos / globales
    nuevoDispositivo: true, // correo al entrar desde un navegador nuevo
    // Avisos por correo (ademas del aviso dentro del CRM)
    correoAsignaciones: true,  // tarea asignada, agregado a un proyecto
    correoInvitaciones: true,  // invitacion a evento o reunion
    correoRecordatorios: true, // antes de que empiece un evento
    minutosRecordatorio: 30,   // si el evento no trae su propio aviso
    correoResumenDiario: true, // cada mañana: vencen hoy/mañana, vencidas, proyectos por terminar
    horaResumen: '08:00',
  },
  // Google Calendar: credenciales OAuth del cliente de Google de la empresa.
  // El secreto se guarda cifrado y nunca sale de la API.
  google: {
    clientId: null,
    secretCifrado: null,
  },
  // Operacion diaria: horario, zona horaria y nombres de estados.
  operacion: {
    zonaHoraria: 'America/Mexico_City',
    diasLaborales: [1, 2, 3, 4, 5],
    horaEntrada: '09:00',
    horaSalida: '18:00',
    horaComidaInicio: '14:00',
    horaComidaFin: '15:00',
    etiquetasEstados: { PENDIENTE: null, EN_PROGRESO: null, HECHO: null },
    etiquetasPrioridades: { BAJA: null, MEDIA: null, ALTA: null },
    feriadosOficiales: true,   // mostrar los feriados oficiales en el calendario
    horariosPorDia: {},        // dias con horario distinto (p. ej. sabado 09:00-14:00)
  },
});

// Zonas horarias que se ofrecen (IANA). Las que tienen horario de verano se
// resuelven bien porque el desfase se calcula para cada fecha con Intl.
const ZONAS_HORARIAS = [
  'America/Mexico_City', 'America/Cancun', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana',
  'America/Bogota', 'America/Lima', 'America/Guayaquil', 'America/Caracas', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Montevideo', 'America/Asuncion', 'America/La_Paz', 'America/Guatemala', 'America/El_Salvador', 'America/Tegucigalpa',
  'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Santo_Domingo', 'America/Puerto_Rico',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid', 'UTC',
];
const TIPOS_ADJUNTO = ['pdf', 'imagenes', 'office', 'texto', 'comprimidos'];
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const clonar = (valor) => JSON.parse(JSON.stringify(valor));

const REGEX_COLOR = /^#[0-9a-f]{6}$/i;

const texto = (valor, max, anterior) => {
  if (valor === undefined) return anterior;
  if (valor === null) return null;
  const limpio = String(valor).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return limpio ? limpio.slice(0, max) : null;
};
const textoObligatorio = (valor, max, anterior, defecto) => texto(valor, max, anterior) || anterior || defecto;
const booleano = (valor, anterior) => (typeof valor === 'boolean' ? valor : anterior);
const deLista = (valor, lista, anterior) => (lista.includes(valor) ? valor : anterior);
const color = (valor, anterior) => (typeof valor === 'string' && REGEX_COLOR.test(valor) ? valor.toLowerCase() : anterior);
const entero = (valor, min, max, anterior) => {
  if (valor === undefined || valor === null || valor === '') return anterior;
  const n = Number(valor);
  return Number.isInteger(n) && n >= min && n <= max ? n : anterior;
};
const hora = (valor, anterior) => (typeof valor === 'string' && REGEX_HORA.test(valor) ? valor : anterior);
const etiquetas = (entrada, base = {}, claves = []) => Object.fromEntries(
  claves.map((clave) => [clave, texto((entrada || {})[clave], 30, base[clave] ?? null)]),
);

/** "Atención a clientes" -> "ATENCION_A_CLIENTES" (clave estable que se guarda en la base). */
const claveDeArea = (nombre) => String(nombre || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  .slice(0, 30);

/**
 * Lista de areas. Las que ya existian conservan su clave (aunque cambie el
 * nombre); las nuevas reciben una clave derivada del nombre. El area general
 * nunca se pierde. Las de fabrica pueden quedar sin nombre (= traduccion).
 */
const validarAreas = (entrada, base) => {
  const previas = Array.isArray(base) && base.length ? base : clonar(AREAS_DEFECTO);
  if (!Array.isArray(entrada)) return previas;
  const porClave = new Map(previas.map((a) => [a.clave, a]));
  const usadas = new Set();
  const nombresUsados = new Set();
  const salida = [];
  const colorLibre = () => COLORES_AREA.find((c) => !salida.some((a) => a.color === c) && !entrada.some((a) => a?.color === c) && porClave.get(AREA_GENERAL)?.color !== c) || COLORES_AREA[salida.length % COLORES_AREA.length];
  for (const item of entrada.slice(0, MAX_AREAS)) {
    if (!item || typeof item !== 'object') continue;
    const nombre = texto(item.nombre, 40, null);
    let clave = typeof item.clave === 'string' && porClave.has(item.clave) ? item.clave : null;
    if (!clave) {
      const baseClave = claveDeArea(nombre);
      if (!baseClave) continue; // area nueva sin nombre: se ignora
      clave = baseClave;
      for (let n = 2; usadas.has(clave) || porClave.has(clave); n += 1) clave = `${baseClave.slice(0, 27)}_${n}`;
    }
    if (usadas.has(clave)) continue;
    // Las de fabrica pueden ir sin nombre; las nuevas, no.
    if (!nombre && !AREAS.includes(clave)) continue;
    // Dos areas con el mismo nombre (sin contar acentos ni mayusculas) confunden.
    const normal = claveDeArea(nombre || clave);
    if (nombresUsados.has(normal)) continue;
    nombresUsados.add(normal);
    usadas.add(clave);
    salida.push({ clave, nombre, color: color(item.color, porClave.get(clave)?.color || colorLibre()) });
  }
  if (!usadas.has(AREA_GENERAL)) {
    salida.unshift(porClave.get(AREA_GENERAL) || clonar(AREAS_DEFECTO.find((a) => a.clave === AREA_GENERAL)));
  }
  return salida.slice(0, MAX_AREAS);
};

/** Texto de varias lineas: conserva los saltos de linea (maximo dos seguidos). */
const textoLargo = (valor, max, anterior) => {
  if (valor === undefined) return anterior;
  if (valor === null) return null;
  const limpio = String(valor)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpio ? limpio.slice(0, max) : null;
};

/** Sitio web del pie: solo http(s); sin esquema se asume https. */
const sitioWeb = (valor, anterior) => {
  if (valor === undefined) return anterior;
  const limpio = texto(valor, 200, null);
  if (!limpio) return null;
  const url = /^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href.replace(/\/$/, '') : anterior;
  } catch (_e) {
    return anterior;
  }
};

/**
 * Textos propios de los correos. Si llega el objeto, es el mapa COMPLETO (el
 * panel siempre manda todo): plantilla o campo que falte o venga vacio vuelve
 * al texto de fabrica. Solo se guardan plantillas y campos que existen.
 */
const validarTextosCorreo = (entrada, base) => {
  const previos = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  if (entrada === undefined) return clonar(previos);
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return {};
  const salida = {};
  for (const plantilla of PLANTILLAS) {
    const fuente = entrada[plantilla.id];
    if (!fuente || typeof fuente !== 'object') continue;
    const campos = {};
    for (const campo of camposDe(plantilla)) {
      const max = CAMPOS_TEXTO[campo];
      const valor = campo === 'cuerpo' || campo === 'nota'
        ? textoLargo(fuente[campo], max, null)
        : texto(fuente[campo], max, null);
      if (valor) campos[campo] = valor;
    }
    if (Object.keys(campos).length) salida[plantilla.id] = campos;
  }
  return salida;
};

/** Configuraciones guardadas antes de las areas editables solo tenian nombres. */
const areasHeredadas = (reglas) => {
  if (Array.isArray(reglas?.areas) && reglas.areas.length) return reglas.areas;
  const nombres = reglas?.etiquetasAreas || {};
  return AREAS_DEFECTO.map((a) => ({ ...a, nombre: nombres[a.clave] || null }));
};

/**
 * Mezcla `entrada` (parcial, lo que manda el panel) sobre `base` (lo guardado)
 * y devuelve la configuracion completa y valida.
 */
const validar = (entrada = {}, base = DEFECTO) => {
  const b = { ...clonar(DEFECTO), ...clonar(base || {}) };
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const m = e.marca || {};
  const c = e.colores || {};
  const l = e.login || {};
  const mo = e.modulos || {};
  const r = e.reglas || {};
  const bm = { ...DEFECTO.marca, ...b.marca };
  const bc = { ...DEFECTO.colores, ...b.colores };
  const bl = { ...clonar(DEFECTO.login), ...b.login };
  const br = { ...clonar(DEFECTO.reglas), ...b.reglas };

  const beneficiosBase = Array.isArray(bl.beneficios) ? bl.beneficios : clonar(DEFECTO.login.beneficios);
  const beneficiosEntrada = Array.isArray(l.beneficios) ? l.beneficios.slice(0, 3) : null;
  // Siempre tres; el que no venga (o venga incompleto) conserva lo anterior.
  const beneficios = [0, 1, 2].map((i) => {
    const previo = beneficiosBase[i] || DEFECTO.login.beneficios[i] || {};
    const fuente = (beneficiosEntrada && beneficiosEntrada[i]) || {};
    return {
      icono: deLista(fuente.icono, ICONOS_BENEFICIO, previo.icono || 'estrella'),
      titulo: texto(fuente.titulo, 60, previo.titulo ?? null),
      texto: texto(fuente.texto, 140, previo.texto ?? null),
    };
  });

  const pe = e.permisos || {};
  const ta = e.tareas || {};
  const co = e.correo || {};
  const bpe = { ...clonar(DEFECTO.permisos), ...(b.permisos || {}) };
  const bta = { ...clonar(DEFECTO.tareas), ...(b.tareas || {}) };
  const bco = { ...clonar(DEFECTO.correo), ...(b.correo || {}) };
  const s = e.seguridad || {};
  const a = e.subidas || {};
  const av = e.avisos || {};
  const o = e.operacion || {};
  const bs = { ...clonar(DEFECTO.seguridad), ...(b.seguridad || {}) };
  const ba = { ...clonar(DEFECTO.subidas), ...(b.subidas || b.archivos || {}) };
  const bav = { ...clonar(DEFECTO.avisos), ...(b.avisos || {}) };
  const bo = { ...clonar(DEFECTO.operacion), ...(b.operacion || {}) };
  const dc = e.disenoCorreo || {};
  const bdc = { ...clonar(DEFECTO.disenoCorreo), ...(b.disenoCorreo || {}) };
  const tiposBase = { ...DEFECTO.subidas.tiposAdjuntos, ...(ba.tiposAdjuntos || {}) };
  const diasEntrada = Array.isArray(o.diasLaborales)
    ? [...new Set(o.diasLaborales.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((x, y) => x - y)
    : null;
  // Dominios: lista separada por comas, solo dominios con forma valida.
  const dominios = s.dominiosRegistro === undefined
    ? bs.dominiosRegistro
    : (texto(s.dominiosRegistro, 300, null) || '')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
      .join(', ') || null;


  return {
    marca: {
      nombreSistema: textoObligatorio(m.nombreSistema, 40, bm.nombreSistema, DEFECTO.marca.nombreSistema),
      nombreCorto: textoObligatorio(m.nombreCorto, 20, bm.nombreCorto, DEFECTO.marca.nombreCorto),
      nombreEmpresa: textoObligatorio(m.nombreEmpresa, 80, bm.nombreEmpresa, DEFECTO.marca.nombreEmpresa),
      eslogan: texto(m.eslogan, 40, bm.eslogan),
    },
    colores: {
      primario: color(c.primario, bc.primario),
      acento: color(c.acento, bc.acento),
      tenirModoOscuro: booleano(c.tenirModoOscuro, bc.tenirModoOscuro),
    },
    login: {
      etiqueta: texto(l.etiqueta, 40, bl.etiqueta),
      titulo: texto(l.titulo, 80, bl.titulo),
      texto: texto(l.texto, 220, bl.texto),
      mostrarBeneficios: booleano(l.mostrarBeneficios, bl.mostrarBeneficios),
      beneficios,
      mostrarAnillo: booleano(l.mostrarAnillo, bl.mostrarAnillo),
    },
    modulos: Object.fromEntries(MODULOS.map((clave) => [clave, booleano(mo[clave], b.modulos?.[clave] ?? true)])),
    permisos: Object.fromEntries(PERMISOS.map((clave) => [clave, booleano(pe[clave], bpe[clave])])),
    tareas: {
      estadoInicial: deLista(ta.estadoInicial, ['PENDIENTE', 'EN_PROGRESO'], bta.estadoInicial),
      prioridadDefecto: deLista(ta.prioridadDefecto, ['BAJA', 'MEDIA', 'ALTA'], bta.prioridadDefecto),
      exigirFechaLimite: booleano(ta.exigirFechaLimite, bta.exigirFechaLimite),
      exigirResponsable: booleano(ta.exigirResponsable, bta.exigirResponsable),
      asignarAlCreador: booleano(ta.asignarAlCreador, bta.asignarAlCreador),
      diasPorVencer: entero(ta.diasPorVencer, 0, 30, bta.diasPorVencer),
    },
    correo: {
      host: co.host === undefined ? bco.host
        : (texto(co.host, 253, null) && REGEX_HOST.test(texto(co.host, 253, null)) ? texto(co.host, 253, null).toLowerCase() : (co.host === null || co.host === '' ? null : bco.host)),
      puerto: entero(co.puerto, 1, 65535, bco.puerto),
      seguridad: deLista(co.seguridad, SEGURIDAD_SMTP, bco.seguridad),
      usuario: texto(co.usuario, 160, bco.usuario),
      remitenteEmail: co.remitenteEmail === undefined ? bco.remitenteEmail
        : (texto(co.remitenteEmail, 160, null) && REGEX_EMAIL.test(texto(co.remitenteEmail, 160, null)) ? texto(co.remitenteEmail, 160, null).toLowerCase() : (co.remitenteEmail ? bco.remitenteEmail : null)),
      // Solo la pone el controlador (ya cifrada); el panel nunca la manda.
      passwordCifrada: typeof co.passwordCifrada === 'string' || co.passwordCifrada === null ? co.passwordCifrada : bco.passwordCifrada,
    },
    disenoCorreo: {
      cabecera: deLista(dc.cabecera, CABECERAS_CORREO, bdc.cabecera),
      logo: deLista(dc.logo, LOGOS_CORREO, bdc.logo),
      logoAltura: entero(dc.logoAltura, 20, 80, bdc.logoAltura),
      alineacion: deLista(dc.alineacion, ['izquierda', 'centro'], bdc.alineacion),
      esquinas: deLista(dc.esquinas, ESQUINAS_CORREO, bdc.esquinas),
      boton: deLista(dc.boton, BOTONES_CORREO, bdc.boton),
      colorFondo: color(dc.colorFondo, bdc.colorFondo),
      colorBoton: dc.colorBoton === null ? null : color(dc.colorBoton, bdc.colorBoton),
      pieTexto: texto(dc.pieTexto, 200, bdc.pieTexto),
      direccion: texto(dc.direccion, 160, bdc.direccion),
      telefono: texto(dc.telefono, 40, bdc.telefono),
      sitioWeb: sitioWeb(dc.sitioWeb, bdc.sitioWeb),
      textoLegal: textoLargo(dc.textoLegal, 600, bdc.textoLegal),
    },
    textosCorreo: validarTextosCorreo(e.textosCorreo, b.textosCorreo),
    reglas: {
      idiomaPorDefecto: deLista(r.idiomaPorDefecto, IDIOMAS, br.idiomaPorDefecto),
      temaPorDefecto: deLista(r.temaPorDefecto, TEMAS, br.temaPorDefecto),
      remitenteCorreo: texto(r.remitenteCorreo, 60, br.remitenteCorreo),
      areas: validarAreas(r.areas, areasHeredadas(b.reglas)),
    },
    seguridad: {
      passwordMin: entero(s.passwordMin, 8, 32, bs.passwordMin),
      dosFactores: deLista(s.dosFactores, ['ninguno', 'admins', 'todos'], bs.dosFactores),
      sesionHoras: entero(s.sesionHoras, 1, 24, bs.sesionHoras),
      recordarDias: entero(s.recordarDias, 0, 90, bs.recordarDias),
      intentosBloqueo: entero(s.intentosBloqueo, 3, 10, bs.intentosBloqueo),
      bloqueoMinutos: entero(s.bloqueoMinutos, 5, 240, bs.bloqueoMinutos),
      invitacionHoras: entero(s.invitacionHoras, 12, 168, bs.invitacionHoras),
      registro: s.registro === null ? null : deLista(s.registro, ['cerrado', 'aprobacion', 'abierto'], bs.registro),
      dominiosRegistro: dominios,
    },
    subidas: {
      adjuntosMaxMB: entero(a.adjuntosMaxMB, 1, 25, ba.adjuntosMaxMB),
      tiposAdjuntos: Object.fromEntries(TIPOS_ADJUNTO.map((tipo) => [tipo, booleano((a.tiposAdjuntos || {})[tipo], tiposBase[tipo] !== false)])),
      fotoPerfilMaxMB: entero(a.fotoPerfilMaxMB, 1, 5, ba.fotoPerfilMaxMB),
      contratosMaxMB: entero(a.contratosMaxMB, 1, 50, ba.contratosMaxMB),
    },
    avisos: {
      tareas: booleano(av.tareas, bav.tareas),
      comentarios: booleano(av.comentarios, bav.comentarios),
      recordatorios: booleano(av.recordatorios, bav.recordatorios),
      nuevoDispositivo: booleano(av.nuevoDispositivo, bav.nuevoDispositivo),
      correoAsignaciones: booleano(av.correoAsignaciones, bav.correoAsignaciones),
      correoInvitaciones: booleano(av.correoInvitaciones, bav.correoInvitaciones),
      correoRecordatorios: booleano(av.correoRecordatorios, bav.correoRecordatorios),
      minutosRecordatorio: entero(av.minutosRecordatorio, 5, 1440, bav.minutosRecordatorio),
      correoResumenDiario: booleano(av.correoResumenDiario, bav.correoResumenDiario),
      horaResumen: hora(av.horaResumen, bav.horaResumen),
    },
    google: (() => {
      const g = e.google || {};
      const bg = { ...clonar(DEFECTO.google), ...(b.google || {}) };
      const id = g.clientId === undefined ? bg.clientId
        : (texto(g.clientId, 200, null) && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(texto(g.clientId, 200, null)) ? texto(g.clientId, 200, null) : (g.clientId ? bg.clientId : null));
      return {
        clientId: id,
        // Solo la pone el controlador (ya cifrada); el panel nunca la manda.
        secretCifrado: typeof g.secretCifrado === 'string' || g.secretCifrado === null ? g.secretCifrado : bg.secretCifrado,
      };
    })(),
    operacion: {
      zonaHoraria: deLista(o.zonaHoraria, ZONAS_HORARIAS, bo.zonaHoraria),
      diasLaborales: diasEntrada && diasEntrada.length > 0 ? diasEntrada : bo.diasLaborales,
      horaEntrada: hora(o.horaEntrada, bo.horaEntrada),
      horaSalida: hora(o.horaSalida, bo.horaSalida),
      horaComidaInicio: hora(o.horaComidaInicio, bo.horaComidaInicio),
      horaComidaFin: hora(o.horaComidaFin, bo.horaComidaFin),
      etiquetasEstados: etiquetas(o.etiquetasEstados, bo.etiquetasEstados, ['PENDIENTE', 'EN_PROGRESO', 'HECHO']),
      etiquetasPrioridades: etiquetas(o.etiquetasPrioridades, bo.etiquetasPrioridades, ['BAJA', 'MEDIA', 'ALTA']),
      feriadosOficiales: booleano(o.feriadosOficiales, bo.feriadosOficiales !== false),
      horariosPorDia: (() => {
        if (o.horariosPorDia === undefined) return bo.horariosPorDia || {};
        const { horarios, error } = require('./horarios.utils').validarHorariosPorDia(o.horariosPorDia);
        return error ? (bo.horariosPorDia || {}) : horarios;
      })(),
    },
  };
};

// ---------------------------------------------------------------------------
// Validacion de imagenes de marca (por contenido, no por lo que diga el cliente)
// ---------------------------------------------------------------------------

const firmas = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/x-icon': (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
};
firmas['image/vnd.microsoft.icon'] = firmas['image/x-icon'];

/**
 * Un SVG puede llevar JavaScript. Aunque los logos se muestran con <img> (que
 * no ejecuta scripts) y se sirven con CSP 'sandbox', se rechaza cualquier SVG
 * con contenido activo o referencias externas: defensa en profundidad.
 */
const svgSeguro = (buffer) => {
  const contenido = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(contenido)) return false;
  const peligroso = [
    /<script/i, /<foreignObject/i, /<iframe/i, /<embed/i, /<object/i,
    /\son[a-z]+\s*=/i, /javascript:/i, /data:text\/html/i,
    /<!ENTITY/i, /<\?xml-stylesheet/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i,
    /url\(\s*["']?\s*(?!#|data:image\/)/i,
    /@import/i,
  ];
  return !peligroso.some((patron) => patron.test(contenido));
};

/** Devuelve el mime real del archivo o lanza un Error con mensaje para el usuario. */
const validarArchivoMarca = (clave, buffer, mimeDeclarado) => {
  const reglas = ARCHIVOS_MARCA[clave];
  if (!reglas) throw new Error('Tipo de imagen no reconocido');
  if (!buffer?.length) throw new Error('El archivo está vacío');
  if (buffer.length > reglas.maxBytes) throw new Error(`La imagen supera ${Math.round(reglas.maxBytes / 1024)} KB`);

  const esSvg = mimeDeclarado === 'image/svg+xml' || /^\s*(<\?xml|<svg)/i.test(buffer.subarray(0, 200).toString('utf8'));
  if (esSvg) {
    if (!reglas.mimes.includes('image/svg+xml')) throw new Error('Este campo no admite SVG');
    if (!svgSeguro(buffer)) throw new Error('El SVG contiene elementos no permitidos (scripts, enlaces externos o eventos)');
    return 'image/svg+xml';
  }
  const mime = Object.keys(firmas).find((tipo) => reglas.mimes.includes(tipo) && firmas[tipo](buffer));
  if (!mime) throw new Error(`Formato no admitido. Usa ${reglas.mimes.map((x) => x.split('/')[1].replace('svg+xml', 'svg').replace('vnd.microsoft.icon', 'ico').replace('x-icon', 'ico')).filter((x, i, a) => a.indexOf(x) === i).join(', ').toUpperCase()}`);
  return mime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : mime;
};

module.exports = {
  DEFECTO,
  ZONAS_HORARIAS,
  TIPOS_ADJUNTO,
  AREAS,
  AREA_GENERAL,
  MAX_AREAS,
  claveDeArea,
  ICONOS_BENEFICIO,
  MODULOS,
  PERMISOS,
  ARCHIVOS_MARCA,
  validar,
  validarArchivoMarca,
  svgSeguro,
};
