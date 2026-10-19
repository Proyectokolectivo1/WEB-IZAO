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
