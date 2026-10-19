#!/usr/bin/env bash
# Preparación única del VPS para el MCP de Contabo de Izao.
# Ejecutar UNA vez como root en el VPS:
#   sudo bash setup-vps.sh "ssh-ed25519 AAAA... izao-claude-code"
# No toca contenedores, servicios ni configuraciones de otros proyectos.
set -euo pipefail

PUBKEY="${1:-}"
USER_NAME="izao"
PROJECT_DIR="/srv/izao"

if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root (sudo)."; exit 1; fi
if [[ -z "$PUBKEY" || "$PUBKEY" != ssh-ed25519* ]]; then
  echo 'Uso: sudo bash setup-vps.sh "ssh-ed25519 AAAA... comentario"'; exit 1
fi

echo "== 1. Usuario $USER_NAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$USER_NAME"
  passwd -l "$USER_NAME" >/dev/null   # sin contraseña: solo llave SSH
fi
if getent group docker >/dev/null; then
  usermod -aG docker "$USER_NAME"
else
  echo "  Aviso: no existe el grupo docker (¿Docker no está instalado?). Instálalo y vuelve a ejecutar este script."
fi

echo "== 2. Llave SSH"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$PUBKEY" "$AUTH" || echo "$PUBKEY" >> "$AUTH"
chown "$USER_NAME:$USER_NAME" "$AUTH"; chmod 600 "$AUTH"

echo "== 3. Directorios del proyecto"
for d in "$PROJECT_DIR" "$PROJECT_DIR/app" "$PROJECT_DIR/media" "$PROJECT_DIR/backups" "$PROJECT_DIR/redis" "$PROJECT_DIR/geo" "$PROJECT_DIR/nginx" "$PROJECT_DIR/certbot" "$PROJECT_DIR/tmp" /tmp/izao; do
  install -d -m 755 -o "$USER_NAME" -g "$USER_NAME" "$d"
done

echo "== 4. sudo limitado (solo nginx -t, reload de nginx, certbot y puertos 80/443)"
NGINX="$(command -v nginx || true)"
SYSTEMCTL="$(command -v systemctl)"
CERTBOT="$(command -v certbot || echo /usr/bin/certbot)"
UFW="$(command -v ufw || echo /usr/sbin/ufw)"
SUDOERS="/etc/sudoers.d/izao-mcp"
{
  echo "# Generado por setup-vps.sh del MCP de Izao"
  [[ -n "$NGINX" ]] && echo "$USER_NAME ALL=(root) NOPASSWD: $NGINX -t, $NGINX -T"
  echo "$USER_NAME ALL=(root) NOPASSWD: $SYSTEMCTL reload nginx, $SYSTEMCTL status nginx"
  echo "$USER_NAME ALL=(root) NOPASSWD: $CERTBOT certonly *, $CERTBOT renew, $CERTBOT renew *, $CERTBOT certificates"
  echo "$USER_NAME ALL=(root) NOPASSWD: $UFW status, $UFW allow 80/tcp, $UFW allow 443/tcp"
} > "$SUDOERS.tmp"
chmod 440 "$SUDOERS.tmp"
if visudo -cf "$SUDOERS.tmp" >/dev/null; then mv "$SUDOERS.tmp" "$SUDOERS"; else rm -f "$SUDOERS.tmp"; echo "  sudoers inválido, no se instaló"; fi

echo "== 5. Nginx del host (si existe)"
if [[ -n "$NGINX" && -d /etc/nginx ]]; then
  CONF="$PROJECT_DIR/nginx/izao.conf"
  [[ -f "$CONF" ]] || { echo "# Configuración de izaoperfumeria.com (la administra el deploy de Izao)" > "$CONF"; chown "$USER_NAME:$USER_NAME" "$CONF"; }
  if [[ -d /etc/nginx/sites-enabled ]]; then LINK=/etc/nginx/sites-enabled/izao.conf; else LINK=/etc/nginx/conf.d/izao.conf; fi
  [[ -e "$LINK" ]] || ln -s "$CONF" "$LINK"
  "$NGINX" -t && echo "  nginx -t OK (el archivo de Izao está vacío hasta el primer despliegue)"
else
  echo "  No hay nginx en el host; el proyecto usará su propio contenedor de nginx."
fi

echo
echo "================ DATOS PARA tools/contabo-mcp/.env ================"
echo "VPS_HOST=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo "VPS_USER=$USER_NAME"
echo "VPS_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || echo 22)"
echo "VPS_HOST_KEY_SHA256=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')"
echo "==================================================================="
echo "Aviso: el grupo docker da privilegios equivalentes a root. La política del MCP es la barrera principal; no compartas la llave privada."
