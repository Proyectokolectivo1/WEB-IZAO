#!/usr/bin/env bash
# Ejecuta un comando con las variables de infra/.env cargadas SIN interpretarlas con el shell:
# cada línea CLAVE=VALOR se toma literalmente (una contraseña con $ & ; espacios o `comillas`
# no ejecuta nada ni se parte). Se ignoran líneas vacías y comentarios; si el valor está
# entre comillas simples o dobles, se quitan las exteriores. Uso:
#   infra/scripts/run-with-env.sh comando [args...]        (archivo: ENV_FILE o infra/.env)
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(dirname "${BASH_SOURCE[0]}")/../.env}"
[ -f "$ENV_FILE" ] || { echo "No existe $ENV_FILE" >&2; exit 1; }
[ $# -gt 0 ] || { echo "Uso: run-with-env.sh comando [args...]" >&2; exit 2; }

while IFS= read -r linea || [ -n "$linea" ]; do
  linea="${linea%$'\r'}"
  [[ "$linea" =~ ^[[:space:]]*(#|$) ]] && continue
  if [[ "$linea" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    clave="${BASH_REMATCH[2]}"; valor="${BASH_REMATCH[3]}"
    if [[ "$valor" =~ ^\"(.*)\"$ ]] || [[ "$valor" =~ ^\'(.*)\'$ ]]; then valor="${BASH_REMATCH[1]}"; fi
    export "$clave=$valor"
  else
    echo "Línea ignorada en $ENV_FILE (formato no válido)" >&2
  fi
done < "$ENV_FILE"

exec "$@"
