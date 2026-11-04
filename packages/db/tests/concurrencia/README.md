# Prueba de concurrencia de stock y canjes (T1.13 / T1.14)

Demuestra con conexiones paralelas reales que `reservar_stock` y `reservar_canje` dan exactamente un ganador por el último producto y respetan el límite exacto de un código. No toca ninguna base remota: levanta un `postgres:17` desechable en Docker, aplica **todas** las migraciones reales de `supabase/migrations/` y lo borra al terminar.

## Cómo correrla

```bash
cd packages/db/tests/concurrencia
N=10 bash run.sh        # N = conexiones paralelas, de 2 a 10 (por defecto 10)
IMG=postgres:17 bash run.sh   # otra imagen (por defecto postgres:17-alpine)
```

Requisitos: Docker y bash (Git Bash en Windows). Tarda unos 20 segundos.

## Qué hace

1. `00_roles_supabase.sql` crea lo mínimo de Supabase que las migraciones esperan (roles `anon`, `authenticated`, `service_role`, esquema `auth`).
2. Aplica las migraciones en orden, omitiendo solo `create extension pgtap` (la imagen no la trae; no se usa aquí).
3. `01_datos.sql` crea una variante con stock 1, un código con `usage_limit_total = 3` y 10 pedidos que piden esa variante y ese código (clientes distintos).
4. Barrera: un proceso retiene `pg_advisory_lock(42)`; los N trabajadores se conectan y esperan; al soltarse, todos llaman a `reservar_stock` y `reservar_canje` a la vez.
5. Verifica: exactamente 1 ganador de stock, `stock_reserved <= stock` (y = 1), 1 pedido en `reserved`; `min(N,3)` ganadores de canje, `usage_count` y filas `reserved` iguales a ese número.

La salida termina en `OK: concurrencia exacta` o en `FALLA: ...` con código de salida 1.

## Checkout remoto (`checkout-remoto.mjs`)

Prueba `crear_pedido_checkout` con peticiones simultáneas reales por PostgREST contra el Supabase remoto (cada llamada es su propia transacción, como en producción). Crea sus datos con prefijo por corrida (producto en borrador `prueba-concurrencia-remoto-*`, 6 variantes en CO, códigos `CONCREMOTO*`, claves `conc-remoto-*`; si CO no tiene política de datos publicada, una página temporal) y los borra al final, falle o no.

```bash
node packages/db/tests/concurrencia/checkout-remoto.mjs              # N=12, RONDAS=2
N=20 RONDAS=3 node packages/db/tests/concurrencia/checkout-remoto.mjs
node packages/db/tests/concurrencia/checkout-remoto.mjs --limpiar    # restos de una corrida abortada
```

Credenciales: `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del entorno o de `apps/web/.env.local`/`.env` (no se imprimen). Requiere Node 22.

Escenarios por ronda (N peticiones a la vez cada uno): A última unidad (stock 3 → 3 creados, N−3 `sin_stock`); B/C líneas en orden cruzado `[B,C]`/`[C,B]` de a 2 con stock 5 (2 creados, sin interbloqueos); D misma clave y huella (1 creado, N−1 `existente` con el mismo pedido); E misma clave con huellas distintas (1 creado, N−1 `idempotencia_conflicto`); F código con límite total 2 (2 creados, N−2 `limite_total`); G código de 1 uso por cliente, mismo cliente (1 creado, N−1 `limite_por_cliente`). Invariantes: stock intacto y ≥ 0, `stock_reserved` = Σ unidades de los pedidos reservados ≤ stock, pedidos en la base = creados (los rechazos no dejan filas ni reservas), `usage_count` = canjes. Termina en `OK: ...` (código 0) o `FALLA: ...` (1). Consume números de pedido de la secuencia.
