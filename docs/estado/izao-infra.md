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

## Siguiente paso exacto
Inventario del VPS con `vps_policy` y `vps_inventory` (T0.15) cuando el MCP `contabo` esté disponible.

## Decisiones que necesitan al líder
- Ninguna. Nota: el build de web puede fallar por WIP de la tienda; verificar en copia limpia de HEAD.
