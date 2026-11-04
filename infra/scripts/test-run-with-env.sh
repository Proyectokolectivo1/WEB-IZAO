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

# Avisos: valores que Compose y run-with-env.sh interpretarían distinto (sin imprimir el valor)
cat > "$T/avisos.env" <<'ENV'
A=pa$$word
B=pa$HOMEx
D=x # comentario
E="con $dolar"
F=con espacios sin comillas
G='con $dolar y # almohadilla'
H=normal
ENV
err="$(ENV_FILE="$T/avisos.env" bash ./run-with-env.sh true 2>&1 >/dev/null)"
for clave in A B D E F; do
  if grep -Eq "línea [0-9]+, $clave:" <<<"$err"; then echo "OK   avisa por $clave"; else echo "FALLA no avisó por $clave"; fallos=$((fallos+1)); fi
done
for clave in G H; do
  if grep -Eq "línea [0-9]+, $clave:" <<<"$err"; then echo "FALLA avisó de más por $clave"; fallos=$((fallos+1)); else echo "OK   no avisa por $clave"; fi
done
if grep -qE 'pa[$]|HOMEx|word|comentario|con espacios sin' <<<"$err"; then echo "FALLA el aviso imprime valores"; fallos=$((fallos+1)); else echo "OK   los avisos no imprimen valores"; fi
[ "$fallos" -eq 0 ] && echo "RUN-WITH-ENV OK" || exit 1
