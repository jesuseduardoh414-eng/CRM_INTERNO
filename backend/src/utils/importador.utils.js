const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { mediodiaMexico, instanteLocal, desfaseMs, claveDiaMexico } = require('./fechas.utils');
const { configEnCache } = require('../services/configuracion.service');

// Reglas de tareas del panel de configuracion (estado/prioridad por defecto,
// campos obligatorios y si se asigna al creador).
const reglasTareas = () => configEnCache().tareas;

const ESTADOS_VALIDOS = ['PENDIENTE', 'EN_PROGRESO', 'HECHO'];
const PRIORIDADES_VALIDAS = ['BAJA', 'MEDIA', 'ALTA'];
const COLUMNAS_EXCEL = ['numeroActividad', 'titulo', 'descripcion', 'estado', 'prioridad', 'fechaInicio', 'venceEn', 'asignadoEmail', 'completadoEn', 'horaCompletado'];

// Tope por importacion. Con mas filas la transaccion se alarga demasiado para
// una funcion serverless y el usuario no puede revisar la vista previa.
const LIMITE_FILAS_IMPORTACION = 500;

// Fuera de este rango la fecha es casi seguro un error de captura (o un
// numero de serie de Excel mal interpretado).
const ANIO_MINIMO = 2000;
const ANIO_MAXIMO = 2100;

const IMPORT_TASK_INCLUDE = {
  asignado: {
    select: { id: true, nombre: true, area: true },
  },
  asignados: {
    select: { id: true, nombre: true, area: true },
  },
  creador: {
    select: { id: true, nombre: true, area: true },
  },
};

// Error "de usuario": el archivo o los datos vienen mal. El controlador lo
// devuelve como 400 con el mensaje tal cual. Cualquier otro error es un 500
// generico, para no filtrar mensajes de Prisma al cliente.
class ErrorImportacion extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ErrorImportacion';
    this.status = status;
  }
}

// ── Cabeceras ────────────────────────────────────────────────────────────────
// Se aceptan variantes con tildes, mayusculas, espacios o guiones ("Título",
// "TITULO", "Vence en", "fecha_inicio"...). Todo se compara sin acentos, en
// minusculas y sin separadores.
const normalizarClave = (texto) => String(texto || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const ALIAS_COLUMNAS = {
  numeroActividad: ['numeroactividad', 'numero', 'num', 'no', 'n', 'actividad', 'numerodeactividad', 'noactividad'],
  titulo: ['titulo', 'title', 'tarea', 'nombre', 'nombredelatarea'],
  descripcion: ['descripcion', 'description', 'detalle', 'detalles'],
  estado: ['estado', 'status', 'situacion'],
  prioridad: ['prioridad', 'priority'],
  fechaInicio: ['fechainicio', 'inicio', 'fechadeinicio', 'start', 'startdate', 'fechainicial'],
  venceEn: ['venceen', 'vence', 'fechafin', 'fechalimite', 'limite', 'vencimiento', 'fechadevencimiento', 'fechadefin', 'due', 'duedate', 'deadline', 'fechafinal'],
  asignadoEmail: ['asignadoemail', 'asignado', 'email', 'correo', 'responsable', 'correoresponsable', 'emailasignado', 'correodelresponsable', 'asignadoa'],
  // Cuando se hizo la tarea. Puede traer la hora en la misma celda o en
  // `horaCompletado`; ninguna de las dos es obligatoria.
  completadoEn: ['completadoen', 'completado', 'fechacompletado', 'fechadecompletado', 'fechacompletada', 'completadael', 'terminadoen', 'fechaterminado', 'fechadetermino', 'fechatermino', 'hechoen', 'fechahecho', 'fechacierre', 'fechadecierre', 'cerradoen', 'finalizadoen', 'fechafinalizacion', 'fechadefinalizacion', 'fecharealizacion', 'fechaderealizacion', 'realizadoen', 'completedat', 'completed', 'donedate', 'doneat'],
  horaCompletado: ['horacompletado', 'horadecompletado', 'horacompletada', 'horaterminado', 'horadetermino', 'horatermino', 'horahecho', 'horacierre', 'horadecierre', 'horafinalizacion', 'horarealizacion', 'horaderealizacion', 'hora', 'completedtime', 'donetime'],
};

const MAPA_CABECERAS = Object.entries(ALIAS_COLUMNAS).reduce((mapa, [columna, alias]) => {
  alias.forEach((nombre) => { mapa[nombre] = columna; });
  return mapa;
}, {});

// Devuelve la fila con las claves canonicas (titulo, venceEn...). Si dos
// cabeceras apuntan a la misma columna, gana la primera.
const normalizarCabecerasFila = (fila = {}) => {
  const salida = {};
  if (!fila || typeof fila !== 'object') return salida;
  Object.entries(fila).forEach(([clave, valor]) => {
    const columna = MAPA_CABECERAS[normalizarClave(clave)];
    if (columna && !(columna in salida)) salida[columna] = valor;
  });
  return salida;
};

const filaTieneDatos = (fila) => COLUMNAS_EXCEL.some((col) => {
  const valor = fila[col];
  if (valor === undefined || valor === null) return false;
  if (valor instanceof Date) return true;
  return String(valor).trim() !== '';
});

// ── Estados y prioridades ────────────────────────────────────────────────────
const normalizarEstado = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  const mapa = {
    PENDIENTE: 'PENDIENTE',
    'POR HACER': 'PENDIENTE',
    POR_HACER: 'PENDIENTE',
    EN_PROGRESO: 'EN_PROGRESO',
    'EN PROGRESO': 'EN_PROGRESO',
    'EN-PROGRESO': 'EN_PROGRESO',
    HECHO: 'HECHO',
    COMPLETADO: 'HECHO',
    TERMINADO: 'HECHO',
  };

  return mapa[raw] || raw;
};

const normalizarPrioridad = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  const mapa = {
    BAJA: 'BAJA',
    MEDIA: 'MEDIA',
    ALTA: 'ALTA',
    LOW: 'BAJA',
    MEDIUM: 'MEDIA',
    HIGH: 'ALTA',
  };

  return mapa[raw] || raw;
};

// ── Fechas ───────────────────────────────────────────────────────────────────
// Construye el dia civil validando que exista en el calendario y que el año
// este en rango. El resultado es el mediodia de Mexico de ese dia, que es la
// hora neutra con la que se guardan fechas que solo importan como dia.
const construirFechaCivil = (year, month, day, origen) => {
  const fecha = new Date(Date.UTC(year, month - 1, day));
  const existe = Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    && fecha.getUTCFullYear() === year
    && fecha.getUTCMonth() === month - 1
    && fecha.getUTCDate() === day;

  if (!existe) {
    return { fecha: null, error: `"${origen}" no es una fecha real` };
  }
  if (year < ANIO_MINIMO || year > ANIO_MAXIMO) {
    return { fecha: null, error: `"${origen}" tiene un año fuera de rango (${ANIO_MINIMO}-${ANIO_MAXIMO})` };
  }
  return { fecha: mediodiaMexico({ year, month: month - 1, day }), error: null };
};

/**
 * Interpreta una fecha tal como llega del archivo. Acepta:
 *  - Date (celdas de Excel leidas con `cellDates: true`),
 *  - numero de serie de Excel (celdas sin formato de fecha; `new Date(45822)`
 *    daria 1970),
 *  - 'YYYY-MM-DD' (con o sin hora detras) y 'DD/MM/YYYY' (o con guiones).
 * Devuelve { fecha, error }. Vacio → fecha null sin error.
 */
const parsearFechaImportada = (valor) => {
  if (valor === undefined || valor === null || valor === '') return { fecha: null, error: null };

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return { fecha: null, error: 'la fecha no es válida' };
    // xlsx construye la fecha en hora local y a veces con unos segundos de
    // desfase; se redondea al minuto y se leen las partes locales, que son
    // las que el usuario escribio en la celda.
    const redondeada = new Date(Math.round(valor.getTime() / 60000) * 60000);
    return construirFechaCivil(
      redondeada.getFullYear(),
      redondeada.getMonth() + 1,
      redondeada.getDate(),
      valor.toISOString().slice(0, 10),
    );
  }

  const esSerialExcel = typeof valor === 'number'
    || (typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor.trim()));
  if (esSerialExcel) {
    const serial = Number(valor);
    const partes = Number.isFinite(serial) && serial > 0 ? XLSX.SSF.parse_date_code(serial) : null;
    if (!partes) return { fecha: null, error: `"${valor}" no es una fecha válida` };
    return construirFechaCivil(partes.y, partes.m, partes.d, valor);
  }

  if (typeof valor === 'string') {
    const texto = valor.trim();

    let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (m) return construirFechaCivil(Number(m[1]), Number(m[2]), Number(m[3]), texto);

    m = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return construirFechaCivil(Number(m[3]), Number(m[2]), Number(m[1]), texto);

    return { fecha: null, error: `"${texto}" no es una fecha válida (usa YYYY-MM-DD o DD/MM/YYYY)` };
  }

  return { fecha: null, error: `"${String(valor)}" no es una fecha válida` };
};

// ── Fecha y hora de cierre ───────────────────────────────────────────────────
// A diferencia de inicio y limite, el cierre si guarda la hora: los reportes
// diarios cuentan la tarea en el dia (y la hora) en que se hizo. La hora es
// opcional y puede venir en la misma celda ("2025-06-10 17:30") o aparte
// (`horaCompletado`). Sin hora se usa el mediodia de ese dia, igual que el
// resto de fechas que solo importan como dia.

const dosDigitos = (n) => String(n).padStart(2, '0');

const leerHora = (hora, minuto, meridiano) => {
  let h = Number(hora);
  const m = Number(minuto);
  if (meridiano) {
    if (h < 1 || h > 12) return null;
    const pm = /^p/i.test(meridiano);
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
};

// "17:30", "5:30 pm", "17:30:00", "5:30 p. m."
const PATRON_HORA = '(\\d{1,2}):(\\d{2})(?::\\d{2}(?:\\.\\d+)?)?\\s*([ap]\\.?\\s*m\\.?)?';
const RE_SOLO_HORA = new RegExp(`^${PATRON_HORA}$`, 'i');
const RE_ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const RE_ISO_LOCAL = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[T\\s]+${PATRON_HORA})?$`, 'i');
const RE_DMY = new RegExp(`^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})(?:,?\\s+${PATRON_HORA})?$`, 'i');

/**
 * Lee una celda que puede traer fecha, hora o ambas. Devuelve
 * { dia: {year, month, day} | null, hora: {h, m} | null, instante, error }.
 * `instante` solo se rellena cuando el texto trae su propia zona (el ISO que
 * genera la exportacion, "...Z"): ese ya es un momento exacto.
 */
const leerFechaHora = (valor) => {
  const vacio = { dia: null, hora: null, instante: null, error: null };
  if (valor === undefined || valor === null || valor === '') return vacio;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return { ...vacio, error: 'no es una fecha válida' };
    // Igual que en parsearFechaImportada: partes locales, redondeado al minuto
    const r = new Date(Math.round(valor.getTime() / 60000) * 60000);
    const hora = { h: r.getHours(), m: r.getMinutes() };
    // Una celda con solo hora llega como 1899-12-30/31 a esa hora
    if (r.getFullYear() < 1901) return { ...vacio, hora };
    return {
      ...vacio,
      dia: { year: r.getFullYear(), month: r.getMonth() + 1, day: r.getDate() },
      // 00:00 es lo que trae una celda con solo fecha: se toma como "sin hora"
      hora: hora.h || hora.m ? hora : null,
    };
  }

  const esNumero = typeof valor === 'number' || (typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor.trim()));
  if (esNumero) {
    const serial = Number(valor);
    const p = Number.isFinite(serial) && serial >= 0 ? XLSX.SSF.parse_date_code(serial) : null;
    if (!p) return { ...vacio, error: `"${valor}" no es una fecha válida` };
    const hora = p.H || p.M ? { h: p.H, m: p.M } : null;
    // Menos de 1 = solo la fraccion del dia, es decir, una hora
    if (serial < 1) return { ...vacio, hora: hora || { h: 0, m: 0 } };
    return { ...vacio, dia: { year: p.y, month: p.m, day: p.d }, hora };
  }

  const texto = String(valor).trim();

  if (RE_ISO_CON_ZONA.test(texto)) {
    const instante = new Date(texto);
    if (Number.isNaN(instante.getTime())) return { ...vacio, error: `"${texto}" no es una fecha válida` };
    return { ...vacio, instante };
  }

  let m = texto.match(RE_SOLO_HORA);
  if (m) {
    const hora = leerHora(m[1], m[2], m[3]);
    return hora ? { ...vacio, hora } : { ...vacio, error: `"${texto}" no es una hora válida` };
  }

  m = texto.match(RE_ISO_LOCAL);
  const dmy = m ? null : texto.match(RE_DMY);
  if (m || dmy) {
    const [year, month, day] = m
      ? [Number(m[1]), Number(m[2]), Number(m[3])]
      : [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
    const [hh, mm, mer] = (m || dmy).slice(4, 7);
    let hora = null;
    if (hh !== undefined) {
      hora = leerHora(hh, mm, mer);
      if (!hora) return { ...vacio, error: `"${texto}" trae una hora no válida` };
    }
    return { ...vacio, dia: { year, month, day }, hora };
  }

  return { ...vacio, error: `"${texto}" no es una fecha válida (usa YYYY-MM-DD o DD/MM/YYYY, con hora HH:MM opcional)` };
};

// Una columna "Completado" puede traer Si/No en vez de una fecha
const VALORES_SI = ['si', 's', 'yes', 'y', 'true', 'x', '✓', '✔', 'hecho', 'completado', 'completada', 'terminado', 'terminada'];
const VALORES_NO = ['no', 'n', 'false', '-'];
const textoSiNo = (valor) => {
  if (valor === true) return 'si';
  if (valor === false) return 'no';
  if (typeof valor !== 'string') return null;
  return valor.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
};

/** Fecha civil y hora de un instante en la zona de la empresa. */
const partesEnZona = (instante) => {
  const t = instante.getTime();
  const local = new Date(t - desfaseMs(t));
  return {
    dia: { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() },
    hora: { h: local.getUTCHours(), m: local.getUTCMinutes() },
  };
};

/**
 * Junta `completadoEn` y `horaCompletado` en el instante del cierre.
 * Devuelve { instante, marcaHecho, fechaTexto, horaTexto, error }:
 *  - `marcaHecho`: la fila dice que esta hecha (fecha o "Si"), aunque no
 *    traiga columna de estado.
 *  - `fechaTexto`/`horaTexto`: 'YYYY-MM-DD' y 'HH:MM' para la vista previa
 *    editable ('' si no vienen). La hora queda vacia si no se indico.
 */
const resolverCompletado = (valorFecha, valorHora) => {
  const sinDatos = { instante: null, marcaHecho: false, fechaTexto: '', horaTexto: '', error: null };
  const siNo = textoSiNo(valorFecha);

  if (siNo && VALORES_NO.includes(siNo)) return sinDatos;
  if (siNo && VALORES_SI.includes(siNo)) {
    // "Si" en la columna de fecha: hecha, sin fecha conocida
    const conHora = leerFechaHora(valorHora);
    if (conHora.hora || conHora.dia) return { ...sinDatos, marcaHecho: true, error: 'horaCompletado indicada sin fecha de completado' };
    return { ...sinDatos, marcaHecho: true };
  }

  const fecha = leerFechaHora(valorFecha);
  if (fecha.error) return { ...sinDatos, error: `completadoEn ${fecha.error}` };
  const hora = leerFechaHora(valorHora);
  if (hora.error) return { ...sinDatos, error: `horaCompletado ${hora.error}` };

  let dia = fecha.dia;
  let horaFinal = hora.hora || fecha.hora;
  if (fecha.instante) {
    // Momento exacto (exportacion del propio CRM): se pasa a la zona de la
    // empresa para mostrarlo; una hora aparte, si la hay, manda sobre la suya.
    ({ dia } = partesEnZona(fecha.instante));
    horaFinal = hora.hora || partesEnZona(fecha.instante).hora;
  }

  if (!dia) {
    if (fecha.hora || hora.hora || hora.dia) {
      return { ...sinDatos, error: 'falta la fecha de completado (solo se indicó la hora)' };
    }
    return sinDatos;
  }

  const civil = construirFechaCivil(dia.year, dia.month, dia.day, `${dia.year}-${dosDigitos(dia.month)}-${dosDigitos(dia.day)}`);
  if (civil.error) return { ...sinDatos, error: `completadoEn ${civil.error}` };

  const instante = horaFinal
    ? instanteLocal({ year: dia.year, month: dia.month - 1, day: dia.day }, horaFinal.h, horaFinal.m)
    : civil.fecha;

  // Margen de unos minutos por relojes desfasados
  if (instante.getTime() > Date.now() + 5 * 60000) {
    return { ...sinDatos, error: 'completadoEn no puede ser una fecha u hora futura' };
  }

  return {
    instante,
    marcaHecho: true,
    fechaTexto: `${dia.year}-${dosDigitos(dia.month)}-${dosDigitos(dia.day)}`,
    horaTexto: horaFinal ? `${dosDigitos(horaFinal.h)}:${dosDigitos(horaFinal.m)}` : '',
    error: null,
  };
};

const textoCrudo = (valor) => {
  if (valor === undefined || valor === null) return '';
  return valor instanceof Date ? valor.toISOString() : String(valor);
};

const formatDateInput = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

// Para la vista previa editable: si la fecha se entiende, se muestra como
// YYYY-MM-DD; si no, se deja el texto original para que el usuario vea que
// fue lo que no se pudo leer.
const textoFechaEditable = (valor) => {
  if (valor === undefined || valor === null || valor === '') return '';
  const { fecha } = parsearFechaImportada(valor);
  if (fecha) return formatDateInput(fecha);
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor);
};

// ── Validacion por fila ──────────────────────────────────────────────────────
const normalizarFilaEditable = (raw = {}) => {
  const completado = resolverCompletado(raw.completadoEn, raw.horaCompletado);
  // Sin columna de estado, una fila con fecha de cierre (o "Si") esta hecha.
  // Tambien si la fecha no se entiende: asi la vista previa muestra el campo
  // para corregirla.
  const traeCierre = completado.marcaHecho || Boolean(completado.error);
  return {
    numeroActividad: raw.numeroActividad ?? '',
    titulo: raw.titulo ?? '',
    descripcion: raw.descripcion ?? '',
    estado: normalizarEstado(raw.estado) || (traeCierre ? 'HECHO' : ''),
    prioridad: normalizarPrioridad(raw.prioridad),
    fechaInicio: textoFechaEditable(raw.fechaInicio),
    venceEn: textoFechaEditable(raw.venceEn),
    asignadoEmail: raw.asignadoEmail ?? '',
    completadoEn: completado.error ? textoCrudo(raw.completadoEn) : completado.fechaTexto,
    horaCompletado: completado.error ? textoCrudo(raw.horaCompletado) : completado.horaTexto,
  };
};

const validarFila = (raw) => {
  const fuente = normalizarCabecerasFila(raw);
  const fila = normalizarFilaEditable(fuente);
  const errores = [];

  if (!fila.titulo || String(fila.titulo).trim() === '') {
    errores.push('falta el campo obligatorio "titulo"');
  }

  if (fila.estado) {
    const estado = normalizarEstado(fila.estado);
    if (!ESTADOS_VALIDOS.includes(estado)) {
      errores.push(`estado "${fila.estado}" no valido (usa: ${ESTADOS_VALIDOS.join(' | ')})`);
    } else {
      fila.estado = estado;
    }
  }

  if (fila.prioridad) {
    const prioridad = normalizarPrioridad(fila.prioridad);
    if (!PRIORIDADES_VALIDAS.includes(prioridad)) {
      errores.push(`prioridad "${fila.prioridad}" no valida (usa: ${PRIORIDADES_VALIDAS.join(' | ')})`);
    } else {
      fila.prioridad = prioridad;
    }
  }

  // Las fechas se leen del valor original (puede ser Date o numero de Excel),
  // no del texto ya formateado para la vista previa.
  const inicio = parsearFechaImportada(fuente.fechaInicio);
  if (inicio.error) errores.push(`fechaInicio ${inicio.error}`);

  const vence = parsearFechaImportada(fuente.venceEn);
  if (vence.error) errores.push(`venceEn ${vence.error}`);

  if (inicio.fecha && vence.fecha && vence.fecha.getTime() < inicio.fecha.getTime()) {
    errores.push('venceEn es anterior a fechaInicio');
  }
  if (!vence.error && !vence.fecha && reglasTareas().exigirFechaLimite) {
    errores.push('venceEn es obligatoria en este CRM');
  }

  // El cierre solo cuenta si la tarea queda HECHO. Con otro estado puesto a
  // mano se ignora con un aviso, sin bloquear la fila.
  const avisos = [];
  const completado = resolverCompletado(fuente.completadoEn, fuente.horaCompletado);
  const estadoFinal = fila.estado || reglasTareas().estadoInicial;
  if (estadoFinal !== 'HECHO') {
    if (completado.marcaHecho || completado.error) {
      avisos.push(`Trae fecha de completado pero su estado es ${estadoFinal}: la fecha se ignora.`);
    }
  } else if (completado.error) {
    errores.push(completado.error);
  } else if (completado.instante && inicio.fecha && claveDiaMexico(completado.instante) < claveDiaMexico(inicio.fecha)) {
    errores.push('completadoEn es anterior a fechaInicio');
  }
  const completadoEn = estadoFinal === 'HECHO' ? completado.instante : null;

  if (fila.numeroActividad !== undefined && fila.numeroActividad !== null && String(fila.numeroActividad).trim() !== '') {
    const numero = parseInt(fila.numeroActividad, 10);
    if (Number.isNaN(numero) || numero <= 0) {
      errores.push(`numeroActividad "${fila.numeroActividad}" no es valido (usa un entero mayor a 0)`);
    } else {
      fila.numeroActividad = numero;
    }
  }

  if (errores.length > 0) {
    return { valida: false, tarea: null, razon: errores.join('; '), avisos, filaNormalizada: fila };
  }

  // Sin fecha de inicio, una tarea cerrada en el pasado empieza el dia en que
  // se cerro (o en su fecha limite, si es anterior), no el dia de importar.
  let fechaInicio = inicio.fecha;
  if (!fechaInicio && completadoEn) {
    const [year, month, day] = claveDiaMexico(completadoEn).split('-').map(Number);
    fechaInicio = mediodiaMexico({ year, month: month - 1, day });
    if (vence.fecha && vence.fecha < fechaInicio) fechaInicio = vence.fecha;
  }

  return {
    valida: true,
    tarea: {
      titulo: String(fila.titulo).trim(),
      descripcion: fila.descripcion ? String(fila.descripcion).trim() : null,
      numeroActividad: fila.numeroActividad ? parseInt(fila.numeroActividad, 10) : null,
      estado: estadoFinal,
      prioridad: fila.prioridad ? String(fila.prioridad).toUpperCase() : reglasTareas().prioridadDefecto,
      fechaInicio: fechaInicio || new Date(),
      venceEn: vence.fecha,
      completadoEn,
      asignadoEmail: fila.asignadoEmail ? String(fila.asignadoEmail).trim().toLowerCase() : null,
    },
    razon: null,
    avisos,
    filaNormalizada: fila,
  };
};

// ── Lectura de archivos ──────────────────────────────────────────────────────
const obtenerTextoDesdeFuente = (fileSource) => {
  if (Buffer.isBuffer(fileSource)) {
    return fileSource.toString('utf-8');
  }
  return String(fileSource || '');
};

const comprobarLimiteFilas = (total) => {
  if (total > LIMITE_FILAS_IMPORTACION) {
    throw new ErrorImportacion(
      `El archivo tiene ${total} filas y el máximo por importación es ${LIMITE_FILAS_IMPORTACION}. Divide el archivo en varios.`
    );
  }
};

const parseJSONRows = (fileSource) => {
  let raw;
  try {
    const contenido = obtenerTextoDesdeFuente(fileSource).replace(/^﻿/, '').trim();
    raw = JSON.parse(contenido);
  } catch (error) {
    throw new ErrorImportacion(`El archivo JSON no es valido o esta mal formateado${error?.message ? `: ${error.message}` : ''}`);
  }

  if (!Array.isArray(raw)) {
    if (raw && typeof raw === 'object' && Array.isArray(raw.tareas)) {
      raw = raw.tareas;
    } else {
      throw new ErrorImportacion('El archivo JSON debe contener un array de tareas en la raiz o una propiedad "tareas" con ese array');
    }
  }

  comprobarLimiteFilas(raw.length);

  // En JSON no hay cabecera: la "fila" es la posicion del elemento (desde 1).
  return raw.map((elemento, index) => ({
    ...normalizarCabecerasFila(elemento),
    fila: index + 1,
  }));
};

// Tope de lo que se lee de cada hoja. `sheet_to_json` recorre el rango entero
// de la hoja aunque este vacio: un .xlsx de pocos KB con dos celdas en A1 y
// XFD1048576 dejaba el servidor bloqueado horas. Muy por encima de lo que
// admite una importacion (LIMITE_FILAS_IMPORTACION, unas 15 columnas).
const MAX_FILAS_LEIDAS = 5000;
const MAX_COLUMNAS_LEIDAS = 100;

const recortarRangos = (workbook) => {
  for (const nombre of workbook.SheetNames) {
    const hoja = workbook.Sheets[nombre];
    if (!hoja?.['!ref']) continue;
    const rango = XLSX.utils.decode_range(hoja['!ref']);
    rango.e.c = Math.min(rango.e.c, rango.s.c + MAX_COLUMNAS_LEIDAS - 1);
    rango.e.r = Math.min(rango.e.r, rango.s.r + MAX_FILAS_LEIDAS - 1);
    hoja['!ref'] = XLSX.utils.encode_range(rango);
  }
};

const parseExcelRows = (fileSource) => {
  let workbook;
  try {
    // `cellDates: true`: las celdas con formato de fecha llegan como Date.
    // Sin esto llegan como numero de serie (45822) y `new Date(45822)` es 1970.
    // `nodim`: el rango sale de las celdas reales, no del <dimension> que
    // declara el archivo; `sheetRows` corta la lectura en MAX_FILAS_LEIDAS.
    const opciones = { cellDates: true, nodim: true, sheetRows: MAX_FILAS_LEIDAS };
    workbook = Buffer.isBuffer(fileSource)
      ? XLSX.read(fileSource, { type: 'buffer', ...opciones })
      : XLSX.readFile(fileSource, opciones);
  } catch {
    throw new ErrorImportacion('El archivo Excel no se pudo leer. Verifica que sea un .xlsx o .xls valido');
  }

  if (!workbook.SheetNames.length) {
    throw new ErrorImportacion('El archivo Excel no tiene ninguna hoja');
  }
  recortarRangos(workbook);

  // Solo se importa la primera hoja. Si otra hoja trae datos se avisa en vez
  // de ignorarlos en silencio.
  const [nombreHoja, ...otrasHojas] = workbook.SheetNames;
  const otrasConDatos = otrasHojas.filter((nombre) => {
    const hoja = workbook.Sheets[nombre];
    return hoja && hoja['!ref'] && XLSX.utils.sheet_to_json(hoja, { defval: '' }).length > 0;
  });
  if (otrasConDatos.length > 0) {
    throw new ErrorImportacion(
      `Solo se importa la primera hoja ("${nombreHoja}"), pero el archivo también tiene datos en: ${otrasConDatos.join(', ')}. Deja las tareas en la primera hoja y vacía o elimina las demás.`
    );
  }

  const sheet = workbook.Sheets[nombreHoja];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    throw new ErrorImportacion('El archivo Excel esta vacio o solo contiene el encabezado');
  }

  const cabeceras = Object.keys(rows[0]).map((clave) => MAPA_CABECERAS[normalizarClave(clave)]).filter(Boolean);
  if (!cabeceras.includes('titulo')) {
    throw new ErrorImportacion(`El archivo Excel no tiene la columna "titulo". Columnas esperadas: ${COLUMNAS_EXCEL.join(', ')}`);
  }

  // `__rowNum__` es el indice de la fila en la hoja (0 = encabezado), asi que
  // el numero real de Excel es +1. Se conserva antes de quitar las filas
  // vacias para que los errores señalen la fila que el usuario ve.
  const filas = rows
    .map((row) => ({
      ...normalizarCabecerasFila(row),
      fila: (Number.isInteger(row.__rowNum__) ? row.__rowNum__ : rows.indexOf(row) + 1) + 1,
    }))
    .filter(filaTieneDatos);

  if (filas.length === 0) {
    throw new ErrorImportacion('El archivo Excel esta vacio o solo contiene el encabezado');
  }

  comprobarLimiteFilas(filas.length);

  return filas;
};

const parseRowsFromFile = (fileSource, ext) => {
  if (ext === '.json') return parseJSONRows(fileSource);
  if (ext === '.xlsx' || ext === '.xls') return parseExcelRows(fileSource);
  throw new ErrorImportacion('Tipo de archivo no soportado. Usa .json, .xlsx o .xls');
};

// ── Responsable ──────────────────────────────────────────────────────────────
// Orden: correo de la fila (si es miembro) → asignado por defecto del modo
// elegido → quien importa, solo si es miembro del proyecto. Esta ultima regla
// es la misma del alta de tareas: una tarea sin responsable se la contaba el
// panel de actividad al creador, pero la tarjeta decia "sin asignar".
const resolverAsignado = (asignadoEmail, miembros, asignadoPorDefecto = null, creadorId = null) => {
  const nombreDe = (id) => miembros.find((m) => m.id === id)?.nombre || '';
  const creadorEsMiembro = reglasTareas().asignarAlCreador && creadorId !== null && miembros.some((m) => m.id === creadorId);
  const respaldo = asignadoPorDefecto || (creadorEsMiembro ? creadorId : null);
  const respaldoEsCreador = !asignadoPorDefecto && respaldo === creadorId;

  if (!asignadoEmail) {
    return {
      asignadoId: respaldo,
      asignadoNombre: nombreDe(respaldo),
      aviso: respaldoEsCreador && respaldo
        ? `Sin correo de responsable: se asignará a ${nombreDe(respaldo)} (quien importa).`
        : null,
    };
  }

  const miembro = miembros.find((m) => String(m.email || '').toLowerCase() === asignadoEmail);
  if (miembro) {
    return {
      asignadoId: miembro.id,
      asignadoNombre: miembro.nombre,
      aviso: null,
    };
  }

  if (respaldo) {
    return {
      asignadoId: respaldo,
      asignadoNombre: nombreDe(respaldo),
      aviso: `No se encontró el correo "${asignadoEmail}". Se asignará a ${nombreDe(respaldo)}${respaldoEsCreador ? ' (quien importa)' : ''}.`,
    };
  }

  return {
    asignadoId: null,
    asignadoNombre: '',
    aviso: `No se encontró el correo "${asignadoEmail}". La tarea quedará sin asignar.`,
  };
};

const numeroDeFila = (raw, index) => (Number.isInteger(raw?.fila) ? raw.fila : index + 2);

// ── Vista previa ─────────────────────────────────────────────────────────────
const construirVistaPrevia = (filas, miembros, asignadoPorDefecto = null, { creadorId = null } = {}) => {
  comprobarLimiteFilas(filas.length);

  const preview = filas.map((fila, index) => {
    const numeroFila = numeroDeFila(fila, index);
    const { valida, tarea, razon, avisos, filaNormalizada } = validarFila(fila);

    if (!valida) {
      return {
        fila: numeroFila,
        ...filaNormalizada,
        valida: false,
        errores: razon.split('; ').filter(Boolean),
        avisos,
        asignadoNombre: '',
      };
    }

    const asignacion = resolverAsignado(tarea.asignadoEmail, miembros, asignadoPorDefecto, creadorId);
    if (!asignacion.asignadoId && reglasTareas().exigirResponsable) {
      return {
        fila: numeroFila,
        ...filaNormalizada,
        valida: false,
        errores: ['falta responsable: en este CRM toda tarea debe tener uno'],
        avisos,
        asignadoNombre: '',
      };
    }

    return {
      fila: numeroFila,
      numeroActividad: tarea.numeroActividad ?? '',
      titulo: tarea.titulo,
      descripcion: tarea.descripcion || '',
      estado: tarea.estado,
      prioridad: tarea.prioridad,
      // Inicio tal como vino: el que se deduce del cierre se calcula al guardar
      fechaInicio: filaNormalizada.fechaInicio,
      venceEn: formatDateInput(tarea.venceEn),
      // Se conservan aunque el estado no sea HECHO: si el usuario lo cambia en
      // la vista previa, la fecha del archivo sigue ahi
      completadoEn: filaNormalizada.completadoEn,
      horaCompletado: filaNormalizada.horaCompletado,
      asignadoEmail: tarea.asignadoEmail || '',
      valida: true,
      errores: [],
      avisos: [...avisos, ...(asignacion.aviso ? [asignacion.aviso] : [])],
      asignadoNombre: asignacion.asignadoNombre,
    };
  });

  return {
    filas: preview,
    resumen: {
      total: preview.length,
      validas: preview.filter((fila) => fila.valida).length,
      invalidas: preview.filter((fila) => !fila.valida).length,
    },
  };
};

// ── Notificaciones ───────────────────────────────────────────────────────────
// Una sola notificacion por responsable, agrupada ("Se te asignaron N tareas
// en X"), nunca a quien importa. Es "best effort": si falla no se deshace la
// importacion, que ya quedo guardada.
const notificarAsignados = async (tareasCreadas, { usuarioId, proyectoId, proyectoNombre }) => {
  const porUsuario = new Map();
  tareasCreadas.forEach((tarea) => {
    const responsables = new Set([tarea.asignadoId, ...(tarea.asignados || []).map((a) => a.id)].filter(Boolean));
    responsables.forEach((responsableId) => {
      if (responsableId === usuarioId) return;
      const lista = porUsuario.get(responsableId) || [];
      lista.push(tarea);
      porUsuario.set(responsableId, lista);
    });
  });

  // eslint-disable-next-line global-require
  if (porUsuario.size === 0 || !require('../services/configuracion.service').configEnCache().avisos.tareas) return;

  const nombreProyecto = proyectoNombre ? ` en "${proyectoNombre}"` : '';
  const data = [...porUsuario.entries()].map(([responsableId, tareas]) => ({
    usuarioId: responsableId,
    tipo: 'ASIGNACION',
    proyectoId,
    tareaId: tareas.length === 1 ? tareas[0].id : null,
    mensaje: tareas.length === 1
      ? `Se te asignó 1 tarea${nombreProyecto}: "${tareas[0].titulo}"`
      : `Se te asignaron ${tareas.length} tareas${nombreProyecto}`,
  }));

  try {
    await prisma.notificacion.createMany({ data });
  } catch (error) {
    console.error('[importador.notificarAsignados]', error);
  }
  // eslint-disable-next-line global-require
  require('../services/avisosCorreo.service').avisarTareasAsignadas({ porUsuario, proyectoId, proyectoNombre });
};

// ── Guardado ─────────────────────────────────────────────────────────────────
const procesarFilas = async (
  filas,
  proyectoId,
  miembros,
  registrarActividad,
  usuarioId,
  asignadoPorDefecto = null,
  { proyectoNombre = null } = {},
) => {
  comprobarLimiteFilas(filas.length);

  const errores = [];
  const tareasACrear = [];

  for (let i = 0; i < filas.length; i += 1) {
    const numeroFila = numeroDeFila(filas[i], i);
    const { valida, tarea, razon } = validarFila(filas[i]);

    if (!valida) {
      errores.push({ fila: numeroFila, razon });
      continue;
    }

    const asignacion = resolverAsignado(tarea.asignadoEmail, miembros, asignadoPorDefecto, usuarioId);
    delete tarea.asignadoEmail;
    if (!asignacion.asignadoId && reglasTareas().exigirResponsable) {
      errores.push({ fila: numeroFila, razon: 'falta responsable: en este CRM toda tarea debe tener uno' });
      continue;
    }

    tareasACrear.push({
      ...tarea,
      // Una tarea importada como HECHO necesita fecha de cierre o no cuenta en
      // ningun reporte. Si el archivo no la trae se usa su fecha limite (si
      // ya paso) y, si no, el momento de la importacion.
      completadoEn: tarea.estado === 'HECHO'
        ? (tarea.completadoEn || (tarea.venceEn && tarea.venceEn <= new Date() ? tarea.venceEn : new Date()))
        : null,
      proyectoId,
      creadorId: usuarioId,
      asignadoId: asignacion.asignadoId,
      asignados: asignacion.asignadoId
        ? { connect: [{ id: asignacion.asignadoId }] }
        : undefined,
    });
  }

  let creadas = 0;
  let tareasCreadas = [];
  if (tareasACrear.length > 0) {
    // Numero de actividad para las filas que no lo traen: continua despues del
    // mayor que haya en el proyecto o en el propio archivo, para no repetir.
    const { _max } = await prisma.tarea.aggregate({
      where: { proyectoId },
      _max: { numeroActividad: true },
    });
    let siguienteNumero = Math.max(
      _max.numeroActividad || 0,
      ...tareasACrear.map((tarea) => tarea.numeroActividad || 0),
    ) + 1;
    tareasACrear.forEach((tarea) => {
      if (!tarea.numeroActividad) {
        tarea.numeroActividad = siguienteNumero;
        siguienteNumero += 1;
      }
    });

    // Transaccion en lote (sin callback): no tiene el limite de 5 s de las
    // interactivas y las tareas se crean una a una porque `createMany` no
    // admite conectar la relacion `asignados`.
    tareasCreadas = await prisma.$transaction(
      tareasACrear.map((tarea) => prisma.tarea.create({ data: tarea, include: IMPORT_TASK_INCLUDE }))
    );
    creadas = tareasCreadas.length;

    await registrarActividad(
      usuarioId,
      proyectoId,
      'IMPORTAR_TAREAS',
      `Se importaron ${creadas} tarea(s) masivamente al proyecto`
    );

    await notificarAsignados(tareasCreadas, { usuarioId, proyectoId, proyectoNombre });
  }

  return { creadas, errores, tareas: tareasCreadas };
};

const procesarJSON = async (fileSource, proyectoId, miembros, registrarActividad, usuarioId, asignadoPorDefecto = null, opciones = {}) => {
  const rows = parseJSONRows(fileSource);
  return procesarFilas(rows, proyectoId, miembros, registrarActividad, usuarioId, asignadoPorDefecto, opciones);
};

const procesarExcel = async (fileSource, proyectoId, miembros, registrarActividad, usuarioId, asignadoPorDefecto = null, opciones = {}) => {
  const rows = parseExcelRows(fileSource);
  return procesarFilas(rows, proyectoId, miembros, registrarActividad, usuarioId, asignadoPorDefecto, opciones);
};

// ── Plantillas descargables ──────────────────────────────────────────────────
const generarPlantillaJSON = () => ([
  {
    numeroActividad: 1,
    titulo: 'Diseno de interfaz de usuario',
    descripcion: 'Crear wireframes y mockups para la nueva pantalla de reportes',
    estado: 'PENDIENTE',
    prioridad: 'ALTA',
    fechaInicio: '2025-06-01',
    venceEn: '2025-06-15',
    asignadoEmail: 'miembro@empresa.com',
  },
  {
    numeroActividad: 2,
    titulo: 'Integracion con API de pagos',
    descripcion: 'Conectar el modulo de facturacion con el gateway de pago seleccionado',
    estado: 'EN_PROGRESO',
    prioridad: 'ALTA',
    venceEn: '2025-06-30',
    asignadoEmail: '',
  },
  {
    numeroActividad: 3,
    titulo: 'Documentacion tecnica',
    descripcion: 'Escribir la documentacion del modulo de autenticacion',
    estado: 'PENDIENTE',
    prioridad: 'BAJA',
    venceEn: '',
    asignadoEmail: '',
  },
  {
    numeroActividad: 4,
    titulo: 'Levantamiento de requerimientos',
    descripcion: 'Tarea ya hecha: completadoEn y horaCompletado son opcionales',
    estado: 'HECHO',
    prioridad: 'MEDIA',
    fechaInicio: '2025-05-20',
    venceEn: '2025-05-30',
    asignadoEmail: '',
    completadoEn: '2025-05-28',
    horaCompletado: '17:30',
  },
]);

const generarPlantillaExcel = () => {
  const datos = generarPlantillaJSON();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos, { header: COLUMNAS_EXCEL });

  ws['!cols'] = [
    { wch: 16 },
    { wch: 35 },
    { wch: 55 },
    { wch: 15 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 30 },
    { wch: 14 },
    { wch: 15 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Tareas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = {
  COLUMNAS_EXCEL,
  ESTADOS_VALIDOS,
  PRIORIDADES_VALIDAS,
  LIMITE_FILAS_IMPORTACION,
  ErrorImportacion,
  construirVistaPrevia,
  generarPlantillaExcel,
  generarPlantillaJSON,
  normalizarCabecerasFila,
  parsearFechaImportada,
  parseRowsFromFile,
  procesarExcel,
  procesarFilas,
  procesarJSON,
  validarFila,
};
