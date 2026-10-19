#!/usr/bin/env bash
# Prueba run-with-env.sh: valores con caracteres especiales se cargan literalmente y no se ejecutan.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
T="$(mktemp -d)"
cat > "$T/.env" <<'ENV'
# comentario
PASS_RARA=a b&c;d$(touch PWNED)`touch PWNED2` $HOME
MAIL_FROM="Izao Perfumería <pedidos@izaoperfumeria.com>"
SIMPLE='con espacios'
VACIA=
ENV
fallos=0
salida="$(cd "$T" && ENV_FILE="$T/.env" bash "$OLDPWD/run-with-env.sh" bash -c 'printf "%s|%s|%s|[%s]" "$PASS_RARA" "$MAIL_FROM" "$SIMPLE" "$VACIA"')"
esperado='a b&c;d$(touch PWNED)`touch PWNED2` $HOME|Izao Perfumería <pedidos@izaoperfumeria.com>|con espacios|[]'
if [ "$salida" = "$esperado" ]; then echo "OK   valores cargados literalmente"; else echo "FALLA valores: $salida"; fallos=$((fallos+1)); fi
if [ -e "$T/PWNED" ] || [ -e "$T/PWNED2" ] || [ -e PWNED ] || [ -e PWNED2 ]; then echo "FALLA: se ejecutó texto del .env"; fallos=$((fallos+1)); else echo "OK   no se ejecutó nada"; fi
# Contraste: el método anterior (set -a; . archivo) sí ejecuta el texto
( cd "$T" && bash -c 'set -a; . ./.env' >/dev/null 2>&1 || true )
if [ -e "$T/PWNED" ] || [ -e "$T/PWNED2" ]; then echo "     (contraste: 'source' del mismo .env sí ejecutaba comandos)"; fi
[ "$fallos" -eq 0 ] && echo "RUN-WITH-ENV OK" || exit 1
