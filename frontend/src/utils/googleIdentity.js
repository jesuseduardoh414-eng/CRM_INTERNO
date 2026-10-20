// Google Identity Services (el boton "Continuar con Google" en una ventana
// emergente). Se carga una sola vez para toda la aplicacion: lo usan la agenda
// (conectar Google Calendar) y el panel de configuracion (conectar Google
// Drive). Con `ux_mode: 'popup'` Google entrega un codigo que el servidor
// cambia por los permisos con redirect_uri 'postmessage'.
let googleScriptPromise = null;

export const cargarGoogleIdentityScript = () => {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      googleScriptPromise = null;
      const error = new Error('google-script');
      error.code = 'google-script';
      reject(error);
    };
    document.head.appendChild(script);
  });

  return googleScriptPromise;
};

/**
 * Abre la ventana de Google y resuelve con el codigo de autorizacion.
 * Con `elegirCuenta`, Google siempre pregunta que cuenta usar. Rechaza con
 * error.code = 'google-script' si no carga el script, 'popup-bloqueado' si el
 * navegador no dejo abrir la ventana, 'sin-codigo' si Google no devolvio
 * codigo o 'cancelado' si se cerro.
 */
export const pedirCodigoGoogle = async ({ clientId, scope, elegirCuenta = false }) => {
  const google = await cargarGoogleIdentityScript();
  return new Promise((resolve, reject) => {
    const falla = (codigo) => {
      const error = new Error(codigo);
      error.code = codigo;
      reject(error);
    };
    const cliente = google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope,
      ux_mode: 'popup',
      ...(elegirCuenta ? { select_account: true } : {}),
      callback: (respuesta) => (respuesta?.code ? resolve(respuesta.code) : falla('sin-codigo')),
      error_callback: (error) => falla(error?.type === 'popup_failed_to_open' ? 'popup-bloqueado' : 'cancelado'),
    });
    cliente.requestCode();
  });
};
