// Menú de la cuenta al pie del menú lateral: una tarjeta con la persona que,
// al pulsarla, despliega hacia arriba sus opciones (cuenta, tema, idioma y
// cerrar sesión). Se usa en el CRM y en el panel de configuración.
//
// Radix DropdownMenu da navegación con flechas, Esc, foco atrapado y
// submenús accesibles. `opciones` son las entradas propias de cada sitio:
//   [{ id, icono, etiqueta, atajo?, onSelect }]
// `atajo` ('Ctrl+,') también se activa con el teclado aunque el menú esté cerrado.
import { useEffect } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, ChevronsUpDown, Languages, LogOut, Moon } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext';
import UserAvatar from './UserAvatar';

const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const textoAtajo = (atajo) => (esMac ? atajo.replace('Ctrl+', '⌘') : atajo);

const coincideAtajo = (evento, atajo) => {
  const [mod, tecla] = atajo.split('+');
  const conMod = mod === 'Ctrl' ? (evento.ctrlKey || evento.metaKey) : false;
  return conMod && evento.key === tecla;
};

// Sin color de texto: cada entrada pone el suyo (si no, el rojo de "Cerrar
// sesión" competía con el color base y ganaba uno u otro según el CSS).
// Con el dedo cada entrada sube a ~40px de alto (py-1.5 se quedaba en 32px).
const ITEM = 'flex w-full cursor-pointer select-none items-center gap-3 rounded-[4px] px-2.5 py-1.5 [@media(pointer:coarse)]:py-2.5 text-sm outline-none transition-colors data-[highlighted]:bg-[var(--color-surface-3)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const CONTENIDO = 'z-[1600] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.35)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95';
const SEPARADOR = 'my-1 h-px bg-[var(--color-border)]';

const IDIOMAS = [
  { valor: 'es', etiqueta: 'Español' },
  { valor: 'en', etiqueta: 'English' },
];

// `plano`: fila sin caja (panel de configuración); por defecto, tarjeta (CRM).
const MenuCuenta = ({ usuario, subtitulo, opciones = [], onCerrarSesion, colapsado = false, plano = false }) => {
  const { t, theme, setTheme, language, setLanguage } = usePreferences();
  const oscuro = theme === 'dark';

  // Atajos de las opciones (p. ej. Ctrl+, para "Mi cuenta"), con el menú cerrado.
  useEffect(() => {
    const conAtajo = opciones.filter((o) => o.atajo);
    if (conAtajo.length === 0) return undefined;
    const alTeclear = (evento) => {
      const opcion = conAtajo.find((o) => coincideAtajo(evento, o.atajo));
      if (!opcion) return;
      evento.preventDefault();
      opcion.onSelect();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [opciones]);

  const avatar = (tamano) => (
    <UserAvatar
      usuario={usuario}
      size={tamano}
      radius={999}
      fontSize={tamano > 36 ? '0.85rem' : '0.75rem'}
      color={plano ? 'var(--color-on-primary)' : '#ffffff'}
      background={plano ? 'var(--color-primary)' : 'rgba(255,255,255,0.12)'}
      borderColor={plano ? 'transparent' : 'rgba(255,255,255,0.16)'}
    />
  );

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={`group flex w-full items-center text-left outline-none transition-colors ${plano ? 'rounded-[6px] text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] data-[state=open]:bg-[var(--color-surface)]' : 'rounded-2xl border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] data-[state=open]:bg-white/[0.1]'} ${colapsado ? 'justify-center p-2' : plano ? 'gap-2.5 px-2 py-2' : 'gap-3 p-2.5 pr-3'}`}
        aria-label={t('menuAccount')}
        title={colapsado ? usuario?.nombre : undefined}
      >
        {avatar(plano ? 32 : 40)}
        {!colapsado && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{usuario?.nombre}</span>
              <span className={`block truncate text-xs ${plano ? 'text-[var(--color-text-muted)]' : 'text-white/50'}`}>{subtitulo}</span>
            </span>
            <ChevronsUpDown size={16} className={`shrink-0 transition-colors ${plano ? 'text-[var(--color-text-muted)]' : 'text-white/40 group-hover:text-white/70'}`} aria-hidden="true" />
          </>
        )}
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          side={colapsado ? 'right' : 'top'}
          align={colapsado ? 'end' : 'start'}
          sideOffset={10}
          collisionPadding={12}
          className={`${CONTENIDO} max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(300px,calc(100vw-24px))] overflow-y-auto ${colapsado ? '' : 'min-w-[var(--radix-dropdown-menu-trigger-width)]'}`}
        >
          {/* Cabecera: quién tiene la sesión abierta */}
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <UserAvatar usuario={usuario} size={38} radius={999} fontSize="0.8rem" color="var(--color-text)" background="var(--color-surface-3)" borderColor="var(--color-border)" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{usuario?.nombre}</p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">{usuario?.email}</p>
            </div>
          </div>
          <Menu.Separator className={SEPARADOR} />

          {opciones.length > 0 && (
            <>
              {opciones.map(({ id, icono: Icono, etiqueta, atajo, distintivo, onSelect }) => (
                <Menu.Item key={id} className={`${ITEM} text-[var(--color-text)]`} onSelect={onSelect}>
                  <Icono size={17} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                  <span className="flex-1 truncate">{etiqueta}</span>
                  {distintivo && <span className="badge-warning shrink-0">{distintivo}</span>}
                  {atajo && <kbd className="shrink-0 font-sans text-xs text-[var(--color-text-muted)]">{textoAtajo(atajo)}</kbd>}
                </Menu.Item>
              ))}
              <Menu.Separator className={SEPARADOR} />
            </>
          )}

          {/* Tema: un clic lo cambia sin cerrar el menú, para ver el efecto */}
          <Menu.CheckboxItem checked={oscuro} className={`${ITEM} text-[var(--color-text)]`} onSelect={(e) => { e.preventDefault(); setTheme(oscuro ? 'light' : 'dark'); }}>
            {/* Etiqueta fija + interruptor que muestra el estado (encendido = oscuro) */}
            <Moon size={17} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
            <span className="flex-1">{t('darkMode')}</span>
            <span
              aria-hidden="true"
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${oscuro ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
            >
              <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${oscuro ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </span>
          </Menu.CheckboxItem>

          <Menu.Sub>
            <Menu.SubTrigger className={`${ITEM} text-[var(--color-text)] data-[state=open]:bg-[var(--color-surface-3)]`}>
              <Languages size={17} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
              <span className="flex-1">{t('language')}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{IDIOMAS.find((i) => i.valor === language)?.etiqueta}</span>
              <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent sideOffset={8} collisionPadding={12} className={`${CONTENIDO} w-44`}>
                <Menu.RadioGroup value={language} onValueChange={setLanguage}>
                  {IDIOMAS.map((idioma) => (
                    <Menu.RadioItem key={idioma.valor} value={idioma.valor} className={`${ITEM} text-[var(--color-text)]`}>
                      <span className="flex-1">{idioma.etiqueta}</span>
                      <Menu.ItemIndicator><Check size={15} className="text-[var(--color-primary)]" /></Menu.ItemIndicator>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>

          <Menu.Separator className={SEPARADOR} />
          <Menu.Item className={`${ITEM} text-[var(--color-error)] data-[highlighted]:bg-[var(--badge-danger-bg)] data-[highlighted]:text-[var(--badge-danger-fg)]`} onSelect={onCerrarSesion}>
            <LogOut size={17} className="shrink-0" aria-hidden="true" />
            <span className="flex-1">{t('menuSignOut')}</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default MenuCuenta;
