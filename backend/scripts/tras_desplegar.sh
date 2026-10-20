#!/usr/bin/env bash
# Corre en el servidor de cPanel justo después de que GitHub Actions sube el
# backend (.github/workflows/desplegar-cpanel.yml). Hace lo mismo que los
# botones de "Setup Node.js App" (Run NPM Install, Run JS script y Restart)
# con cloudlinux-selector, que es lo que usan esos botones: así los scripts
# reciben las variables de entorno de la aplicación (DATABASE_URL,
# NODE_OPTIONS...), que una terminal o un cron no tienen.
#
#   bash crm_backend/scripts/tras_desplegar.sh [--instalar] [--generar] [--migrar] COMMIT
#
# Al terminar bien anota COMMIT en .commit_desplegado: el siguiente despliegue
# compara contra él para saber si cambiaron dependencias, esquema o migraciones.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$PATH:/usr/sbin:/usr/bin:/usr/local/bin"
APP_ROOT="${PWD#"$HOME"/}"

instalar=0 generar=0 migrar=0 commit=""
for arg in "$@"; do
  case "$arg" in
    --instalar) instalar=1 ;;
    --generar) generar=1 ;;
    --migrar) migrar=1 ;;
    --*) echo "Opción desconocida: $arg" >&2; exit 2 ;;
    *) commit="$arg" ;;
  esac
done

hay_selector=0
command -v cloudlinux-selector >/dev/null 2>&1 && hay_selector=1

# cloudlinux-selector responde JSON con "result": "success" o el error.
selector() {
  local salida
  salida=$(cloudlinux-selector "$@" --json --interpreter nodejs --app-root "$APP_ROOT" 2>&1) || true
  printf '%s\n' "$salida"
  grep -q '"result": *"success"' <<<"$salida"
}

paso() { printf '\n== %s\n' "$1"; }

if (( instalar || generar || migrar )) && (( ! hay_selector )); then
  echo "No está cloudlinux-selector en este servidor: haz a mano en Setup Node.js App" >&2
  (( instalar )) && echo "  - Run NPM Install" >&2
  (( generar )) && echo "  - Run JS script → db:generate" >&2
  (( migrar )) && echo "  - Run JS script → db:migrate" >&2
  exit 1
fi

if (( instalar )); then
  paso 'npm install (Run NPM Install)'
  selector install-modules
fi
if (( generar )); then
  paso 'prisma generate (db:generate)'
  selector run-script --script-name db:generate
fi
if (( migrar )); then
  paso 'migraciones (db:migrate)'
  selector run-script --script-name db:migrate
fi

paso 'reiniciar la aplicación'
if ! { (( hay_selector )) && selector restart; }; then
  # Passenger y LiteSpeed reinician la app al tocar tmp/restart.txt.
  mkdir -p tmp
  touch tmp/restart.txt
  echo 'Reinicio pedido con tmp/restart.txt'
fi

if [[ -n "$commit" ]]; then
  printf '%s\n' "$commit" > .commit_desplegado
fi
echo 'Listo.'
