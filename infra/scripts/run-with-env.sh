#!/usr/bin/env bash
# Ejecuta un comando con las variables de infra/.env cargadas SIN interpretarlas con el shell:
# cada línea CLAVE=VALOR se toma literalmente (una contraseña con $ & ; espacios o `comillas`
# no ejecuta nada ni se parte). Se ignoran líneas vacías y comentarios; si el valor está
# entre comillas simples o dobles, se quitan las exteriores. Todo valor con $, # o espacios debe
# ir entre comillas simples (Compose y este lector coinciden); si no, avisa por stderr. Uso:
#   infra/scripts/run-with-env.sh comando [args...]        (archivo: ENV_FILE o infra/.env)
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(dirname "${BASH_SOURCE[0]}")/../.env}"
[ -f "$ENV_FILE" ] || { echo "No existe $ENV_FILE" >&2; exit 1; }
[ $# -gt 0 ] || { echo "Uso: run-with-env.sh comando [args...]" >&2; exit 2; }

n=0
while IFS= read -r linea || [ -n "$linea" ]; do
  n=$((n+1))
  linea="${linea%$'\r'}"
  [[ "$linea" =~ ^[[:space:]]*(#|$) ]] && continue
  if [[ "$linea" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    clave="${BASH_REMATCH[2]}"; valor="${BASH_REMATCH[3]}"
    # Docker Compose lee el mismo .env distinto si el valor tiene $, # o espacios sin comillas
    # simples (interpola $, trata " #" como comentario). Se avisa por stderr SIN imprimir el valor.
    if [[ "$valor" =~ ^\'(.*)\'$ ]]; then
      valor="${BASH_REMATCH[1]}"
    elif [[ "$valor" =~ ^\"(.*)\"$ ]]; then
      valor="${BASH_REMATCH[1]}"
      if [[ "$valor" == *'$'* ]]; then
        echo "AVISO: $ENV_FILE línea $n, $clave: comillas dobles con un signo de dólar (Compose lo interpola; usa comillas simples)" >&2
      fi
    elif [[ "$valor" == *'$'* || "$valor" == *' #'* || "$valor" =~ [[:space:]] ]]; then
      echo "AVISO: $ENV_FILE línea $n, $clave: valor sin comillas con dólar, ' #' o espacios (Compose y este lector lo interpretan distinto; usa comillas simples)" >&2
    fi
    export "$clave=$valor"
  else
    echo "Línea ignorada en $ENV_FILE (formato no válido)" >&2
  fi
done < "$ENV_FILE"

exec "$@"
