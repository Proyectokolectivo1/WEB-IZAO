#!/usr/bin/env bash
# Prueba local: Postgres 17 temporal con datos de ejemplo -> backup.sh -> restore.sh -> compara conteos.
# No usa Supabase. Credenciales de prueba desechables, solo dentro de contenedores efímeros.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export MSYS_NO_PATHCONV=1
RED="izao-bk-net-$$"; SRC="izao-bk-src-$$"
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$SRC" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$RED" >/dev/null
docker run -d --name "$SRC" --network "$RED" -e POSTGRES_PASSWORD=prueba postgres:17 >/dev/null
for _ in $(seq 1 40); do [ "$(docker logs "$SRC" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break; sleep 1; done
sleep 2
docker exec -i "$SRC" psql -q -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.products (id serial primary key, name text, price_cop bigint);
create table public.orders (id serial primary key, user_id uuid references auth.users(id), total bigint);
insert into auth.users(email) select 'u'||g||'@ejemplo.test' from generate_series(1,25) g;
insert into public.products(name, price_cop) select 'Producto '||g, g*1000 from generate_series(1,400) g;
insert into public.orders(user_id,total) select id, 50000 from auth.users;
SQL
mkdir -p "$TMP/media/p1"
echo imagen > "$TMP/media/p1/a.webp"
export DATABASE_URL="postgres://postgres:prueba@$SRC:5432/postgres" PG_DOCKER_NETWORK="$RED"
export PG_FORCE_DOCKER=1
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
