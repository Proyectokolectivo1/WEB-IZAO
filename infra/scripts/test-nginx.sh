#!/usr/bin/env bash
# Valida Nginx en un contenedor desechable: sintaxis (producción y local) y cabeceras de seguridad
# (HSTS en /, /api/*, /api/chat, /api/health y /media/*).
# Genera certificados autofirmados temporales SOLO dentro del contenedor; no toca nada del host.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../nginx"
RUTA="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1

docker run --rm -v "$RUTA:/cfg:ro" nginx:1.27-alpine sh -ec '
  mkdir -p /etc/nginx/snippets /srv/izao/media /srv/izao/certbot /etc/letsencrypt/live/izaoperfumeria.com
  cp /cfg/snippets/* /etc/nginx/snippets/
  echo imagen > /srv/izao/media/a.webp
  apk add --no-cache openssl curl >/dev/null
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=izaoperfumeria.com" \
    -keyout /etc/letsencrypt/live/izaoperfumeria.com/privkey.pem \
    -out /etc/letsencrypt/live/izaoperfumeria.com/fullchain.pem 2>/dev/null
  # "web" no resuelve fuera de Compose: se sustituye solo para la prueba.
  sed -i "s/server web:3000/server 127.0.0.1:3000/" /etc/nginx/snippets/zones.conf

  for f in izao.conf izao.local.conf; do
    echo "== sintaxis $f"
    cp /cfg/$f /etc/nginx/conf.d/default.conf
    nginx -t
  done

  echo "== cabeceras (producción con TLS)"
  cp /cfg/izao.conf /etc/nginx/conf.d/default.conf
  # Backend simulado de la app en 127.0.0.1:3000
  cat > /etc/nginx/conf.d/backend.conf <<CONF
server { listen 127.0.0.1:3000; location / { return 200 ok; } }
CONF
  nginx
  sleep 1
  fallos=0
  for ruta in / /api/productos /api/health /api/chat /media/a.webp; do
    cab="$(curl -sk -D - -o /dev/null -H "Host: izaoperfumeria.com" "https://127.0.0.1$ruta")"
    if echo "$cab" | grep -qi "^strict-transport-security: max-age="; then echo "OK   HSTS en $ruta"; else echo "FALLA sin HSTS en $ruta"; fallos=$((fallos+1)); fi
  done
  cab="$(curl -sk -D - -o /dev/null -H "Host: www.izaoperfumeria.com" "https://127.0.0.1/x")"
  if echo "$cab" | grep -qi "^strict-transport-security: max-age=" && echo "$cab" | grep -qi "^location: https://izaoperfumeria.com/x"; then echo "OK   www -> raíz 301 con HSTS"; else echo "FALLA www"; fallos=$((fallos+1)); fi
  cab="$(curl -s -D - -o /dev/null -H "Host: izaoperfumeria.com" "http://127.0.0.1/algo")"
  if echo "$cab" | grep -qi "^location: https://izaoperfumeria.com/algo"; then echo "OK   http -> https 301"; else echo "FALLA redirección http"; fallos=$((fallos+1)); fi
  [ "$fallos" -eq 0 ] && echo "NGINX OK" || { echo "NGINX CON $fallos FALLOS"; exit 1; }
'
