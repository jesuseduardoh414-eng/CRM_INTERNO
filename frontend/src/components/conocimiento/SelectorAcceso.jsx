// Quién ve un artículo o un archivo de la base de conocimiento: todo el equipo
// (o, en un archivo, lo mismo que el artículo) o solo quienes se elijan, por
// área (toda, solo administradores o solo miembros), por rol en todas las
// áreas y persona por persona. Debajo, quiénes lo verán con esa elección.
// Lo usan el editor, la ventana de acceso y la subida de documentos; el valor
// es { restringido, reglas } (utils/accesoConocimiento.js).
import { useState } from 'react';
import { AlertTriangle, ChevronDown, Globe, Lock, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { useTextoConocimiento } from '../../hooks/useTextoConocimiento';
import { useDescribirRegla, usePersonas } from '../../hooks/useConocimiento';
import SelectorSimple from '../SelectorSimple';
import SelectorMultiple from '../SelectorMultiple';
import UserAvatar from '../UserAvatar';
import { claveRegla, motivoArchivo, motivoArticulo } from '../../utils/accesoConocimiento';
import { areasDeTexto } from '../../utils/areas';

const MOTIVOS = {
  general: 'accMotivoGeneral', autor: 'accMotivoAutor', subio: 'accMotivoSubio', regla: 'accMotivoRegla', articulo: 'accMotivoArticulo', equipo: 'accMotivoEquipo',
};

/** Resumen de solo lectura: "Todo el equipo" o las reglas como etiquetas. */
export const ResumenAcceso = ({ acceso, contexto = 'articulo' }) => {
  const tc = useTextoConocimiento();
  const describir = useDescribirRegla();
  if (!acceso.restringido) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
        <Globe size={15} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
        {contexto === 'archivo' ? tc('accIgualArticulo') : tc('accTodoEquipo')}
      </p>
    );
  }
  if (acceso.reglas.length === 0) {
    return (
      <p className="flex items-start gap-2 text-[13px] text-[var(--color-text)]">
        <Lock size={15} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
        {contexto === 'archivo' ? tc('accNadieMasArchivo') : tc('accNadieMas')}
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={tc('accQuienVe')}>
      {acceso.reglas.map((r) => (
        <li key={claveRegla(r)} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[12px] text-[var(--color-text)]">
          {r.usuarioId ? <Users size={12} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" /> : <Lock size={12} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />}
          <span className="truncate">{describir(r)}</span>
        </li>
      ))}
    </ul>
  );
};

const Opcion = ({ nombre, elegida, onElegir, Icono, titulo, ayuda }) => (
  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${elegida ? 'border-[var(--color-primary)] bg-[var(--color-primary-10)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}`}>
    <input type="radio" name={nombre} checked={elegida} onChange={onElegir} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
    <span className="min-w-0">
      <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--color-text)]"><Icono size={14} aria-hidden="true" />{titulo}</span>
      <span className="block text-[12px] text-[var(--color-text-muted)]">{ayuda}</span>
    </span>
  </label>
);

/**
 * Props: valor { restringido, reglas }, onCambio(valor), contexto
 * ('articulo' | 'archivo'), autorId (quien escribió o escribirá el artículo)
 * y, en un archivo, accesoArticulo y subidoPorId para la vista previa.
 */
const SelectorAcceso = ({ valor, onCambio, contexto = 'articulo', autorId, accesoArticulo, subidoPorId, nombre = 'acceso' }) => {
  const tc = useTextoConocimiento();
  const { areas, nombreArea } = useConfiguracion();
  const { usuario: yo } = useAuth();
  const personas = usePersonas();
  const describir = useDescribirRegla();
  const [verLista, setVerLista] = useState(false);
  const esArchivo = contexto === 'archivo';
  const { reglas } = valor;

  const cambiarReglas = (nuevas) => onCambio({ ...valor, reglas: nuevas });
  // Nivel de un área: '' (sin acceso), 'todos', 'admin' o 'miembro'.
  const nivelArea = (clave) => {
    const r = reglas.find((x) => !x.usuarioId && x.area === clave);
    return r ? (r.rol || 'todos') : '';
  };
  const ponerArea = (clave, nivel) => {
    const resto = reglas.filter((x) => x.usuarioId || x.area !== clave);
    cambiarReglas(nivel ? [...resto, { area: clave, rol: nivel === 'todos' ? null : nivel, usuarioId: null }] : resto);
  };
  const nivelTodas = reglas.find((x) => !x.usuarioId && !x.area)?.rol || '';
  const ponerTodas = (nivel) => {
    const resto = reglas.filter((x) => x.usuarioId || x.area);
    cambiarReglas(nivel ? [...resto, { area: null, rol: nivel, usuarioId: null }] : resto);
  };
  const elegidas = reglas.filter((x) => x.usuarioId);
  const alternarPersona = (id) => cambiarReglas(elegidas.some((x) => x.usuarioId === id)
    ? reglas.filter((x) => x.usuarioId !== id)
    : [...reglas, { area: null, rol: null, usuarioId: id }]);

  const motivo = (u) => (esArchivo
    ? motivoArchivo(valor, u, { accesoArticulo, autorId, subidoPorId })
    : motivoArticulo(valor, u, autorId));
  const quienes = personas.map((u) => ({ u, m: motivo(u) })).filter((x) => x.m);
  const yoFuera = Boolean(yo) && valor.restringido && !motivo(yo);

  const opcionesNivel = [
    { valor: 'todos', etiqueta: tc('accTodaArea') },
    { valor: 'admin', etiqueta: tc('accSoloAdmins') },
    { valor: 'miembro', etiqueta: tc('accSoloMiembros') },
  ];
  // Agrupadas por área y en el orden de las áreas configuradas (quien tiene
  // varias va en el grupo de esas áreas, después del de la primera).
  const ordenArea = new Map(areas.map((a, i) => [a.clave, i]));
  const ordenDe = (u) => ordenArea.get(areasDeTexto(u.area)[0]) ?? 99;
  const opcionesPersonas = [...personas]
    .sort((a, b) => ordenDe(a) - ordenDe(b)
      || areasDeTexto(a.area).length - areasDeTexto(b.area).length
      || nombreArea(a.area).localeCompare(nombreArea(b.area), 'es')
      || a.nombre.localeCompare(b.nombre, 'es'))
    .map((u) => ({ valor: u.id, etiqueta: u.nombre, grupo: nombreArea(u.area) }));

  const resumen = !valor.restringido && !esArchivo
    ? tc('accLoVenTodos', { n: quienes.length })
    : (quienes.length === 1 ? tc('accLoVeranUno') : tc('accLoVeran', { n: quienes.length }));

  return (
    <div className="space-y-3">
      <div className="space-y-2" role="radiogroup" aria-label={tc('accQuienVe')}>
        <Opcion
          nombre={nombre}
          elegida={!valor.restringido}
          onElegir={() => onCambio({ ...valor, restringido: false })}
          Icono={Globe}
          titulo={esArchivo ? tc('accIgualArticulo') : tc('accTodoEquipo')}
          ayuda={esArchivo ? tc('accIgualArticuloAyuda') : tc('accTodoEquipoAyuda')}
        />
        <Opcion
          nombre={nombre}
          elegida={valor.restringido}
          onElegir={() => onCambio({ ...valor, restringido: true })}
          Icono={Lock}
          titulo={tc('accSoloElegidos')}
          ayuda={esArchivo ? tc('accSoloElegidosArchivoAyuda') : tc('accSoloElegidosAyuda')}
        />
      </div>

      {valor.restringido && (
        <>
          <div>
            <p className="form-label mb-1.5">{tc('accAreas')}</p>
            <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
              {[...areas.map((a) => ({ clave: a.clave, nombre: a.nombre, nivel: nivelArea(a.clave), poner: (v) => ponerArea(a.clave, v), opciones: opcionesNivel })),
                { clave: '__todas', nombre: tc('accTodasAreas'), nivel: nivelTodas, poner: ponerTodas, opciones: opcionesNivel.slice(1) },
              ].map((fila) => (
                // La fila con acceso se resalta: así no se confunde, p. ej., el área
                // Administración con la opción "Solo administradores" de otra.
                <li key={fila.clave} className={`flex items-center justify-between gap-2 px-3 py-1.5 ${fila.nivel ? 'bg-[var(--color-primary-10)]' : ''}`}>
                  <span className={`min-w-0 truncate text-[13px] text-[var(--color-text)] ${fila.nivel ? 'font-semibold' : ''}`}>{fila.nombre}</span>
                  <div className="w-[12rem] shrink-0">
                    <SelectorSimple valor={fila.nivel} onCambio={fila.poner} opciones={fila.opciones} opcionVacia={tc('accNadie')} aria-label={fila.nombre} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="form-label mb-1.5">{tc('accPersonas')}</p>
            <SelectorMultiple conBuscador placeholder={tc('accElegirPersonas')} seleccionados={elegidas.map((x) => x.usuarioId)} onToggle={alternarPersona} opciones={opcionesPersonas} />
            {elegidas.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {elegidas.map((r) => {
                  const nombrePersona = describir(r);
                  return (
                    <li key={r.usuarioId} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] py-0.5 pl-2.5 pr-1 text-[12px] text-[var(--color-text)]">
                      <span className="truncate">{nombrePersona}</span>
                      <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]" title={tc('accQuitarPersona', { nombre: nombrePersona })} aria-label={tc('accQuitarPersona', { nombre: nombrePersona })} onClick={() => alternarPersona(r.usuarioId)}>
                        <X size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-[var(--color-text)]">{resumen}</p>
          {quienes.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-primary)] hover:underline" aria-expanded={verLista} onClick={() => setVerLista((v) => !v)}>
              {verLista ? tc('accOcultarQuienes') : tc('accVerQuienes')}
              <ChevronDown size={14} className={`transition-transform ${verLista ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>
        {verLista && (
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
            {quienes.map(({ u, m }) => (
              <li key={u.id} className="flex items-center gap-2">
                <UserAvatar usuario={u} size={24} radius={8} fontSize="0.65rem" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text)]">{u.nombre}</span>
                <span className="shrink-0 text-[11.5px] text-[var(--color-text-muted)]">{tc(MOTIVOS[m])}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{tc('accPrevisionNota')}</p>
      </div>

      {yoFuera && (
        <p className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--badge-warning-fg)_30%,transparent)] bg-[var(--badge-warning-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-warning-fg)]" role="status">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {tc('accTuFuera')}
        </p>
      )}
    </div>
  );
};

export default SelectorAcceso;
