#!/usr/bin/env bash
# Listado de media huérfana (solo lectura). Ejecuta media-huerfanos.mjs dentro del contenedor del worker (uid 100,
# único con acceso a /srv/izao/media y con las credenciales de la base). No borra nada.
set -euo pipefail
CONTENEDOR="${WORKER_CONTAINER:-izao-worker-1}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker exec -i "$CONTENEDOR" node --input-type=module - < "$DIR/media-huerfanos.mjs"
