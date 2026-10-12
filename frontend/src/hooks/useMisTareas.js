import { useCallback, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useAuth } from '../context/AuthContext';
import { statsService, tareasService } from '../services/api';
import { asignadosDeTarea } from '../utils/estadosTarea';
import { claveDiaLocal, claveDesdeISO, fechaDesdeClave } from '../utils/fechasLocales';

// Una sola petición (/stats/member) alimenta el Inicio del miembro y su menú
// lateral: comparten la clave de SWR, así que cambiar
// una tarea en un sitio se ve en los dos sin pedir nada más.
const CLAVE = 'stats-miembro';

const ESTADOS_PROYECTO_CERRADOS = ['TERMINADO', 'ARCHIVADO'];

export const esResponsable = (tarea, usuarioId) => (
  asignadosDeTarea(tarea).some((a) => a.id === usuarioId) || tarea?.asignadoId === usuarioId
);

const sumarDias = (clave, dias) => {
  const fecha = fechaDesdeClave(clave);
  fecha.setDate(fecha.getDate() + dias);
  return claveDiaLocal(fecha);
};

// Lunes de la semana en curso, como clave de día local.
const lunesDeEstaSemana = () => {
  const hoy = new Date();
  const desdeLunes = (hoy.getDay() + 6) % 7;
  hoy.setDate(hoy.getDate() - desdeLunes);
  return claveDiaLocal(hoy);
};

/**
 * Grupo de fecha de una tarea abierta: vencidas, hoy, próximos 7 días, más
 * adelante o sin fecha. Las hechas van siempre a su propio grupo.
 */
export const grupoDeTarea = (tarea, hoy = claveDiaLocal()) => {
  if (tarea.estado === 'HECHO') return 'hechas';
  const vence = claveDesdeISO(tarea.venceEn);
  if (!vence) return 'sinFecha';
  if (vence < hoy) return 'vencidas';
  if (vence === hoy) return 'hoy';
  if (vence <= sumarDias(hoy, 7)) return 'semana';
  return 'despues';
};

export const ORDEN_GRUPOS = ['vencidas', 'hoy', 'semana', 'despues', 'sinFecha', 'hechas'];

const porVencimiento = (a, b) => {
  const fa = claveDesdeISO(a.venceEn) || '9999';
  const fb = claveDesdeISO(b.venceEn) || '9999';
  if (fa !== fb) return fa < fb ? -1 : 1;
  // Mismo día: primero lo que ya está en curso y luego por prioridad.
  const peso = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  if (a.estado !== b.estado) return a.estado === 'EN_PROGRESO' ? -1 : 1;
  return (peso[a.prioridad] ?? 1) - (peso[b.prioridad] ?? 1);
};

const porCierre = (a, b) => new Date(b.completadoEn || b.actualizadoEn || 0) - new Date(a.completadoEn || a.actualizadoEn || 0);

/** Reparte una lista en grupos de fecha, ordenados por dentro. */
export const agruparTareas = (tareas) => {
  const hoy = claveDiaLocal();
  const grupos = Object.fromEntries(ORDEN_GRUPOS.map((g) => [g, []]));
  tareas.forEach((tarea) => grupos[grupoDeTarea(tarea, hoy)].push(tarea));
  ORDEN_GRUPOS.forEach((g) => grupos[g].sort(g === 'hechas' ? porCierre : porVencimiento));
  return grupos;
};

/**
 * Datos del miembro con todo lo derivado que piden sus pantallas. Solo pide
 * algo si quien entra NO es administrador (el endpoint es solo de miembros).
 *
 * `escucharCambios` lo activa una sola pantalla montada siempre (el Layout):
 * recarga cuando otra parte del CRM avisa que cambió una tarea o un evento.
 */
export const useMisTareas = ({ escucharCambios = false } = {}) => {
  const { usuario } = useAuth();
  const usuarioId = usuario?.id;
  const activo = Boolean(usuarioId) && usuario?.rol !== 'ADMIN';

  const { data, error, isLoading, mutate } = useSWR(
    activo ? [CLAVE, usuarioId] : null,
    () => statsService.getMemberStats(),
  );

  useEffect(() => {
    if (!activo || !escucharCambios) return undefined;
    let espera = null;
    const alCambiar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => mutate(), 300);
    };
    window.addEventListener('crm:schedule-changed', alCambiar);
    return () => {
      clearTimeout(espera);
      window.removeEventListener('crm:schedule-changed', alCambiar);
    };
  }, [activo, escucharCambios, mutate]);

  const derivados = useMemo(() => {
    const tareas = data?.tareas || [];
    const proyectos = data?.proyectos || [];
    const mias = tareas.filter((t) => esResponsable(t, usuarioId));
    const abiertas = mias.filter((t) => t.estado !== 'HECHO');
    const grupos = agruparTareas(abiertas);
    const lunes = lunesDeEstaSemana();
    const hechasSemana = mias.filter((t) => (
      t.estado === 'HECHO' && t.completadoEn && claveDiaLocal(new Date(t.completadoEn)) >= lunes
    )).length;

    // Pendientes propias por proyecto, para el menú y las tarjetas.
    const abiertasPorProyecto = {};
    abiertas.forEach((t) => {
      const id = t.proyectoId || t.proyecto?.id;
      abiertasPorProyecto[id] = (abiertasPorProyecto[id] || 0) + 1;
    });

    // Activos primero; dentro, los que tienen más trabajo tuyo pendiente.
    const proyectosOrdenados = [...proyectos].sort((a, b) => {
      const ca = ESTADOS_PROYECTO_CERRADOS.includes(a.estado) ? 1 : 0;
      const cb = ESTADOS_PROYECTO_CERRADOS.includes(b.estado) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return (abiertasPorProyecto[b.id] || 0) - (abiertasPorProyecto[a.id] || 0);
    });

    return {
      tareas,
      mias,
      abiertas,
      grupos,
      proyectos: proyectosOrdenados,
      proyectosAbiertos: proyectosOrdenados.filter((p) => !ESTADOS_PROYECTO_CERRADOS.includes(p.estado)),
      abiertasPorProyecto,
      resumen: {
        vencidas: grupos.vencidas.length,
        hoy: grupos.hoy.length,
        semana: grupos.semana.length,
        enCurso: abiertas.filter((t) => t.estado === 'EN_PROGRESO').length,
        abiertas: abiertas.length,
        hechasSemana,
      },
    };
  }, [data, usuarioId]);

  // Cambio de estado con la lista actualizada al instante; si el servidor lo
  // rechaza se vuelve a pedir la lista real.
  const cambiarEstado = useCallback(async (tarea, estado) => {
    const completadoEn = estado === 'HECHO' ? new Date().toISOString() : null;
    await mutate(
      async (actual) => {
        await tareasService.actualizarEstado(tarea.id, estado);
        return actual;
      },
      {
        optimisticData: (actual) => actual && ({
          ...actual,
          tareas: actual.tareas.map((t) => (t.id === tarea.id ? { ...t, estado, completadoEn } : t)),
        }),
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      },
    );
  }, [mutate]);

  return {
    activo,
    cargando: activo && isLoading && !data,
    error: data ? null : error,
    recargar: mutate,
    cambiarEstado,
    ...derivados,
  };
};
