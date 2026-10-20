# Bitácora izao-db

## Hecho
- Oleadas 0 y 1 (última f63d558). T2.7 RPC catálogo: 8da6bc2, 343bfbe. T2.8 `lib/db/` (cliente, catalogo): 8f33a8c. Colección y stock_bajo: 08d0a46.
- `admin_guardar_producto` / `admin_importar_catalogo` + `lib/db/admin-catalogo`: 373d18d. T2.9 fixture de imágenes: 490cf03.
- `crear_pedido_checkout` (20261020140537, pgTAP 19): 34cfe1f.
- Pedidos (1)(2)(3) de izao-pagos: migración 20261020213954, pgTAP 20 (24/24 remoto) y 19 actualizada (30/30), tipos regenerados, `lib/db/checkout.ts` (7 vitest): 0d237eb.
- Pedido (4): migración 20261020214637, pgTAP 21 (18/18 remoto), `lib/db/pedidos.ts` (4 vitest), tipos regenerados.

## Contrato `crear_pedido_checkout(p jsonb)` (envoltorio `crearPedidoCheckoutDb` de `@/lib/db/checkout`)
- `order` = `FilaPedido` (lista blanca; `status` lo fija la base por método), `items` = `FilaItem[]`. Montos number o string entero.
- ok: `{ok:true, estado:'creado'|'existente', repetido, order:{id, number, public_token, status, ..., lines[]}}` montos en texto.
- ok:false 'existente': `idempotencia_conflicto` (otro país, o ambas huellas existen y difieren) → 409 IDEMPOTENCY_CONFLICT; `en_proceso` → 409.
- ok:false 'rechazado' (nada escrito): `sin_stock`+`faltantes`; `codigo_*`/`limite_*`; `sin_items`; `totales_inconsistentes`; `datos_invalidos`+`detalle`;
  NUEVOS `sin_politica_datos` (→ 503) y `politica_datos_desactualizada` + `version_vigente` (→ 409 DATA_POLICY_OUTDATED).
- Orden: forma → huella válida → idempotencia (un repetido devuelve su pedido aunque la política haya cambiado) → política → escritura.

## Contrato 20261020213954 (para izao-pagos, izao-tienda, izao-admin)
- `orders.checkout_request_hash text` CHECK `^[0-9a-f]{64}$` (SHA-256 hex minúscula). Se envía en `order.checkout_request_hash`; nula no choca.
  `pedido_checkout_existente(p_clave, p_pais, p_hash)` nueva; la de 2 argumentos delega con hash nulo.
- `discount_codes_code_key` único sobre `code` (sirve a `.eq('code', X)`); se conserva `discount_codes_upper_code_idx`.
- `pages.kind text not null default 'general'` CHECK in (general, quienes_somos, envios, tratamiento_datos, terminos, devoluciones).
  Seed y migración marcan las 5 legales por slug. Índice único parcial `pages_pais_tipo_publicada_key (country_code, kind) where status='published' and kind<>'general'`
  → publicar una segunda del mismo tipo en el país falla con 23505 (el panel debe despublicar la anterior en la misma transacción).
- `politica_datos_vigente(p_pais) → text|null` = `version::text` de la `tratamiento_datos` publicada (envoltorio `politicaDatosVigenteDb`). Solo service_role.
  Tienda/servidor: elegir páginas legales por `kind`, no por regex. `version` no se incrementa sola: la sube el panel al publicar cambios.

## Contrato 20261020214637 (pedido (4) de izao-pagos)
- `payments_provider_reference_key` único parcial `(provider, provider_reference) where provider_reference is not null` → 23505 al repetir referencia.
- `aplicar_transicion_pedido(p jsonb)`, solo service_role, una transacción: update condicional por estado + evento `status_changed`.
  p = `{order_id, from_status, to_status, actor, payload?, fechas?:{paid_at, abandoned_at, sent_to_carrier_at, delivered_at, cancelled_at}}`
  (lista blanca; las fechas que vengan se fijan). Legalidad: `transicionar` de core antes de llamar.
  → `{ok:true, order_id, from_status, to_status, event_id}` | `{ok:false, motivo:'estado_cambiado', status_actual}` (nada escrito; un reintento
  que ve `status_actual = to_status` ya estaba aplicado) | `pedido_inexistente` | `datos_invalidos` + `detalle` (forma, mismo_estado, fechas,
  `orders_status_check`, `order_events_actor_check`; deshace el update).
- Web: `aplicarTransicionPedidoDb` / `aplicarEventoPedidoDb(orderId, evento, fechas?)` de `@/lib/db/pedidos`. Worker (PostgREST):
  `POST /rest/v1/rpc/aplicar_transicion_pedido` con `{p}`; reemplaza PATCH orders + POST order_events de `fuente-postgrest.ts`.

## Pendiente
1. (vacío: pedidos 1–4 de izao-pagos hechos)
2. Rendimiento T2.7: explain (analyze, buffers) y p95 de 50 corridas por RPC.
3. Cierre: pgTAP 01–21 remoto, advisors (solo INFO hoy), lint/typecheck/test.
4. Prueba de concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh, local).
5. store_*: no se crean salvo pedido de izao-tienda.

## Notas
- pgTAP por el MCP: convertir la suite (aserciones → `insert into tap(l) select ...`, sin begin/rollback) y terminar con
  `do $$ begin raise exception 'RESUMEN ...' $$` que reporta y deshace todo (el MCP corre el lote en una transacción implícita).
