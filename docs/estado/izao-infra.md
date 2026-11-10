# Bitácora de izao-infra

## Hecho
- F0a: monorepo, esqueletos web/worker, Compose local, Nginx, deploy.sh (`2cae450`..`ae44398`).
- T0.14 backup/restore/keepalive/alertas con prueba (`11b182e`, `90de5eb`); revisiones corregidas (ver `git log infra/`).
- CI: `.github/workflows/{ci,lighthouse,k6}.yml` (`ce19db1`) + job `agente-impresion` (windows-2022) sin ejecutar aún en Actions.
- Worker (`apps/worker/src/{index,queues,cron}.ts`): build con esbuild (`build.mjs`); colas sistema, pagos, contraentrega, carrier y whatsapp con sus procesadores; `crearProcesadorSistema(extra)` con manejadores inyectados.
- Cron (America/Bogota): `pedidos.barrido` */5, `mastershop.polling` */10, `mastershop.billetera` 7 * * * *, `metrics.recompute_recent` 30 3 * * *, purga de audit_log 03:30.
- Recalculador de métricas: `recalculadorMetricasDesdeEnv(cola)` pasado como último argumento a pagos, barrido y COD (D-034). `addi.callback` corre en la cola `pagos`, sin cola ni cron nuevos.
Pruebas de infra en `infra/scripts/test-*` (backup-restore, restore-guard, deploy-rollback, nginx, memoria, run-with-env).
## Pendiente
- Restaurar un backup contra el esquema `auth` real de Supabase (hoy solo contra fixture tipo GoTrue).
- Medir 429 de `izao_next_action` antes de F1 (B-n1).
- Limitador de checkout en Redis (código de izao-pagos).

## Media, CSP, límite de garantías
- `media.borrar_archivos` (4ea5711): cron */15, lee `media_file_deletions`, borra base_path+variants bajo MEDIA_ROOT y la fila; fallo -> attempts+1 y last_error; tope 10.
- CSP tienda sin `data:` + Turnstile (D-037), probado en test-nginx.
- Límite de garantías estaba en memoria; ahora Redis (`apps/web/lib/limite-tasa-redis.ts`, respaldo en memoria). `ipDe` de esa ruta acepta X-Forwarded-For: debería usar `ipCliente` (izao-tienda).
- Correo: sin proveedor (SMTP_* vacías). Alerta/correo de garantía NO hecho hasta que el líder elija proveedor.
- `chat.purgar_conversaciones` (cron 03:45, por lotes de 100): borra chat_messages y chat_sessions con más de 180 días (env opcional `CHAT_RETENCION_DIAS`, mín. 30; no es configurable en chat_settings); no toca chat_usage_monthly.

## F0b (2026-11-02)
Redis, web y worker corriendo en el VPS (tag 68cdd45, healthy); Nginx con `izao.conf` propio sirve https://izaoperfumeria.com (200), www 301, `/media/warranty/` 404. Detalles en `docs/RUNBOOK.md` ("F0b"). Sin snapshot (API Contabo 401).
Bloqueos: quitar enlace viejo y cron (root); `BACKUP_AGE_RECIPIENT` vacío; host sin `pg_dump` 17 ni `age`.

## Redespliegue 967d971 (2026-11-05) — OK
El script viejo del VPS corría en cada intento (git reset del rollback); con `git pull --ff-only` previo corrió el nuevo. Puerto de web autodetectado (3000-3001). Backup 2026-11-04 existe.
PROCEDIMIENTO: antes de deploy.sh, `git pull --ff-only` si el script cambió. Stash local de `.dockerignore` en VPS (inocuo).

## Redespliegue 78e6c0f (2026-11-05) — OK
`git pull --ff-only` + `deploy.sh --skip-tests` (359 s, sin snapshot). web y worker healthy, web en 127.0.0.1:3000 (volvió a 3000), /api/health 200 local y https, /admin/login 200. `/api/chat/estado?country=co|ec` 200 (usa `country`, no `pais`); logs web sin `BigInt`. Turnstile del login apagado: no hay TURNSTILE_SITE_KEY en el .env (no se tocó). `ultimo-ok`=78e6c0f.

## Limpieza Nginx — BLOQUEADA por política
`sites-enabled/izaoperfumeria` (SPA vieja, mismo dominio) da 5 avisos server_name duplicado; política no deja escribir en /etc/nginx. Lo ejecuta el dueño como root; luego `sudo nginx -t` y /api/health.

## Redespliegue b79e94b (2026-11-05) — OK
pull + `deploy.sh --skip-tests --migraciones-verificadas` (428 s; el script exige ese flag si hay migración nueva; verificada con list_migrations). Sin snapshot. web/worker healthy; /api/health, /co, /ec, /admin/login 200 https; HTML de /co precarga 2 woff2 y enlaza 2 css de `.next/static` (Dockerfile.web los copia). Build ~320 s, sin agotar memoria (6 GB libres).
MEDIA CORREGIDO Y DESPLEGADO f573920 (376 s, sin snapshot; web/worker uid 100 escriben en /srv/izao/media, Nginx sirve /media/banners/ 200, prueba borrada; infra/data/media en el VPS estaba vacío): compose monta `${IZAO_DATA_DIR:-./data}/media`; sin IZAO_DATA_DIR en .env resuelve a `/srv/izao/app/infra/data/media` (root, 755, uid web=100) y NO a `/srv/izao/media` que sirve Nginx. Subir banners falla (EACCES) y no se servirían. Hice `chmod 777 /srv/izao/media` (inocuo). Arreglo: IZAO_DATA_DIR=/srv/izao en infra/.env (lo sube el dueño) migrando redis (hoy en infra/data/redis) o root: bind del dir correcto.

## Endurecimiento de media (2026-11-05, solo repo, sin desplegar)
Nginx `/media/`: solo webp|avif|jpe?g|png|mp4; warranty/, labels/ y agent-screenshots/ 404; resto 404; nosniff + CSP `default-src 'none'; sandbox` (map en izao-zones.conf). `infra/scripts/permisos-media.sh` (uid 100, grupo www-data, 2750/640; privados 700) y comandos del dueño en RUNBOOK. Compose: `IZAO_MEDIA_DIR` por defecto `/srv/izao/media` (local: `./data/media` en infra/.env). test-nginx ampliado, NO ejecutado (Docker Desktop no arranca en esta sesión): correr `bash infra/scripts/test-nginx.sh` antes de desplegar. Dueño: ejecutar RUNBOOK "Permisos de /srv/izao/media" tras pull.

## Redespliegue 529c333 (2026-11-06) — OK
pull + `deploy.sh --skip-tests --migraciones-verificadas` (402 s, sin snapshot). Migraciones 20261105060857 y 20261106050343 verificadas con list_migrations. web/worker healthy; web ahora en 127.0.0.1:3001 (autodetección). https /co /ec /api/health /admin/login 200; logs limpios. Compose monta /srv/izao/media en ambos (mismo dir que lee Nginx); uid 100 escribe en web y worker (touch borrado). Build avisa de `@valkey/valkey-glide` (bullmq, inocuo). PENDIENTE ROOT (no hecho a propósito): copiar nginx a /srv/izao/nginx, permisos-media.sh, limpieza del sitio viejo; mientras tanto Nginx sirve /media con la config anterior y media sigue en 777.

## Verificación tras acciones de root (2026-11-06)
OK: permisos-media.sh aplicado (media 100:33 2750; warranty/labels/agent-screenshots 700 uid 100; banners 2750 grupo 33); web y worker (uid 100) escriben en banners/; sites-enabled solo tiene izao.conf; `sudo nginx -t` sin avisos; /co /ec /api/health /admin/login 200; /media/labels y /media/warranty 404.
FALLA: /srv/izao/nginx/izao-locations.conf e izao-zones.conf siguen en la versión VIEJA (diff contra infra/nginx): /media/banners/prueba.txt da 200 (sin filtro de extensiones) y /media/ no lleva CSP `sandbox` (usa la CSP general). Root debe copiar de nuevo y recargar (comando en el reporte). Pruebas borradas.

RESUELTO (tras copia del dueño + reload): izao-locations.conf e izao-zones.conf coinciden con el repo. .txt en banners/ 404; .webp de prueba 200 (www-data lo lee) con nosniff y CSP `default-src 'none'; sandbox`; labels/warranty/agent-screenshots 404; /co /ec /api/health /admin/login 200. izao.conf del VPS difiere solo en cabecera y upstream (3000+3001), sin cambios reales; no se copia. Pruebas borradas.

## Siguiente paso exacto
Dueño ejecuta la limpieza Nginx; luego `uptime`, `crear-admin`, restore real contra `auth`, snapshot (API Contabo).
Nota: el build de web puede fallar por WIP de la tienda; verificar en copia limpia de HEAD.

## Salida CO (2026-11-09)
HSTS 6 meses aplicado en VPS y repo (sin includeSubDomains/preload). media-huerfanos.{sh,mjs}: 0 huérfanos. HALLAZGO: backups de media 06-08/11 fallaron (permisos 2750 de media); backup.sh corregido vía docker exec, aplica tras pull. Restauración real de backup pendiente: falta llave age del dueño y Docker local. Detalle en RUNBOOK.

## D-Q1 y D-Q7 (2026-11-09, solo repo)
`img-src 'self' data: blob: https:` en el default de `izao-zones.conf`; `server_tokens off;` en los 3 server de `izao.conf`; test-nginx ampliado (data: solo en img-src, Server sin versión). test-nginx NO ejecutado (Docker no responde). Aplicar en VPS: ver RUNBOOK (copiar 2 archivos, `nginx -t`, reload, snapshot antes).
