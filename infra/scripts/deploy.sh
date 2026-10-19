#!/usr/bin/env bash
# Despliegue de Izao (§4.5). Uso:
#   infra/scripts/deploy.sh [--dry-run] [--skip-tests] [--migraciones-verificadas] [--branch main]
# --dry-run imprime cada paso sin ejecutar nada (no toca git, Docker ni la base).
# Pensado para correr en el VPS (/srv/izao/app) vía el MCP contabo; también sirve en local.
set -euo pipefail

DRY_RUN=0; SKIP_TESTS=0; MIG_OK=0; BRANCH=main
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --migraciones-verificadas) MIG_OK=1 ;;
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
ULTIMO_OK="${ULTIMO_OK:-/srv/izao/ultimo-ok}"   # último tag de imagen que pasó el healthcheck
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
  PREV_GIT="$(git rev-parse HEAD)"
  # Tag a restaurar si algo falla: NO se toma de git (tras un despliegue fallido HEAD puede quedar
  # en el commit malo). Orden: 1) /srv/izao/ultimo-ok (último tag sano), 2) tag de la imagen del
  # contenedor web vivo, 3) git como último recurso.
  PREV_SHA=""; BASE_GIT=""
  # Formato de ultimo-ok: "<tag-de-imagen> <commit-git-completo>" del último despliegue sano.
  if [ -s "$ULTIMO_OK" ]; then
    read -r PREV_SHA BASE_GIT < "$ULTIMO_OK" || true
    PREV_SHA="$(printf '%s' "$PREV_SHA" | tr -cd 'A-Za-z0-9._-')"; BASE_GIT="$(printf '%s' "$BASE_GIT" | tr -cd 'A-Fa-f0-9')"
    if [ -n "$BASE_GIT" ] && ! git cat-file -e "${BASE_GIT}^{commit}" 2>/dev/null; then BASE_GIT=""; fi
  fi
  if [ -z "$PREV_SHA" ]; then
    CID="$("${COMPOSE[@]}" ps -q web 2>/dev/null | head -1 || true)"
    if [ -n "$CID" ]; then PREV_SHA="$(docker inspect --format '{{.Config.Image}}' "$CID" 2>/dev/null | sed 's/.*://' || true)"; fi
  fi
  PREV_SHA="${PREV_SHA:-$(git rev-parse --short HEAD)}"
else
  PREV_GIT="<commit-actual>"
  PREV_SHA="<tag-sano-anterior>"
  BASE_GIT=""
fi
# Base del diff de migraciones: el commit del último despliegue SANO (no HEAD: un despliegue
# fallido antes del paso 5 deja HEAD adelantado y ocultaría sus migraciones al siguiente intento).
BASE_DIFF="${BASE_GIT:-$PREV_GIT}"

# Si algo falla antes de tocar los contenedores (pasos 1 a 4), el código vuelve al commit anterior.
ANTES_PASO5=1
volver_git() {
  if [ "$ANTES_PASO5" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    git reset --keep "$PREV_GIT" 2>/dev/null || echo "AVISO: no se pudo devolver git a $PREV_GIT" >&2
  fi
}
trap volver_git ERR

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

paso "3/7 Migraciones de base de datos (paso manual, D-008)"
# Las migraciones NO se aplican desde aquí: se aplican con el MCP de Supabase (apply_migration).
# Este paso solo exige que, si el commit nuevo trae migraciones, alguien haya comprobado que
# packages/db/supabase/migrations coincide con las remotas (list_migrations) y lo confirme.
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] git diff --name-only $BASE_DIFF $NEW_SHA -- packages/db/supabase/migrations"
  MIG_NUEVAS=""
else
  MIG_NUEVAS="$(git diff --name-only "$BASE_DIFF" "$NEW_SHA" -- packages/db/supabase/migrations || true)"
fi
if [ -n "$MIG_NUEVAS" ] && [ "$MIG_OK" -ne 1 ]; then
  echo "Este despliegue trae migraciones nuevas o modificadas:" >&2
  echo "$MIG_NUEVAS" | sed 's/^/  /' >&2
  echo >&2
  echo "Antes de desplegar: aplícalas con el MCP de Supabase (apply_migration), compara con list_migrations" >&2
  echo "que las versiones remotas coinciden con los archivos de packages/db/supabase/migrations y vuelve" >&2
  echo "a ejecutar con --migraciones-verificadas (ver docs/RUNBOOK.md)." >&2
  volver_git
  exit 1
fi
[ -n "$MIG_NUEVAS" ] && echo "Migraciones confirmadas a mano (--migraciones-verificadas)." || echo "Sin cambios en migraciones."

paso "4/7 Construcción de imágenes"
export IZAO_TAG="$NEW_SHA"
run "${COMPOSE[@]}" build web worker

ANTES_PASO5=0
paso "5/7 Actualización: web y luego worker; 6/7 verificación de salud"
guardar_ultimo_ok() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "[dry-run] echo '$1 $2' > $ULTIMO_OK"; return; fi
  mkdir -p "$(dirname "$ULTIMO_OK")" 2>/dev/null || true
  echo "$1 $2" > "$ULTIMO_OK" 2>/dev/null || echo "AVISO: no se pudo escribir $ULTIMO_OK" >&2
}

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
  # El código vuelve al commit anterior para que el siguiente despliegue y su diff partan de lo sano.
  git reset --keep "$PREV_GIT" || echo "AVISO: no se pudo devolver git a $PREV_GIT" >&2
  guardar_ultimo_ok "$PREV_SHA" "$BASE_DIFF"
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

guardar_ultimo_ok "$NEW_SHA" "$( [ "$DRY_RUN" -eq 1 ] && echo "<commit-nuevo>" || git rev-parse HEAD )"
paso "7/7 Registro"
registrar "DEPLOY $PREV_SHA -> $NEW_SHA rama=$BRANCH"
echo "Despliegue terminado."
