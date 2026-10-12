// Servicio de comunicación con el backend
// Centraliza la URL base y el manejo del JWT en cada petición

const API_URL = import.meta.env.VITE_API_URL || '/api';
const PUBLIC_BASE_URL = API_URL.startsWith('http') ? API_URL.replace(/\/api\/?$/, '') : '';
// Access token (JWT de 15 min) y refresh token (rota en cada uso). Los dos
// llevan el prefijo crm_ para que AuthContext los borre al cerrar sesion.
const TOKEN_KEY = 'crm_token';
const REFRESH_KEY = 'crm_refresh';

// ── Helpers internos ──────────────────────────────────────────────────────

// Arma un querystring omitiendo valores vacios, para no mandar ?q=&estado=
const construirQuery = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      query.append(clave, valor);
    }
  });
  const texto = query.toString();
  return texto ? `?${texto}` : '';
};

const getToken = () => localStorage.getItem(TOKEN_KEY);
const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

/** Guarda el par de tokens que devuelven login, 2FA, invitacion y refresh. */
export const guardarTokens = ({ token, refreshToken }) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
};

export const borrarTokens = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

export const hayTokens = () => Boolean(getToken() && getRefreshToken());
export const REFRESH_STORAGE_KEY = REFRESH_KEY;

const esperar = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// ── Renovacion de sesion ─────────────────────────────────────────────────
// Cuando el access token caduca (401 con codigo TOKEN_EXPIRADO) se canjea el
// refresh token por un par nuevo y se repite la peticion una vez.
//  - Una sola renovacion a la vez por pestaña (las demas peticiones esperan).
//  - Entre pestañas se usa Web Locks: el refresh token rota y si dos pestañas
//    lo gastaran a la vez el servidor lo tomaria por un robo. La que entra
//    segunda ve que el token guardado ya cambio y lo reutiliza.
let renovacionEnCurso = null;

const renovarSesion = (tokenUsado) => {
  if (renovacionEnCurso) return renovacionEnCurso;

  const tarea = async () => {
    for (let intento = 0; intento < 3; intento += 1) {
      const actual = getToken();
      if (actual && actual !== tokenUsado) return true; // otra pestaña ya renovo
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;

      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.ok) {
        guardarTokens(await res.json());
        return true;
      }
      // 409: otra pestaña (sin Web Locks) lo esta rotando ahora mismo.
      if (res.status === 409) {
        await esperar(500 * (intento + 1));
        continue;
      }
      return false;
    }
    return false;
  };

  const conBloqueo = typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request('crm_renovar_sesion', tarea)
    : tarea();

  renovacionEnCurso = conBloqueo.finally(() => { renovacionEnCurso = null; });
  return renovacionEnCurso;
};

const codigoDeError = async (res) => {
  try {
    const data = await res.clone().json();
    return data?.codigo || null;
  } catch {
    return null;
  }
};

/**
 * fetch con renovacion automatica de sesion. Todas las llamadas de este
 * archivo pasan por aqui. Si la renovacion falla, devuelve el 401 original y
 * handleResponse cierra la sesion como siempre.
 */
const apiFetch = async (url, opciones = {}) => {
  const tokenUsado = getToken();
  const res = await fetch(url, opciones);
  if (res.status !== 401 || !tokenUsado) return res;
  if ((await codigoDeError(res)) !== 'TOKEN_EXPIRADO') return res;

  const renovada = await renovarSesion(tokenUsado);
  if (!renovada) return res;

  const headers = new Headers(opciones.headers || {});
  headers.set('Authorization', `Bearer ${getToken()}`);
  return fetch(url, { ...opciones, headers });
};

const getHeaders = (isMultipart = false) => {
  const token = getToken();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
};

/** Error con el codigo HTTP, para que quien llama distinga un 401 de un fallo de red. */
export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Datos extra del backend: `codigo` (EMAIL_NO_VERIFICADO, CUENTA_BLOQUEADA...)
    // y `detalles` (requisitos de contraseña que no se cumplen).
    this.codigo = data.codigo || null;
    this.detalles = Array.isArray(data.detalles) ? data.detalles : [];
    this.data = data;
  }
}

/**
 * Un 401 con token guardado significa que la sesion ya no vale: el token
 * expiro o el usuario fue desactivado. Se borra el token y se avisa a la app
 * (AuthContext escucha este evento) para que limpie la cache y mande al login.
 * No se usa para las rutas publicas (login, invitaciones...), donde un 401 es
 * simplemente "credenciales incorrectas".
 */
const avisarSesionInvalida = (mensaje) => {
  borrarTokens();
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('crm:sesion-invalida', { detail: { mensaje } }));
};

const handleResponse = async (res, { publica = false } = {}) => {
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }
  }
  if (!res.ok) {
    const mensaje = data.error || 'Error en la petición';
    if (res.status === 401 && !publica && getToken()) avisarSesionInvalida(mensaje);
    // La política exige 2FA y aún no está activa: la app lleva a activarla.
    if (res.status === 403 && data.codigo === 'REQUIERE_2FA' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('crm:requiere-2fa'));
    }
    throw new ApiError(mensaje, res.status, data);
  }
  return data;
};

/** Nombre de archivo de la cabecera Content-Disposition, si el backend lo manda. */
const nombreDesdeCabecera = (cabecera) => {
  if (!cabecera) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* se usa el respaldo */ }
  }
  const simple = /filename="?([^";]+)"?/i.exec(cabecera);
  return simple ? simple[1] : null;
};

/**
 * Descarga autenticada. El backend ya no acepta el token por `?token=` en la
 * URL, asi que un enlace directo no sirve: se pide con `fetch` y la cabecera
 * Authorization, se convierte a blob y se dispara la descarga desde memoria.
 */
const descargarArchivo = async (url, nombreArchivo) => {
  const res = await apiFetch(url, { headers: getHeaders(true) });
  if (!res.ok) await handleResponse(res); // lanza con el mensaje del backend

  const blob = await res.blob();
  const nombre = nombreDesdeCabecera(res.headers.get('Content-Disposition')) || nombreArchivo;
  const objectUrl = URL.createObjectURL(blob);

  const enlace = document.createElement('a');
  enlace.href = objectUrl;
  enlace.download = nombre;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Se libera despues, no al instante: algunos navegadores leen el blob de
  // forma asincrona y revocarlo en seguida cancelaba la descarga.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
};

const emitScheduleSync = (detail = {}) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('crm:schedule-changed', { detail }));
};

export const getPublicAssetUrl = (value) => {
  if (!value) return '';
  if (/^(data|blob):/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `${PUBLIC_BASE_URL}${value}`;
};

// ── Auth ──────────────────────────────────────────────────────────────────

// Peticion JSON a /auth. `publica` evita que un 401 (credenciales malas)
// se interprete como "sesion caducada".
const pedirAuth = async (ruta, { metodo = 'GET', cuerpo, publica = false } = {}) => {
  const res = await apiFetch(`${API_URL}/auth${ruta}`, {
    method: metodo,
    headers: publica ? { 'Content-Type': 'application/json' } : getHeaders(),
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return handleResponse(res, { publica });
};

const segmento = (valor) => encodeURIComponent(String(valor ?? ''));

export const authService = {
  // ── Públicas ──
  config: () => pedirAuth('/config', { publica: true }),
  login: (email, password, recordar = false) => pedirAuth('/login', { metodo: 'POST', cuerpo: { email, password, recordar }, publica: true }),
  login2fa: (desafio, codigo) => pedirAuth('/2fa/login', { metodo: 'POST', cuerpo: { desafio, codigo }, publica: true }),
  register: (datos) => pedirAuth('/register', { metodo: 'POST', cuerpo: datos, publica: true }),
  verificarEmail: (email, codigo) => pedirAuth('/verificar-email', { metodo: 'POST', cuerpo: { email, codigo }, publica: true }),
  reenviarCodigo: (email) => pedirAuth('/reenviar-codigo', { metodo: 'POST', cuerpo: { email }, publica: true }),
  forgotPassword: (email) => pedirAuth('/forgot-password', { metodo: 'POST', cuerpo: { email }, publica: true }),
  validarReset: (token) => pedirAuth(`/reset-password/${segmento(token)}`, { publica: true }),
  resetPassword: (token, password) => pedirAuth(`/reset-password/${segmento(token)}`, { metodo: 'POST', cuerpo: { password }, publica: true }),
  verifyAccount: (token) => pedirAuth(`/verify/${segmento(token)}`, { publica: true }),
  // Cierra la sesion en el servidor. No necesita access token (puede haber caducado).
  logout: () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.resolve();
    return pedirAuth('/logout', { metodo: 'POST', cuerpo: { refreshToken }, publica: true }).catch(() => {});
  },

  // Invitaciones
  verificarInvitacion: (token) => pedirAuth(`/invitacion/${segmento(token)}`, { publica: true }),
  aceptarInvitacion: (token, datos) => pedirAuth(`/invitacion/${segmento(token)}/aceptar`, { metodo: 'POST', cuerpo: datos, publica: true }),

  // ── Con sesión ──
  me: () => pedirAuth('/me'),
  seguridad: () => pedirAuth('/seguridad'),
  cambiarPassword: (passwordActual, passwordNueva) => pedirAuth('/cambiar-password', { metodo: 'POST', cuerpo: { passwordActual, passwordNueva } }),
  sesiones: () => pedirAuth('/sesiones'),
  cerrarSesion: (id) => pedirAuth(`/sesiones/${segmento(id)}`, { metodo: 'DELETE' }),
  cerrarOtrasSesiones: () => pedirAuth('/sesiones', { metodo: 'DELETE' }),
  eventos: (limite = 30) => pedirAuth(`/eventos?limite=${limite}`),
  configurar2fa: (password) => pedirAuth('/2fa/configurar', { metodo: 'POST', cuerpo: { password } }),
  activar2fa: (codigo) => pedirAuth('/2fa/activar', { metodo: 'POST', cuerpo: { codigo } }),
  desactivar2fa: (password, codigo) => pedirAuth('/2fa/desactivar', { metodo: 'POST', cuerpo: { password, codigo } }),
  regenerarCodigos: (password) => pedirAuth('/2fa/codigos-respaldo', { metodo: 'POST', cuerpo: { password } }),
};

// ── Proyectos ─────────────────────────────────────────────────────────────

export const proyectosService = {
  listar: async (params = {}) => {
    const res = await apiFetch(`${API_URL}/proyectos${construirQuery(params)}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  equipoDeProyecto: async (id) => {
    const res = await apiFetch(`${API_URL}/proyectos/${id}/equipo`, { headers: getHeaders() });
    return handleResponse(res);
  },

  crear: async (datos) => {
    const isMultipart = datos instanceof FormData;
    const res = await apiFetch(`${API_URL}/proyectos`, {
      method: 'POST',
      headers: getHeaders(isMultipart),
      body: isMultipart ? datos : JSON.stringify(datos),
    });
    return handleResponse(res);
  },

  editar: async (id, datos) => {
    const isMultipart = datos instanceof FormData;
    const res = await apiFetch(`${API_URL}/proyectos/${id}`, {
      method: 'PUT',
      headers: getHeaders(isMultipart),
      body: isMultipart ? datos : JSON.stringify(datos),
    });
    return handleResponse(res);
  },

  // El borrado de proyectos sigue existiendo en el backend, pero por decision
  // del usuario (P3/P9) no hay forma de llamarlo desde la interfaz: se archiva.

  listarPlantillas: async () => {
    const res = await apiFetch(`${API_URL}/proyectos/plantillas`, { headers: getHeaders() });
    return handleResponse(res);
  },

  guardarComoPlantilla: async (proyectoId, datos) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/plantilla`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(datos),
    });
    return handleResponse(res);
  },
};

// ── Tareas ────────────────────────────────────────────────────────────────

export const tareasService = {
  // Listar tareas de un proyecto (también devuelve info del proyecto)
  listar: async (proyectoId) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/tareas`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  crear: async (proyectoId, datos) => {
    const isMultipart = datos instanceof FormData;
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/tareas`, {
      method: 'POST',
      headers: getHeaders(isMultipart),
      body: isMultipart ? datos : JSON.stringify(datos),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'tarea', action: 'crear', proyectoId });
    return data;
  },

  editar: async (id, datos) => {
    const res = await apiFetch(`${API_URL}/tareas/${id}`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'tarea', action: 'editar', id });
    return data;
  },

  eliminar: async (id) => {
    const res = await apiFetch(`${API_URL}/tareas/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'tarea', action: 'eliminar', id });
    return data;
  },

  // Borrado en bloque. Va por POST y no por DELETE porque el cuerpo con la
  // lista de ids no viaja fiable en un DELETE.
  eliminarVarias: async (ids) => {
    const res = await apiFetch(`${API_URL}/tareas/eliminar-multiples`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ ids }),
    });
    const data = await handleResponse(res);
    (data.ids || ids).forEach((id) => emitScheduleSync({ entity: 'tarea', action: 'eliminar', id }));
    return data;
  },

  // Cambio rápido de estado inline
  actualizarEstado: async (id, estado) => {
    const res = await apiFetch(`${API_URL}/tareas/${id}/estado`, {
      method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ estado }),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'tarea', action: 'estado', id, estado });
    return data;
  },

  // ── Importación masiva ──────────────────────────────────────────────────
  previewImportar: async (proyectoId, archivo, modoAsignacion = 'archivo', asignadoId = null) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('modoAsignacion', modoAsignacion);
    if (asignadoId) fd.append('asignadoId', asignadoId);
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/tareas/importar/preview`, {
      method: 'POST',
      headers: getHeaders(true),
      body: fd,
    });
    return handleResponse(res);
  },

  confirmarImportacion: async (proyectoId, filas, modoAsignacion = 'archivo', asignadoId = null) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/tareas/importar/confirmar`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        filas,
        modoAsignacion,
        asignadoId,
      }),
    });
    return handleResponse(res);
  },

  descargarPlantilla: (tipo) => descargarArchivo(
    `${API_URL}/tareas/plantilla/${tipo}`,
    `plantilla_tareas.${tipo === 'json' ? 'json' : 'xlsx'}`,
  ),

  exportarProyecto: (proyectoId, tipo = 'json') => descargarArchivo(
    `${API_URL}/proyectos/${proyectoId}/tareas/exportar/${tipo}`,
    `proyecto_${proyectoId}_tareas.${tipo === 'excel' ? 'xlsx' : 'json'}`,
  ),
};

// ── Usuarios ──────────────────────────────────────────────────────────────

export const usuariosService = {
  listar: async (params = {}) => {
    const res = await apiFetch(`${API_URL}/usuarios${construirQuery(params)}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  listarParaProyectos: async () => {
    const res = await apiFetch(`${API_URL}/usuarios/catalogo/proyectos`, { headers: getHeaders() });
    return handleResponse(res);
  },
  perfil: async () => {
    const res = await apiFetch(`${API_URL}/usuarios/perfil`, { headers: getHeaders() });
    return handleResponse(res);
  },
  actualizarPerfil: async (datos) => {
    const res = await apiFetch(`${API_URL}/usuarios/perfil`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: datos,
    });
    return handleResponse(res);
  },
  crear: async (datos) => {
    const res = await apiFetch(`${API_URL}/usuarios`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(datos),
    });
    return handleResponse(res);
  },
  editar: async (id, datos) => {
    const res = await apiFetch(`${API_URL}/usuarios/${id}`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos),
    });
    return handleResponse(res);
  },
  // DELETE /usuarios/:id ya no borra: desactiva la cuenta. Los usuarios no se
  // eliminan para no perder su historial de tareas y proyectos.
  desactivar: async (id) => {
    const res = await apiFetch(`${API_URL}/usuarios/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  },
  toggleEstado: async (id, estado) => {
    const res = await apiFetch(`${API_URL}/usuarios/${id}/estado`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify({ estado }),
    });
    return handleResponse(res);
  },

  // Invitaciones (Solo Admin)
  invitar: async (datos) => {
    const res = await apiFetch(`${API_URL}/auth/invitar`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(datos),
    });
    return handleResponse(res);
  },
  reenviarInvitacion: async (email) => {
    const res = await apiFetch(`${API_URL}/auth/invitar/reenviar`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  },
  listarInvitaciones: async () => {
    const res = await apiFetch(`${API_URL}/auth/invitaciones`, { headers: getHeaders() });
    return handleResponse(res);
  },
  eliminarInvitacion: async (id) => {
    const res = await apiFetch(`${API_URL}/auth/invitaciones/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  },
};

// ── Notificaciones ────────────────────────────────────────────────────────
export const notificacionesService = {
  listar: async () => {
    const res = await apiFetch(`${API_URL}/notificaciones`, { headers: getHeaders() });
    return handleResponse(res);
  },
  marcarLeida: async (id) => {
    const res = await apiFetch(`${API_URL}/notificaciones/${id}/leida`, {
      method: 'PUT', headers: getHeaders(),
    });
    return handleResponse(res);
  },
  marcarTodasLeidas: async () => {
    const res = await apiFetch(`${API_URL}/notificaciones/todas/leidas`, {
      method: 'PUT', headers: getHeaders(),
    });
    return handleResponse(res);
  },
  eliminar: async (id) => {
    const res = await apiFetch(`${API_URL}/notificaciones/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  }
};

// ── Comentarios ───────────────────────────────────────────────────────────
export const comentariosService = {
  listar: async (parentId, type = 'tareas') => {
    const res = await apiFetch(`${API_URL}/${type}/${parentId}/comentarios`, { headers: getHeaders() });
    return handleResponse(res);
  },
  crear: async (parentId, contenido, type = 'tareas') => {
    const res = await apiFetch(`${API_URL}/${type}/${parentId}/comentarios`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ contenido }),
    });
    return handleResponse(res);
  },
  eliminar: async (comentarioId) => {
    const res = await apiFetch(`${API_URL}/tareas/comentarios/${comentarioId}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  },
};

// ── Historial (Logs) ───────────────────────────────────────────────────────
export const logsService = {
  listarPorProyecto: async (proyectoId) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/logs`, { headers: getHeaders() });
    return handleResponse(res);
  },
};

// ── Adjuntos ──────────────────────────────────────────────────────────────
// Los archivos se guardan en el disco del servidor: cada adjunto trae su `url`
// relativa (/api/archivos/adjuntos/...) y se abre o descarga con
// getPublicAssetUrl. Los adjuntos antiguos conservan su URL absoluta de Vercel
// Blob. Las rutas /adjuntos/ver y /adjuntos/descargar desaparecieron.
export const adjuntosService = {
  listar: async (parentId, type = 'tareas') => {
    const res = await apiFetch(`${API_URL}/${type}/${parentId}/adjuntos`, { headers: getHeaders() });
    return handleResponse(res);
  },
  subir: async (parentId, payload, type = 'tareas') => {
    const formData = payload instanceof FormData
      ? payload
      : (() => {
          const fd = new FormData();
          const files = Array.isArray(payload) ? payload : Array.from(payload || []);
          files.forEach((file) => fd.append('archivos', file));
          return fd;
        })();
    const res = await apiFetch(`${API_URL}/${type}/${parentId}/adjuntos`, {
      method: 'POST',
      headers: getHeaders(true), // Multipart
      body: formData
    });
    return handleResponse(res);
  },
  eliminar: async (adjuntoId) => {
    const res = await apiFetch(`${API_URL}/tareas/adjuntos/${adjuntoId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },
};

// ── Estadísticas ──────────────────────────────────────────────────────────
export const statsService = {
  // Actividad del equipo de un día concreto (sin fecha = hoy)
  actividadEquipo: async (fecha) => {
    const res = await apiFetch(`${API_URL}/stats/actividad-equipo${construirQuery({ fecha })}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },
  getAdminStats: async () => {
    const res = await apiFetch(`${API_URL}/stats/admin?t=${Date.now()}`, {
      headers: { ...getHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    return handleResponse(res);
  },
  getMemberStats: async () => {
    const res = await apiFetch(`${API_URL}/stats/member?t=${Date.now()}`, {
      headers: { ...getHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    return handleResponse(res);
  },

  // Reporte del día en Excel, con la cabecera Authorization como cualquier
  // otra peticion (el token ya no viaja en la URL).
  descargarReporteDia: (fecha, proyectoId = null) => descargarArchivo(
    `${API_URL}/stats/reporte-dia/excel${construirQuery({ fecha, proyectoId })}`,
    `actividad_${fecha}.xlsx`,
  ),
};

// ── Agenda Personal ────────────────────────────────────────────────────────
export const agendaService = {
  // Calendario de la empresa: dias ya expandidos ('YYYY-MM-DD') en el rango.
  diasEmpresa: async (desde, hasta) => {
    const res = await apiFetch(`${API_URL}/agenda/dias-empresa${construirQuery({ desde, hasta })}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // Registros para administrarlos (admin).
  registrosDiasEmpresa: async () => {
    const res = await apiFetch(`${API_URL}/agenda/dias-empresa/registros`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // { fechaInicio, fechaFin?, tipo: festivo|no_laboral|cierre|puente|especial, nombre, descripcion?, repetirAnual?, area? }
  crearDiaEmpresa: async (datos) => {
    const res = await apiFetch(`${API_URL}/agenda/dias-empresa`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  eliminarDiaEmpresa: async (id) => {
    const res = await apiFetch(`${API_URL}/agenda/dias-empresa/${id}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  // Vista de equipo (admin): personas con horario, eventos, tareas y ausencias.
  equipo: async (desde, hasta) => {
    const res = await apiFetch(`${API_URL}/agenda/equipo${construirQuery({ desde, hasta })}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // Huecos libres comunes: { usuariosIds: [], desde, dias, duracion (min), excluirId, max }
  sugerirHorarios: async ({ usuariosIds = [], desde, dias, duracion, excluirId, max } = {}) => {
    const query = construirQuery({ usuarios_ids: usuariosIds.join(','), desde, dias, duracion, excluir_id: excluirId, max });
    const res = await apiFetch(`${API_URL}/agenda/sugerir-horarios${query}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  listar: async (fechaInicio, fechaFin) => {
    let url = `${API_URL}/agenda`;
    if (fechaInicio && fechaFin) {
      url += `?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
    }
    const res = await apiFetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },
  crear: async (datos) => {
    const res = await apiFetch(`${API_URL}/agenda`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(datos),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'agenda', action: 'crear' });
    return data;
  },
  editar: async (id, datos) => {
    const res = await apiFetch(`${API_URL}/agenda/${id}`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'agenda', action: 'editar', id });
    return data;
  },
  eliminar: async (id) => {
    const res = await apiFetch(`${API_URL}/agenda/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    const data = await handleResponse(res);
    emitScheduleSync({ entity: 'agenda', action: 'eliminar', id });
    return data;
  },
  recordatorios: async () => {
    const res = await apiFetch(`${API_URL}/agenda/recordatorios`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Phase 8.1 - Compartidos e Invitaciones
  invitacionesPendientes: async () => {
    const res = await apiFetch(`${API_URL}/agenda/invitaciones/pendientes`, { headers: getHeaders() });
    return handleResponse(res);
  },
  responderInvitacion: async (id, estado) => {
    const res = await apiFetch(`${API_URL}/agenda/${id}/responder`, {
      method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ estado }),
    });
    return handleResponse(res);
  },
  consultarDisponibilidad: async ({ usuarios_ids, inicio, fin, excluir_id, excluir_proyecto_id, sin_proyectos }) => {
    const params = new URLSearchParams({ usuarios_ids, inicio });
    if (fin) params.append('fin', fin);
    if (excluir_id) params.append('excluir_id', excluir_id);
    if (excluir_proyecto_id) params.append('excluir_proyecto_id', excluir_proyecto_id);
    if (sin_proyectos) params.append('sin_proyectos', '1');
    const res = await apiFetch(`${API_URL}/agenda/disponibilidad?${params}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Phase 8.1 - Configuración Laboral
  getConfigLaboral: async () => {
    const res = await apiFetch(`${API_URL}/agenda/config-laboral`, { headers: getHeaders() });
    return handleResponse(res);
  },
  updateConfigLaboral: async (payload) => {
    const res = await apiFetch(`${API_URL}/agenda/config-laboral`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },
  getGoogleCalendarStatus: async () => {
    const res = await apiFetch(`${API_URL}/agenda/google-calendar/status`, { headers: getHeaders() });
    return handleResponse(res);
  },
  connectGoogleCalendar: async (code) => {
    const res = await apiFetch(`${API_URL}/agenda/google-calendar/connect`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ code }),
    });
    return handleResponse(res);
  },
  disconnectGoogleCalendar: async () => {
    const res = await apiFetch(`${API_URL}/agenda/google-calendar/connect`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // Phase 8.1 - Días Especiales
  listarDiasEspeciales: async (mes, anio) => {
    let url = `${API_URL}/agenda/dias-especiales`;
    if (mes && anio) url += `?mes=${mes}&anio=${anio}`;
    const res = await apiFetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },
  crearDiaEspecial: async (payload) => {
    const res = await apiFetch(`${API_URL}/agenda/dias-especiales`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },
  eliminarDiaEspecial: async (id) => {
    const res = await apiFetch(`${API_URL}/agenda/dias-especiales/${id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    return handleResponse(res);
  },
};

// ── Contratos (solo admin) ─────────────────────────────────────────────────
export const contratosService = {
  listar: async (params = {}) => {
    const res = await apiFetch(`${API_URL}/contratos${construirQuery(params)}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  resumen: async () => {
    const res = await apiFetch(`${API_URL}/contratos/resumen`, { headers: getHeaders() });
    return handleResponse(res);
  },
  catalogos: async () => {
    const res = await apiFetch(`${API_URL}/contratos/catalogos`, { headers: getHeaders() });
    return handleResponse(res);
  },
  obtener: async (id) => {
    const res = await apiFetch(`${API_URL}/contratos/${id}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  crear: async (datos) => {
    const res = await apiFetch(`${API_URL}/contratos`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  editar: async (id, datos) => {
    const res = await apiFetch(`${API_URL}/contratos/${id}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  eliminar: async (id) => {
    const res = await apiFetch(`${API_URL}/contratos/${id}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  subirArchivo: async (id, archivo, tipoDocumento = 'FIRMADO') => {
    const fd = new FormData();
    fd.append('tipoDocumento', tipoDocumento);
    fd.append('archivo', archivo);
    const res = await apiFetch(`${API_URL}/contratos/${id}/archivos`, { method: 'POST', headers: getHeaders(true), body: fd });
    return handleResponse(res);
  },
  eliminarArchivo: async (archivoId) => {
    const res = await apiFetch(`${API_URL}/contratos/archivos/${archivoId}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  // El PDF no tiene URL publica: se pide con la sesion y se muestra desde
  // memoria (blob). Quien llama debe liberar la URL con URL.revokeObjectURL.
  urlParaVer: async (archivoId) => {
    const res = await apiFetch(`${API_URL}/contratos/archivos/${archivoId}`, { headers: getHeaders(true) });
    if (!res.ok) await handleResponse(res);
    return URL.createObjectURL(await res.blob());
  },
  descargarArchivo: (archivoId, nombre) => descargarArchivo(`${API_URL}/contratos/archivos/${archivoId}?descargar=1`, nombre),
};

// ── Finanzas: Ventas (pagos), Tesorería (partidas) y Gastos ────────────────
// El acceso es por usuario y recurso (usuario.finanzas); el servidor manda
// 403 SIN_PERMISO si no alcanza el nivel.
const pedirFinanzas = async (ruta, { metodo = 'GET', cuerpo, formData } = {}) => {
  const res = await apiFetch(`${API_URL}/finanzas${ruta}`, {
    method: metodo,
    headers: getHeaders(Boolean(formData)),
    body: formData || (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
  });
  return handleResponse(res);
};
const formularioComprobante = (archivo) => {
  const fd = new FormData();
  fd.append('archivo', archivo);
  return fd;
};

export const finanzasService = {
  catalogos: () => pedirFinanzas('/catalogos'),
  bitacora: (params = {}) => pedirFinanzas(`/bitacora${construirQuery(params)}`),
  cuentas: {
    listar: () => pedirFinanzas('/cuentas'),
    crear: (datos) => pedirFinanzas('/cuentas', { metodo: 'POST', cuerpo: datos }),
    editar: (id, datos) => pedirFinanzas(`/cuentas/${id}`, { metodo: 'PUT', cuerpo: datos }),
    eliminar: (id) => pedirFinanzas(`/cuentas/${id}`, { metodo: 'DELETE' }),
  },
  partidas: {
    listar: () => pedirFinanzas('/partidas'),
    crear: (datos) => pedirFinanzas('/partidas', { metodo: 'POST', cuerpo: datos }),
    editar: (id, datos) => pedirFinanzas(`/partidas/${id}`, { metodo: 'PUT', cuerpo: datos }),
    eliminar: (id) => pedirFinanzas(`/partidas/${id}`, { metodo: 'DELETE' }),
  },
  pagos: {
    listar: (params = {}) => pedirFinanzas(`/pagos${construirQuery(params)}`),
    resumen: (params = {}) => pedirFinanzas(`/pagos/resumen${construirQuery(params)}`),
    obtener: (id) => pedirFinanzas(`/pagos/${id}`),
    crear: (datos) => pedirFinanzas('/pagos', { metodo: 'POST', cuerpo: datos }),
    editar: (id, datos) => pedirFinanzas(`/pagos/${id}`, { metodo: 'PUT', cuerpo: datos }),
    anular: (id, motivo) => pedirFinanzas(`/pagos/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    eliminar: (id) => pedirFinanzas(`/pagos/${id}`, { metodo: 'DELETE' }),
    subirComprobante: (id, archivo) => pedirFinanzas(`/pagos/${id}/comprobantes`, { metodo: 'POST', formData: formularioComprobante(archivo) }),
  },
  gastos: {
    listar: (params = {}) => pedirFinanzas(`/gastos${construirQuery(params)}`),
    resumen: (params = {}) => pedirFinanzas(`/gastos/resumen${construirQuery(params)}`),
    obtener: (id) => pedirFinanzas(`/gastos/${id}`),
    crear: (datos) => pedirFinanzas('/gastos', { metodo: 'POST', cuerpo: datos }),
    editar: (id, datos) => pedirFinanzas(`/gastos/${id}`, { metodo: 'PUT', cuerpo: datos }),
    pagar: (id, datos = {}) => pedirFinanzas(`/gastos/${id}/pagar`, { metodo: 'POST', cuerpo: datos }),
    reabrir: (id) => pedirFinanzas(`/gastos/${id}/reabrir`, { metodo: 'POST', cuerpo: {} }),
    anular: (id, motivo) => pedirFinanzas(`/gastos/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    duplicar: (id, meses = 1) => pedirFinanzas(`/gastos/${id}/duplicar`, { metodo: 'POST', cuerpo: { meses } }),
    eliminar: (id) => pedirFinanzas(`/gastos/${id}`, { metodo: 'DELETE' }),
    subirComprobante: (id, archivo) => pedirFinanzas(`/gastos/${id}/comprobantes`, { metodo: 'POST', formData: formularioComprobante(archivo) }),
  },
  tesoreria: {
    resumen: (params = {}) => pedirFinanzas(`/tesoreria${construirQuery(params)}`),
    asignaciones: (params = {}) => pedirFinanzas(`/tesoreria/asignaciones${construirQuery(params)}`),
    crearAsignacion: (datos) => pedirFinanzas('/tesoreria/asignaciones', { metodo: 'POST', cuerpo: datos }),
    editarAsignacion: (id, datos) => pedirFinanzas(`/tesoreria/asignaciones/${id}`, { metodo: 'PUT', cuerpo: datos }),
    eliminarAsignacion: (id) => pedirFinanzas(`/tesoreria/asignaciones/${id}`, { metodo: 'DELETE' }),
  },
  informe: (params = {}) => pedirFinanzas(`/informe${construirQuery(params)}`),
  descargarInforme: (params = {}) => descargarArchivo(
    `${API_URL}/finanzas/informe${construirQuery({ ...params, formato: 'excel' })}`,
    `informe_gastos_${params.anio || ''}.xlsx`,
  ),
  comprobantes: {
    // Sin URL pública: se pide con la sesión y se muestra desde memoria (blob).
    // Quien llama debe liberar la URL con URL.revokeObjectURL.
    urlParaVer: async (id) => {
      const res = await apiFetch(`${API_URL}/finanzas/comprobantes/${id}`, { headers: getHeaders(true) });
      if (!res.ok) await handleResponse(res);
      return URL.createObjectURL(await res.blob());
    },
    descargar: (id, nombre) => descargarArchivo(`${API_URL}/finanzas/comprobantes/${id}?descargar=1`, nombre),
    eliminar: (id) => pedirFinanzas(`/comprobantes/${id}`, { metodo: 'DELETE' }),
  },
};

// ── Configuración de la instalación ────────────────────────────────────────
// Directorio de clientes y proveedores (solo administradores).
export const empresasService = {
  listar: async (params = {}) => {
    const res = await apiFetch(`${API_URL}/empresas${construirQuery(params)}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  resumen: async () => {
    const res = await apiFetch(`${API_URL}/empresas/resumen`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // tipo: 'CLIENTE' | 'PROVEEDOR' | undefined (todas). Lista corta para selects.
  catalogo: async (tipo) => {
    const res = await apiFetch(`${API_URL}/empresas/catalogo${construirQuery({ tipo })}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  obtener: async (id) => {
    const res = await apiFetch(`${API_URL}/empresas/${id}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  crear: async (datos) => {
    const res = await apiFetch(`${API_URL}/empresas`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  editar: async (id, datos) => {
    const res = await apiFetch(`${API_URL}/empresas/${id}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  eliminar: async (id) => {
    const res = await apiFetch(`${API_URL}/empresas/${id}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  crearContacto: async (empresaId, datos) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/contactos`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  editarContacto: async (contactoId, datos) => {
    const res = await apiFetch(`${API_URL}/empresas/contactos/${contactoId}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  eliminarContacto: async (contactoId) => {
    const res = await apiFetch(`${API_URL}/empresas/contactos/${contactoId}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  // Accesos al portal de clientes de la empresa
  accesos: async (empresaId) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/accesos`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // datos: { contactoId } o { nombre, email }
  darAcceso: async (empresaId, datos) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/accesos`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  reenviarAcceso: async (empresaId, invitacionId) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/accesos/invitaciones/${segmento(invitacionId)}/reenviar`, { method: 'POST', headers: getHeaders() });
    return handleResponse(res);
  },
  cancelarAcceso: async (empresaId, invitacionId) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/accesos/invitaciones/${segmento(invitacionId)}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  // estado: 'activo' | 'inactivo'
  estadoAcceso: async (empresaId, usuarioId, estado) => {
    const res = await apiFetch(`${API_URL}/empresas/${empresaId}/accesos/${usuarioId}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify({ estado }) });
    return handleResponse(res);
  },
};

// Portal de clientes (solo cuentas CLIENTE). Todo viene ya filtrado por la
// empresa de la cuenta.
const pedirPortal = async (ruta, { metodo = 'GET', cuerpo } = {}) => {
  const res = await apiFetch(`${API_URL}/portal${ruta}`, {
    method: metodo,
    headers: getHeaders(),
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return handleResponse(res);
};

export const portalService = {
  resumen: () => pedirPortal('/resumen'),
  perfil: () => pedirPortal('/perfil'),
  // Multipart (foto opcional): sin Content-Type JSON.
  actualizarPerfil: async (datos) => {
    const res = await apiFetch(`${API_URL}/portal/perfil`, { method: 'PUT', headers: getHeaders(true), body: datos });
    return handleResponse(res);
  },
  proyectos: () => pedirPortal('/proyectos'),
  proyecto: (id) => pedirPortal(`/proyectos/${segmento(id)}`),
  mensajes: (id) => pedirPortal(`/proyectos/${segmento(id)}/mensajes`),
  enviarMensaje: (id, contenido) => pedirPortal(`/proyectos/${segmento(id)}/mensajes`, { metodo: 'POST', cuerpo: { contenido } }),
  documentos: () => pedirPortal('/documentos'),
  reuniones: () => pedirPortal('/reuniones'),
  contratos: () => pedirPortal('/contratos'),
  // PDF del contrato: se pide con la sesión y se abre desde memoria (blob).
  urlArchivoContrato: async (archivoId) => {
    const res = await apiFetch(`${API_URL}/portal/contratos/archivos/${segmento(archivoId)}`, { headers: getHeaders(true) });
    if (!res.ok) await handleResponse(res);
    return URL.createObjectURL(await res.blob());
  },
  descargarArchivoContrato: (archivoId, nombre) => descargarArchivo(`${API_URL}/portal/contratos/archivos/${segmento(archivoId)}?descargar=1`, nombre),
};

// Lado del equipo: conversación con el cliente y archivos compartidos.
export const portalEquipoService = {
  proyecto: async (proyectoId) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/portal`, { headers: getHeaders() });
    return handleResponse(res);
  },
  responder: async (proyectoId, contenido) => {
    const res = await apiFetch(`${API_URL}/proyectos/${proyectoId}/portal/mensajes`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ contenido }) });
    return handleResponse(res);
  },
  compartirArchivo: async (adjuntoId, visible) => {
    const res = await apiFetch(`${API_URL}/proyectos/adjuntos/${adjuntoId}/visible-cliente`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ visible }) });
    return handleResponse(res);
  },
};

// Reportes para administradores. `formato: 'excel'` descarga el archivo.
export const reportesService = {
  personas: async ({ desde, hasta } = {}) => {
    const res = await apiFetch(`${API_URL}/reportes/personas${construirQuery({ desde, hasta })}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  descargarPersonas: ({ desde, hasta } = {}) => descargarArchivo(
    `${API_URL}/reportes/personas${construirQuery({ desde, hasta, formato: 'excel' })}`,
    `reporte_personas_${desde || ''}_${hasta || ''}.xlsx`,
  ),
  clientes: async () => {
    const res = await apiFetch(`${API_URL}/reportes/clientes`, { headers: getHeaders() });
    return handleResponse(res);
  },
  descargarClientes: () => descargarArchivo(`${API_URL}/reportes/clientes?formato=excel`, 'reporte_clientes.xlsx'),
};

export const configuracionService = {
  // Sin sesión: la usa también la pantalla de inicio de sesión.
  publica: async () => {
    const res = await fetch(`${API_URL}/configuracion/publica`);
    return handleResponse(res, { publica: true });
  },
  obtener: async () => {
    const res = await apiFetch(`${API_URL}/configuracion`, { headers: getHeaders() });
    return handleResponse(res);
  },
  guardar: async (cambios) => {
    const res = await apiFetch(`${API_URL}/configuracion`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(cambios) });
    return handleResponse(res);
  },
  restablecer: async () => {
    const res = await apiFetch(`${API_URL}/configuracion/restablecer`, { method: 'POST', headers: getHeaders() });
    return handleResponse(res);
  },
  subirImagen: async (clave, archivo) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    const res = await apiFetch(`${API_URL}/configuracion/archivos/${encodeURIComponent(clave)}`, { method: 'POST', headers: getHeaders(true), body: fd });
    return handleResponse(res);
  },
  eliminarImagen: async (clave) => {
    const res = await apiFetch(`${API_URL}/configuracion/archivos/${encodeURIComponent(clave)}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  administradores: async () => {
    const res = await apiFetch(`${API_URL}/configuracion/administradores`, { headers: getHeaders() });
    return handleResponse(res);
  },
  invitarAdministrador: async (datos) => {
    const res = await apiFetch(`${API_URL}/configuracion/administradores`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  reenviarInvitacionAdmin: async (id) => {
    const res = await apiFetch(`${API_URL}/configuracion/administradores/invitaciones/${encodeURIComponent(id)}/reenviar`, { method: 'POST', headers: getHeaders() });
    return handleResponse(res);
  },
  eliminarInvitacionAdmin: async (id) => {
    const res = await apiFetch(`${API_URL}/configuracion/administradores/invitaciones/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getHeaders() });
    return handleResponse(res);
  },
  accionAdministrador: async (id, accion) => {
    const res = await apiFetch(`${API_URL}/configuracion/administradores/${id}/acciones`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ accion }) });
    return handleResponse(res);
  },
  correoPrueba: async (email, plantilla) => {
    const res = await apiFetch(`${API_URL}/configuracion/correo/prueba`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ email, plantilla }) });
    return handleResponse(res);
  },
  plantillasCorreo: async () => {
    const res = await apiFetch(`${API_URL}/configuracion/correo/plantillas`, { headers: getHeaders() });
    return handleResponse(res);
  },
  // Arma el correo con el borrador del panel (sin guardarlo).
  vistaPreviaCorreo: async (plantilla, borrador, signal) => {
    const res = await apiFetch(`${API_URL}/configuracion/correo/vista-previa`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ plantilla, borrador }), signal });
    return handleResponse(res);
  },
  // Prueba conexión e inicio de sesión SMTP con los datos del formulario (sin guardarlos).
  verificarCorreo: async (datos) => {
    const res = await apiFetch(`${API_URL}/configuracion/correo/verificar`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(datos) });
    return handleResponse(res);
  },
  estado: async () => {
    const res = await apiFetch(`${API_URL}/configuracion/estado`, { headers: getHeaders() });
    return handleResponse(res);
  },
};
