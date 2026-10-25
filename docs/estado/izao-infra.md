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

## Cola pagos y build del worker
- Cola `pagos` registrada en `apps/worker/src/{queues,index}.ts` (+ cola `contraentrega` solo para `cancelarJobsCod`; su worker falta: izao-pagos debe dar `dependenciasCodDesdeEnv`).
- Build del worker con esbuild (`apps/worker/build.mjs`, bundle ESM; bullmq/ioredis externos). Dockerfile.worker ya copia `dist` + `deploy --prod`: sin cambios.
- `.env.example`: SITE_URL y CHECKOUT_*; compose usa env_file (cubre SUPABASE_*, APP_ENCRYPTION_KEY). Nginx: `X-Real-IP $remote_addr` confirmado.
- Pendiente: `encolarTransportadora` es un stub con aviso (esperar contrato de izao-logistica); limitador de checkout en Redis (código de izao-pagos).

## Colas contraentrega y whatsapp
- `queues.ts`: `QUEUE_NAMES.whatsapp`. `index.ts`: worker `contraentrega` con `crearProcesadorCod(dependenciasCodDesdeEnv(programadorCod(colaCod)))` registrado solo si `jobs/cod/index.ts` exporta `dependenciasCodDesdeEnv` (import dinámico; si no, aviso). `cancelarJobsCod` ya iba como 2.º argumento de pagos.
- Cola `whatsapp` creada sin consumidor: falta `jobs/whatsapp/evento.ts` (izao-pagos); dejar TODO en `index.ts` para el `createWorker`.
- Firma esperada: `dependenciasCodDesdeEnv(programar)` devuelve `DepsCod`.

## Registro definitivo COD, whatsapp y barrido
- `index.ts`: imports estáticos; worker `contraentrega` (dependenciasCodDesdeEnv), worker `whatsapp` (crearProcesadorWhatsApp(dependenciasWhatsAppDesdeEnv())), sin TODO ni import dinámico.
- `queues.ts`: `crearProcesadorSistema(extra)` (procesarSistema sigue exportado); `pedidos.barrido` se inyecta desde index con `barrerPedidos(dependenciasBarridoDesdeEnv(colaCod, cancelarJobsCod))`.
- `cron.ts`: scheduler `pedidos.barrido` `*/5 * * * *` America/Bogota (upsert idempotente). Test añadido.
- Verificado: typecheck, build y 117 tests del worker verdes.

## Cola carrier
- `queues.ts`: `QUEUE_NAMES.carrier = COLA_CARRIER`. `index.ts`: cola + worker `crearProcesadorCarrier(dependenciasCarrierDesdeEnv(programadorCarrier(colaCarrier)))`; el stub de pagos se reemplazó por `encolarTransportadora(colaCarrier)`; cierre de la cola.
- `.env.example`: `MASTERSHOP_MODO` (solo dev/QA; bloqueado con NODE_ENV=production). `MASTERSHOP_WEBHOOK_PATH_SECRET` ya existía.
- Pendiente: polling de respaldo cada 10 min en `cron.ts` (anotado) cuando izao-logistica entregue `jobs/sync`.
- Worker: cableados mastershop.polling (*/10) y mastershop.billetera (7 * * * *) en cron.ts/index.ts (cola sistema), con prueba.

## CI agente de impresión
- Job `agente-impresion` (windows-2022, py3.12, caché pip) en ci.yml + sección en RUNBOOK. Sin ejecutar en Actions aún.

## Ajustes menores
- .env.example: INTEGRACIONES_MODO (mock, ignorado en producción). CI: comentario de agente-impresion corregido (sin filtro por rutas). pnpm lint verde (8/8).

## Métricas en el worker
- `index.ts`: manejadores `metrics.recompute_day` (dependenciasMetricasDesdeEnv) y `metrics.recompute_recent` (cola sistema) inyectados en `crearProcesadorSistema`. `cron.ts`: `metrics.recompute_recent` `30 3 * * *` America/Bogota (60 días x CO/EC, lo expande el manejador). Pruebas en cron.test.ts y queues.test.ts. `queues.ts` sin cambios (ya admitía extras).
