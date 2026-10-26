// Nombres legibles de los campos que aparecen en el registro de actividad y en
// la papelera (backend: services/registroActividad.service.js), y como se
// muestran sus valores. Lo que no esta aqui se muestra separando la palabra
// ("fechaLimite" -> "Fecha limite").

const CAMPOS = {
  titulo: ['Título', 'Title'],
  nombre: ['Nombre', 'Name'],
  nombreComercial: ['Nombre comercial', 'Trade name'],
  nombreOriginal: ['Archivo', 'File'],
  descripcion: ['Descripción', 'Description'],
  contenido: ['Contenido', 'Content'],
  resumen: ['Resumen', 'Summary'],
  estado: ['Estado', 'Status'],
  prioridad: ['Prioridad', 'Priority'],
  tipo: ['Tipo', 'Type'],
  area: ['Área', 'Area'],
  rol: ['Rol', 'Role'],
  asignadoId: ['Responsable', 'Assignee'],
  responsableId: ['Responsable', 'Owner'],
  creadorId: ['Creado por', 'Created by'],
  creadoPorId: ['Creado por', 'Created by'],
  autorId: ['Autor', 'Author'],
  usuarioId: ['Persona', 'Person'],
  subidoPorId: ['Subido por', 'Uploaded by'],
  editadoPorId: ['Editado por', 'Edited by'],
  proyectoId: ['Proyecto', 'Project'],
  tareaId: ['Tarea', 'Task'],
  dependeDeId: ['Depende de', 'Depends on'],
  clienteId: ['Cliente', 'Client'],
  empresaId: ['Cliente o proveedor', 'Client or supplier'],
  contratoId: ['Contrato', 'Contract'],
  cuentaId: ['Cuenta', 'Account'],
  cotizacionId: ['Cotización', 'Quote'],
  articuloId: ['Artículo', 'Article'],
  pagoId: ['Pago', 'Payment'],
  gastoId: ['Gasto', 'Expense'],
  fechaInicio: ['Inicio', 'Start'],
  fechaFin: ['Fin', 'End'],
  venceEn: ['Fecha límite', 'Due date'],
  fechaLimite: ['Fecha límite', 'Due date'],
  completadoEn: ['Terminada el', 'Completed on'],
  fecha: ['Fecha', 'Date'],
  fechaFirma: ['Firma', 'Signed on'],
  pagadoEn: ['Pagado el', 'Paid on'],
  creadoEn: ['Creado el', 'Created on'],
  borradoEn: ['Borrado el', 'Deleted on'],
  monto: ['Monto', 'Amount'],
  moneda: ['Moneda', 'Currency'],
  concepto: ['Concepto', 'Concept'],
  folio: ['Folio', 'Number'],
  categoria: ['Categoría', 'Category'],
  metodo: ['Método', 'Method'],
  referencia: ['Referencia', 'Reference'],
  notas: ['Notas', 'Notes'],
  motivoAnulacion: ['Motivo de anulación', 'Void reason'],
  email: ['Correo', 'Email'],
  telefono: ['Teléfono', 'Phone'],
  puesto: ['Puesto', 'Position'],
  rfc: ['RFC', 'Tax ID'],
  sector: ['Sector', 'Industry'],
  sitioWeb: ['Sitio web', 'Website'],
  direccion: ['Dirección', 'Address'],
  ciudad: ['Ciudad', 'City'],
  principal: ['Contacto principal', 'Main contact'],
  contraparteNombre: ['Contraparte', 'Counterparty'],
  clienteNombre: ['Cliente', 'Client'],
  proveedorNombre: ['Proveedor', 'Supplier'],
  responsableNombre: ['Responsable', 'Assignee'],
  autorNombre: ['Autor', 'Author'],
  publicado: ['Publicado', 'Published'],
  fijado: ['Fijado', 'Pinned'],
  restringido: ['Acceso restringido', 'Restricted'],
  visibleCliente: ['Visible para el cliente', 'Visible to client'],
  tamano: ['Tamaño', 'Size'],
  ubicacion: ['Lugar', 'Location'],
  modalidad: ['Modalidad', 'Mode'],
  todoElDia: ['Todo el día', 'All day'],
  activa: ['Activa', 'Active'],
  banco: ['Banco', 'Bank'],
  dosFactoresActivo: ['Verificación en dos pasos', '2-step verification'],
  password: ['Contraseña', 'Password'],
  permisos: ['Permisos', 'Permissions'],
  fotoPerfilUrl: ['Foto de perfil', 'Profile photo'],
  sha256: ['Imagen', 'Image'],
  contraparteRfc: ['RFC de la contraparte', 'Counterparty tax ID'],
  contraparteContacto: ['Contacto de la contraparte', 'Counterparty contact'],
  contraparteEmail: ['Correo de la contraparte', 'Counterparty email'],
  contraparteTelefono: ['Teléfono de la contraparte', 'Counterparty phone'],
  incluyeIva: ['Incluye IVA', 'Includes VAT'],
  periodicidadPago: ['Periodicidad de pago', 'Payment frequency'],
  renovacionAutomatica: ['Renovación automática', 'Auto-renewal'],
  diasAviso: ['Días de aviso', 'Notice days'],
  tipoDocumento: ['Tipo de documento', 'Document type'],
  mime: ['Tipo de archivo', 'File type'],
  numero: ['Versión', 'Version'],
  nota: ['Nota', 'Note'],
  origen: ['Origen', 'Source'],
  esRecurrente: ['Se repite', 'Recurring'],
  fechaFinRecurr: ['Se repite hasta', 'Repeats until'],
  esCompartido: ['Compartido', 'Shared'],
  esGlobal: ['Para todo el equipo', 'For everyone'],
  alertaMinutos: ['Aviso (minutos antes)', 'Reminder (minutes before)'],
  urlReunion: ['Enlace de la reunión', 'Meeting link'],
  instruccionesAcceso: ['Instrucciones de acceso', 'Access instructions'],
  repetirAnual: ['Se repite cada año', 'Repeats yearly'],
  horaInicio: ['Hora de inicio', 'Start time'],
  horaFin: ['Hora de fin', 'End time'],
  anio: ['Año', 'Year'],
  mes: ['Mes', 'Month'],
  biografia: ['Biografía', 'Bio'],
  verificado: ['Correo verificado', 'Email verified'],
};

const camello = (texto) => String(texto).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** "fechaLimite" -> "Fecha límite"; "marca.nombreSistema" -> "Marca › Nombre sistema". */
export const etiquetaCampo = (campo, idioma = 'es') => String(campo).split('.').map((parte) => {
  const conocido = CAMPOS[parte];
  return conocido ? conocido[idioma === 'en' ? 1 : 0] : camello(parte);
}).join(' › ');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Texto para un valor guardado (fechas, si/no, vacio). */
export const textoValor = (valor, { t, language, nombre } = {}) => {
  if (nombre) return nombre;
  if (valor === null || valor === undefined || valor === '') return t('hisVacio');
  if (valor === true) return t('hisSi');
  if (valor === false) return t('hisNo');
  if (typeof valor === 'string' && ISO.test(valor)) {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) {
      const conHora = !/T00:00:00(\.000)?Z$/.test(valor);
      return fecha.toLocaleString(language === 'en' ? 'en-US' : 'es-MX', conHora
        ? { dateStyle: 'medium', timeStyle: 'short' }
        : { dateStyle: 'medium', timeZone: 'UTC' });
    }
  }
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
};

// Campos que no se muestran en la papelera (internos o repetidos con su nombre).
export const CAMPOS_OCULTOS = new Set([
  'id', 'url', 'archivo', 'driveArchivoId', 'driveCarpetaId', 'googleCalendarEventId', 'googleEtag', 'desdeDrive',
  'sha256', 'huella', 'actualizadoEn', 'eventoId', 'numeroActividad', 'patronRecurrencia', 'diasSemana', 'color',
]);
