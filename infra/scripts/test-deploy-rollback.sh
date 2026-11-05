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
echo "git $*" >> "$STUB_DIR/calls.log"
case "$1" in
  rev-parse)
    # Antes del merge: aaa1111; después: bbb2222. Con --short el sha corto; sin él, el completo.
    if [ -f "$STUB_DIR/merged" ]; then c=bbb2222; else c=aaa1111; fi
    if [ "$2" = "--short" ]; then echo "$c"; else echo "${c}0000"; fi ;;
  merge) touch "$STUB_DIR/merged" ;;
  diff)
    # STUB_MIG_CHANGED: siempre hay migraciones nuevas. STUB_MIG_BASE: solo si el diff parte de ese commit.
    if [ -n "${STUB_MIG_CHANGED:-}" ] || [ "$3" = "${STUB_MIG_BASE:-sin-base}" ]; then
      echo "packages/db/supabase/migrations/20261101000000_nueva.sql"
    fi ;;
  reset) [ "$3" = "aaa11110000" ] && rm -f "$STUB_DIR/merged" || true ;;
  *) ;;
esac
EOF
cat > "$T/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
[ -z "${STUB_PNPM_FAIL:-}" ]
EOF
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls.log"
[ -z "${STUB_CURL_FAIL:-}" ]
EOF
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "TAG=${IZAO_TAG:-} docker $*" >> "$STUB_DIR/calls.log"
if [[ " $* " == *" ps -q web"* ]]; then echo "${STUB_RUNNING_TAG:+cid-web-1}"; exit 0; fi
if [ "$1" = "inspect" ]; then echo "izao-web:${STUB_RUNNING_TAG}"; exit 0; fi
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
  ULTIMO_OK_FILE="$STUB_DIR/ultimo-ok"
  [ -n "${SEMILLA_OK:-}" ] && echo "$SEMILLA_OK" > "$ULTIMO_OK_FILE"
  env "$@" PATH="$T/bin:$PATH" STUB_DIR="$STUB_DIR" ULTIMO_OK="$ULTIMO_OK_FILE" STUB_RUNNING_TAG="${RUNNING_TAG:-}" DEPLOY_LOG="$T/deploys.log" FALLO_LOG="$T/fallo.log" HEALTH_URL=http://127.0.0.1:1/x \
    bash "$T/repo/infra/scripts/deploy.sh" --skip-tests ${EXTRA_ARGS:-} > "$STUB_DIR/salida.txt" 2>&1 || rc=$?
  local rb; rb="$(grep -E "^TAG=${RB_TAG:-aaa1111} docker compose .* up " "$STUB_DIR/calls.log" 2>/dev/null || true)"
  local ok=1
  case "$esperado" in
    rollback)
      [ "$rc" -ne 0 ] || ok=0
      grep -q -- '--no-build' <<<"$rb" || ok=0
      grep -q -- '--no-deps' <<<"$rb" || ok=0
      # El código vuelve al commit anterior y ultimo-ok conserva el tag sano
      grep -q "^git reset --keep aaa11110000" "$STUB_DIR/calls.log" || ok=0
      [ "$(cut -d" " -f1 "$ULTIMO_OK_FILE")" = "${RB_TAG:-aaa1111}" ] || ok=0 ;;
    sinimagen)
      [ "$rc" -ne 0 ] || ok=0
      [ -z "$rb" ] || ok=0
      grep -q 'no existe la imagen' "$STUB_DIR/salida.txt" || ok=0 ;;
    ok)
      [ "$rc" -eq 0 ] || ok=0
      [ -z "$rb" ] || ok=0
      [ "$(cut -d" " -f1 "$ULTIMO_OK_FILE" 2>/dev/null)" = "bbb2222" ] || ok=0 ;;
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
escenario "despliegue sano: no revierte y guarda ultimo-ok" ok
# HEAD quedó en un commit malo tras un despliegue fallido: el rollback usa ultimo-ok, no git
SEMILLA_OK=good111 RB_TAG=good111 escenario "rollback usa ultimo-ok y devuelve git al commit anterior" rollback STUB_UP_FAIL=1
# Sin ultimo-ok: usa el tag de la imagen del contenedor web vivo
RUNNING_TAG=run5555 RB_TAG=run5555 escenario "rollback usa el tag del contenedor vivo" rollback STUB_CURL_FAIL=1
escenario "migraciones nuevas sin confirmar: aborta antes de construir" abortamig STUB_MIG_CHANGED=1
EXTRA_ARGS="--migraciones-verificadas" escenario "migraciones nuevas confirmadas a mano: continúa" ok STUB_MIG_CHANGED=1

# --- Dos despliegues seguidos: el 1.º trae una migración y falla en pnpm (tras avanzar git);
#     el 2.º debe seguir exigiendo --migraciones-verificadas (el diff parte del último despliegue sano).
echo "--- escenario: despliegue fallido antes del paso 5 no oculta migraciones al siguiente"
export STUB_DIR="$T/s2"; rm -rf "$STUB_DIR"; mkdir -p "$STUB_DIR"
echo "good111 aaa11110000" > "$STUB_DIR/ultimo-ok"
correr() { env STUB_MIG_BASE=aaa11110000 PATH="$T/bin:$PATH" STUB_DIR="$STUB_DIR" ULTIMO_OK="$STUB_DIR/ultimo-ok" DEPLOY_LOG="$T/deploys.log" FALLO_LOG="$T/fallo.log" HEALTH_URL=http://127.0.0.1:1/x "$@" bash "$T/repo/infra/scripts/deploy.sh" ${ARGS:-} > "$STUB_DIR/salida.txt" 2>&1; }
rc1=0; ARGS="--migraciones-verificadas" correr STUB_PNPM_FAIL=1 || rc1=$?
rc2=0; ARGS="" correr STUB_X=1 || rc2=$?
if [ "$rc1" -ne 0 ] && [ "$rc2" -ne 0 ] && grep -q 'list_migrations' "$STUB_DIR/salida.txt"; then
  echo "OK   el 2.º despliegue sigue exigiendo --migraciones-verificadas"
else
  echo "FALLA 2.º despliegue no exigió verificar migraciones (rc1=$rc1 rc2=$rc2)"; sed 's/^/     /' "$STUB_DIR/salida.txt" | tail -8; FALLOS=$((FALLOS+1))
fi
rc3=0; ARGS="--skip-tests --migraciones-verificadas" correr STUB_X=1 || rc3=$?
if [ "$rc3" -eq 0 ] && [ "$(cut -d' ' -f1 "$STUB_DIR/ultimo-ok")" = "bbb2222" ] && [ "$(cut -d' ' -f2 "$STUB_DIR/ultimo-ok")" = "bbb22220000" ]; then echo "OK   con la bandera continúa y ultimo-ok guarda tag y commit"; else echo "FALLA 3.º despliegue (rc=$rc3): $(cat "$STUB_DIR/ultimo-ok")"; FALLOS=$((FALLOS+1)); fi

[ "$FALLOS" -eq 0 ] && echo "DEPLOY ROLLBACK OK" || { echo "DEPLOY ROLLBACK CON $FALLOS FALLOS"; exit 1; }
