#!/usr/bin/env bash
# Alerta si la base supera 70 % de 500 MB o el disco supera 80 % (§4.6, §4.7).
# Variables: DATABASE_URL, DB_LIMIT_MB (500), DB_ALERT_PCT (70), DISK_ALERT_PCT (80), DISK_PATH (/srv/izao).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${DATABASE_URL:?DATABASE_URL no está definida}"
export PGURL="$DATABASE_URL"
LIM="${DB_LIMIT_MB:-500}"; PCT_DB="${DB_ALERT_PCT:-70}"; PCT_DISK="${DISK_ALERT_PCT:-80}"
RUTA="${DISK_PATH:-/srv/izao}"
[ -d "$RUTA" ] || RUTA=/
MAL=0
BYTES="$(pg_run psql -X -At -c "select pg_database_size(current_database())")"
USO_MB=$(( BYTES / 1024 / 1024 ))
PCT=$(( BYTES * 100 / (LIM * 1024 * 1024) ))
log "Base: ${USO_MB} MB de ${LIM} MB (${PCT} %)"
if [ "$PCT" -ge "$PCT_DB" ]; then alertar "Base de datos al ${PCT} % (${USO_MB} MB de ${LIM} MB)"; MAL=1; fi
DISCO="$(df -P "$RUTA" | awk 'NR==2 {gsub("%","",$5); print $5}')"
log "Disco ($RUTA): ${DISCO} %"
if [ "$DISCO" -ge "$PCT_DISK" ]; then alertar "Disco al ${DISCO} % en $RUTA"; MAL=1; fi
exit "$MAL"
