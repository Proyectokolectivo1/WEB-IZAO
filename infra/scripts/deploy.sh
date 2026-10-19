#!/usr/bin/env bash
# Despliegue de Izao (§4.5). Uso:
#   infra/scripts/deploy.sh [--dry-run] [--skip-tests] [--skip-migrations] [--branch main]
# --dry-run imprime cada paso sin ejecutar nada (no toca git, Docker ni la base).
# Pensado para correr en el VPS (/srv/izao/app) vía el MCP contabo; también sirve en local.
set -euo pipefail

DRY_RUN=0; SKIP_TESTS=0; SKIP_MIG=0; BRANCH=main
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --skip-migrations) SKIP_MIG=1 ;;
    --branch) BRANCH="${2:?falta la rama}"; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$RAIZ/infra"
LOG="${DEPLOY_LOG:-/srv/izao/deploys.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
COMPOSE=(docker compose -f "$INFRA/docker-compose.yml" --project-directory "$INFRA")

paso() { echo; echo "==> $*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "[dry-run] $*"; else echo "+ $*"; "$@"; fi
}
registrar() {
  local linea; linea="$(date -u +%FT%TZ) $*"
  if [ "$DRY_RUN" -eq 1 ]; then echo "[dry-run] log -> $LOG: $linea"; return; fi
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  echo "$linea" >> "$LOG" 2>/dev/null || echo "(no se pudo escribir $LOG)"
}

source "$INFRA/scripts/lib.sh"
cd "$RAIZ"
[ "$DRY_RUN" -eq 1 ] && echo "MODO SIMULACIÓN: no se ejecuta ningún cambio."

if [ "$DRY_RUN" -eq 0 ]; then
  [ -f "$INFRA/.env" ] || { echo "Falta $INFRA/.env (lo sube el usuario; ver docs/RUNBOOK.md)." >&2; exit 1; }
  PREV_SHA="$(git rev-parse --short HEAD)"
else
  PREV_SHA="<sha-actual>"
fi

paso "1/7 Código"
run git fetch origin "$BRANCH"
run git merge --ff-only "origin/$BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then NEW_SHA="<sha-nuevo>"; else NEW_SHA="$(git rev-parse --short HEAD)"; fi
echo "Versión: $PREV_SHA -> $NEW_SHA"

paso "2/7 Dependencias y pruebas"
run pnpm install --frozen-lockfile
if [ "$SKIP_TESTS" -eq 1 ]; then echo "(pruebas omitidas)"; else
  run pnpm lint; run pnpm typecheck; run pnpm test
fi

paso "3/7 Migraciones (Supabase)"
if [ "$SKIP_MIG" -eq 1 ]; then echo "(migraciones omitidas)"; else
  if [ "$DRY_RUN" -eq 1 ] || { command -v supabase >/dev/null && [ -d packages/db/supabase/migrations -o -d supabase/migrations ]; }; then
    run supabase db push
  else
    echo "(sin Supabase CLI o sin migraciones: se omite)"
  fi
fi

paso "4/7 Construcción de imágenes"
export IZAO_TAG="$NEW_SHA"
run "${COMPOSE[@]}" build web worker

paso "5/7 Actualización: web y luego worker; 6/7 verificación de salud"
revertir() {
  echo "Revirtiendo a la versión $PREV_SHA" >&2
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] docker image inspect izao-web:$PREV_SHA izao-worker:$PREV_SHA"
    echo "[dry-run] IZAO_TAG=$PREV_SHA docker compose up -d --no-build --no-deps --wait web worker"
    return 0
  fi
  if ! docker image inspect "izao-web:$PREV_SHA" >/dev/null 2>&1 || ! docker image inspect "izao-worker:$PREV_SHA" >/dev/null 2>&1; then
    alertar "Despliegue $NEW_SHA falló y no existe la imagen anterior $PREV_SHA: no se puede revertir"
    echo "ERROR: no existe la imagen anterior ($PREV_SHA); sin rollback automático." >&2
    registrar "FALLO sin rollback $PREV_SHA -> $NEW_SHA"
    return 1
  fi
  IZAO_TAG="$PREV_SHA" "${COMPOSE[@]}" up -d --no-build --no-deps --wait --wait-timeout 120 web worker || {
    alertar "El rollback a $PREV_SHA también falló"; return 1; }
  registrar "ROLLBACK $NEW_SHA -> $PREV_SHA"
}

actualizar_y_verificar() {
  run "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 web || return 1
  run "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 worker || return 1
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] curl --fail --retry 10 --retry-delay 3 --retry-connrefused $HEALTH_URL"
    return 0
  fi
  curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-connrefused "$HEALTH_URL" >/dev/null || return 1
  echo "Salud OK"
}

if ! actualizar_y_verificar; then
  echo "La actualización o el healthcheck falló." >&2
  revertir || true
  exit 1
fi

paso "7/7 Registro"
registrar "DEPLOY $PREV_SHA -> $NEW_SHA rama=$BRANCH"
echo "Despliegue terminado."
