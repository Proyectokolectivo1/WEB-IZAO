#!/usr/bin/env bash
# Prueba de la lista blanca de restore.sh --target-url: debe rechazar todo lo que no sea una base
# temporal local (izao_restore_*) con confirmación explícita, y aceptar el caso válido.
# Uso: bash infra/scripts/test-restore-guard.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export MSYS_NO_PATHCONV=1
TMP="$(mktemp -d)"
TGT="izao-guard-tgt"
cleanup() { docker rm -f "$TGT" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
printf 'create schema public;\ncreate table public.t(a int);\ninsert into public.t values (1),(2),(3);\n' | gzip > "$TMP/mini.sql.gz"

FALLOS=0
rechaza() { # descripción, URL, DATABASE_URL, [bandera]
  local desc="$1" url="$2" dburl="$3" flag="${4:---confirmo-base-temporal}" rc=0 out
  out="$(DATABASE_URL="$dburl" PG_FORCE_DOCKER=1 timeout 60 ./restore.sh "$TMP/mini.sql.gz" --target-url "$url" $flag 2>&1)" || rc=$?
  if [ "$rc" -eq 3 ] && grep -q RECHAZADO <<<"$out"; then echo "OK   rechaza: $desc"; else echo "FALLA no rechazó ($rc): $desc"; FALLOS=$((FALLOS+1)); fi
}

rechaza "host Supabase en mayúsculas" "POSTGRES://u:p@DB.ABCDEF.SUPABASE.CO:5432/izao_restore_x" ""
rechaza "alias del pooler" "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/izao_restore_x" ""
rechaza "IP literal remota" "postgres://u:p@3.3.3.3:5432/izao_restore_x" ""
rechaza "localhost sin la bandera de confirmación" "postgres://u:p@localhost:5432/izao_restore_x" "" " "
rechaza "localhost con base que no es izao_restore_*" "postgres://u:p@localhost:5432/postgres" ""
rechaza "mismo destino que DATABASE_URL (con ?sslmode)" "postgres://u:p@LOCALHOST:5432/izao_restore_x" "postgres://u:p@localhost:5432/izao_restore_x?sslmode=require"
rechaza "URL inválida" "mysql://u:p@localhost/izao_restore_x" ""

echo "--- caso válido: base temporal local"
docker run -d --name "$TGT" -e POSTGRES_PASSWORD=prueba postgres:17 >/dev/null
for _ in $(seq 1 40); do [ "$(docker logs "$TGT" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break; sleep 1; done
sleep 2
docker exec "$TGT" psql -q -U postgres -c "create database izao_restore_ok"
# El cliente comparte la red del contenedor: "127.0.0.1" apunta a la base temporal.
SALIDA="$(PG_FORCE_DOCKER=1 PG_DOCKER_NETWORK="container:$TGT" DATABASE_URL="postgres://x:y@db.ejemplo.supabase.co:5432/postgres" \
  ./restore.sh "$TMP/mini.sql.gz" --target-url "postgres://postgres:prueba@127.0.0.1:5432/izao_restore_ok" --confirmo-base-temporal 2>&1)" || { echo "$SALIDA"; echo "FALLA caso válido"; FALLOS=$((FALLOS+1)); }
if grep -q "public.t 3" <<<"$SALIDA"; then echo "OK   restauró y contó public.t = 3"; else echo "$SALIDA"; echo "FALLA conteo del caso válido"; FALLOS=$((FALLOS+1)); fi

echo "--- parse_pg_url con caracteres especiales"
source ./lib.sh
parse_pg_url "postgres://u%40x:p%3Aa%2Fb%40c@HOST.Example:6543/db%20n?sslmode=require"
if [ "$U_USER|$U_PASS|$U_HOST|$U_PORT|$U_DB|$U_QUERY" = "u@x|p:a/b@c|host.example|6543|db n|sslmode=require" ]; then echo "OK   parse_pg_url"; else echo "FALLA parse_pg_url"; FALLOS=$((FALLOS+1)); fi

echo "--- variables de entorno de libpq que evadirían la lista blanca"
mkdir -p "$TMP/shim"
cat > "$TMP/shim/psql" <<'SH'
#!/usr/bin/env bash
echo "PGSERVICE=[${PGSERVICE-}] PGHOSTADDR=[${PGHOSTADDR-}] PGOPTIONS=[${PGOPTIONS-}] PGSERVICEFILE=[${PGSERVICEFILE-}] PGPASSFILE=[${PGPASSFILE-}] PGHOST=[${PGHOST-}]" > "$SHIM_SALIDA"
SH
chmod +x "$TMP/shim/psql"
(
  export SHIM_SALIDA="$TMP/entorno.txt" PATH="$TMP/shim:$PATH"
  export PGSERVICE=malicioso PGHOSTADDR=3.3.3.3 PGOPTIONS="-c search_path=x" PGSERVICEFILE=/tmp/svc PGPASSFILE=/tmp/pw
  unset PG_FORCE_DOCKER
  PGURL="postgres://u:p@127.0.0.1:5432/izao_restore_x"
  source ./lib.sh
  pg_run psql -c "select 1"
)
if grep -q "PGSERVICE=\[\] PGHOSTADDR=\[\] PGOPTIONS=\[\] PGSERVICEFILE=\[/dev/null\] PGPASSFILE=\[\] PGHOST=\[127.0.0.1\]" "$TMP/entorno.txt"; then echo "OK   pg_run limpia PGSERVICE/PGHOSTADDR/PGOPTIONS/PGPASSFILE y fija PGSERVICEFILE=/dev/null"; else echo "FALLA entorno de pg_run: $(cat "$TMP/entorno.txt")"; FALLOS=$((FALLOS+1)); fi

[ "$FALLOS" -eq 0 ] && echo "GUARDA OK" || { echo "GUARDA CON $FALLOS FALLOS"; exit 1; }
