# Bitácora de izao-infra

## Hecho
- F0a: monorepo, esqueletos web/worker, Compose local, Nginx, deploy.sh (`2cae450`..`ae44398`).
- T0.14 backup/restore/keepalive/alertas con prueba (`11b182e`, `90de5eb`); revisiones corregidas (ver `git log infra/`).
- CI: `.github/workflows/{ci,lighthouse,k6}.yml` (`ce19db1`) + job `agente-impresion` (windows-2022) sin ejecutar aún en Actions.
- Worker (`apps/worker/src/{index,queues,cron}.ts`): build con esbuild (`build.mjs`); colas sistema, pagos, contraentrega, carrier y whatsapp con sus procesadores; `crearProcesadorSistema(extra)` con manejadores inyectados.
- Cron (America/Bogota): `pedidos.barrido` */5, `mastershop.polling` */10, `mastershop.billetera` 7 * * * *, `metrics.recompute_recent` 30 3 * * *, purga de audit_log 03:30.
- Recalculador de métricas: `recalculadorMetricasDesdeEnv(cola)` pasado como último argumento a pagos, barrido y COD (D-034). `addi.callback` corre en la cola `pagos`, sin cola ni cron nuevos.
- Verificado `@izao/addi`: dependencia en web y worker, lockfile y `transpilePackages` de web correctos.
- `.env.example`: SITE_URL, CHECKOUT_*, MASTERSHOP_MODO (bloqueado en producción), INTEGRACIONES_MODO (ignorado en producción).

## Pruebas de infra (en `infra/scripts/`)
test-backup-restore, test-restore-guard, test-deploy-rollback, test-nginx (1.27/1.24/1.18), test-memoria, test-run-with-env.

## Pendiente (esperan al MCP `contabo`)
- T0.15 inventario del VPS + `docs/RUNBOOK.md`; T0.16 `setup-vps.sh`, primer despliegue, certificados, cron.
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

## Redespliegue 496dac9/bdf471a (2026-11-05) — FALLÓ 3 veces, revertido a ad327bf (sano)
Sin snapshot (API Contabo 401). Imágenes 496dac9 y bdf471a construidas; compose las da healthy pero curl al puerto publicado (ya autodetectado en bdf471a) rechazado x11 -> rollback automático OK (https 200). Entre ad327bf y 496dac9 el código de web no cambia (solo client.ts de mastershop y borrado de .env.example): no es un cambio de la app. Causa SIN determinar: los contenedores fallidos se recrean en el rollback y sus logs se pierden; la política bloquea docker events/image inspect y `VAR=… docker compose`. VPS: HEAD ad327bf, stash local de `.dockerignore`. Backup 2026-11-04.sql.gz.age existe.

## Siguiente paso exacto
Capturar logs: el dueño ejecuta en el VPS (con IZAO_TAG=496dac9 `docker compose -f infra/docker-compose.yml up -d --no-deps --no-build web`; luego `docker logs --tail 80 izao-web-1`, `docker inspect izao-web-1 --format '{{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}}'`, `docker port izao-web-1`) y vuelve a ad327bf. Alternativa: añadir a deploy.sh volcado de logs/estado de web antes del rollback.

## Decisiones que necesitan al líder
- Ninguna. Nota: el build de web puede fallar por WIP de la tienda; verificar en copia limpia de HEAD.
