#!/usr/bin/env bash
# Prueba de concurrencia real contra un postgres:17 desechable (ver README.md). No toca ninguna base remota.
set -euo pipefail
cd "$(dirname "$0")"
N="${N:-10}"                      # conexiones paralelas (2 a 10)
IMG="${IMG:-postgres:17-alpine}"
NAME="izao-concurrencia-$$"
MIG="../../supabase/migrations"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x "$IMG" >/dev/null
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
psqlc() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

psqlc < 00_roles_supabase.sql
for f in "$MIG"/*.sql; do
  # postgres:17 no trae pgTAP: solo se omite esa extensión; el resto de la migración es la real
  grep -v 'create extension if not exists pgtap' "$f" | psqlc >/dev/null
done
psqlc < 01_datos.sql

# Barrera: el proceso 'maestro' retiene un lock exclusivo; los N trabajadores se conectan y esperan el lock compartido,
# y se liberan todos a la vez cuando el maestro termina.
docker exec "$NAME" sh -c "psql -U postgres -q -X -c \"select pg_advisory_lock(42); select pg_sleep(4);\" >/dev/null" &
sleep 1
OUT="$(mktemp -d)"
for i in $(seq 1 "$N"); do
  ID="d0000000-0000-0000-0000-0000000001$(printf '%02d' "$i")"
  docker exec -i "$NAME" psql -U postgres -At -X -v ON_ERROR_STOP=1 -c "
    select pg_advisory_lock_shared(42);
    select 'stock:' || ((public.reservar_stock('$ID'))->>'ok');
    select 'canje:' || ((public.reservar_canje('$ID'))->>'ok');" > "$OUT/$i.txt" 2>&1 &
done
wait

echo "--- resultados por conexión ---"; cat "$OUT"/*.txt | grep -E 'stock:|canje:' | sort | uniq -c
GANA_STOCK=$(grep -h 'stock:true' "$OUT"/*.txt | wc -l)
GANA_CANJE=$(grep -h 'canje:true' "$OUT"/*.txt | wc -l)
read -r STOCK RES USO < <(psqlc -At -F ' ' -c "select vc.stock, vc.stock_reserved, (select usage_count from public.discount_codes where code='CONCURRENCIA') from public.variant_countries vc")
RESERVADOS=$(psqlc -At -c "select count(*) from public.orders where stock_state='reserved'")
FILAS=$(psqlc -At -c "select count(*) from public.discount_redemptions where status='reserved'")
echo "ganadores de stock=$GANA_STOCK (esperado 1) · stock=$STOCK stock_reserved=$RES pedidos reservados=$RESERVADOS"
echo "ganadores de canje=$GANA_CANJE (esperado $(( N < 3 ? N : 3 ))) · usage_count=$USO canjes reservados=$FILAS"
FALLA=0
[ "$GANA_STOCK" -eq 1 ] && [ "$RES" -le "$STOCK" ] && [ "$RES" -eq 1 ] && [ "$RESERVADOS" -eq 1 ] || { echo "FALLA: stock"; FALLA=1; }
ESP=$(( N < 3 ? N : 3 ))
[ "$GANA_CANJE" -eq "$ESP" ] && [ "$USO" -eq "$ESP" ] && [ "$FILAS" -eq "$ESP" ] || { echo "FALLA: canje"; FALLA=1; }
[ "$FALLA" -eq 0 ] && echo "OK: concurrencia exacta" || exit 1
