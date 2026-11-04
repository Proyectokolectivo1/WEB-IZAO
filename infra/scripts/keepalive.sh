#!/usr/bin/env bash
# Consulta ligera para que Supabase gratuito no pause el proyecto por inactividad (§4.6).
# Cron: cada 3 días (ver izao.cron). Requiere DATABASE_URL.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${DATABASE_URL:?DATABASE_URL no está definida}"
export PGURL="$DATABASE_URL"
if pg_run psql -X -At -c "select 1" >/dev/null; then
  log "keepalive OK"
else
  alertar "keepalive: la base no respondió"
  exit 1
fi
