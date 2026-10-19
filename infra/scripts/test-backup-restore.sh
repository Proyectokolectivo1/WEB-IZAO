#!/usr/bin/env bash
# Prueba local (criterio F0 "backup restaurado en prueba"): Postgres 17 temporal con las migraciones
# y el seed REALES de packages/db -> backup.sh -> restore.sh -> compara conteos.
# No usa Supabase. Credenciales de prueba desechables, solo dentro de contenedores efímeros.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export MSYS_NO_PATHCONV=1
DB_DIR="$(cd ../../packages/db/supabase && pwd)"
RED="izao-bk-net"; SRC="izao-bk-src"
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$SRC" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$RED" >/dev/null
docker run -d --name "$SRC" --network "$RED" -e POSTGRES_PASSWORD=prueba postgres:17 >/dev/null
for _ in $(seq 1 40); do [ "$(docker logs "$SRC" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break; sleep 1; done
sleep 2
sql() { docker exec -i "$SRC" psql -q -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "--- origen: simulación mínima de Supabase + migraciones y seed reales"
sql <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_admin nologin;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text);
create table auth.refresh_tokens (id bigserial primary key, token text, user_id uuid);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.flow_state (id uuid primary key default gen_random_uuid(), auth_code text);
create table auth.one_time_tokens (id uuid primary key default gen_random_uuid(), token_hash text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, secret text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table storage.buckets (id text primary key, name text);
SQL
# pgtap no viene en la imagen oficial; solo se usa para pruebas del esquema.
for f in "$DB_DIR"/migrations/*.sql; do grep -vi 'pgtap' "$f" | sql >/dev/null; done
sql < "$DB_DIR/seed.sql" >/dev/null
sql <<'SQL'
insert into auth.users(email, encrypted_password) select 'u'||g||'@ejemplo.test', 'hash'||g from generate_series(1,25) g;
insert into auth.refresh_tokens(token, user_id) select 'tok'||g, id from (select id, row_number() over () g from auth.users) s;
insert into auth.sessions(user_id) select id from auth.users;
insert into auth.flow_state(auth_code) values ('codigo');
insert into auth.one_time_tokens(token_hash) values ('hash');
insert into auth.mfa_factors(user_id, secret) select id, 's' from auth.users limit 3;
insert into storage.buckets values ('media','media');
SQL

mkdir -p "$TMP/media/p1"
echo imagen > "$TMP/media/p1/a.webp"
export DATABASE_URL="postgres://postgres:prueba@$SRC:5432/postgres" PG_DOCKER_NETWORK="$RED" PG_FORCE_DOCKER=1
export BACKUP_DIR="$TMP/backups" MEDIA_ROOT="$TMP/media"

echo "--- backup"
./backup.sh --no-s3
FILE="$BACKUP_DIR/db/$(date +%F).sql.gz"
ls -l "$FILE" "$BACKUP_DIR"/media/
echo "--- conteos origen"
export PGURL="$DATABASE_URL"
source ./lib.sh
table_counts "public auth storage" | tee "$TMP/origen.txt"
echo "--- restore (contenedor temporal)"
unset PG_DOCKER_NETWORK
./restore.sh "$FILE" --counts "$TMP/restaurado.txt" >/dev/null
diff "$TMP/origen.txt" "$TMP/restaurado.txt" && echo "CONTEOS IGUALES"
echo "--- el restore rechaza Supabase"
if ./restore.sh "$FILE" --target-url "postgres://x:y@db.example.supabase.co:5432/postgres" 2>&1; then
  echo "ERROR: no rechazó"; exit 1
fi
echo "--- keepalive y alertas"
export PG_DOCKER_NETWORK="$RED"
./keepalive.sh
DISK_PATH="$TMP" ./check-alerts.sh
echo "--- retención: un archivo viejo se borra"
touch -d "20 days ago" "$BACKUP_DIR/db/2000-01-01.sql.gz"
./backup.sh --db-only --no-s3 >/dev/null
if [ ! -f "$BACKUP_DIR/db/2000-01-01.sql.gz" ]; then echo "RETENCION OK"; fi
echo "PRUEBA COMPLETA OK"
