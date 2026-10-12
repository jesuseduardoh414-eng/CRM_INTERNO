// Equipo de cada proyecto, agrupado y desplegable.
//
// Era la pagina "Comunidad", con su propia entrada en el menu. El usuario pidio
// moverla dentro de Proyectos como una pestaña mas y dejarla **solo para el
// admin**, que es quien reparte trabajo entre proyectos. Quien decide que se ve
// es ProyectosPage; aqui solo se dibuja.
//
// Mismo lenguaje que el directorio de clientes: un panel con filas, sin
// tarjetas grandes. Cada proyecto es una fila que se despliega con su equipo.

import { useState } from 'react';
import { proyectosService } from '../services/api';
import { ListSkeleton } from './Skeleton';
import UserAvatar from './UserAvatar';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoProyectos } from '../hooks/useTextoProyectos';
import { useProyectosTodos } from '../hooks/useProyectosTodos';
import { getEstadoProyecto } from '../utils/estadosProyecto';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Zap,
  CheckCircle2,
} from 'lucide-react';

// 10 por pagina: con 29 proyectos, abrirlos todos era una pared de filas.
const PROYECTOS_POR_PAGINA = 10;

const ROL_CLAVE = { ADMIN: 'roleAdmin', MIEMBRO: 'roleMember' };

/** Área en texto con su punto de color; sin área, "General" en gris. */
const AreaTexto = ({ clave }) => {
  const { t } = usePreferences();
  const { nombreArea, colorArea } = useConfiguracion();
  return (
    <span className="proy-area" style={clave ? { '--proy-punto': colorArea(clave) } : undefined}>
      {clave ? nombreArea(clave) : t('areaGeneral')}
    </span>
  );
};

// —— Fila de miembro —————————————————————————————————————————————————————————
const MiembroFila = ({ miembro }) => {
  const { t } = usePreferences();
  const tp = useTextoProyectos();
  const { colorArea } = useConfiguracion();
  const { total, hechas, pendientes, enProgreso } = miembro.tareas;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  const color = miembro.area ? colorArea(miembro.area) : 'var(--color-text-muted)';

  return (
    <li className="proy-miembro">
      <div className="flex min-w-0 items-center gap-2.5">
        <UserAvatar
          usuario={miembro}
          size={30}
          radius={999}
          fontSize="11px"
          color={color}
          background={`color-mix(in srgb, ${color} 12%, transparent)`}
          borderColor={`color-mix(in srgb, ${color} 25%, transparent)`}
        />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-[var(--color-text)]">{miembro.nombre}</div>
          <div className="truncate text-[12px] text-[var(--color-text-muted)]">{miembro.email}</div>
        </div>
      </div>
      <div className="text-[12.5px] text-[var(--color-text-dim)]"><AreaTexto clave={miembro.area} /></div>
      <div className="text-[12.5px] text-[var(--color-text-dim)]">{t(ROL_CLAVE[miembro.rol] || 'roleMember')}</div>
      <div className="min-w-0">
        {total > 0 ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="proy-barra"><span style={{ width: `${pct}%`, background: pct === 100 ? 'var(--color-success)' : 'var(--color-primary)' }} /></span>
              <span className="w-9 shrink-0 text-right text-[12px] font-semibold tabular-nums text-[var(--color-text)]">{pct}%</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-1" title={tp('lista_equipoPendientes')}><ClipboardList size={12} /> {pendientes}</span>
              <span className="inline-flex items-center gap-1" title={tp('lista_equipoEnCurso')}><Zap size={12} /> {enProgreso}</span>
              <span className="inline-flex items-center gap-1" title={tp('lista_equipoHechas')}><CheckCircle2 size={12} /> {hechas}/{total}</span>
            </div>
          </>
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">{tp('lista_equipoSinTareas')}</span>
        )}
      </div>
    </li>
  );
};

// —— Fila de proyecto ————————————————————————————————————————————————————————
const ProyectoEquipo = ({ proyecto }) => {
  const { t } = usePreferences();
  const tp = useTextoProyectos();
  // Plegado de entrada: con veintitantos proyectos, abiertos era una pared.
  const [open, setOpen] = useState(false);
  const [equipoData, setEquipoData] = useState(null);
  const [cargandoEquipo, setCargandoEquipo] = useState(false);
  // Si falla la peticion se avisa y se puede reintentar; antes se tomaba como
  // un equipo vacio y el proyecto parecia no tener a nadie.
  const [errorEquipo, setErrorEquipo] = useState(false);
  const estado = getEstadoProyecto(proyecto.estado);
  // El conteo y las fotos salen de lo que ya trae el proyecto, para no tener
  // que pedir el equipo solo para poder mostrar un numero.
  const miembros = proyecto.miembros || [];
  const totalDelProyecto = equipoData?.length ?? miembros.length;

  // El equipo se pide al abrir por primera vez, no al cargar el panel. Antes se
  // pedian los 29 de golpe y habia que esperarlos todos para ver algo.
  //
  // Se lanza desde el propio clic y no desde un efecto que observe `open`: asi
  // la peticion sale una sola vez, sin la cascada de renders que provoca poner
  // el estado de carga dentro de un efecto.
  const cargarEquipo = async () => {
    setCargandoEquipo(true);
    setErrorEquipo(false);
    try {
      const data = await proyectosService.equipoDeProyecto(proyecto.id);
      setEquipoData(data.equipo || []);
    } catch {
      setErrorEquipo(true);
    } finally {
      setCargandoEquipo(false);
    }
  };

  const alternar = () => {
    const abriendo = !open;
    setOpen(abriendo);
    if (!abriendo || equipoData !== null || cargandoEquipo) return;
    cargarEquipo();
  };

  return (
    <li className="proy-equipo" data-abierto={open || undefined}>
      <button type="button" onClick={alternar} aria-expanded={open} className="proy-equipo-cabecera">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: estado.dot }} title={t(estado.labelKey)} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-[var(--color-text)]">{proyecto.nombre}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--color-text-muted)]">
            <span>{t(estado.labelKey)}</span>
            <span className="tabular-nums">{totalDelProyecto} {totalDelProyecto !== 1 ? t('teamMemberPlural') : t('teamMemberSingular')}</span>
            <AreaTexto clave={proyecto.creador?.area} />
          </span>
        </span>
        {miembros.length > 0 && (
          <span className="proy-avatares hidden sm:inline-flex">
            {miembros.slice(0, 5).map((m) => <UserAvatar key={m.id} usuario={m} size={24} radius={999} fontSize="10px" />)}
            {miembros.length > 5 && <span className="proy-avatar-mas">{tp('lista_masMiembros', { n: miembros.length - 5 })}</span>}
          </span>
        )}
        <ChevronDown size={16} className="proy-equipo-flecha shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      </button>

      {/* Equipo del proyecto */}
      {open && (
        <div className="proy-equipo-cuerpo">
          {errorEquipo && !cargandoEquipo ? (
            <div className="flex items-center justify-center gap-3 px-4 py-5 text-[12.5px] text-[var(--color-error)]">
              <span>{tp('lista_equipoError')}</span>
              <button type="button" onClick={cargarEquipo} className="cli-enlace">{t('retry')}</button>
            </div>
          ) : cargandoEquipo || equipoData === null ? (
            <p className="px-4 py-5 text-center text-[12.5px] text-[var(--color-text-muted)]">{t('loading')}</p>
          ) : equipoData.length === 0 ? (
            <p className="px-4 py-5 text-center text-[12.5px] text-[var(--color-text-muted)]">{t('teamNoMembers')}</p>
          ) : (
            <>
              <div className="proy-miembro proy-miembro-titulos" aria-hidden="true">
                <span>{tp('lista_equipoPersona')}</span>
                <span>{tp('lista_equipoArea')}</span>
                <span>{tp('lista_equipoRol')}</span>
                <span>{tp('lista_equipoTareas')}</span>
              </div>
              <ul>
                {equipoData.map((m) => <MiembroFila key={m.id} miembro={m} />)}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
};

// —— Panel ——————————————————————————————————————————————————————————————————
const PanelMiembros = () => {
  const { t } = usePreferences();
  const tp = useTextoProyectos();
  const [pagina, setPagina] = useState(1);

  // Una sola peticion: la lista de proyectos. El equipo de cada uno lo pide su
  // propia fila al desplegarse. Antes se pedian los 29 equipos de golpe y no
  // se pintaba nada hasta que llegaba el ultimo.
  const { data, isLoading, error } = useProyectosTodos();

  const proyectos = data || [];
  const totalPaginas = Math.max(1, Math.ceil(proyectos.length / PROYECTOS_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const proyectosDeLaPagina = proyectos.slice(
    (paginaActual - 1) * PROYECTOS_POR_PAGINA,
    paginaActual * PROYECTOS_POR_PAGINA,
  );

  // Suma de los contadores que ya trae cada proyecto, sin pedir nada mas
  const totalMiembros = proyectos.reduce((suma, p) => suma + (p.miembros?.length || 0), 0);

  if (isLoading && !data) {
    return <div className="cli-panel p-4"><ListSkeleton rows={6} header={false} /></div>;
  }

  return (
    <div className="cli-panel overflow-hidden">
      {/* El resumen se queda: dice de un vistazo cuanta gente hay repartida y
          en cuantos proyectos. El titulo lo pone la pestaña. */}
      <header className="cli-panel-cabecera flex-wrap">
        <h2 className="cli-etiqueta">{t('teamTitle')}</h2>
        <p className="text-[12.5px] text-[var(--color-text-muted)]">
          {t('teamSummary', {
            members: totalMiembros,
            memberLabel: totalMiembros !== 1 ? t('teamMemberPlural') : t('teamMemberSingular'),
            projects: proyectos.length,
            projectLabel: proyectos.length !== 1 ? t('teamProjectPlural') : t('teamProjectSingular'),
          })}
        </p>
      </header>

      {error ? (
        <div className="p-4"><div className="alert-error">{error.message}</div></div>
      ) : proyectos.length === 0 ? (
        <p className="px-6 py-12 text-center text-[13px] text-[var(--color-text-muted)]">{t('teamNoProjects')}</p>
      ) : (
        <>
          <ul>
            {proyectosDeLaPagina.map((proyecto) => (
              <ProyectoEquipo key={proyecto.id} proyecto={proyecto} />
            ))}
          </ul>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              <span className="tabular-nums">
                {tp('lista_rango', {
                  desde: (paginaActual - 1) * PROYECTOS_POR_PAGINA + 1,
                  hasta: Math.min(paginaActual * PROYECTOS_POR_PAGINA, proyectos.length),
                  total: proyectos.length,
                })}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="dash-icono" onClick={() => setPagina((n) => Math.max(1, n - 1))} disabled={paginaActual === 1} aria-label={t('previous')} title={t('previous')}>
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-[52px] text-center font-medium tabular-nums text-[var(--color-text)]">{paginaActual} / {totalPaginas}</span>
                <button type="button" className="dash-icono" onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))} disabled={paginaActual === totalPaginas} aria-label={t('next')} title={t('next')}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PanelMiembros;
