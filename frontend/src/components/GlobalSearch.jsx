import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import {
  Calendar,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  PiggyBank,
  Receipt,
  ReceiptText,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import Modal from './Modal';
import UserAvatar from './UserAvatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { proyectosService, usuariosService } from '../services/api';
import { useDebounce } from '../utils/useDebounce';
import { getEstadoProyecto } from '../utils/estadosProyecto';
import { useTextoFinanzas } from '../hooks/useTextoFinanzas';
import { puedeVerFinanzas, tieneAccesoGastos } from '../utils/finanzas';

// Con una letra la busqueda devuelve medio catalogo; con dos ya discrimina.
const MIN_CARACTERES = 2;
const LIMITE_POR_GRUPO = 8;

const ATAJOS = [
  { to: '/dashboard', labelKey: 'home', Icon: LayoutDashboard },
  { to: '/proyectos', labelKey: 'projects', Icon: FolderKanban },
  { to: '/agenda', labelKey: 'agenda', Icon: Calendar, modulo: 'agenda' },
  { to: '/usuarios', labelKey: 'users', Icon: ShieldCheck, soloAdmin: true },
  // Finanzas: salen solo con permiso (usuario.finanzas) y el módulo activo.
  { to: '/ventas', tfKey: 'finVentasTitulo', Icon: Receipt, modulo: 'finanzas', finanzas: 'ventas' },
  { to: '/tesoreria', tfKey: 'finTesoreriaTitulo', Icon: PiggyBank, modulo: 'finanzas', finanzas: 'tesoreria' },
  { to: '/gastos', tfKey: 'finGastosTitulo', Icon: ReceiptText, modulo: 'finanzas', finanzas: 'gastos' },
  { to: '/perfil', labelKey: 'goToProfile', Icon: UserCircle2 },
];

/**
 * Buscador global (Ctrl+K / Cmd+K). Busca proyectos y, para el admin, personas.
 *
 * Va sobre el `Modal` del sistema y no sobre el `CommandDialog` de shadcn: ese
 * usa el Dialog con z-50, que queda por debajo del menu lateral (z-100).
 *
 * No hay busqueda de tareas: el backend no tiene un endpoint de tareas por
 * texto fuera de un proyecto. Se añadiria aqui como un tercer grupo.
 */
const GlobalSearch = ({ open, onClose }) => {
  const { t } = usePreferences();
  const tf = useTextoFinanzas();
  const { usuario } = useAuth();
  const { moduloActivo } = useConfiguracion();
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const termino = useDebounce(texto.trim(), 250);
  const esAdmin = usuario?.rol === 'ADMIN';

  // La busqueda de personas solo para el admin: la pantalla a la que lleva
  // (Usuarios) es suya. La API responde a cualquiera, pero un miembro no tendria
  // a donde ir con el resultado.
  const clave = open && termino.length >= MIN_CARACTERES
    ? ['busqueda-global', termino, esAdmin]
    : null;

  const { data, isLoading, error } = useSWR(
    clave,
    async ([, q, incluirPersonas]) => {
      const [proyectos, personas] = await Promise.all([
        proyectosService.listar({ q, page: 1, limit: LIMITE_POR_GRUPO }).then((r) => r.proyectos || []),
        incluirPersonas
          ? usuariosService.listar({ q, page: 1, limit: LIMITE_POR_GRUPO }).then((r) => r.usuarios || [])
          : Promise.resolve([]),
      ]);
      return { proyectos, personas };
    },
    { keepPreviousData: true, dedupingInterval: 10000 },
  );

  // Con `keepPreviousData` SWR sigue devolviendo los ultimos resultados aunque
  // la clave sea null (texto corto): se vacian a mano para no pintar restos
  // debajo de los atajos.
  const buscando = Boolean(clave);
  const proyectos = buscando ? (data?.proyectos || []) : [];
  const personas = buscando ? (data?.personas || []) : [];
  const sinResultados = buscando && !isLoading && !error && proyectos.length === 0 && personas.length === 0;

  const ir = (destino) => {
    onClose?.();
    navigate(destino);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="640px"
      title={t('searchTitle')}
      subtitle={t('searchHint')}
      bodyClassName="!p-0"
    >
      {/* El filtrado lo hace el servidor; cmdk no debe volver a filtrar */}
      <Command shouldFilter={false} loop className="bg-transparent">
        <CommandInput
          autoFocus
          value={texto}
          onValueChange={setTexto}
          placeholder={t('searchPlaceholderLong')}
          aria-label={t('searchTitle')}
          enterKeyHint="search"
        />
        <CommandList className="max-h-[min(60dvh,420px)] overscroll-contain p-2">
          {!buscando && (
            <CommandGroup heading={t('searchGoTo')}>
              {ATAJOS.filter((atajo) => (!atajo.soloAdmin || esAdmin)
                && (!atajo.modulo || moduloActivo(atajo.modulo))
                && (!atajo.finanzas || (atajo.finanzas === 'gastos' ? tieneAccesoGastos(usuario) : puedeVerFinanzas(usuario, atajo.finanzas)))).map(({ to, labelKey, tfKey, Icon }) => (
                <CommandItem key={to} value={`ir-${to}`} onSelect={() => ir(to)} className="cursor-pointer rounded-lg py-2.5">
                  <Icon size={16} className="text-[var(--color-text-muted)]" />
                  <span>{tfKey ? tf(tfKey) : t(labelKey)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {buscando && isLoading && !data && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin" /> {t('loading')}
            </div>
          )}

          {buscando && error && (
            <div className="py-8 text-center text-sm text-[var(--color-error)]">{error.message}</div>
          )}

          {sinResultados && (
            <CommandEmpty>{t('searchNoResults')}</CommandEmpty>
          )}

          {proyectos.length > 0 && (
            <CommandGroup heading={t('projects')}>
              {proyectos.map((proyecto) => {
                const estado = getEstadoProyecto(proyecto.estado);
                return (
                  <CommandItem
                    key={`proyecto-${proyecto.id}`}
                    value={`proyecto-${proyecto.id}`}
                    onSelect={() => ir(`/proyectos/${proyecto.id}`)}
                    className="cursor-pointer rounded-lg py-2.5"
                  >
                    <FolderKanban size={16} className="text-[var(--color-text-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{proyecto.nombre}</span>
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
                      style={{ color: estado.color, background: estado.bg }}
                    >
                      {t(estado.labelKey)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {personas.length > 0 && (
            <CommandGroup heading={t('searchPeople')}>
              {personas.map((persona) => (
                <CommandItem
                  key={`persona-${persona.id}`}
                  value={`persona-${persona.id}`}
                  onSelect={() => ir(`/usuarios?q=${encodeURIComponent(persona.nombre || persona.email || '')}`)}
                  className="cursor-pointer rounded-lg py-2"
                >
                  <UserAvatar
                    usuario={persona}
                    size={26}
                    radius={999}
                    fontSize="0.65rem"
                    color="var(--color-primary)"
                    background="var(--color-primary-10)"
                    borderColor="var(--color-primary-20)"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{persona.nombre}</span>
                    <span className="block truncate text-xs text-[var(--color-text-muted)]">{persona.email}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </Modal>
  );
};

export default GlobalSearch;
