// Tabla de permisos por área del panel de configuración (sección Permisos).
//
// Se elige un área y, sección por sección, se decide qué pueden sus miembros
// y sus administradores. Solo se guardan las casillas distintas de las de
// fábrica (config.permisosAreas = { AREA: { miembro: {...}, admin: {...} } });
// el servidor vuelve a limpiar lo que llegue. El administrador general (ADMIN
// del área de Administración) siempre puede todo y no aparece aquí.
import { useMemo, useState } from 'react';
import { RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoPermisos } from '../../hooks/useTextoPermisos';
import { useTextoFinanzas } from '../../hooks/useTextoFinanzas';
import { AREA_GENERAL } from '../../utils/areas';
import {
  agruparCatalogo, ayudaPermiso, etiquetaPermiso, etiquetaRecurso, normalizarBusqueda, opcionesPermiso, textoValor,
} from '../../utils/catalogoPermisos';
import SelectorSimple from '../SelectorSimple';
import { Fila } from './PiezasConfiguracion';

const ROLES = ['miembro', 'admin'];

const cuantosCambios = (tabla) => ROLES.reduce((n, rol) => n + Object.keys(tabla?.[rol] || {}).length, 0);

/** Interruptor (sí/no) o desplegable de alcance para una celda. */
const Control = ({ permiso, valor, onCambio, etiqueta, tp }) => {
  if (permiso.tipo === 'bool') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={valor === true}
        aria-label={etiqueta}
        onClick={() => onCambio(!valor)}
        className="cfg-switch"
      />
    );
  }
  return (
    <SelectorSimple
      valor={valor}
      onCambio={onCambio}
      opciones={opcionesPermiso(permiso, tp)}
      aria-label={etiqueta}
      className="cfg-perm-select"
    />
  );
};

const PermisosPorArea = ({ areas = [], valor = {}, onCambio, catalogo = [], defectos }) => {
  const tp = useTextoPermisos();
  const tf = useTextoFinanzas();
  const { nombreArea } = useConfiguracion();
  const [area, setArea] = useState(() => areas.find((a) => a.clave !== AREA_GENERAL)?.clave || areas[0]?.clave || '');
  const [busqueda, setBusqueda] = useState('');
  const secciones = useMemo(() => agruparCatalogo(catalogo), [catalogo]);

  // Si se borró el área elegida en Operación, se pasa a la primera.
  const areaActual = areas.some((a) => a.clave === area) ? area : areas[0]?.clave;
  const nombre = (a) => a?.nombre || nombreArea(a?.clave);
  const esGeneral = areaActual === AREA_GENERAL;
  const roles = esGeneral ? ['miembro'] : ROLES;
  const tabla = valor[areaActual] || {};

  if (!defectos || !catalogo.length || !areaActual) return null;

  const efectivo = (rol, clave) => tabla[rol]?.[clave] ?? defectos[rol]?.[clave];
  const cambiado = (rol, clave) => tabla[rol]?.[clave] !== undefined;

  const poner = (rol, clave, nuevo) => {
    const delRol = { ...(tabla[rol] || {}) };
    if (nuevo === defectos[rol]?.[clave]) delete delRol[clave];
    else delRol[clave] = nuevo;
    const siguiente = { miembro: { ...(tabla.miembro || {}) }, admin: { ...(tabla.admin || {}) }, [rol]: delRol };
    const resto = { ...valor };
    if (cuantosCambios(siguiente)) resto[areaActual] = siguiente;
    else delete resto[areaActual];
    onCambio(resto);
  };
  const restablecer = () => {
    const resto = { ...valor };
    delete resto[areaActual];
    onCambio(resto);
  };
  const copiarDe = (origen) => {
    const fuente = valor[origen];
    const resto = { ...valor };
    if (fuente && cuantosCambios(fuente)) {
      resto[areaActual] = JSON.parse(JSON.stringify(fuente));
      // El área general no tiene columna de administradores.
      if (esGeneral) resto[areaActual].admin = {};
    } else delete resto[areaActual];
    onCambio(resto);
  };

  const filtro = normalizarBusqueda(busqueda);
  const coincide = (seccion, grupo, permiso) => !filtro || [
    tp(`sec.${seccion}`), grupo.conTitulo ? etiquetaRecurso(grupo.recurso, tp, tf) : '', etiquetaPermiso(permiso, tp), ayudaPermiso(permiso, tp) || '',
  ].some((t) => normalizarBusqueda(t).includes(filtro));

  const visibles = secciones
    .map((s) => ({
      ...s,
      grupos: s.grupos
        .map((g) => ({ ...g, permisos: g.permisos.filter((p) => coincide(s.seccion, g, p)) }))
        .filter((g) => g.permisos.length),
    }))
    .filter((s) => s.grupos.length);

  const cambiosArea = cuantosCambios(tabla);

  return (
    <Fila titulo={tp('permAreasTitulo')} descripcion={tp('permAreasTexto')}>
      {/* Áreas: cada una con cuántas casillas cambió */}
      <div role="tablist" aria-label={tp('permArea')} className="flex flex-wrap gap-2">
        {areas.map((a) => {
          const n = cuantosCambios(valor[a.clave]);
          return (
            <button
              key={a.clave}
              type="button"
              role="tab"
              aria-selected={a.clave === areaActual}
              aria-pressed={a.clave === areaActual}
              onClick={() => setArea(a.clave)}
              className="cfg-chip-paleta"
            >
              <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: a.color }} aria-hidden="true" />
              <span className="text-[13px] font-medium">{nombre(a)}</span>
              {n > 0 && <span className="cfg-contador" title={tp('permCambiosArea', { n })}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <label className="relative min-w-0">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input
            type="search"
            className="cfg-input !pl-9"
            placeholder={tp('permBuscar')}
            aria-label={tp('permBuscar')}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          {areas.length > 1 && (
            <div className="min-w-0 flex-1">
              <SelectorSimple
                valor=""
                placeholder={tp('permCopiarDe')}
                aria-label={tp('permCopiarDe')}
                onCambio={copiarDe}
                opciones={areas.filter((a) => a.clave !== areaActual).map((a) => ({ valor: a.clave, etiqueta: nombre(a) }))}
              />
            </div>
          )}
          <button type="button" className="cfg-btn shrink-0" onClick={restablecer} disabled={!cambiosArea} title={tp('permRestablecer')}>
            <RotateCcw size={14} /> <span className="hidden sm:inline">{tp('permRestablecer')}</span>
          </button>
        </div>
      </div>

      <p className="cfg-ayuda mt-2">{tp('permLeyenda')}</p>
      {esGeneral && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-[var(--color-text-dim)]">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--color-primary)]" /> {tp('permAreaGeneral')}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {visibles.length === 0 && <p className="text-[13px] text-[var(--color-text-muted)]">{tp('permSinResultados')}</p>}
        {visibles.map(({ seccion, grupos }) => (
          <section key={seccion} className="cfg-perm-seccion">
            <header className="cfg-perm-cabecera" style={{ '--cfg-perm-cols': roles.length }}>
              <h3>{tp(`sec.${seccion}`)}</h3>
              {roles.map((rol) => (
                <span key={rol} className="cfg-perm-col">{tp(rol === 'admin' ? 'permColAdmins' : 'permColMiembros')}</span>
              ))}
            </header>
            {grupos.map((grupo) => (
              <div key={grupo.recurso}>
                {grupo.conTitulo && <p className="cfg-perm-subtitulo">{etiquetaRecurso(grupo.recurso, tp, tf)}</p>}
                {grupo.permisos.map((permiso) => {
                  const etiqueta = etiquetaPermiso(permiso, tp);
                  const ayuda = ayudaPermiso(permiso, tp);
                  return (
                    <div key={permiso.clave} className="cfg-perm-fila" style={{ '--cfg-perm-cols': roles.length }}>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-[var(--color-text)]">{etiqueta}</p>
                        {ayuda && <p className="text-[12px] leading-snug text-[var(--color-text-dim)]">{ayuda}</p>}
                      </div>
                      {roles.map((rol) => {
                        const rotulo = tp(rol === 'admin' ? 'permColAdmins' : 'permColMiembros');
                        return (
                          <div key={rol} className="cfg-perm-celda" data-rol={rotulo}>
                            {/* El punto marca lo que ya no es de fábrica */}
                            <span className="cfg-perm-control" data-tipo={permiso.tipo}>
                              <Control
                                permiso={permiso}
                                valor={efectivo(rol, permiso.clave)}
                                onCambio={(v) => poner(rol, permiso.clave, v)}
                                etiqueta={`${etiqueta} · ${rotulo}`}
                                tp={tp}
                              />
                              {cambiado(rol, permiso.clave) && (
                                <span
                                  className="cfg-perm-marca"
                                  title={tp('permFabrica', { valor: textoValor(permiso, defectos[rol]?.[permiso.clave], tp) })}
                                  aria-label={tp('permCambiado')}
                                />
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </Fila>
  );
};

export default PermisosPorArea;
