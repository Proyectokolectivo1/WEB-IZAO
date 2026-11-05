#!/usr/bin/env bash
# Valida Nginx en contenedores desechables con las versiones 1.27, 1.24 (Ubuntu 24.04) y 1.18 (Ubuntu 22.04),
# en tres variantes:
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

for VER in ${NGINX_VERSIONS:-1.27 1.24 1.18}; do
echo "##### nginx $VER"
docker run --rm -i -v "$RUTA:/cfg:ro" nginx:$VER-alpine sh -s <<'INNER'
set -eu
apk add --no-cache openssl curl >/dev/null
mkdir -p /srv/izao/media /srv/izao/certbot /etc/letsencrypt/live/izaoperfumeria.com /etc/nginx/sites-enabled
cp -r /cfg /srv/izao/nginx
echo imagen > /srv/izao/media/a.webp
mkdir -p /srv/izao/media/warranty/2026/10 && echo foto > /srv/izao/media/warranty/2026/10/x-640.webp
echo '<script>1</script>' > /srv/izao/media/evil.html
echo '<svg onload=alert(1)>' > /srv/izao/media/evil.svg
mkdir -p /srv/izao/media/labels /srv/izao/media/agent-screenshots /srv/izao/media/banners
echo pdf > /srv/izao/media/labels/1.pdf
echo png > /srv/izao/media/agent-screenshots/s.png
echo png > /srv/izao/media/banners/b.PNG
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
  # CSP: /admin/** debe permitir img-src data: (QR del MFA); todas las rutas llevan CSP
  for ruta in / /api/productos /media/a.webp /admin/login /admin/mfa/enroll; do
    csp="$(curl -sk -D - -o /dev/null -H 'Host: izaoperfumeria.com' "https://127.0.0.1$ruta" | grep -i '^content-security-policy:' || true)"
    [ -n "$csp" ] || { echo "FALLA [$1] sin CSP en $ruta"; fallos=$((fallos+1)); }
  done
  csp="$(curl -sk -D - -o /dev/null -H 'Host: izaoperfumeria.com' "https://127.0.0.1/admin/mfa/enroll" | grep -i '^content-security-policy:' || true)"
  if echo "$csp" | grep -q "img-src[^;]* data:"; then echo "OK   [$1] CSP de /admin/mfa permite img-src data:"; else echo "FALLA [$1] CSP de /admin sin data:"; fallos=$((fallos+1)); fi
  csp="$(curl -sk -D - -o /dev/null -H 'Host: izaoperfumeria.com' "https://127.0.0.1/co" | grep -i '^content-security-policy:' || true)"
  if echo "$csp" | grep -q "data:"; then echo "FALLA [$1] la CSP de la tienda no debe permitir data:"; fallos=$((fallos+1)); else echo "OK   [$1] CSP de la tienda sin data:"; fi
  if echo "$csp" | grep -q "challenges.cloudflare.com"; then echo "OK   [$1] CSP de la tienda permite Turnstile"; else echo "FALLA [$1] CSP de la tienda sin challenges.cloudflare.com"; fallos=$((fallos+1)); fi
  c="$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: izaoperfumeria.com' "https://127.0.0.1/media/warranty/2026/10/x-640.webp")"
  if [ "$c" = 404 ]; then echo "OK   [$1] /media/warranty/ bloqueado (404)"; else echo "FALLA [$1] /media/warranty/ responde $c"; fallos=$((fallos+1)); fi
  # /media: solo imágenes/video públicos; el resto y las rutas privadas dan 404; nosniff y CSP con sandbox.
  for ruta in /media/evil.html /media/evil.svg /media/labels/1.pdf /media/agent-screenshots/s.png /media/labels/; do
    c="$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: izaoperfumeria.com' "https://127.0.0.1$ruta")"
    if [ "$c" = 404 ]; then echo "OK   [$1] $ruta bloqueado (404)"; else echo "FALLA [$1] $ruta responde $c"; fallos=$((fallos+1)); fi
  done
  c="$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: izaoperfumeria.com' "https://127.0.0.1/media/banners/b.PNG")"
  if [ "$c" = 200 ]; then echo "OK   [$1] /media/banners/b.PNG 200"; else echo "FALLA [$1] /media/banners/b.PNG responde $c"; fallos=$((fallos+1)); fi
  cab="$(curl -sk -D - -o /dev/null -H 'Host: izaoperfumeria.com' "https://127.0.0.1/media/a.webp")"
  if echo "$cab" | grep -qi "^x-content-type-options: nosniff"; then echo "OK   [$1] /media con nosniff"; else echo "FALLA [$1] /media sin nosniff"; fallos=$((fallos+1)); fi
  if [ "$(echo "$cab" | grep -ci '^content-security-policy: default-src .none.; sandbox')" = 1 ]; then echo "OK   [$1] /media con CSP default-src none; sandbox (una sola)"; else echo "FALLA [$1] /media sin CSP sandbox o duplicada"; fallos=$((fallos+1)); fi
  # Server Actions de Next: un POST con la cabecera Next-Action se ejecuta en CUALQUIER ruta, así que
  # se limita por cabecera además de por ruta (evita esquivar el límite de /admin/login con POST a /).
  n429=0; n200=0
  for i in $(seq 1 45); do
    c=$(curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Next-Action: abc123' -H 'Host: izaoperfumeria.com' "https://127.0.0.1/")
    [ "$c" = 429 ] && n429=$((n429+1)); [ "$c" = 200 ] && n200=$((n200+1))
  done
  if [ "$n429" -ge 1 ] && [ "$n200" -ge 20 ]; then echo "OK   [$1] POST / con Next-Action limitado ($n200 pasan, $n429 con 429)"; else echo "FALLA [$1] POST / con Next-Action sin límite ($n200 pasan, $n429 con 429)"; fallos=$((fallos+1)); fi
  n429=0
  for i in $(seq 1 45); do
    c=$(curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Host: izaoperfumeria.com' "https://127.0.0.1/formulario")
    [ "$c" = 429 ] && n429=$((n429+1))
  done
  if [ "$n429" -eq 0 ]; then echo "OK   [$1] POST normal sin Next-Action no se limita"; else echo "FALLA [$1] POST normal limitado ($n429)"; fallos=$((fallos+1)); fi
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
done
