#!/usr/bin/env bash
# Prueba de deploy.sh con git/pnpm/docker/curl simulados: si falla la actualización o el
# healthcheck debe revertir a la imagen anterior SIN construir (--no-build), y si la imagen
# anterior no existe debe avisar y no tocar nada más.
# Uso: bash infra/scripts/test-deploy-rollback.sh
set -euo pipefail
ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"
mkdir -p "$T/repo/infra/scripts" "$T/bin"
cp "$ORIGEN/deploy.sh" "$ORIGEN/lib.sh" "$T/repo/infra/scripts/"
: > "$T/repo/infra/.env"
: > "$T/repo/infra/docker-compose.yml"

cat > "$T/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  rev-parse)
    n=$(cat "$STUB_DIR/git.n" 2>/dev/null || echo 0)
    # Antes del merge: aaa1111; después: bbb2222.
    if [ -f "$STUB_DIR/merged" ]; then echo bbb2222; else echo aaa1111; fi ;;
  merge) touch "$STUB_DIR/merged" ;;
  diff) [ -n "${STUB_MIG_CHANGED:-}" ] && echo "packages/db/supabase/migrations/20261101000000_nueva.sql" || true ;;
  *) ;;
esac
EOF
cat > "$T/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls.log"
[ -z "${STUB_CURL_FAIL:-}" ]
EOF
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "TAG=${IZAO_TAG:-} docker $*" >> "$STUB_DIR/calls.log"
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then [ -z "${STUB_NO_PREV_IMAGE:-}" ]; exit $?; fi
if [[ " $* " == *" up "* ]] && [ -n "${STUB_UP_FAIL:-}" ] && [ "${IZAO_TAG:-}" = "bbb2222" ]; then exit 1; fi
exit 0
EOF
chmod +x "$T"/bin/*

FALLOS=0
escenario() { # nombre, esperado: rollback|sinimagen|ok|abortamig, variables... (EXTRA_ARGS opcional)
  local nombre="$1" esperado="$2"; shift 2
  export STUB_DIR="$T/s"; rm -rf "$STUB_DIR"; mkdir -p "$STUB_DIR"
  local rc=0
  env "$@" PATH="$T/bin:$PATH" STUB_DIR="$STUB_DIR" DEPLOY_LOG="$T/deploys.log" HEALTH_URL=http://127.0.0.1:1/x \
    bash "$T/repo/infra/scripts/deploy.sh" --skip-tests ${EXTRA_ARGS:-} > "$STUB_DIR/salida.txt" 2>&1 || rc=$?
  local rb; rb="$(grep -E '^TAG=aaa1111 docker compose .* up ' "$STUB_DIR/calls.log" 2>/dev/null || true)"
  local ok=1
  case "$esperado" in
    rollback)
      [ "$rc" -ne 0 ] || ok=0
      grep -q -- '--no-build' <<<"$rb" || ok=0
      grep -q -- '--no-deps' <<<"$rb" || ok=0 ;;
    sinimagen)
      [ "$rc" -ne 0 ] || ok=0
      [ -z "$rb" ] || ok=0
      grep -q 'no existe la imagen' "$STUB_DIR/salida.txt" || ok=0 ;;
    ok)
      [ "$rc" -eq 0 ] || ok=0
      [ -z "$rb" ] || ok=0 ;;
    abortamig)
      [ "$rc" -ne 0 ] || ok=0
      grep -q 'list_migrations' "$STUB_DIR/salida.txt" || ok=0
      ! grep -qE 'docker compose .* (build|up) ' "$STUB_DIR/calls.log" 2>/dev/null || ok=0 ;;
  esac
  if [ "$ok" -eq 1 ]; then echo "OK   $nombre"; else echo "FALLA $nombre (código $rc)"; sed 's/^/     /' "$STUB_DIR/calls.log" "$STUB_DIR/salida.txt" | tail -25; FALLOS=$((FALLOS+1)); fi
}

escenario "falla la actualización de web: revierte sin construir" rollback STUB_UP_FAIL=1
escenario "falla el healthcheck: revierte sin construir" rollback STUB_CURL_FAIL=1
escenario "no existe la imagen anterior: avisa y no revierte" sinimagen STUB_CURL_FAIL=1 STUB_NO_PREV_IMAGE=1
escenario "despliegue sano: no revierte" ok
escenario "migraciones nuevas sin confirmar: aborta antes de construir" abortamig STUB_MIG_CHANGED=1
EXTRA_ARGS="--migraciones-verificadas" escenario "migraciones nuevas confirmadas a mano: continúa" ok STUB_MIG_CHANGED=1

[ "$FALLOS" -eq 0 ] && echo "DEPLOY ROLLBACK OK" || { echo "DEPLOY ROLLBACK CON $FALLOS FALLOS"; exit 1; }
