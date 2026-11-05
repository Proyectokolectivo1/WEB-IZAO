# Bitácora de izao-logistica

## Hecho
- Paquete `@izao/mastershop` (líneas, pedido, estados, cliente, adaptador, mock con trampas), cola `carrier` (`1dc959b`, `20acdf2`), webhook (`607beec`), D-026/D-027.
- `c611a9f` 23505 de etiqueta automática = ya existe. `97c4dd5` billetera. `76aa22d` jobs `mastershop.polling`/`billetera`. `e29de8c` reintento de envío.
- `942d1ad` contrato `docs/integraciones/agente-api.md` v1; `242e6f1` API `/api/agent/*`. `9643c4d`/`6513e22` registro de webhooks (16/17) en `integration_webhooks`.
- `6d77b62` D-042 (`hasNovelty` 0/1, listados 45 s). `e18c20a` D-043 (modo B; `guide` opcional en el detalle).
- 2026-11-04: pedido 3076033 (`IZ-CO-PRUEBA-0001`) **cancelado por el dueño** (verificado: `idStatus 9`, «Cancelada Por Vendedor»).
- 2026-11-04 D-044 (solo lectura): la transportadora **no se elige por API**; MasterShop la asigna. Historial: Marinilla salió con Coordinadora (2916057, con guía y PDF), Envia (2841592) e InterRapidisimo (sin guía).

## Para izao-infra
- Redesplegar el worker: el contenedor actual **no** tiene D-043 (verificado en `dist/index.js.map`); sin él `carrier.poll_label` falla mientras no haya guía. D-042 también pendiente si no se desplegó.
- La web escribe en `MEDIA_ROOT/agent-screenshots/` y lee `MEDIA_ROOT/labels/`.

## Para izao-admin
- Botón "Reintentar": `reintentarEnvioMasterShop(orderId, order.status)`; auditar.
- Módulo Agente: token ≥ 32 `[A-Za-z0-9_-]`, guardar `hashTokenAgente(token)`; reimpresión = nuevo `print_job` `requested_by: 'admin:<id>'`.
- Registro de webhooks: `registrarWebhooksMasterShop(apiKey, ambiente)`.

## Pendiente
- Canal de alertas al admin (saldo bajo, impresión fallida, agente sin heartbeat > 5 min). Lista de empaque.
- Avisar a izao-agente-windows del contrato v1.
- Segundo pedido real de prueba (`IZ-CO-PRUEBA-0002`): **no creado**. La aprobación llegó reenviada por el líder (no es consentimiento del dueño) y por API saldría casi seguro con InterRapidisimo.

## Scripts temporales en el VPS (borrar al terminar la prueba)
- `/tmp/izao/p.mjs` (parchado: `guide` opcional, número `IZ-CO-PRUEBA-0002`, fases `crear|estado|etiqueta|confirmar|cancelar`), `/tmp/izao/p2.mjs` (fases `leer <idOrder>` con transportadora/alertas/ciudad y `carriers`), `/tmp/izao/fix.sed`.
- No hay etiquetas de prueba descargadas en `MEDIA_ROOT/labels/`.

## Siguiente paso exacto
Con aprobación directa del dueño (en su chat o en el aviso de permisos):
1. `docker exec -i izao-worker-1 node --input-type=module - crear 697831 IZAO-MEN-035 1 < /tmp/izao/p.mjs`
2. `... - leer <id> < /tmp/izao/p2.mjs`: si la transportadora no es Coordinadora/Envia, el dueño la cambia en el panel de MasterShop; si no puede, `cancelar <id>` y reportar.
3. `confirmar <id>` → `etiqueta <id>` (guarda `labels/IZ-CO-PRUEBA-0002.pdf`) → `cancelar <id>` → `estado <id>`.
4. `rm /tmp/izao/p.mjs /tmp/izao/p2.mjs /tmp/izao/fix.sed /srv/izao/media/labels/IZ-CO-PRUEBA-0002.pdf`.
