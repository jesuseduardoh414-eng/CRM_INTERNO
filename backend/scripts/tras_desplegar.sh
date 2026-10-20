#!/usr/bin/env bash
# Corre en el servidor de cPanel justo después de que GitHub Actions sube el
# backend (.github/workflows/desplegar-cpanel.yml): instala dependencias si
# cambió package-lock.json, genera el cliente de Prisma, aplica migraciones y
# pide el reinicio de la aplicación con tmp/restart.txt.
#
# PROCESOS. En la jaula de CloudLinux la cuenta tiene 100 procesos y cada hilo
# cuenta como uno. El 2026-10-20 la aplicación (sin tope de hilos de Prisma)
# ocupaba ~88; `cloudlinux-selector install-modules` llegó al límite, se colgó
# 20 minutos sin salida y la cuenta se quedó sin poder abrir nada (SSH: "exec
# request failed"; se arregla suspendiendo y reactivando la cuenta en WHM). Por
# eso aquí:
#   - si no hay nada que instalar, generar ni migrar, no se arranca ningún
#     node: solo se toca tmp/restart.txt;
#   - antes de cada paso pesado se mira cuántos procesos usa la cuenta y, si no
#     hay margen, se detiene en vez de quedarse colgado;
#   - los node que corre (npm, prisma) llevan pocos hilos y un tiempo máximo.
#
# Usa el node y npm de la aplicación (~/nodevenv/<app>/<versión>) y sus
# variables de entorno (las de "Setup Node.js App", leídas con
# `cloudlinux-selector get`), que una terminal o un cron no tienen.
#
#   bash crm_backend/scripts/tras_desplegar.sh [--instalar] [--generar] [--migrar] COMMIT
#
# Sin --instalar, npm install solo corre si package-lock.json no coincide con
# el de la última instalación (.lock_instalado). Al terminar anota COMMIT en
# .commit_desplegado, que /api/health lee al arrancar.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$PATH:/usr/sbin:/usr/bin:/usr/local/bin"
APP_ROOT="${PWD#"$HOME"/}"
LIMITE="${LIMITE_PROCESOS:-100}"

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

paso() { printf '\n== %s (%s)\n' "$1" "$(date +%H:%M:%S)"; }
hilos() { ps -L -u "$(id -un)" --no-headers 2>/dev/null | wc -l; }
# margen N: hay sitio para un paso que necesita ~N procesos más.
margen() {
  local usados
  usados=$(hilos)
  echo "Procesos de la cuenta: $usados de $LIMITE (este paso necesita ~$1)"
  if (( usados + $1 > LIMITE )); then
    echo "Sin margen: la aplicación ocupa casi todo. Reinicia la aplicación (o espera a que se duerma) y vuelve a desplegar." >&2
    return 1
  fi
}
# Con límite de tiempo; si se pasa, se corta y el despliegue falla.
limitado() {
  local segundos="$1"; shift
  if ! timeout --kill-after=30 "$segundos" "$@"; then
    echo "Falló o pasó de ${segundos}s: $*" >&2
    return 1
  fi
}

node_listo=0
preparar_node() {
  (( node_listo )) && return 0
  paso 'node y variables de la aplicación'
  margen 15
  local activar json exportar
  activar=$(ls -1d "$HOME/nodevenv/$APP_ROOT"/*/bin/activate 2>/dev/null | sort -V | tail -1 || true)
  if [[ -z "$activar" ]]; then
    echo "No está ~/nodevenv/$APP_ROOT: ¿existe la aplicación en Setup Node.js App?" >&2
    exit 1
  fi
  set +u
  # shellcheck disable=SC1090
  source "$activar"
  set -u
  json=$(limitado 60 cloudlinux-selector get --json --interpreter nodejs)
  # Sin `< <(...)`: en la jaula de CloudLinux no hay /dev/fd.
  exportar=$(APP_ROOT="$APP_ROOT" node --v8-pool-size=1 scripts/variables_app.js <<<"$json")
  eval "$exportar"
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "No encontré las variables de la aplicación $APP_ROOT (falta DATABASE_URL)." >&2
    exit 1
  fi
  # Pocos hilos también para npm, prisma generate y el motor de migraciones.
  export TOKIO_WORKER_THREADS="${TOKIO_WORKER_THREADS:-2}" UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-2}"
  export NODE_OPTIONS="${NODE_OPTIONS:-} --v8-pool-size=2"
  echo "node $(node -v), npm $(npm -v); variables: ${VARIABLES_APP:-}"
  node_listo=1
}
# Cada dependencia de package.json está en node_modules y las clave cargan. No
# se usa `npm ls`: en cPanel siempre falla (node_modules es un enlace a
# ~/nodevenv y xlsx viene de una URL), y eso dispararía un npm install de más.
completas() {
  node -e '
    const fs = require("fs");
    const { dependencies } = require("./package.json");
    const faltan = Object.keys(dependencies).filter((m) => !fs.existsSync(`node_modules/${m}/package.json`));
    if (faltan.length) { console.error(`Faltan: ${faltan.join(", ")}`); process.exit(1); }
    require("express"); require("@prisma/client");
  '
}

paso 'inicio'
echo "Procesos de la cuenta: $(hilos) de $LIMITE"

paso 'dependencias'
huella=$(sha256sum package-lock.json | cut -d' ' -f1)
instalada=$(cat .lock_instalado 2>/dev/null || true)
if (( instalar )); then
  echo 'Instalación pedida.'
elif [[ "$huella" == "$instalada" ]]; then
  echo 'package-lock.json sin cambios: no se instala nada.'
elif [[ -z "$instalada" ]]; then
  preparar_node
  if completas; then
    echo 'Dependencias completas (primera vez con este script): se anota la huella sin reinstalar.'
    echo "$huella" > .lock_instalado
  else
    instalar=1
  fi
else
  instalar=1
fi
if (( instalar )); then
  preparar_node
  paso 'npm install'
  margen 40
  limitado 600 npm install --omit=dev --no-audit --no-fund --no-progress
  completas || { echo 'npm install terminó pero faltan dependencias.' >&2; exit 1; }
  echo "$huella" > .lock_instalado
  generar=1
fi

if (( generar )); then
  preparar_node
  paso 'prisma generate'
  margen 25
  limitado 300 node scripts/prisma.js generate
fi
if (( migrar )); then
  preparar_node
  paso 'migraciones'
  margen 25
  limitado 300 node scripts/prisma.js migrate deploy
fi

paso 'reiniciar la aplicación'
if [[ -n "$commit" ]]; then
  printf '%s\n' "$commit" > .commit_desplegado
fi
# Passenger y LiteSpeed reinician la aplicación en la siguiente petición al
# ver tmp/restart.txt más nuevo (comprobado en este servidor con MAQSER24).
mkdir -p tmp
touch tmp/restart.txt
echo "Listo. Procesos de la cuenta: $(hilos) de $LIMITE"
