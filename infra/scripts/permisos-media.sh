#!/usr/bin/env bash
# Deja /srv/izao/media sin 777: dueño uid 100 (usuario izao de los contenedores web y worker),
# grupo del usuario de Nginx del host (lee, no escribe), sin acceso para el resto.
# Lo ejecuta el dueño como root. Es idempotente. No toca nada fuera de MEDIA.
#   bash infra/scripts/permisos-media.sh
# Variables: MEDIA (def. /srv/izao/media), UID_IZAO (100), NGINX_GRUPO (def. www-data).
set -euo pipefail
MEDIA="${MEDIA:-/srv/izao/media}"
UID_IZAO="${UID_IZAO:-100}"
NGINX_GRUPO="${NGINX_GRUPO:-www-data}"

[ "$(id -u)" -eq 0 ] || { echo "Ejecutar como root."; exit 1; }
getent group "$NGINX_GRUPO" >/dev/null || { echo "No existe el grupo $NGINX_GRUPO (defina NGINX_GRUPO)."; exit 1; }
case "$MEDIA" in /srv/izao/*) ;; *) echo "MEDIA fuera de /srv/izao: $MEDIA"; exit 1 ;; esac

mkdir -p "$MEDIA" "$MEDIA/labels" "$MEDIA/agent-screenshots" "$MEDIA/warranty"

# Público (lo sirve Nginx): lectura para el grupo de Nginx; setgid para que lo nuevo herede el grupo.
chown -R "$UID_IZAO:$NGINX_GRUPO" "$MEDIA"
find "$MEDIA" -type d -exec chmod 2750 {} +
find "$MEDIA" -type f -exec chmod 640 {} +

# Privado (Nginx no lo sirve y no debe poder leerlo): solo el dueño uid 100.
for d in warranty labels agent-screenshots; do
  chown -R "$UID_IZAO:$UID_IZAO" "$MEDIA/$d"
  find "$MEDIA/$d" -type d -exec chmod 700 {} +
  find "$MEDIA/$d" -type f -exec chmod 600 {} +
done

echo "== Resultado"
stat -c '%a %U:%G %n' "$MEDIA" "$MEDIA/warranty" "$MEDIA/labels" "$MEDIA/agent-screenshots"
if find "$MEDIA" -perm -o+w | grep -q .; then echo "FALLA: quedan rutas con escritura para todos"; exit 1; fi
echo "OK: sin permisos de escritura para otros."
echo "Comprobar la escritura: docker exec izao-web-1 touch /srv/izao/media/.prueba (y borrarlo), igual con el worker."
