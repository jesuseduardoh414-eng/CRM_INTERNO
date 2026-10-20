// Panel de configuración de la instalación (solo rol CONFIGURADOR).
// Tiene su propio marco: esta cuenta no ve el menú ni los datos del CRM.
//
// Interacción:
//  - Textos, colores, módulos y reglas se editan en un borrador; la barra
//    superior cuenta los cambios y se guardan juntos (botón o Ctrl+S).
//    Las imágenes se guardan al subirlas.
//  - La vista previa usa el borrador en vivo. Pasar el ratón o enfocar un
//    campo resalta en ella el elemento que controla (data-zona → enfoque).
//  - El menú lateral muestra cuánto de la marca está personalizado y sugiere
//    el siguiente paso; las secciones con cambios sin guardar llevan un punto.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Brush, CalendarSync, Check, ChevronRight, Eye, FolderKanban, HardDrive, KeyRound, LayoutPanelLeft, Loader2, Mail, Palette, Paperclip, RotateCcw, Settings2, ShieldCheck, UserCog } from 'lucide-react';
import { configuracionService, getPublicAssetUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useConfirmacion } from '../components/ConfirmDialog';
import LogoMarca from '../components/LogoMarca';
import MenuCuenta from '../components/MenuCuenta';
import SeguridadCuenta from '../components/SeguridadCuenta';
import SelectorSimple from '../components/SelectorSimple';
import LienzoPrevia from '../components/configuracion/LienzoPrevia';
import { Campo, CampoColor, CampoImagen, Fila, Interruptor, PaletaGenerada } from '../components/configuracion/PiezasConfiguracion';
import { PanelEstado, SeccionAccesos, SeccionArchivos, SeccionCorreo, SeccionGoogle, SeccionOperacion } from '../components/configuracion/SeccionesSistema';
import { EditorAreas, ListaModulos, ReglasTareas, SeccionPermisos, ServidorCorreo } from '../components/configuracion/SeccionesReglas';
import { DisenoCorreo, TextosCorreo, VistaCorreo } from '../components/configuracion/CorreoDiseno';
import SeccionDrive from '../components/configuracion/SeccionDrive';
import { COLORES_FABRICA, esColorFabrica } from '../utils/temaMarca';
import { ICONOS_BENEFICIO } from '../utils/iconosMarca';
import '../configuracion.css';

// `grupos`: partes del borrador que edita cada sección (para el punto de
// "cambios sin guardar" y para deshacer solo esa sección). Admiten rutas
// ('reglas.areas') porque `reglas` reparte campos entre varias secciones.
const SECCIONES = [
  { id: 'marca', grupo: 'personalizacion', icono: Brush, titulo: 'cfgSecBrand', ayuda: 'cfgSecBrandHint', grupos: ['marca'], vista: 'crm', atajo: '1' },
  { id: 'colores', grupo: 'personalizacion', icono: Palette, titulo: 'cfgSecColors', ayuda: 'cfgSecColorsHint', grupos: ['colores'], vista: 'crm', atajo: '2' },
  { id: 'login', grupo: 'personalizacion', icono: LayoutPanelLeft, titulo: 'cfgSecLogin', ayuda: 'cfgSecLoginHint', grupos: ['login'], vista: 'login', atajo: '3' },
  { id: 'accesos', grupo: 'empresa', icono: ShieldCheck, titulo: 'cfgSecAccess', ayuda: 'cfgSecAccessHint', grupos: ['seguridad'], atajo: '4' },
  { id: 'permisos', grupo: 'empresa', icono: KeyRound, titulo: 'cfgSecPerms', ayuda: 'cfgSecPermsHint', grupos: ['permisosAreas'], atajo: '5' },
  { id: 'operacion', grupo: 'empresa', icono: FolderKanban, titulo: 'cfgSecOps', ayuda: 'cfgSecOpsHint', grupos: ['reglas.areas', 'tareas', 'operacion'], atajo: '6' },
  { id: 'archivos', grupo: 'sistema', icono: Paperclip, titulo: 'cfgSecFiles', ayuda: 'cfgSecFilesHint', grupos: ['subidas'], atajo: '7' },
  { id: 'correo', grupo: 'sistema', icono: Mail, titulo: 'cfgSecMail', ayuda: 'cfgSecMailHint', grupos: ['correo', 'reglas.remitenteCorreo', 'avisos', 'disenoCorreo', 'textosCorreo'], atajo: '8' },
  { id: 'modulos', grupo: 'sistema', icono: Settings2, titulo: 'cfgSecModules', ayuda: 'cfgSecModulesHint', grupos: ['modulos', 'reglas.idiomaPorDefecto', 'reglas.temaPorDefecto'], vista: 'crm', atajo: '9' },
  { id: 'google', grupo: 'sistema', icono: CalendarSync, titulo: 'cfgSecGoogle', ayuda: 'cfgSecGoogleHint', grupos: ['google'], atajo: '0' },
  // Se guarda al momento (conectar, respaldar): no pasa por el borrador.
  { id: 'drive', grupo: 'sistema', icono: HardDrive, titulo: 'cfgSecDrive', ayuda: 'cfgSecDriveHint', grupos: [] },
  { id: 'cuenta', grupo: null, icono: UserCog, titulo: 'cfgSecAccount', ayuda: 'cfgSecAccountHint', grupos: [] },
];
const GRUPOS = [
  { id: 'personalizacion', titulo: 'cfgGroupCustomize' },
  { id: 'empresa', titulo: 'cfgGroupCompany' },
  { id: 'sistema', titulo: 'cfgGroupSystem' },
];

// Al enfocar estos campos la vista previa salta a la pantalla donde se ven.
const VISTA_DE_ZONA = {
  remitente: 'correo',
  loginEtiqueta: 'login', loginTitulo: 'login', loginTexto: 'login', beneficios: 'login', anillo: 'login', fondoLogin: 'login',
  eslogan: 'crm', modulos: 'crm', areas: 'crm', tenir: 'crm',
};

const PALETAS = [
  { nombre: 'OMNIS', primario: COLORES_FABRICA.primario, acento: COLORES_FABRICA.acento },
  { nombre: 'Océano', primario: '#0c4a6e', acento: '#22d3ee' },
  { nombre: 'Bosque', primario: '#14532d', acento: '#a3e635' },
  { nombre: 'Vino', primario: '#4c0519', acento: '#fb7185' },
  { nombre: 'Grafito', primario: '#1f2937', acento: '#f97316' },
  { nombre: 'Índigo', primario: '#312e81', acento: '#a78bfa' },
  { nombre: 'Terracota', primario: '#431407', acento: '#fdba74' },
  { nombre: 'Petróleo', primario: '#134e4a', acento: '#fcd34d' },
];

const IMAGENES = [
  { clave: 'logoOscuro', zona: 'logoOscuro', etiqueta: 'cfgImgLogoOscuro', ayuda: 'cfgImgLogoOscuroHint', fabrica: '/brand/omnis-horizontal-blanco.png', aceptar: 'image/svg+xml,image/png,image/webp,image/jpeg', fondoOscuro: true },
  { clave: 'logoClaro', zona: 'logoClaro', etiqueta: 'cfgImgLogoClaro', ayuda: 'cfgImgLogoClaroHint', fabrica: '/brand/omnis-horizontal-azul.png', aceptar: 'image/svg+xml,image/png,image/webp,image/jpeg' },
  { clave: 'isotipo', zona: 'favicon', etiqueta: 'cfgImgIsotipo', ayuda: 'cfgImgIsotipoHint', fabrica: '/brand/omnis-circulo-dorado.png', aceptar: 'image/svg+xml,image/png,image/webp', dosFondos: true },
  { clave: 'favicon', zona: 'favicon', etiqueta: 'cfgImgFavicon', ayuda: 'cfgImgFaviconHint', fabrica: '/brand/favicon.svg', aceptar: 'image/svg+xml,image/png,image/x-icon,.ico', dosFondos: true },
];

// Igual que DEFECTO.disenoCorreo en backend/src/utils/configuracion.utils.js
const DISENO_CORREO_FABRICA = {
  cabecera: 'color', logo: 'auto', logoAltura: 36, alineacion: 'izquierda', esquinas: 'redondeadas', boton: 'redondeado',
  colorFondo: '#f3f5f9', colorBoton: null, pieTexto: null, direccion: null, telefono: null, sitioWeb: null, textoLegal: null,
};

// Igual que el backend: un Client ID mal escrito se ignoraría al guardar.
const REGEX_CLIENT_ID_GOOGLE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

/** Solo las secciones editables (sin archivos ni metadatos). */
const aBorrador = (c) => ({
  marca: { ...c.marca },
  colores: { ...c.colores },
  login: { ...c.login, beneficios: (c.login.beneficios || []).map((b) => ({ ...b })) },
  modulos: { ...c.modulos },
  reglas: { ...c.reglas, areas: (c.reglas.areas || []).map((a) => ({ ...a })) },
  permisos: { ...c.permisos },
  // Tabla por área: { AREA: { miembro: {...}, admin: {...} } }, solo lo cambiado.
  permisosAreas: JSON.parse(JSON.stringify(c.permisosAreas || {})),
  tareas: { ...c.tareas },
  // `password` solo viaja si se escribe una nueva ('' = conservar la guardada).
  correo: { ...c.correo, password: '' },
  seguridad: { ...c.seguridad },
  subidas: { ...c.subidas, tiposAdjuntos: { ...c.subidas.tiposAdjuntos } },
  avisos: { ...c.avisos },
  // Igual que correo.password: `secret` solo viaja si se escribe uno nuevo.
  google: { clientId: null, secretGuardado: false, ...(c.google || {}), secret: '' },
  // Valores de fábrica por si el servidor todavía no manda este grupo.
  disenoCorreo: { ...DISENO_CORREO_FABRICA, ...(c.disenoCorreo || {}) },
  textosCorreo: JSON.parse(JSON.stringify(c.textosCorreo || {})),
  operacion: {
    ...c.operacion,
    diasLaborales: [...(c.operacion.diasLaborales || [])],
    // Solo los dias con horario distinto al general (sabado medio turno...)
    horariosPorDia: JSON.parse(JSON.stringify(c.operacion.horariosPorDia || {})),
    etiquetasEstados: { ...c.operacion.etiquetasEstados },
    etiquetasPrioridades: { ...c.operacion.etiquetasPrioridades },
  },
});

/** Valor en una ruta ('reglas.areas') y copia con esa ruta cambiada. */
const leerRuta = (objeto, ruta) => ruta.split('.').reduce((o, k) => o?.[k], objeto);
const conRuta = (objeto, ruta, valor) => {
  const [k, ...resto] = ruta.split('.');
  return { ...objeto, [k]: resto.length ? conRuta(objeto?.[k] || {}, resto.join('.'), valor) : valor };
};

/** Hojas del objeto ('marca.nombreSistema' → valor), para contar cambios. */
const aplanar = (objeto, prefijo = '') => Object.entries(objeto || {}).flatMap(([clave, valor]) => (
  valor && typeof valor === 'object'
    ? aplanar(valor, `${prefijo}${clave}.`)
    : [[`${prefijo}${clave}`, valor ?? null]]
));
const contarCambios = (a, b) => {
  const pa = Object.fromEntries(aplanar(a));
  const pb = Object.fromEntries(aplanar(b));
  return [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => (pa[k] || null) !== (pb[k] || null)).length;
};

/** Pasos de personalización de la marca respecto a la instalación de fábrica. */
const pasosMarca = (borrador, archivos) => [
  { id: 'nombre', ok: borrador.marca.nombreSistema !== 'OMNIS CRM', seccion: 'marca', foco: 'cfg-sistema', texto: 'cfgTodoName' },
  { id: 'empresa', ok: borrador.marca.nombreEmpresa !== 'OMNIS Proyectos Globales', seccion: 'marca', foco: 'cfg-empresa', texto: 'cfgTodoCompany' },
  { id: 'logoOscuro', ok: Boolean(archivos.logoOscuro), seccion: 'marca', foco: 'img-logoOscuro', texto: 'cfgTodoLogoDark' },
  { id: 'logoClaro', ok: Boolean(archivos.logoClaro), seccion: 'marca', foco: 'img-logoClaro', texto: 'cfgTodoLogoLight' },
  { id: 'favicon', ok: Boolean(archivos.favicon || archivos.isotipo), seccion: 'marca', foco: 'img-favicon', texto: 'cfgTodoFavicon' },
  { id: 'colores', ok: !esColorFabrica(borrador.colores), seccion: 'colores', foco: 'cfg-primario', texto: 'cfgTodoColors' },
  { id: 'login', ok: Boolean(borrador.login.titulo || borrador.login.texto || borrador.login.etiqueta), seccion: 'login', foco: 'cfg-titulo', texto: 'cfgTodoLogin' },
];

const AnilloProgreso = ({ valor }) => {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="4" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-gold)" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - valor)} className="cfg-progreso-anillo" />
    </svg>
  );
};

const ConfiguracionPage = () => {
  const { t, tBase } = usePreferences();
  const { usuario, logout } = useAuth();
  const { showToast } = useToast();
  const { recargar } = useConfiguracion();
  const { confirmar, dialogo } = useConfirmacion();

  const [servidor, setServidor] = useState(null); // respuesta completa de GET /configuracion
  const [borrador, setBorrador] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [seccion, setSeccion] = useState('marca');
  const [zonaRaton, setZonaRaton] = useState(null);
  const [zonaFoco, setZonaFoco] = useState(null);
  const enfocarDespues = useRef(null);
  const [estado, setEstado] = useState(null);
  // Correo y avisos: pestaña activa y plantilla que se edita / previsualiza.
  const [pestanaCorreo, setPestanaCorreo] = useState('servidor');
  const [plantillasCorreo, setPlantillasCorreo] = useState(null);
  const [plantillaCorreo, setPlantillaCorreo] = useState('invitacion');

  const [errorPlantillas, setErrorPlantillas] = useState(false);
  // Por debajo de xl ajustes y vista previa no caben juntos: se alterna entre
  // ellos. Guarda la sección en la que se pidió la vista previa, así al
  // cambiar de sección se vuelve a los ajustes.
  const [previaEn, setPreviaEn] = useState(null);
  const pestanasMovil = useRef(null);
  const [salto, setSalto] = useState(0); // cuenta los clics en "Siguiente paso"
  const [intentoPlantillas, setIntentoPlantillas] = useState(0);

  useEffect(() => {
    if (seccion !== 'correo' || plantillasCorreo?.length) return undefined;
    let cancelado = false;
    configuracionService.plantillasCorreo()
      .then((r) => { if (!cancelado) { setPlantillasCorreo(r.plantillas); setErrorPlantillas(false); } })
      .catch(() => { if (!cancelado) setErrorPlantillas(true); });
    return () => { cancelado = true; };
  }, [seccion, plantillasCorreo, intentoPlantillas, pestanaCorreo]);

  const refrescarEstado = useCallback(() => configuracionService.estado().then(setEstado).catch(() => {}), []);
  useEffect(() => {
    let cancelado = false;
    configuracionService.estado().then((e) => { if (!cancelado) setEstado(e); }).catch(() => {});
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    document.title = `${t('cfgPanelTitle')} · ${t('appName')}`;
  }, [t]);

  useEffect(() => {
    let cancelado = false;
    configuracionService.obtener()
      .then((datos) => { if (!cancelado) { setServidor(datos); setBorrador(aBorrador(datos)); } })
      .catch((err) => { if (!cancelado) setError(err.message); });
    return () => { cancelado = true; };
  }, []);

  const original = useMemo(() => (servidor ? aBorrador(servidor) : null), [servidor]);
  const cambios = borrador && original ? contarCambios(borrador, original) : 0;
  const hayCambios = cambios > 0;
  const seccionSucia = (s) => Boolean(original && borrador) && s.grupos.some((g) => JSON.stringify(leerRuta(borrador, g)) !== JSON.stringify(leerRuta(original, g)));

  // Aviso del navegador si se cierra la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [hayCambios]);

  const cambiar = (grupo, campo, valor) => setBorrador((b) => ({ ...b, [grupo]: { ...b[grupo], [campo]: valor } }));
  const cambiarBeneficio = (i, campo, valor) => setBorrador((b) => ({
    ...b,
    login: { ...b.login, beneficios: b.login.beneficios.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) },
  }));
  const cambiarAreas = (areas) => setBorrador((b) => ({ ...b, reglas: { ...b.reglas, areas } }));
  const cambiarPermisosAreas = (permisosAreas) => setBorrador((b) => ({ ...b, permisosAreas }));
  // Quitar el servidor SMTP: el correo vuelve al SMTP del .env o a la consola.
  const quitarSmtp = () => setBorrador((b) => ({
    ...b,
    correo: { ...b.correo, host: null, usuario: null, remitenteEmail: null, password: null },
  }));

  // Quitar las credenciales de Google: la agenda deja de ofrecer la conexión.
  // `secretGuardado: false` hace que el cambio cuente aunque no hubiera Client ID.
  const quitarGoogle = () => setBorrador((b) => ({
    ...b,
    google: { ...b.google, clientId: null, secret: null, secretGuardado: false },
  }));

  const aplicarRespuesta = async (configuracion, mensaje) => {
    setServidor((prev) => ({ ...prev, ...configuracion }));
    await recargar();
    if (mensaje) showToast(mensaje, 'success');
  };

  const guardar = useCallback(async () => {
    if (!borrador) return;
    if (borrador.google?.clientId && !REGEX_CLIENT_ID_GOOGLE.test(borrador.google.clientId)) {
      setSeccion('google');
      showToast(t('gcalClientIdInvalid'), 'error');
      return;
    }
    setGuardando(true);
    try {
      const data = await configuracionService.guardar(borrador);
      setBorrador(aBorrador(data.configuracion));
      setServidor((prev) => ({ ...prev, ...data.configuracion }));
      await recargar();
      showToast(t('cfgSaved'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  }, [borrador, recargar, showToast, t]);

  // Ctrl+S guarda; Alt+0..9 cambia de sección.
  useEffect(() => {
    const alTeclear = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (hayCambios && !guardando) guardar();
        return;
      }
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const destino = SECCIONES.find((s) => s.atajo === e.key);
        if (destino) { e.preventDefault(); setSeccion(destino.id); }
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [hayCambios, guardando, guardar]);

  // Tras saltar a otra sección desde una sugerencia, enfocar el campo.
  useEffect(() => {
    const id = enfocarDespues.current;
    if (!id) return;
    enfocarDespues.current = null;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const enfocable = el.matches('input,textarea,select,button') ? el : el.querySelector('button');
    enfocable?.focus({ preventScroll: true });
  }, [seccion, borrador, salto]);

  // En móvil la sección activa puede quedar fuera de la tira de pestañas
  // (p. ej. al saltar desde una sugerencia): se trae a la vista.
  // Solo en horizontal, para no mover la página.
  useEffect(() => {
    const tira = pestanasMovil.current;
    const activa = tira?.querySelector('[aria-current="page"]');
    if (!tira || !activa || !tira.clientWidth) return;
    tira.scrollTo({ left: activa.offsetLeft - (tira.clientWidth - activa.clientWidth) / 2, behavior: 'smooth' });
  }, [seccion]);

  const irA = (paso) => {
    enfocarDespues.current = paso.foco;
    setSeccion(paso.seccion);
    // Si ya se está en esa sección, `seccion` no cambia: `salto` dispara el
    // enfoque igual. En móvil se vuelve a los ajustes, donde está el campo.
    setPreviaEn(null);
    setSalto((n) => n + 1);
  };

  const subirImagen = async (clave, archivo) => {
    try {
      const data = await configuracionService.subirImagen(clave, archivo);
      await aplicarRespuesta(data.configuracion, t('cfgImageUpdated'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const quitarImagen = async (clave) => {
    try {
      const data = await configuracionService.eliminarImagen(clave);
      await aplicarRespuesta(data.configuracion, t('cfgImageRemoved'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const restablecer = async () => {
    const ok = await confirmar({ titulo: t('cfgResetConfirm'), descripcion: t('cfgResetConfirmText'), textoConfirmar: t('cfgDanger'), peligro: true });
    if (!ok) return;
    try {
      const data = await configuracionService.restablecer();
      setBorrador(aBorrador(data.configuracion));
      await aplicarRespuesta(data.configuracion, t('cfgResetDone'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const deshacerSeccion = (s) => setBorrador((b) => s.grupos.reduce((acc, g) => conRuta(acc, g, JSON.parse(JSON.stringify(leerRuta(original, g)))), b));

  const salir = async () => {
    if (hayCambios && !(await confirmar({ titulo: t('cfgLeaveConfirm'), textoConfirmar: t('logout') }))) return;
    logout();
  };

  const opcionesCuenta = useMemo(() => [
    { id: 'cuenta', icono: UserCog, etiqueta: t('menuMyAccount'), atajo: 'Ctrl+,', onSelect: () => setSeccion('cuenta') },
  ], [t]);

  // Enlace con la vista previa: zona bajo el ratón o con el foco.
  const zonaDe = (evento) => evento.target.closest?.('[data-zona]')?.getAttribute('data-zona') || null;
  const enfoque = zonaRaton || zonaFoco;

  const archivosRel = servidor?.archivos || {};
  const archivos = useMemo(() => Object.fromEntries(Object.entries(servidor?.archivos || {}).map(([k, v]) => [k, getPublicAssetUrl(v)])), [servidor]);
  const limites = servidor?.limitesArchivos || {};
  const kb = (clave) => Math.round((limites[clave]?.maxBytes || 1024 * 1024) / 1024);
  const actual = SECCIONES.find((s) => s.id === seccion);
  const IconoActual = actual.icono;
  const pasos = borrador ? pasosMarca(borrador, archivosRel) : [];
  const hechos = pasos.filter((p) => p.ok).length;
  const siguiente = pasos.find((p) => !p.ok);
  const vistaSugerida = VISTA_DE_ZONA[zonaFoco] || actual.vista || 'crm';
  // La columna derecha es una vista previa (y no el panel de estado).
  const hayPrevia = Boolean(actual.vista) || (seccion === 'correo' && pestanaCorreo !== 'servidor');
  const verPrevia = hayPrevia && previaEn === seccion;

  const contenido = () => {
    if (!borrador) return null;
    const { marca, colores, login, modulos, reglas } = borrador;

    if (seccion === 'marca') {
      return (
        <>
          <Fila titulo={t('cfgRowIdentity')} descripcion={t('cfgRowIdentityHint')}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <Campo etiqueta={t('cfgSystemName')} ayuda={t('cfgSystemNameHint')} htmlFor="cfg-sistema" zona="nombreSistema">
                <input id="cfg-sistema" className="cfg-input" maxLength={40} value={marca.nombreSistema} onChange={(e) => cambiar('marca', 'nombreSistema', e.target.value)} />
              </Campo>
              <Campo etiqueta={t('cfgShortName')} ayuda={t('cfgShortNameHint')} htmlFor="cfg-corto" zona="nombreCorto">
                <input id="cfg-corto" className="cfg-input" maxLength={20} value={marca.nombreCorto} onChange={(e) => cambiar('marca', 'nombreCorto', e.target.value)} />
              </Campo>
              <Campo etiqueta={t('cfgCompanyName')} ayuda={t('cfgCompanyNameHint')} htmlFor="cfg-empresa" zona="nombreEmpresa">
                <input id="cfg-empresa" className="cfg-input" maxLength={80} value={marca.nombreEmpresa} onChange={(e) => cambiar('marca', 'nombreEmpresa', e.target.value)} />
              </Campo>
              <Campo etiqueta={t('cfgTagline')} ayuda={t('cfgTaglineHint')} htmlFor="cfg-lema" zona="eslogan">
                <input id="cfg-lema" className="cfg-input" maxLength={40} placeholder={tBase('internalPanel')} value={marca.eslogan || ''} onChange={(e) => cambiar('marca', 'eslogan', e.target.value)} />
              </Campo>
            </div>
          </Fila>
          <Fila titulo={t('cfgLogos')} descripcion={t('cfgLogosHint')}>
            <div className="cfg-lista">
              {IMAGENES.map((img) => (
                <div key={img.clave} id={`img-${img.clave}`}>
                  <CampoImagen
                    {...img}
                    etiqueta={t(img.etiqueta)}
                    ayuda={t(img.ayuda)}
                    url={archivos[img.clave] || null}
                    maxKb={kb(img.clave)}
                    onSubir={subirImagen}
                    onQuitar={quitarImagen}
                  />
                </div>
              ))}
            </div>
          </Fila>
        </>
      );
    }

    if (seccion === 'colores') {
      return (
        <>
          <Fila titulo={t('cfgBrandColors')} descripcion={t('cfgBrandColorsHint')}>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:divide-x sm:divide-[var(--cfg-linea)]">
              <Campo etiqueta={t('cfgPrimary')} ayuda={t('cfgPrimaryHint')} htmlFor="cfg-primario" zona="primario">
                <CampoColor id="cfg-primario" valor={colores.primario} onChange={(v) => cambiar('colores', 'primario', v)} />
              </Campo>
              <Campo etiqueta={t('cfgAccent')} ayuda={t('cfgAccentHint')} htmlFor="cfg-acento" zona="acento" className="sm:pl-6">
                <CampoColor id="cfg-acento" valor={colores.acento} onChange={(v) => cambiar('colores', 'acento', v)} fondoContraste="#122039" />
              </Campo>
            </div>
          </Fila>
          <Fila titulo={t('cfgPresets')} descripcion={t('cfgPresetsHint')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PALETAS.map((p) => {
                const elegida = p.primario === colores.primario && p.acento === colores.acento;
                return (
                  <button
                    key={p.nombre}
                    type="button"
                    className="cfg-paleta"
                    aria-pressed={elegida}
                    onClick={() => setBorrador((b) => ({ ...b, colores: { ...b.colores, primario: p.primario, acento: p.acento } }))}
                  >
                    <span className="cfg-paleta-mini" aria-hidden="true">
                      <span className="w-[34%]" style={{ background: p.primario }} />
                      <span className="flex flex-1 flex-col justify-center gap-1 bg-[#f8fafc] px-1.5">
                        <span className="h-1 w-3/4 rounded-full bg-[#e2e8f0]" />
                        <span className="h-2 w-6 rounded-[2px]" style={{ background: p.primario }} />
                        <span className="h-1 w-1/2 rounded-full" style={{ background: p.acento }} />
                      </span>
                    </span>
                    <span className="flex items-center justify-between px-0.5 text-[12.5px] font-medium text-[var(--color-text)]">
                      {p.nombre}
                      {elegida && <Check size={13} className="text-[var(--color-primary)]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </Fila>
          <Fila titulo={t('cfgGeneratedPalette')} descripcion={t('cfgGeneratedPaletteHint')}>
            <PaletaGenerada colores={colores} />
          </Fila>
          <Fila titulo={t('cfgTintDark')} descripcion={t('cfgTintDarkHint')} zona="tenir">
            <Interruptor id="cfg-tenir" activo={colores.tenirModoOscuro} onChange={(v) => cambiar('colores', 'tenirModoOscuro', v)} etiqueta={colores.tenirModoOscuro ? t('sec2faOn') : t('sec2faOff')} />
          </Fila>
        </>
      );
    }

    if (seccion === 'login') {
      return (
        <>
          <Fila titulo={t('cfgRowLoginTexts')} descripcion={t('cfgLoginDefaultHint')}>
            <div className="space-y-5">
              <Campo etiqueta={t('cfgLoginEyebrow')} htmlFor="cfg-eyebrow" zona="loginEtiqueta">
                <input id="cfg-eyebrow" className="cfg-input max-w-sm" maxLength={40} placeholder={tBase('authBrandEyebrow')} value={login.etiqueta || ''} onChange={(e) => cambiar('login', 'etiqueta', e.target.value)} />
              </Campo>
              <Campo etiqueta={t('cfgLoginTitle')} ayuda={t('cfgLoginTitleHint')} htmlFor="cfg-titulo" zona="loginTitulo">
                <textarea id="cfg-titulo" rows={2} className="cfg-input" maxLength={80} placeholder={tBase('authBrandHeadline')} value={login.titulo || ''} onChange={(e) => cambiar('login', 'titulo', e.target.value)} />
              </Campo>
              <Campo etiqueta={t('cfgLoginText')} htmlFor="cfg-texto" zona="loginTexto">
                <textarea id="cfg-texto" rows={3} className="cfg-input" maxLength={220} placeholder={tBase('authBrandText')} value={login.texto || ''} onChange={(e) => cambiar('login', 'texto', e.target.value)} />
                <p className="cfg-ayuda text-right tabular-nums">{(login.texto || '').length}/220</p>
              </Campo>
            </div>
          </Fila>
          <Fila
            titulo={t('cfgShowBenefits')}
            descripcion={t('cfgBenefitsHint')}
            zona="beneficios"
            extra={<Interruptor id="cfg-beneficios" activo={login.mostrarBeneficios} onChange={(v) => cambiar('login', 'mostrarBeneficios', v)} />}
          >
            <div className={`cfg-lista ${login.mostrarBeneficios ? '' : 'pointer-events-none opacity-45'}`}>
              {login.beneficios.map((b, i) => {
                const Icono = ICONOS_BENEFICIO[b.icono] || ICONOS_BENEFICIO.estrella;
                return (
                  <div key={i} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[2rem_9.5rem_minmax(0,1fr)]">
                    <span className="hidden h-9 items-center text-xs font-semibold tabular-nums text-[var(--color-text-muted)] sm:flex">0{i + 1}</span>
                    <div className="relative">
                      <Icono size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <SelectorSimple
                        aria-label={t('cfgBenefitIcon')}
                        className="!pl-8"
                        valor={b.icono}
                        onCambio={(v) => cambiarBeneficio(i, 'icono', v)}
                        opciones={Object.keys(ICONOS_BENEFICIO).map((clave) => ({ valor: clave, etiqueta: t(`cfgIcon${clave}`) }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <input aria-label={t('cfgBenefitTitle')} className="cfg-input font-medium" maxLength={60} placeholder={tBase(`authBrandFeat${i + 1}Title`)} value={b.titulo || ''} onChange={(e) => cambiarBeneficio(i, 'titulo', e.target.value)} />
                      <input aria-label={t('cfgBenefitText')} className="cfg-input" maxLength={140} placeholder={tBase(`authBrandFeat${i + 1}Text`)} value={b.texto || ''} onChange={(e) => cambiarBeneficio(i, 'texto', e.target.value)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Fila>
          <Fila titulo={t('cfgRowBackground')} descripcion={t('cfgRowBackgroundHint')}>
            <div className="cfg-lista">
              <Interruptor id="cfg-anillo" zona="anillo" activo={login.mostrarAnillo} onChange={(v) => cambiar('login', 'mostrarAnillo', v)} etiqueta={t('cfgShowRing')} ayuda={t('cfgShowRingHint')} />
              <CampoImagen
                clave="fondoLogin"
                zona="fondoLogin"
                etiqueta={t('cfgImgFondoLogin')}
                ayuda={t('cfgImgFondoLoginHint')}
                url={archivos.fondoLogin || null}
                maxKb={kb('fondoLogin')}
                aceptar="image/jpeg,image/png,image/webp"
                onSubir={subirImagen}
                onQuitar={quitarImagen}
              />
            </div>
          </Fila>
        </>
      );
    }

    if (seccion === 'accesos') return <SeccionAccesos seguridad={borrador.seguridad} cambiar={cambiar} />;
    if (seccion === 'archivos') return <SeccionArchivos archivos={borrador.subidas} cambiar={cambiar} estado={estado} />;
    if (seccion === 'permisos') {
      return (
        <SeccionPermisos
          areas={borrador.reglas.areas}
          permisosAreas={borrador.permisosAreas}
          onCambio={cambiarPermisosAreas}
          catalogo={servidor.catalogoPermisos}
          defectos={servidor.defectosPermisos}
        />
      );
    }
    if (seccion === 'correo') {
      const correoSucio = JSON.stringify(borrador.correo) !== JSON.stringify(original.correo);
      const pestanas = [
        { id: 'servidor', texto: t('emdTabServer'), grupos: ['correo', 'reglas.remitenteCorreo', 'avisos'] },
        { id: 'diseno', texto: t('emdTabDesign'), grupos: ['disenoCorreo'] },
        { id: 'textos', texto: t('emdTabTexts'), grupos: ['textosCorreo'] },
      ];
      const barra = (
        <div role="tablist" aria-label={t('emdTabsAria')} className="cfg-pestanas">
          {pestanas.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={pestanaCorreo === p.id} onClick={() => setPestanaCorreo(p.id)}>
              {p.texto}
              {seccionSucia(p) && <span className="cfg-nav-punto" aria-label={t('cfgUnsaved')} />}
            </button>
          ))}
        </div>
      );
      if (pestanaCorreo === 'diseno') {
        return (
          <>
            {barra}
            <DisenoCorreo
              diseno={borrador.disenoCorreo}
              colores={borrador.colores}
              nombreSistema={borrador.marca.nombreSistema}
              cambiar={cambiar}
              urlLogoCorreo={archivos.logoCorreo || null}
              kbLogo={kb('logoCorreo')}
              onSubir={subirImagen}
              onQuitar={quitarImagen}
            />
          </>
        );
      }
      if (pestanaCorreo === 'textos') {
        return (
          <>
            {barra}
            {plantillasCorreo
              ? <TextosCorreo plantillas={plantillasCorreo} plantillaId={plantillaCorreo} onPlantilla={setPlantillaCorreo} textos={borrador.textosCorreo} onCambiar={(textos) => setBorrador((b) => ({ ...b, textosCorreo: textos }))} />
              : <div className="flex justify-center py-16 text-[13px] text-[var(--color-text-muted)]">{errorPlantillas ? t('emdPreviewError') : <Loader2 className="animate-spin" />}</div>}
          </>
        );
      }
      return (
        <>
          {barra}
          <ServidorCorreo
            correo={borrador.correo}
            reglas={borrador.reglas}
            cambiar={cambiar}
            nombreSistema={borrador.marca.nombreSistema}
            onQuitar={servidor?.correo?.host ? quitarSmtp : null}
          />
          <SeccionCorreo
            avisos={borrador.avisos}
            cambiar={cambiar}
            estado={estado}
            emailPorDefecto={usuario?.email}
            cambiosSinGuardar={correoSucio}
          />
        </>
      );
    }
    if (seccion === 'drive') {
      return (
        <SeccionDrive
          google={borrador.google}
          guardado={servidor?.google}
          cambiar={cambiar}
          onGuardar={guardar}
          guardando={guardando}
          nombreSistema={marca.nombreSistema}
        />
      );
    }
    if (seccion === 'google') {
      return (
        <SeccionGoogle
          google={borrador.google}
          guardado={servidor?.google}
          modulos={modulos}
          cambiar={cambiar}
          onQuitar={quitarGoogle}
          onIrModulos={() => setSeccion('modulos')}
        />
      );
    }
    if (seccion === 'operacion') {
      return (
        <>
          <Fila titulo={t('cfgAreas')} descripcion={t('cfgAreasHint')} zona="areas">
            <EditorAreas areas={borrador.reglas.areas} onChange={cambiarAreas} />
          </Fila>
          <ReglasTareas tareas={borrador.tareas} operacion={borrador.operacion} cambiar={cambiar} />
          <SeccionOperacion operacion={borrador.operacion} cambiar={cambiar} />
        </>
      );
    }

    if (seccion === 'modulos') {
      return (
        <>
          <ListaModulos modulos={modulos} cambiar={cambiar} />
          <Fila titulo={t('cfgDefaults')} descripcion={t('cfgDefaultsHint')}>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Campo etiqueta={t('cfgDefaultLanguage')} htmlFor="cfg-idioma">
                <SelectorSimple
                  id="cfg-idioma"
                  valor={reglas.idiomaPorDefecto}
                  onCambio={(v) => cambiar('reglas', 'idiomaPorDefecto', v)}
                  opciones={[{ valor: 'es', etiqueta: 'Español' }, { valor: 'en', etiqueta: 'English' }]}
                />
              </Campo>
              <Campo etiqueta={t('cfgDefaultTheme')} htmlFor="cfg-tema">
                <SelectorSimple
                  id="cfg-tema"
                  valor={reglas.temaPorDefecto}
                  onCambio={(v) => cambiar('reglas', 'temaPorDefecto', v)}
                  opciones={[
                    { valor: 'sistema', etiqueta: t('cfgThemeSystem') },
                    { valor: 'claro', etiqueta: t('cfgThemeLight') },
                    { valor: 'oscuro', etiqueta: t('cfgThemeDark') },
                  ]}
                />
              </Campo>
            </div>
          </Fila>
          <Fila titulo={t('cfgResetAll')} descripcion={t('cfgResetAllHint')}>
            <button type="button" className="cfg-btn cfg-btn-peligro" onClick={restablecer}><RotateCcw size={13} /> {t('cfgResetAll')}</button>
          </Fila>
        </>
      );
    }

    return <SeguridadCuenta />;
  };

  return (
    <div className="cfg flex min-h-screen bg-[var(--color-bg-base)]">
      {dialogo}
      {/* Menú lateral propio del panel */}
      <aside className="cfg-lateral sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-3 pb-3 pt-5 lg:flex">
        <div className="px-3 pb-5">
          <LogoMarca fondo="auto" className="h-8 w-auto max-w-[150px]" textoClassName="text-lg" />
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{t('cfgPanelTitle')}</p>
        </div>

        {borrador && (
          <div className="cfg-progreso">
            <div className="flex items-center gap-3">
              <div className="relative">
                <AnilloProgreso valor={hechos / pasos.length} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">{Math.round((hechos / pasos.length) * 100)}%</span>
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">{t('cfgProgressTitle')}</p>
                <p className="text-[11.5px] text-white/50">{t('cfgProgressCount', { n: hechos, total: pasos.length })}</p>
              </div>
            </div>
            {siguiente ? (
              <button type="button" className="cfg-sugerencia" onClick={() => irA(siguiente)}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] uppercase tracking-[0.1em] text-white/40">{t('cfgNext')}</span>
                  <span className="block font-medium leading-snug">{t(siguiente.texto)}</span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-[var(--color-gold)]" />
              </button>
            ) : (
              <p className="cfg-sugerencia !cursor-default"><Check size={13} className="text-[var(--color-gold)]" /> {t('cfgProgressDone')}</p>
            )}
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-6 overflow-y-auto" aria-label={t('cfgPanelTitle')}>
          {GRUPOS.map((grupo) => (
            <div key={grupo.id}>
              <p className="cfg-nav-grupo">{t(grupo.titulo)}</p>
              <div className="flex flex-col gap-px">
                {SECCIONES.filter((x) => x.grupo === grupo.id).map((s) => {
                  const Icono = s.icono;
                  const sucia = seccionSucia(s);
                  return (
                    <button key={s.id} type="button" className="cfg-nav-item" onClick={() => setSeccion(s.id)} aria-current={seccion === s.id ? 'page' : undefined} title={`Alt+${s.atajo}`}>
                      <Icono size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" /><span className="cfg-nav-texto">{t(s.titulo)}</span>
                      {sucia ? <span className="cfg-nav-punto" aria-label={t('cfgUnsaved')} /> : <kbd>Alt {s.atajo}</kbd>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--cfg-linea)] pt-2">
          <MenuCuenta usuario={usuario} subtitulo={t('roleConfigurator')} opciones={opcionesCuenta} onCerrarSesion={salir} plano />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: ruta, estado y acciones de guardado */}
        <header className="cfg-barra">
          <div className="flex min-w-0 items-center gap-3">
            <span className="lg:hidden"><LogoMarca fondo="auto" className="h-6 w-auto" textoClassName="text-sm" /></span>
            <nav aria-label="breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
              <span className="text-[var(--color-text-muted)]">{t('cfgPanelTitle')}</span>
              <ChevronRight size={13} className="text-[var(--color-text-muted)]" aria-hidden="true" />
              <span className="truncate font-medium text-[var(--color-text)]">{t(actual.titulo)}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {borrador && seccion !== 'cuenta' && (
              <>
                <span className="cfg-estado mr-1 hidden sm:inline-flex" data-pendiente={hayCambios} aria-live="polite">
                  {hayCambios ? (cambios === 1 ? t('cfgChangesOne') : t('cfgChangesMany', { n: cambios })) : t('cfgStatusSaved')}
                </span>
                <button type="button" className="cfg-btn cfg-btn-texto" onClick={() => setBorrador(aBorrador(servidor))} disabled={!hayCambios || guardando} aria-label={t('cfgDiscard')} title={t('cfgDiscard')}>
                  {/* En el teléfono solo el icono: con el texto la barra no cabía */}
                  <RotateCcw size={14} className="sm:hidden" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('cfgDiscard')}</span>
                </button>
                <button type="button" className="cfg-btn cfg-btn-primario" onClick={guardar} disabled={!hayCambios || guardando} title="Ctrl+S">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : hayCambios ? <span className="cfg-contador">{cambios}</span> : <Check size={14} />}
                  {guardando ? t('cfgSaving') : hayCambios ? t('cfgSave') : t('cfgSavedShort')}
                  {hayCambios && <kbd className="hidden font-sans text-[11px] opacity-60 xl:inline">Ctrl S</kbd>}
                </button>
              </>
            )}
            <span className="lg:hidden">
              <MenuCuenta usuario={usuario} opciones={opcionesCuenta} onCerrarSesion={salir} colapsado plano />
            </span>
          </div>
        </header>

        <main className="cfg-principal min-w-0 flex-1 px-4 pb-16 pt-8 sm:px-8 lg:px-10">
          {/* Avance de la puesta en marcha en móvil: la tarjeta completa vive
              en el menú lateral, que aquí no se muestra. */}
          {borrador && siguiente && (
            <button
              type="button"
              onClick={() => irA(siguiente)}
              className="mb-4 flex min-h-[44px] w-full items-center gap-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left lg:hidden"
            >
              <span className="text-[12px] font-bold text-[var(--color-gold)]">{Math.round((hechos / pasos.length) * 100)}%</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{t('cfgNext')}</span>
                <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{t(siguiente.texto)}</span>
              </span>
              <ArrowRight size={14} className="shrink-0 text-[var(--color-gold)]" aria-hidden="true" />
            </button>
          )}

          {/* Secciones en móvil (en escritorio están en el menú lateral) */}
          <div ref={pestanasMovil} className="relative -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border)] px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:hidden">
            {SECCIONES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSeccion(s.id)}
                aria-current={seccion === s.id ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium ${seccion === s.id ? 'border-[var(--color-primary)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}`}
              >
                {t(s.titulo)}
                {seccionSucia(s) && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" aria-label={t('cfgUnsaved')} />}
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-[1360px]">
            <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="cfg-icono-seccion" aria-hidden="true"><IconoActual size={19} /></span>
                <div>
                  <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">{t(actual.titulo)}</h1>
                  <p className="mt-0.5 text-[14px] text-[var(--color-text-dim)]">{t(actual.ayuda)}</p>
                </div>
              </div>
              {seccionSucia(actual) && (
                <button type="button" className="cfg-btn" onClick={() => deshacerSeccion(actual)}>
                  <RotateCcw size={13} /> {t('cfgUndoSection')}
                </button>
              )}
            </header>

            {error && <div role="alert" className="alert-error">{t('cfgLoadError')} {error}</div>}
            {!borrador && !error && <div className="flex justify-center py-20 text-[var(--color-text-muted)]"><Loader2 className="animate-spin" /></div>}

            {borrador && hayPrevia && (
              <div className="cfg-segmentado mb-5 xl:hidden" role="radiogroup" aria-label={t('cfgViewToggle')}>
                <button type="button" role="radio" aria-checked={!verPrevia} onClick={() => setPreviaEn(null)}>
                  <Settings2 size={14} aria-hidden="true" /> {t('cfgSettingsTab')}
                </button>
                <button type="button" role="radio" aria-checked={verPrevia} onClick={() => setPreviaEn(seccion)}>
                  <Eye size={14} aria-hidden="true" /> {t('cfgPreview')}
                </button>
              </div>
            )}

            {borrador && (
              seccion === 'cuenta' ? contenido() : (
                <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                  <div
                    key={seccion}
                    className={`cfg-entrar min-w-0 space-y-5 ${verPrevia ? 'hidden xl:block' : ''}`}
                    onMouseOver={(e) => setZonaRaton(zonaDe(e))}
                    onMouseLeave={() => setZonaRaton(null)}
                    onFocus={(e) => setZonaFoco(zonaDe(e))}
                    onBlur={() => setZonaFoco(null)}
                  >
                    {contenido()}
                  </div>
                  <aside className={`min-w-0 xl:sticky xl:top-20 ${hayPrevia && !verPrevia ? 'hidden xl:block' : ''}`}>
                    {actual.vista
                      ? <LienzoPrevia borrador={borrador} archivos={archivos} enfoque={enfoque} vistaSugerida={vistaSugerida} />
                      : seccion === 'correo' && pestanaCorreo !== 'servidor' && !plantillasCorreo?.length
                        ? (
                          <div className="cfg-bloque flex flex-col items-center gap-3 px-6 py-16 text-center text-[13px] text-[var(--color-text-muted)]">
                            {errorPlantillas ? (
                              <>
                                <p>{t('emdPreviewError')}</p>
                                <button type="button" className="cfg-btn" onClick={() => setIntentoPlantillas((n) => n + 1)}><RotateCcw size={13} /> {t('emdRetry')}</button>
                              </>
                            ) : <Loader2 className="animate-spin" />}
                          </div>
                        )
                      : seccion === 'correo' && pestanaCorreo !== 'servidor'
                        ? (
                          <VistaCorreo
                            borrador={borrador}
                            plantillas={plantillasCorreo}
                            plantillaId={plantillaCorreo}
                            onPlantilla={setPlantillaCorreo}
                            emailPorDefecto={usuario?.email}
                            cambiosSinGuardar={['disenoCorreo', 'textosCorreo', 'marca', 'colores'].some((g) => JSON.stringify(borrador[g]) !== JSON.stringify(original[g]))}
                          />
                        )
                        : <PanelEstado estado={estado} onRefrescar={refrescarEstado} seccion={actual.id} />}
                  </aside>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default ConfiguracionPage;
