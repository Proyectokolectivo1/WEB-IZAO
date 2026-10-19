---
name: izao-supabase-db
description: Úsala antes de crear o modificar tablas, migraciones, índices, políticas RLS, funciones o triggers en la base de Supabase de Izao (proyecto wyxjmlgrcjclelbrluvd), o al tocar catalog_listing, seeds o tipos generados.
---

# Base de datos Supabase de Izao

Referencia: `docs/ESPECIFICACION.md` §6 (modelo completo), §4.6 (límites del plan gratuito).

## Proyecto

- Ref `wyxjmlgrcjclelbrluvd`, Postgres 17, plan gratuito (500 MB de base). Enlace: `supabase link --project-ref wyxjmlgrcjclelbrluvd`.
- Migraciones en `packages/db/supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`. Nunca cambios manuales en el dashboard que no queden en una migración.

## Convenciones obligatorias

- PK `uuid default gen_random_uuid()`; tablas de referencia con PK natural (`countries.code`).
- Dinero en `bigint` (unidad menor de la moneda). Prohibido `numeric` con decimales para montos y prohibido `float`.
- Todas las tablas con `created_at timestamptz default now()` y `updated_at` mantenido por trigger `set_updated_at()`.
- Nombres en `snake_case` y en inglés para tablas/columnas (como en la especificación); textos de UI en español.
- Estados como `text` con `check (status in (...))`, no `enum` de Postgres (más fácil de migrar).
- Extensiones en el esquema `extensions`: `pg_trgm`, `unaccent`, `citext`, `pgcrypto`.
- Funciones `security definer` solo cuando sea indispensable y siempre con `set search_path = ''` y nombres calificados.

## RLS

- `alter table … enable row level security;` en **todas** las tablas, en la misma migración que las crea.
- Por defecto sin políticas (denegado). El servidor usa la llave secreta.
- Políticas solo para clientes autenticados sobre lo suyo: `customers`, `addresses`, `wishlists`, `orders`/`order_items` de lectura (`customer_id` ligado a `auth.uid()`).
- Pruebas `pgtap` para cada política en `packages/db/tests/`.

## Índices

- Implementa exactamente los de §6.3 y los de `catalog_listing` (§6.4). Índices parciales `where is_visible` para listados.
- Toda consulta nueva del catálogo o de métricas se revisa con `explain (analyze, buffers)`; si hace *seq scan* sobre una tabla grande, falta un índice.

## `catalog_listing`

- Una fila por (producto, país). Función `refresh_catalog_listing(p_product_id uuid)` idempotente (`insert … on conflict do update` y borrado de países que ya no aplican).
- Triggers `after insert/update/delete` en `products`, `product_countries`, `variant_countries`, `product_images`, `product_categories` y `reviews` (aprobadas) que llaman la función para el producto afectado. Evitar recursión y trabajo duplicado en importaciones masivas: durante la importación, desactivar el trigger por sesión (`set local izao.skip_catalog_refresh = 'on'`) y llamar el refresco por lote al final.
- `search_tsv` con configuración `spanish` sobre `unaccent(...)`.

## Mantener la base liviana (500 MB)

- No crear tablas de eventos crudos de navegación. Tráfico va a `daily_traffic_stats` desde Redis.
- Retención con job: `webhook_events` 90 días, `chat_messages` 180 días.
- Las imágenes viven en disco del VPS, nunca en `bytea` ni en Supabase Storage.

## Después de cada migración

1. `supabase db push` en el entorno correcto.
2. Revisar *advisors* de seguridad y rendimiento; corregir todo lo crítico.
3. Regenerar tipos: `supabase gen types typescript --project-id wyxjmlgrcjclelbrluvd > packages/db/src/types.ts`.
4. Ejecutar pruebas `pgtap` y las del paquete `core`.

## Seed

`packages/db/supabase/seed.sql` y scripts en `packages/db/seed/`: países, monedas, `country_settings` con los valores por defecto de §6.2, regiones y ciudades (DIVIPOLA para Colombia; provincias y cantones para Ecuador), géneros, concentraciones, familias olfativas, categorías de gasto, plantillas de WhatsApp (Anexo B), páginas legales (Anexo A), `site_settings` con la paleta de §8.1.
