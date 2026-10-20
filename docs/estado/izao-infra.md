# Bitácora de izao-infra

## Hecho
- F0a: monorepo, esqueletos web/worker, Compose local, Nginx, deploy.sh (`2cae450`..`ae44398`).
- T0.14 backup/restore/keepalive/alertas con prueba (`11b182e`, `90de5eb`); revisiones A1-A4, M1-M12, N-2, B-n2 corregidas (ver `git log infra/`).
- CI: `.github/workflows/{ci,lighthouse,k6}.yml` (`ce19db1`). `NEXT_DIST_DIR` en next.config.ts (`ver git log`).
- Worker: job diario 03:30 Bogotá que llama a `purgar_audit_log` (`7c3355a`).

## Pruebas de infra (todas en `infra/scripts/`)
test-backup-restore, test-restore-guard, test-deploy-rollback, test-nginx (1.27/1.24/1.18), test-memoria, test-run-with-env.

## Pendiente (esperan al MCP `contabo`)
- T0.15 inventario del VPS + `docs/RUNBOOK.md`; T0.16 `setup-vps.sh`, primer despliegue, certificados, cron.
- Restaurar un backup contra el esquema `auth` real de Supabase (hoy solo contra un fixture tipo GoTrue).
- Medir 429 de `izao_next_action` antes de F1 (B-n1). Decidir `data:` en la CSP de la tienda.

## Notas
- El build de web en el árbol de trabajo falla hoy por WIP de la tienda (`lib/store/fuentes.ts`); mi cambio se verificó en copia limpia de HEAD.
