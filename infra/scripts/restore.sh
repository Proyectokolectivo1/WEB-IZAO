#!/usr/bin/env bash
# Restaura un backup (.sql.gz, .sql.gz.age o .sql.gz.gpg) SOLO en una base temporal. Nunca sobrescribe el proyecto de Supabase.
#   infra/scripts/restore.sh <archivo.sql.gz> [--keep] [--counts salida.txt]
#     Crea un contenedor postgres:17 desechable, restaura, imprime conteos por tabla y lo borra
#     (--keep lo deja vivo para inspección; se imprime su nombre).
#   infra/scripts/restore.sh <archivo.sql.gz> --target-url URL_TEMPORAL
#     Restaura en una base temporal local ya existente. Lista blanca: --confirmo-base-temporal,
#     host localhost/127.0.0.1, base izao_restore_*, distinta de DATABASE_URL.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ARCHIVO="${1:-}"
if [ -n "$ARCHIVO" ]; then shift; fi
KEEP=0; TARGET=""; COUNTS=""; CONFIRMO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --target-url) TARGET="${2:?falta URL}"; shift ;;
    --confirmo-base-temporal) CONFIRMO=1 ;;
    --counts) COUNTS="${2:?falta archivo}"; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -f "$ARCHIVO" ] || { echo "Uso: restore.sh <archivo.sql.gz> [--keep] [--counts f] [--target-url URL --confirmo-base-temporal]" >&2; exit 2; }
# Los backups de base van cifrados (.age/.gpg): se descifran con la llave privada, que NO está en el VPS.
descifrar "$ARCHIVO" | gzip -t

SCHEMAS="${DUMP_SCHEMAS:-public auth storage}"
# Roles que Supabase da por existentes y que el dump referencia (GRANT/POLICY).
ROLES_SQL="do \$\$ declare r text; begin foreach r in array array['anon','authenticated','service_role','supabase_admin','authenticator','supabase_auth_admin','supabase_storage_admin','dashboard_user'] loop if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if; end loop; end \$\$;"

# Esquema y extensiones que las migraciones crean en `extensions` (pg_dump no los incluye al
# respaldar solo public/auth/storage). pgtap queda fuera: solo sirve para pruebas del esquema.
EXT_SQL='create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists pg_trgm with schema extensions; create extension if not exists unaccent with schema extensions; create extension if not exists citext with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;'

if [ -n "$TARGET" ]; then
  # Lista blanca (el destino de esta ruta se vacía con `drop schema public cascade`):
  #  - bandera explícita --confirmo-base-temporal
  #  - host solo localhost / 127.0.0.1 / ::1 (normalizado)
  #  - nombre de base que empieza por izao_restore_
  #  - nunca el mismo host/puerto/base que DATABASE_URL
  [ "$CONFIRMO" -eq 1 ] || { echo "RECHAZADO: falta --confirmo-base-temporal." >&2; exit 3; }
  parse_pg_url "$TARGET" || { echo "RECHAZADO: la URL de destino no es válida." >&2; exit 3; }
  case "$U_HOST" in
    localhost|127.0.0.1|::1) ;;
    *) echo "RECHAZADO: el destino debe ser localhost o 127.0.0.1." >&2; exit 3 ;;
  esac
  case "$U_DB" in
    izao_restore_?*) ;;
    *) echo "RECHAZADO: el nombre de la base debe empezar por izao_restore_." >&2; exit 3 ;;
  esac
  DEST_ID="$U_HOST:$U_PORT/$U_DB"
  if [ -n "${DATABASE_URL:-}" ] && parse_pg_url "$DATABASE_URL" && [ "$U_HOST:$U_PORT/$U_DB" = "$DEST_ID" ]; then
    echo "RECHAZADO: el destino coincide con DATABASE_URL." >&2; exit 3
  fi
  export PGURL="$TARGET"
  pg_run psql -X -q -c "$ROLES_SQL"
  pg_run psql -X -q -c "$EXT_SQL"
  pg_run psql -X -q -c "drop schema if exists public cascade"
  descifrar "$ARCHIVO" | gunzip | pg_run psql -X -q -v ON_ERROR_STOP=1 >/dev/null
  log "Restauración completada en la base temporal indicada"
  if [ -n "$COUNTS" ]; then table_counts "$SCHEMAS" > "$COUNTS"; fi
  table_counts "$SCHEMAS"
  exit 0
fi

NOMBRE="izao-restore-$$"
cleanup() { if [ "$KEEP" -ne 1 ]; then docker rm -f "$NOMBRE" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
docker run -d --name "$NOMBRE" -e POSTGRES_PASSWORD=temporal postgres:17 >/dev/null
for _ in $(seq 1 40); do [ "$(docker logs "$NOMBRE" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break; sleep 1; done
sleep 2
dpsql() { docker exec -i "$NOMBRE" psql -X -q -U postgres -d postgres "$@"; }
dpsql -c "$ROLES_SQL"
dpsql -c "$EXT_SQL"
# El dump trae CREATE SCHEMA public: se parte de una base vacía (solo es seguro en la base temporal).
dpsql -c "drop schema if exists public cascade"
descifrar "$ARCHIVO" | gunzip | dpsql -v ON_ERROR_STOP=1 >/dev/null
log "Restauración completada en $NOMBRE"
CUENTAS="$(dpsql -At -c "select format('select %L, count(*) from %I.%I', schemaname||'.'||tablename, schemaname, tablename) from pg_tables where schemaname = any(string_to_array('${SCHEMAS// /,}', ',')) order by 1" \
  | { grep . || true; } | while read -r q; do dpsql -At -F ' ' -c "$q" </dev/null; done | tr '|' ' ' | sort)"
echo "$CUENTAS"
if [ -n "$COUNTS" ]; then echo "$CUENTAS" > "$COUNTS"; fi
if [ "$KEEP" -eq 1 ]; then log "Contenedor temporal conservado: $NOMBRE (bórralo con: docker rm -f $NOMBRE)"; fi
exit 0
