# Bitácora izao-db

## Hecho
- Oleadas 0 y 1: ver commits previos (última f63d558). T2.7 RPC catálogo: 8da6bc2, 343bfbe (pgTAP 16, 23 pruebas).
- T2.8 `apps/web/lib/db/` (cliente.ts: clienteDb, llamarRpc, ErrorDb; catalogo.ts: catalogPage/SearchPage/Suggest/Product/Related con zod): 8f33a8c. Avisado a izao-tienda e izao-admin-2.
- Filtro `collection` en catalog_page/search + `stock_bajo` nunca null: migración 20261020043428, pgTAP 17 (10/10): 08d0a46.
- `crear_pedido_checkout` (decisión 1 de izao-pagos): migración 20261020140537, pgTAP 19 (30/30 remoto), envoltorio `lib/db/checkout.ts` (4 vitest), tipos regenerados.

## Contrato `crear_pedido_checkout(p jsonb)` para izao-pagos (integrar en lib/checkout)
- `crearPedidoCheckoutDb({order, items})` de `@/lib/db/checkout`. Reemplaza insertarPedido → insertarItems → reservarStock → reservarCanje → registrarEvento y `deshacer` (ya no hace falta; también `eliminarPedido`).
- `order` = la `FilaPedido` actual (lista blanca; `status` se ignora: la base lo fija por método igual que ESTADO_INICIAL). `items` = `FilaItem[]` actuales. Montos number o string entero.
- ok: `{ok:true, estado:'creado'|'existente', repetido, order:{id, number, public_token, status, country_code, currency_code, payment_method, subtotal, discount_amount, financing_surcharge_amount, total_customer, cod_deposit_amount, cod_collect_amount, lines[{variant_id, name_snapshot, variant_label, quantity, unit_price, line_discount}]}}` montos en texto; líneas por nombre y sku.
- ok:false estado 'existente': `idempotencia_conflicto` (409 IDEMPOTENCY_CONFLICT), `en_proceso` (409 CHECKOUT_IN_PROGRESS). Estado 'rechazado' (nada escrito): `sin_stock` + `faltantes[{variant_id, sku, solicitado, disponible, motivo}]` (409 STOCK_CHANGED); `codigo_*`/`limite_*` (422 CODE_REJECTED, MOTIVO_CANJE); `sin_items`, `totales_inconsistentes` (subtotal ≠ Σ precio×cant o descuento ≠ Σ line_discount), `datos_invalidos` + `detalle` (restricción/columna) → 503 o 400.
- Evento `created` con payload `{payment_method, total_customer (texto), discount_code}` lo escribe la base. Carrera con la misma clave: la segunda espera el índice único y recibe el pedido como repetido.

## Contrato pedido por izao-admin (reenviado por izao-admin-2; no perder)
`admin_guardar_producto(p jsonb) -> {ok, product_id, motivo?, detalle?}`. Solo service_role, search_path vacío, una transacción.
- p = {product:{id?, name, slug, short_description, description_html, brand_id, gender_id, family_id, concentration_id, notes_top[], notes_heart[], notes_base[], occasion[], season[], longevity, sillage, seo_title, seo_description, status}, category_ids[], countries[{country_code, is_visible, is_featured, featured_rank, badges[]}], options[{id, name, sort_order, values[{id, value, sort_order}]}], variants[{id, sku, option_value_ids[], weight_kg, is_default, mastershop_product_id, mastershop_variant_id, image_id, sort_order, countries[{country_code, is_active, price, compare_at_price, cost, stock, low_stock_threshold}]}], images[{media_id, role, sort_order}]}.
- UUID de options/values/variants los genera la app. Sin product.id = alta. Sincronización completa: lo que no venga se borra, salvo variantes con order_items => ok=false 'variante_con_pedidos'.
- Dinero entero en unidad menor (number o string numérico). Nunca toca stock_reserved. published_at = now() la primera vez que is_visible pasa a true. Refresco normal de catalog_listing (sin skip).
- Motivos: sin_vinculo_mastershop (variante activa en CO, producto visible en CO, sin mastershop_product_id; id_variant puede ser null según §14.3), variante_con_pedidos, sku_duplicado, slug_duplicado, sin_variante_por_defecto (0 o más de 1), datos_invalidos + detalle corto.
`admin_importar_catalogo(p jsonb)`: p = {modo:'simular'|'aplicar', filas:[payload del punto 1 por producto, sin UUID de options/values/variants: resolver por (producto, nombre opción/valor) y sku]}.
- Devuelve {ok, creados, actualizados, sin_cambios, errores[{indice, sku?, motivo, detalle?}], cambios[{indice, tipo:'crear'|'actualizar', campos[]}]}. simular no escribe.
- aplicar: skip_catalog_refresh='on', al final refresh_catalog_listing_many(ids). Idempotente por sku y slug. Atómico por producto: una fila con error se reporta y no detiene el lote. Imágenes ya resueltas (media_id).
- Envoltorios en '@/lib/db/admin-catalogo'. Al terminar: avisar a izao-admin e izao-admin-2 (lanzan T2.6c y T2.7).

## Pendiente
1. admin_guardar_producto + admin_importar_catalogo (contrato arriba), pgTAP 18/19, envoltorios.
2. store_*: no se crean salvo pedido de izao-tienda (lee con selects).
3. T2.9 fixture de imágenes de prueba (~20 productos, rutas de prueba, sin binarios).
4. Rendimiento T2.7: explain (analyze, buffers) y p95 de 50 corridas por RPC.
5. Cierre: pgTAP 01–18 remoto, advisors, lint/typecheck/test (tipos ya regenerados en T3.1b).
6. Prueba de concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh, local).

## Notas
- Correr pgTAP por el MCP: pgTAP 1.3.3 no tiene __tresults__; envolver cada aserción en `insert into tap(l) select ...` (temp table) y al final resumir ok/fallos.
