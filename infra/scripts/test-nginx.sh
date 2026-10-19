#!/usr/bin/env bash
# Valida la sintaxis de Nginx (producción y local) en un contenedor desechable.
# Genera certificados autofirmados temporales SOLO dentro del contenedor; no toca nada del host.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../nginx"
RUTA="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1

docker run --rm -v "$RUTA:/cfg:ro" nginx:1.27-alpine sh -ec '
  mkdir -p /etc/nginx/snippets /srv/izao/media /srv/izao/certbot /etc/letsencrypt/live/izaoperfumeria.com
  cp /cfg/snippets/* /etc/nginx/snippets/
  apk add --no-cache openssl >/dev/null
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=izaoperfumeria.com" \
    -keyout /etc/letsencrypt/live/izaoperfumeria.com/privkey.pem \
    -out /etc/letsencrypt/live/izaoperfumeria.com/fullchain.pem 2>/dev/null
  for f in izao.conf izao.local.conf; do
    echo "== $f"
    cp /cfg/$f /etc/nginx/conf.d/default.conf
    # "web" no resuelve fuera de Compose: se sustituye solo para la prueba de sintaxis.
    sed -i "s/server web:3000/server 127.0.0.1:3000/" /etc/nginx/snippets/zones.conf
    nginx -t
  done
'
