# Bitácora izao-pagos

## Hecho
- 3a7e66b `POST /api/checkout/preview` y `POST /api/checkout` (§7.7, §10, §11, §17.1). Código en `apps/web/lib/checkout/` (fuente.ts interfaz, fuente-supabase.ts, carrito.ts, vista-previa.ts, crear-pedido.ts, http.ts, limite-tasa.ts) y rutas en `apps/web/app/api/checkout/`. 57 pruebas nuevas (fuente en memoria que imita reservar_stock/reservar_canje); web 322 y core 779 verdes; lint y typecheck limpios.

## Contrato
- Vista previa: el de `lib/store/carrito/contrato.ts` sin cambios incompatibles. Acepta `country` en mayúsculas o minúsculas. Aditivo: `payment_method?` en la entrada y `totals {currency, payment_method, payment_method_available, surcharge, total_customer, cod_deposit, cod_collect, available_methods[], manual_allowed, messages[]}` en la salida. `code.status = 'withdrawn'` solo si se pide con addi/sistecredito (el bolso nunca lo manda). Subtotal, descuento y `line_discount` se calculan sobre `max_quantity`. Línea inexistente: `unit_price "0"`, `max_quantity 0`.
- Checkout: cuerpo = `checkoutInputSchema` de core. 201 crea / 200 repite: `{order (forma orderSummarySchema, montos texto), public_token, next_step (pay_wompi|pay_addi|pay_sistecredito|pay_cod_deposit|manual_whatsapp), status_path, repeated, warnings[]}`. Errores `{error, issues?, lines?, reason?, missing_amount?}`: 400 INVALID_INPUT, 409 STOCK_CHANGED/IDEMPOTENCY_CONFLICT/CHECKOUT_IN_PROGRESS, 422 CODE_REJECTED/METHOD_UNAVAILABLE/SHIPPING_LOCATION_INVALID, 413, 415, 429 RATE_LIMITED (Retry-After), 503 UNAVAILABLE.
- Estado inicial: wompi/addi/sistecredito → pendiente_pago; cod → esperando_abono; manual → pendiente_manual. Evento `created` en order_events (la creación no es transición; no pasa por `transicionar`).

## Pendiente
- Cobro: link de Wompi, Addi, Sistecrédito y abono de contra entrega (el checkout solo deja el pedido y `next_step`).
- UTM y click IDs (no hay cookie de primer/último toque), `customer_id`, `gateway_fee_estimated` (queda 0).
- Rate limit en memoria del proceso (provisional): pasar a Redis cuando exista el cliente compartido. Variables opcionales `CHECKOUT_RATE_LIMIT_PER_MIN` (10) y `CHECKOUT_PREVIEW_RATE_LIMIT_PER_MIN` (60).
- Turnstile: no hay infraestructura (ni llave ni widget); §26.1 no lo exige en checkout. Si se quiere, cabecera `x-turnstile-token` verificada en `http.ts`.
- `fuente-supabase.ts` sin probar contra la base real (faltan llaves en `.env.local`): verificar los `select` embebidos y la inserción de bigint como texto.

## Siguiente paso exacto
Link de pago Wompi (skill izao-wompi) a partir de `next_step = pay_wompi`, con credenciales sandbox del panel.

## Decisiones que necesitan al líder
- Atomicidad: hoy son llamadas separadas (insert pedido → líneas → reservar_stock → reservar_canje) con deshacer (liberar canje, liberar stock, borrar pedido). Si deshacer falla, el pedido queda sin evento `created`, no se entrega por idempotencia y lo vence `pedidos_por_vencer`. Propuesta: pedir a izao-db `crear_pedido_checkout(p jsonb)` transaccional.
- `max_quantity` revela existencias hasta la cantidad pedida (pedir 999 muestra el stock real hasta 999). Lo pide el contrato; mitigado con el límite por IP. ¿Acotarlo (p. ej. a 10)?
- Pedidos fallidos se borran (no se transicionan a expirado/abandonado) para no ensuciar métricas de abandono; quedan huecos en la numeración IZ-XX-NNNNNN.
