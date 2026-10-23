// Configuración de la instalación (marca, colores, login, módulos y reglas).
//
// Se pide a /api/configuracion/publica al arrancar y se guarda en
// localStorage, para que la próxima visita pinte la marca correcta desde el
// primer momento (index.html aplica el CSS guardado antes de cargar React).
// Aplica: paleta de colores, favicon, color de la barra del navegador y los
// textos personalizados (que pasan a PreferencesContext como prioritarios).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { configuracionService, getPublicAssetUrl } from '../services/api';
import { usePreferences } from './PreferencesContext';
import { aplicarCssDeMarca, cssDeMarca } from '../utils/temaMarca';
import { fijarPasswordMin } from '../utils/politicaPassword';
import { fijarPdfMaxMb } from '../utils/contratos';
import { fijarComprobanteMaxMb } from '../utils/finanzas';
import { AREAS_FABRICA, CLAVE_TRADUCCION_AREA, areasDeTexto, nombreDesdeClave } from '../utils/areas';

// Módulos retirados: siempre apagados (espejo de MODULOS_RETIRADOS del backend).
const MODULOS_RETIRADOS = ['portalClientes'];

// Valores de fábrica mientras llega la configuración (iguales a los del backend).
const TAREAS_FABRICA = {
  estadoInicial: 'PENDIENTE', prioridadDefecto: 'MEDIA', exigirFechaLimite: false,
  exigirResponsable: false, asignarAlCreador: true, diasPorVencer: 2,
};

const ConfiguracionContext = createContext(null);
const CLAVE_CONFIG = 'crm_marca_config';
const CLAVE_CSS = 'crm_marca_css';

// Imágenes de fábrica (OMNIS) cuando la instalación no subió las suyas.
const IMAGENES_FABRICA = {
  logoClaro: '/brand/omnis-horizontal-azul.png',
  logoOscuro: '/brand/omnis-horizontal-blanco.png',
  isotipo: '/brand/omnis-circulo-dorado.png',
  favicon: '/brand/favicon.svg',
};

const leerCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CONFIG) || 'null');
  } catch {
    return null;
  }
};

/** Claves de traducción que la instalación sobrescribe (solo las que tienen valor). */
const textosDesdeConfig = (config) => {
  if (!config) return {};
  const { marca = {}, login = {}, reglas = {}, operacion = {} } = config;
  const estados = operacion.etiquetasEstados || {};
  const prioridades = operacion.etiquetasPrioridades || {};
  // Nombres propios de las áreas de fábrica (las nuevas no tienen traducción).
  const nombresAreas = Object.fromEntries((reglas.areas || []).map((a) => [a.clave, a.nombre]));
  const beneficios = login.beneficios || [];
  const pares = {
    appName: marca.nombreSistema,
    internalPanel: marca.eslogan,
    authBrandEyebrow: login.etiqueta,
    authBrandHeadline: login.titulo,
    authBrandText: login.texto,
    areaDesarrollo: nombresAreas.DESARROLLO,
    areaAdministracion: nombresAreas.ADMINISTRACION,
    areaComunicacion: nombresAreas.COMUNICACION,
    areaMarketing: nombresAreas.MARKETING,
    statusTodo: estados.PENDIENTE,
    statusInProgress: estados.EN_PROGRESO,
    statusDone: estados.HECHO,
    priorityLow: prioridades.BAJA,
    priorityMedium: prioridades.MEDIA,
    priorityHigh: prioridades.ALTA,
  };
  beneficios.forEach((b, i) => {
    pares[`authBrandFeat${i + 1}Title`] = b?.titulo;
    pares[`authBrandFeat${i + 1}Text`] = b?.texto;
  });
  const textos = Object.fromEntries(Object.entries(pares).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  textos.__vars = { marca: marca.nombreCorto, empresa: marca.nombreEmpresa, sistema: marca.nombreSistema };
  return textos;
};

const ponerFavicon = (url) => {
  document.querySelectorAll('link[rel~="icon"]').forEach((el, i) => {
    if (i === 0) el.href = url;
    else el.remove();
  });
};

export const ConfiguracionProvider = ({ children }) => {
  const { setTextosMarca, t } = usePreferences();
  const [config, setConfig] = useState(leerCache);

  const aplicar = useCallback((nueva) => {
    if (!nueva) return;
    const css = cssDeMarca(nueva.colores);
    aplicarCssDeMarca(css);
    try {
      localStorage.setItem(CLAVE_CONFIG, JSON.stringify(nueva));
      if (css) localStorage.setItem(CLAVE_CSS, css); else localStorage.removeItem(CLAVE_CSS);
    } catch { /* sin almacenamiento: se aplica igual en esta visita */ }
    setTextosMarca(textosDesdeConfig(nueva));
    fijarPasswordMin(nueva.seguridad?.passwordMin);
    fijarPdfMaxMb(nueva.subidas?.contratosMaxMB);
    fijarComprobanteMaxMb(nueva.subidas?.comprobantesMaxMB);
    const favicon = nueva.archivos?.favicon || nueva.archivos?.isotipo;
    ponerFavicon(favicon ? getPublicAssetUrl(favicon) : IMAGENES_FABRICA.favicon);
    const meta = document.querySelector('meta[name="theme-color"]');
    // Igual que en PreferencesContext: la barra del navegador sigue al
    // encabezado (--color-surface), ya recalculado con el CSS de la marca.
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
    if (meta && surface) meta.setAttribute('content', surface);
  }, [setTextosMarca]);

  const recargar = useCallback(async () => {
    const nueva = await configuracionService.publica();
    setConfig(nueva);
    aplicar(nueva);
    return nueva;
  }, [aplicar]);

  // Lo guardado se aplica al instante y luego se refresca desde el servidor.
  useEffect(() => {
    let cancelado = false;
    const guardada = leerCache();
    if (guardada) aplicar(guardada);
    configuracionService.publica()
      .then((nueva) => { if (!cancelado) { setConfig(nueva); aplicar(nueva); } })
      .catch(() => { /* sin red: queda la última conocida o la de fábrica */ });
    return () => { cancelado = true; };
  }, [aplicar]);

  useEffect(() => {
    if (!document.title || /OMNIS CRM/.test(document.title)) document.title = t('appName');
  }, [t]);

  const valor = useMemo(() => {
    const archivos = config?.archivos || {};
    const hayLogosPropios = Boolean(archivos.logoClaro || archivos.logoOscuro || archivos.isotipo);
    // Imagen a mostrar; si la instalación tiene sus propios logos nunca se
    // mezcla con los de OMNIS (se usa el otro logo propio como respaldo).
    const imagen = (clave) => {
      const respaldo = {
        logoClaro: ['logoClaro', 'logoOscuro'],
        logoOscuro: ['logoOscuro', 'logoClaro'],
        isotipo: ['isotipo'],
        fondoLogin: ['fondoLogin'],
      }[clave] || [clave];
      const propia = respaldo.map((c) => archivos[c]).find(Boolean);
      if (propia) return getPublicAssetUrl(propia);
      if (hayLogosPropios || clave === 'fondoLogin') return null;
      // Instalación renombrada sin logos: mejor el nombre en texto que el logo de OMNIS.
      if (config?.marca?.nombreCorto && config.marca.nombreCorto !== 'OMNIS') return null;
      return IMAGENES_FABRICA[clave] || null;
    };
    const areas = (config?.reglas?.areas?.length ? config.reglas.areas : AREAS_FABRICA).map((a) => ({
      ...a,
      nombre: a.nombre || (CLAVE_TRADUCCION_AREA[a.clave] ? t(CLAVE_TRADUCCION_AREA[a.clave]) : nombreDesdeClave(a.clave)),
    }));
    const porClave = new Map(areas.map((a) => [a.clave, a]));
    const nombreDeUna = (clave) => porClave.get(clave)?.nombre
      || (CLAVE_TRADUCCION_AREA[clave] ? t(CLAVE_TRADUCCION_AREA[clave]) : nombreDesdeClave(clave));
    return {
      config,
      // Áreas configuradas, ya con nombre para mostrar.
      areas,
      // Aceptan una clave o varias separadas por coma (personas y proyectos
      // con varias áreas): los nombres van separados por coma y el color es
      // el de la primera.
      nombreArea: (clave) => (String(clave || '').includes(',') ? areasDeTexto(clave).map(nombreDeUna).join(', ') : nombreDeUna(clave)),
      colorArea: (clave) => porClave.get(areasDeTexto(clave)[0])?.color || '#64748b',
      // Los permisos de cada persona vienen ya resueltos en usuario.permisos
      // (utils/permisos.js).
      reglasTareas: { ...TAREAS_FABRICA, ...(config?.tareas || {}) },
      marca: config?.marca || { nombreSistema: 'OMNIS CRM', nombreCorto: 'OMNIS', nombreEmpresa: 'OMNIS Proyectos Globales' },
      login: config?.login || null,
      modulos: config?.modulos || { contratos: true, agenda: true },
      // Los retirados (portal de clientes) salen apagados aunque la configuración
      // guardada en el navegador sea anterior a su retiro.
      moduloActivo: (modulo) => !MODULOS_RETIRADOS.includes(modulo) && config?.modulos?.[modulo] !== false,
      imagen,
      recargar,
      aplicar,
    };
  }, [config, recargar, aplicar, t]);

  return <ConfiguracionContext.Provider value={valor}>{children}</ConfiguracionContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- el hook y el proveedor van juntos a proposito
export const useConfiguracion = () => {
  const ctx = useContext(ConfiguracionContext);
  if (!ctx) throw new Error('useConfiguracion debe usarse dentro de <ConfiguracionProvider>');
  return ctx;
};
