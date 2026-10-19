#!/usr/bin/env bash
# Funciones comunes de backup/restore. Se usa con `source`. Nunca imprime DATABASE_URL.
# Si el anfitrión no tiene pg_dump/psql, se usan en un contenedor postgres:17-alpine
# (PG_DOCKER_NETWORK opcional para redes de Docker; en el VPS no hace falta).

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
export MSYS_NO_PATHCONV=1

log() { echo "[$(date +%FT%T%z)] $*"; }

# Ejecuta un binario de Postgres (pg_dump|psql) con la URL en la variable de entorno PGURL.
pg_run() {
  local bin="$1"; shift
  if [ -z "${PG_FORCE_DOCKER:-}" ] && command -v "$bin" >/dev/null 2>&1; then
    "$bin" "$PGURL" "$@"
  else
    local net=()
    [ -n "${PG_DOCKER_NETWORK:-}" ] && net=(--network "$PG_DOCKER_NETWORK")
    docker run --rm -i "${net[@]}" -e PGURL "$PG_IMAGE" sh -c 'bin="$1"; shift; exec "$bin" "$PGURL" "$@"' _ "$bin" "$@"
  fi
}

# Conteo de filas por tabla (esquemas indicados): líneas "esquema.tabla N" ordenadas.
table_counts() {
  local schemas="$1"
  pg_run psql -X -At -v ON_ERROR_STOP=1 -c "
    select format('select %L as t, count(*) as n from %I.%I', schemaname||'.'||tablename, schemaname, tablename)
    from pg_tables where schemaname = any(string_to_array('${schemas// /,}', ','))
    order by 1" \
  | { grep . || true; } \
  | while read -r q; do pg_run psql -X -At -F ' ' -c "$q" </dev/null; done | tr '|' ' ' | sort
}

# Alerta: ALERTA.txt, correo si hay `mail`, y push a Uptime Kuma si hay UPTIME_PUSH_URL.
alertar() {
  local msg="$1"
  log "ALERTA: $msg" >&2
  local dir="${BACKUP_DIR:-/srv/izao/backups}"
  if mkdir -p "$dir" 2>/dev/null; then echo "$(date +%FT%T%z) $msg" >> "$dir/ALERTA.txt" || true; fi
  if [ -n "${ADMIN_ALERT_EMAIL:-}" ] && command -v mail >/dev/null 2>&1; then
    echo "$msg" | mail -s "Izao: alerta de infraestructura" "$ADMIN_ALERT_EMAIL" || true
  fi
  if [ -n "${UPTIME_PUSH_URL:-}" ]; then
    curl -fsS -m 10 --get --data-urlencode "status=down" --data-urlencode "msg=$msg" "$UPTIME_PUSH_URL" >/dev/null || true
  fi
}

# Descodifica %XX de una URL.
urldecode() { local s="${1//+/+}"; printf '%b' "${s//%/\x}"; }

# Descompone postgres://usuario:clave@host:puerto/base?consulta en U_USER, U_PASS, U_HOST (en
# minúsculas, sin corchetes), U_PORT (def. 5432), U_DB y U_QUERY. Falla si no es una URL de Postgres.
parse_pg_url() {
  local url="$1" rest auth
  [[ "$url" =~ ^[Pp][Oo][Ss][Tt][Gg][Rr][Ee][Ss]([Qq][Ll])?://(.*)$ ]] || return 1
  rest="${BASH_REMATCH[2]}"
  U_QUERY=""; U_DB=""; U_USER=""; U_PASS=""; U_PORT=""
  if [[ "$rest" == *\?* ]]; then U_QUERY="${rest#*\?}"; rest="${rest%%\?*}"; fi
  if [[ "$rest" == */* ]]; then U_DB="${rest#*/}"; rest="${rest%%/*}"; fi
  if [[ "$rest" == *@* ]]; then
    auth="${rest%@*}"; rest="${rest##*@}"
    U_USER="${auth%%:*}"
    if [[ "$auth" == *:* ]]; then U_PASS="${auth#*:}"; fi
  fi
  if [[ "$rest" =~ ^\[(.*)\](:([0-9]+))?$ ]]; then
    U_HOST="${BASH_REMATCH[1]}"; U_PORT="${BASH_REMATCH[3]}"
  else
    U_HOST="${rest%%:*}"
    if [[ "$rest" == *:* ]]; then U_PORT="${rest##*:}"; fi
  fi
  U_HOST="$(printf '%s' "$U_HOST" | tr 'A-Z' 'a-z')"
  U_PORT="${U_PORT:-5432}"
  U_USER="$(urldecode "$U_USER")"; U_PASS="$(urldecode "$U_PASS")"; U_DB="$(urldecode "$U_DB")"
}
