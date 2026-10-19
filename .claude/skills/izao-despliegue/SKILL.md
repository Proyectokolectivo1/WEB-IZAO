---
name: izao-despliegue
description: Úsala al preparar o cambiar la infraestructura de Izao en el VPS de Contabo — Docker Compose, Nginx/TLS, DNS en Hostinger, variables de entorno, script de despliegue, migraciones, backups de Supabase y media, monitoreo y alertas.
---

# Despliegue e infraestructura

Referencia: `docs/ESPECIFICACION.md` §4, §28.

## Acceso al VPS

Solo con el MCP `contabo` (ver `tools/contabo-mcp/README.md`). Estructura en el servidor: repo en `/srv/izao/app`, datos en `/srv/izao/{media,backups,redis,geo,certbot}`, configuración de Nginx del host en `/srv/izao/nginx/izao.conf` (enlazada desde `sites-enabled` por `setup-vps.sh`). Los scripts que ejecuta el MCP deben vivir en `infra/scripts/` del repo (en el VPS: `/srv/izao/app/infra/scripts/`).

## Antes de tocar el VPS

El VPS ya aloja otros proyectos. Primero inventariar sin cambiar nada: `docker ps -a`, `ss -tulpn`, proxies existentes (`nginx -T`, Caddy, Traefik), uso de RAM y disco. Si ya hay proxy inverso, **agregar un bloque** para el dominio en lugar de instalar otro. Documentar lo encontrado en `docs/RUNBOOK.md`. Nunca detener ni modificar servicios ajenos a Izao.

## Servicios

`infra/docker-compose.yml`: `web` (2 réplicas, Next.js standalone), `worker`, `redis` (AOF, `noeviction`, 512 MB), `nginx` (si no hay proxy), `uptime-kuma`. Límites de memoria por contenedor para no afectar los otros proyectos (web 1,5 GB c/u, worker 1 GB, redis 600 MB). Volúmenes en `/srv/izao/`.

## Nginx

TLS con certbot, HTTP/2, brotli/gzip, `client_max_body_size 35m` (videos de garantía), `/media/` con caché inmutable, rate limits (`/api/` general y `/api/chat` estricto), cabeceras de seguridad y CSP de §26. `www` → raíz con 301.

## DNS (Hostinger)

A `@` → IP del VPS (confirmar con el dueño), CNAME `www`. No tocar `web.izaoperfumeria.com` ni registros de correo existentes.

## Despliegue

`infra/scripts/deploy.sh`: `git pull` → `pnpm install --frozen-lockfile` → pruebas → `supabase db push` → build de imágenes → actualización de una réplica de `web` a la vez + `worker` → *healthcheck* `/api/health` → si falla, volver a la imagen anterior. Registro de cada despliegue en `docs/RUNBOOK.md` o en un log en `/srv/izao/deploys.log`.

## Backups

- Diario 03:00 Bogotá: `pg_dump` con `DATABASE_URL` → `/srv/izao/backups/db/AAAA-MM-DD.sql.gz`; `tar` incremental de media. Retención 14 días. Opcional copia semanal a S3 de Contabo.
- `infra/scripts/restore.sh` probado en F0 restaurando en un proyecto o base temporal.
- Job ligero cada 3 días para que Supabase gratuito no pause el proyecto en etapas sin tráfico.

## Monitoreo

Sentry en `web` y `worker`; Uptime Kuma para sitio, `/api/health`, colas y *heartbeat* del agente; alertas por correo y WhatsApp (`ADMIN_ALERT_*`). Página `/admin/sistema` (§4.7). Alerta si la base supera 70 % de 500 MB o el disco 80 %.

## Variables

Lista de §28 en `infra/.env.example` (sin valores). El `.env` real solo en el VPS con permisos `600`.
