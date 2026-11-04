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
create schema storage;
create table storage.buckets (id text primary key, name text);
SQL
sql < "$(dirname "${BASH_SOURCE[0]}")/fixtures/auth-gotrue-schema.sql" >/dev/null
# pgtap no viene en la imagen oficial; solo se usa para pruebas del esquema.
for f in "$DB_DIR"/migrations/*.sql; do grep -vi 'pgtap' "$f" | sql >/dev/null; done
sql < "$DB_DIR/seed.sql" >/dev/null
sql <<'SQL'
insert into auth.schema_migrations values ('20171026211738'), ('20171026211808'), ('20171026211834');
insert into auth.users(email, encrypted_password) select 'u'||g||'@ejemplo.test', 'hash'||g from generate_series(1,25) g;
insert into auth.identities(provider_id, user_id, identity_data, provider) select id::text, id, jsonb_build_object('email', email), 'email' from auth.users;
insert into auth.sessions(id, user_id, created_at) select gen_random_uuid(), id, now() from auth.users;
insert into auth.refresh_tokens(token, user_id, session_id) select 'tok'||row_number() over (), user_id, id from auth.sessions;
insert into auth.mfa_amr_claims(session_id, created_at, updated_at, authentication_method, id) select id, now(), now(), 'password', gen_random_uuid() from auth.sessions;
insert into auth.mfa_factors(id, user_id, factor_type, status, secret) select gen_random_uuid(), id, 'totp', 'verified', 's' from auth.users limit 3;
insert into auth.mfa_challenges(id, factor_id, ip_address) select gen_random_uuid(), id, '127.0.0.1' from auth.mfa_factors;
insert into auth.flow_state(id, auth_code, code_challenge_method, code_challenge, provider_type) values ('00000000-0000-0000-0000-000000000001', 'codigo', 's256', 'x', 'email');
insert into auth.sso_providers(id) values ('00000000-0000-0000-0000-000000000002');
insert into auth.saml_relay_states(id, sso_provider_id, request_id, flow_state_id) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000002', 'r', '00000000-0000-0000-0000-000000000001');
insert into auth.one_time_tokens(id, user_id, token_type, token_hash, relates_to) select gen_random_uuid(), id, 'recovery_token', 'h'||id, email from auth.users;
insert into auth.audit_log_entries(id, payload) select gen_random_uuid(), '{}' from generate_series(1,5);
insert into storage.buckets values ('media','media');
SQL

mkdir -p "$TMP/media/p1"
echo imagen > "$TMP/media/p1/a.webp"
export DATABASE_URL="postgres://postgres:prueba@$SRC:5432/postgres" PG_DOCKER_NETWORK="$RED" PG_FORCE_DOCKER=1
export BACKUP_DIR="$TMP/backups" MEDIA_ROOT="$TMP/media"

# Llave de prueba (solo en este directorio temporal; la privada real nunca está en el VPS).
export GNUPGHOME="$TMP/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME" || true
gpg --batch --quiet --passphrase '' --quick-generate-key "izao-prueba <prueba@ejemplo.test>" default default never 2>/dev/null
export BACKUP_GPG_RECIPIENT="prueba@ejemplo.test"

# Espía de docker: registra los argumentos para comprobar que la contraseña no viaja en ellos.
REAL_DOCKER="$(command -v docker)"
mkdir -p "$TMP/shim"
printf '#!/usr/bin/env bash
echo "$*" >> "%s/docker-args.log"
exec "%s" "$@"
' "$TMP" "$REAL_DOCKER" > "$TMP/shim/docker"
chmod +x "$TMP/shim/docker"

echo "--- backup sin llave pública configurada: debe negarse"
if env -u BACKUP_GPG_RECIPIENT ./backup.sh --db-only --no-s3 >/dev/null 2>&1; then echo "FALLA: hizo backup sin cifrar"; exit 1; else echo "OK   se niega a respaldar sin cifrado"; fi
echo "--- backup"
PATH="$TMP/shim:$PATH" ./backup.sh --no-s3
FILE="$BACKUP_DIR/db/$(date +%F).sql.gz.gpg"
ls -l "$FILE" "$BACKUP_DIR"/media/
if gzip -t "$FILE" 2>/dev/null; then echo "FALLA: el dump no está cifrado"; exit 1; else echo "OK   el dump está cifrado"; fi
if grep -q "prueba" "$TMP/docker-args.log"; then echo "FALLA: la contraseña viaja en los argumentos"; exit 1; else echo "OK   la contraseña no va en argumentos"; fi
echo "--- permisos reales en Linux (el disco de Windows no los aplica): backup dentro de un contenedor"
SCRIPTS_WIN="$(pwd -W 2>/dev/null || pwd)"
docker run --rm --network "$RED" -v "$SCRIPTS_WIN:/s:ro" -e DATABASE_URL -e BACKUP_DIR=/b -e MEDIA_ROOT=/m postgres:17 bash -ec '
  export GNUPGHOME=/root/g; mkdir -p -m 700 $GNUPGHOME /m; echo x > /m/a
  gpg --batch --quiet --passphrase "" --quick-generate-key "p <p@ejemplo.test>" default default never 2>/dev/null
  export BACKUP_GPG_RECIPIENT=p@ejemplo.test
  bash /s/backup.sh --no-s3 >/dev/null
  echo "modos: $(stat -c %a /b) $(stat -c %a /b/db) $(stat -c %a /b/media) $(stat -c %a /b/db/*.gpg) $(stat -c %a /b/media/*.tar.gz)"
' | tee "$TMP/modos.txt"
if grep -q "modos: 700 700 700 600 600" "$TMP/modos.txt"; then echo "OK   permisos 700 (carpetas) y 600 (archivos)"; else echo "FALLA permisos"; exit 1; fi
echo "--- conteos origen"
export PGURL="$DATABASE_URL"
source ./lib.sh
table_counts "public auth storage" | tee "$TMP/origen.txt"
echo "--- restore (contenedor temporal)"
unset PG_DOCKER_NETWORK
./restore.sh "$FILE" --counts "$TMP/restaurado.txt" >/dev/null
# Solo se respaldan los datos de auth.users, auth.identities, auth.mfa_factors y auth.schema_migrations;
# el resto de auth.* (sesiones, tokens, desafíos, auditoría...) debe quedar vacío tras restaurar.
awk '$1 ~ /^auth\./ && $1 !~ /^auth\.(users|identities|mfa_factors|schema_migrations)$/ {print $1, 0; next} {print}' "$TMP/origen.txt" > "$TMP/esperado.txt"
grep -E '^auth\.refresh_tokens [1-9]' "$TMP/origen.txt" >/dev/null || { echo "FALLA: el origen no tenía tokens de prueba"; exit 1; }
diff "$TMP/esperado.txt" "$TMP/restaurado.txt" || { echo "FALLA: los conteos difieren"; exit 1; }
echo "CONTEOS IGUALES (solo users, identities, mfa_factors y schema_migrations conservan filas)"
echo "--- el restore rechaza Supabase"
if ./restore.sh "$FILE" --target-url "postgres://x:y@db.example.supabase.co:5432/postgres" --confirmo-base-temporal 2>&1; then
  echo "ERROR: no rechazó"; exit 1
fi
echo "--- keepalive y alertas"
export PG_DOCKER_NETWORK="$RED"
./keepalive.sh
DISK_PATH="$TMP" ./check-alerts.sh
echo "--- retención: un archivo viejo se borra"
touch -d "20 days ago" "$BACKUP_DIR/db/2000-01-01.sql.gz.gpg"
./backup.sh --db-only --no-s3 >/dev/null
if [ -f "$BACKUP_DIR/db/2000-01-01.sql.gz.gpg" ]; then echo "FALLA: la retención no borró el archivo viejo"; exit 1; fi
echo "OK   retención de 14 días"
echo "PRUEBA COMPLETA OK"
