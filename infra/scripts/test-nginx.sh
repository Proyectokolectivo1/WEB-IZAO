#!/usr/bin/env bash
# Valida Nginx en un contenedor desechable, en tres variantes:
#   1) contenedor local (izao.local.conf + env/container)
#   2) producción en contenedor (izao.conf con TLS + env/container)
#   3) Nginx del HOST tipo Ubuntu (nginx.conf con `gzip on` ya declarado, sites-enabled + conf.d,
#      upstream a 127.0.0.1:3000/3001): izao.conf debe integrarse sin duplicar directivas.
# En 2 y 3 comprueba HSTS en /, /api/*, /api/chat, /api/health y /media/*, y los redireccionamientos.
# Además verifica que izao.conf solo contiene bloques `server` en el nivel superior.
# Genera certificados autofirmados temporales SOLO dentro del contenedor; no toca el host.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../nginx"
RUTA="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1

docker run --rm -i -v "$RUTA:/cfg:ro" nginx:1.27-alpine sh -s <<'INNER'
set -eu
apk add --no-cache openssl curl >/dev/null
mkdir -p /srv/izao/media /srv/izao/certbot /etc/letsencrypt/live/izaoperfumeria.com /etc/nginx/sites-enabled
cp -r /cfg /srv/izao/nginx
echo imagen > /srv/izao/media/a.webp
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=izaoperfumeria.com" \
  -keyout /etc/letsencrypt/live/izaoperfumeria.com/privkey.pem \
  -out /etc/letsencrypt/live/izaoperfumeria.com/fullchain.pem 2>/dev/null
ORIG_CONF=/etc/nginx/nginx.conf.orig
cp /etc/nginx/nginx.conf "$ORIG_CONF"
fallos=0

echo "== izao.conf solo contiene bloques server en el nivel superior"
profundidad_ok=$(sed -e 's/#.*//' /srv/izao/nginx/izao.conf | awk '
  { n=gsub(/\{/,"{"); m=gsub(/\}/,"}");
    if (prof==0 && $0 ~ /[^ \t]/ && $0 !~ /^[ \t]*server[ \t]*\{/ && $0 !~ /^[ \t]*\}/) malo=1;
    prof+=n-m }
  END { print (malo?"no":"si") }')
if [ "$profundidad_ok" = "si" ]; then echo "OK   izao.conf: solo server{}"; else echo "FALLA izao.conf tiene directivas fuera de server{}"; fallos=$((fallos+1)); fi

probar() { # etiqueta
  for ruta in / /api/productos /api/health /api/chat /media/a.webp; do
    cab="$(curl -sk -D - -o /dev/null -H "Host: izaoperfumeria.com" "https://127.0.0.1$ruta")"
    if echo "$cab" | grep -qi "^strict-transport-security: max-age="; then echo "OK   [$1] HSTS en $ruta"; else echo "FALLA [$1] sin HSTS en $ruta"; fallos=$((fallos+1)); fi
  done
  # Login y MFA del panel: límite estricto solo para POST (5 r/min por IP, ráfaga pequeña)
  for ruta in /admin/login /admin/mfa/verify; do
    codigos=""
    for i in 1 2 3 4 5 6 7 8; do
      codigos="$codigos $(curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Host: izaoperfumeria.com' "https://127.0.0.1$ruta")"
    done
    n429=$(echo "$codigos" | tr ' ' '
' | grep -c '^429$' || true)
    n200=$(echo "$codigos" | tr ' ' '
' | grep -c '^200$' || true)
    if [ "$n429" -ge 3 ] && [ "$n200" -ge 1 ]; then echo "OK   [$1] POST $ruta limitado ($n200 pasan, $n429 con 429)"; else echo "FALLA [$1] POST $ruta sin límite estricto:$codigos"; fallos=$((fallos+1)); fi
  done
  codigos=""
  for i in 1 2 3 4 5 6 7 8; do codigos="$codigos $(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: izaoperfumeria.com' "https://127.0.0.1/admin/login")"; done
  if echo "$codigos" | grep -q 429; then echo "FALLA [$1] el GET de /admin/login no debe limitarse:$codigos"; fallos=$((fallos+1)); else echo "OK   [$1] GET /admin/login sin límite estricto"; fi
  cab="$(curl -sk -D - -o /dev/null -H "Host: www.izaoperfumeria.com" "https://127.0.0.1/x")"
  if echo "$cab" | grep -qi "^strict-transport-security: max-age=" && echo "$cab" | grep -qi "^location: https://izaoperfumeria.com/x"; then echo "OK   [$1] www -> raíz 301"; else echo "FALLA [$1] www"; fallos=$((fallos+1)); fi
  cab="$(curl -s -D - -o /dev/null -H "Host: izaoperfumeria.com" "http://127.0.0.1/algo")"
  if echo "$cab" | grep -qi "^location: https://izaoperfumeria.com/algo"; then echo "OK   [$1] http -> https 301"; else echo "FALLA [$1] redirección http"; fallos=$((fallos+1)); fi
}
backend() { # puertos...
  : > /etc/nginx/conf.d/zz-backend.conf
  for p in "$@"; do echo "server { listen 127.0.0.1:$p; location / { return 200 ok; } }" >> /etc/nginx/conf.d/zz-backend.conf; done
}
limpiar() { nginx -s stop 2>/dev/null || true; sleep 1; rm -f /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; cp "$ORIG_CONF" /etc/nginx/nginx.conf; }

echo "== 1) contenedor local"
limpiar
cp /srv/izao/nginx/env/container/izao-http.conf /etc/nginx/conf.d/00-izao-http.conf
sed -i "s/server web:3000/server 127.0.0.1:3000/" /etc/nginx/conf.d/00-izao-http.conf
cp /srv/izao/nginx/izao.local.conf /etc/nginx/conf.d/default.conf
nginx -t

echo "== 2) producción en contenedor"
limpiar
cp /srv/izao/nginx/env/container/izao-http.conf /etc/nginx/conf.d/00-izao-http.conf
sed -i "s/server web:3000/server 127.0.0.1:3000/" /etc/nginx/conf.d/00-izao-http.conf
cp /srv/izao/nginx/izao.conf /etc/nginx/conf.d/default.conf
backend 3000
nginx -t && nginx && sleep 1
probar contenedor

echo "== 3) Nginx del host tipo Ubuntu (gzip ya declarado)"
limpiar
cat > /etc/nginx/nginx.conf <<'CONF'
user nginx;
worker_processes auto;
pid /run/nginx.pid;
events { worker_connections 768; }
http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;
    server_tokens off;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    ssl_protocols TLSv1.2 TLSv1.3;
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
CONF
# Otro proyecto del host (no debe verse afectado)
echo 'server { listen 8081; location / { return 200 otro; } }' > /etc/nginx/conf.d/otro-proyecto.conf
ln -s /srv/izao/nginx/env/host/izao-http.conf /etc/nginx/conf.d/izao-http.conf
ln -s /srv/izao/nginx/izao.conf /etc/nginx/sites-enabled/izao.conf
backend 3000 3001
nginx -t && nginx && sleep 1
probar host
if [ "$(curl -s http://127.0.0.1:8081/)" = "otro" ]; then echo "OK   [host] el otro proyecto sigue respondiendo"; else echo "FALLA otro proyecto"; fallos=$((fallos+1)); fi

[ "$fallos" -eq 0 ] && echo "NGINX OK" || { echo "NGINX CON $fallos FALLOS"; exit 1; }
INNER
