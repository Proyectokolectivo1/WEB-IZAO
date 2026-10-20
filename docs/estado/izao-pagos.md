# Bitácora izao-pagos

## Hecho
- 3a7e66b `POST /api/checkout/preview` y `POST /api/checkout` (§7.7, §10, §11, §17.1) en `apps/web/lib/checkout/`.
- (este commit) Wompi pago completo (§12.2, D-024): `@izao/wompi` (credenciales, firmas, Web Checkout, eventos, cliente, mock), `@izao/core/credentials` (AES-256-GCM), `comisionPasarela` en pricing, `lib/checkout/pago-wompi.ts` + `fuente-pagos-supabase.ts`, `POST /api/checkout/pago`, `payment` aditivo en `POST /api/checkout`, webhook `app/api/webhooks/wompi/` (firma, `webhook_events`, BullMQ), job `apps/worker/src/jobs/payments/`. `crear_pedido_checkout` integrado (sin deshacer ni borrado). Tope de `max_quantity` en vista previa.

## Contrato
- Checkout: igual que antes + `payment: {checkout_url, expires_at} | null` solo si `next_step = pay_wompi`.
- `POST /api/checkout/pago` `{country, token}` → 200 `{checkout_url, expires_at, reused}`; 404 NOT_FOUND; 409/410/503 `{error:'PAYMENT_NOT_AVAILABLE', reason: metodo|estado|pagado|vencido|conflicto|sin_credenciales}`; 400; 429.
- La tienda ya lee `payments` (created/pending, https, sin vencer) en `/pedido/[token]`: no hay que cambiarla.
- Cola `pagos`, job `wompi.transaccion` `{event_id, transaction_id}`, id `wompi.{event_id}` (constantes en `@izao/wompi`).
- Variables nuevas: `CHECKOUT_PREVIEW_MAX_QUANTITY` (10), `CHECKOUT_PAY_RATE_LIMIT_PER_MIN` (20), `SITE_URL`, `REDIS_URL` en web; worker necesita `APP_ENCRYPTION_KEY`.

## Pendiente
- izao-infra: registrar la cola en `apps/worker/src/{queues,index}.ts`: `createWorker(COLA_PAGOS, crearProcesadorPagos(dependenciasPagosDesdeEnv(encolarTransportadora)), conexión)` de `jobs/payments/index.ts`; el build del worker (`tsc` con `rootDir src`) no compila paquetes del workspace: pasar a bundler (tsup/esbuild) o `tsx`.
- izao-logistica: función `encolarTransportadora(orderId)` (job `carrier.create`, id fijo por pedido).
- izao-db: índice único parcial `payments (provider, provider_reference) where provider_reference is not null` (hoy la carrera de dos intentos iguales se resuelve en código) y función atómica `aplicar_transicion_pedido` (hoy update condicional + insert del evento, en dos sentencias).
- izao-admin: módulo de integraciones debe cifrar con `cifrarCredenciales` de `@izao/core/credentials` (formato en D-024) y permitir una sola credencial activa por proveedor/país.
- Probar contra sandbox real (sin llaves en `.env.local`): un evento real para confirmar el checksum (el ejemplo de la documentación es ilustrativo) y `bytea` vía PostgREST.
- Abono de contra entrega (`payment_links`), Addi, Sistecrédito; el job deja `cod_deposit`/`financing` sin procesar (`proposito_no_soportado`).
- Rate limit en memoria (pasar a Redis); UTM, `customer_id`, `gateway_fee_estimated`.

## Siguiente paso exacto
Link de abono de contra entrega por `POST /v1/payment_links` + `pay_links` y su rama en el job (skill izao-contraentrega-whatsapp).

## Decisiones que necesitan al líder
- Lint de `apps/web` falla por las carpetas sin seguimiento `.next-tienda/` y `.next-tienda-dev/` (salida de compilación de izao-tienda): agregarlas al ignore de ESLint/git.
- Se agregaron dependencias: `@izao/wompi`, `bullmq`, `ioredis` en `apps/web`; `@izao/core`, `@izao/wompi` en `apps/worker`; `@izao/wompi` en `transpilePackages` de `next.config.ts` (cambia `pnpm-lock.yaml`).
