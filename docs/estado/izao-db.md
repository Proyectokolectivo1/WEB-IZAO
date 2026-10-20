# Bitácora izao-db

## Hecho
- Oleadas 0 y 1 (esquema, RLS, stock/canje/expiración, consentimientos, revisión A2/M3/B4/B5): ver commits previos; última: f63d558.
- T2.7 (RPC catálogo): migración `20261020042322_rpc_catalogo.sql` aplicada y commit 8da6bc2. pgTAP 16 verde (23 pruebas, plan corregido a 23).
  - `catalog_page(p_country,p_filters,p_sort,p_cursor,p_limit)`, `catalog_search_page(p_country,p_q,p_filters,p_sort,p_cursor,p_limit)`, `catalog_suggest(p_country,p_q,p_limit)`, `catalog_product(p_country,p_slug)`, `catalog_related(p_country,p_product_id,p_limit)`; todas jsonb, solo service_role.
  - Retorno de listado: `{items[], next_cursor|null, total_estimado|null, precio_min, precio_max}`; cursor `{o,s,v,id}` opaco.
  - Filtros: gender, brands[], families[], concentration, category(slug), availability('in_stock'), price_min, price_max, with_total. Órdenes: featured, sales, newest, price_asc, price_desc, discount (+relevance en búsqueda).

## Pendiente
1. T2.7 rendimiento: `explain (analyze, buffers)` de cada RPC (CO, 400 productos) y 50 corridas para p95 < 120 ms; confirmar uso de los índices nuevos (`set enable_seqscan=off` si el planner prefiere seq scan con 400 filas). Anotar números aquí.
2. T2.8: `apps/web/lib/db/` (cliente server-only tipado + envoltorios `catalogPage/catalogSuggest/catalogProduct/catalogRelated` con zod). Falta añadir `@izao/db` como dependencia de apps/web (package.json lo toca otro agente; usar `pnpm install` y avisar) o importar tipos por ruta relativa. Reutilizar `crearClienteServicio()` de `lib/auth/supabase/servicio.ts`.
3. T2.9: confirmar `media.variants`/`product_images` para §7.4 y §27.1 (ya alcanzan: roles primary/hover/gallery, variants jsonb por ancho, lqip). Falta fixture/función que asigne imágenes de prueba a ~20 productos (filas `media` con rutas de prueba, sin binarios).
4. Peticiones de otros agentes sin atender:
   - izao-admin: `admin_guardar_producto(p jsonb)` y `admin_importar_catalogo(p jsonb)` (contrato en su mensaje; sync transaccional del producto, no tocar stock_reserved, `variante_con_pedidos`, `sin_vinculo_mastershop`, modo simular/aplicar con skip_catalog_refresh).
   - izao-tienda: nombres del cliente en lib/db y lecturas de contenido por país (site_settings, theme_overrides, announcements, banners vigentes, home_sections, content_slots, categories con árbol y media_json, colecciones, taxonomías con slugs usados, pages por slug). Propuesta: RPC `store_*` o que izao-tienda lea tabla por tabla con select.
5. Al final: pgTAP 01–16 en el remoto, `get_advisors`, regenerar `src/types.ts`, `pnpm lint && pnpm typecheck && pnpm test`.

## Siguiente paso exacto
Medir rendimiento (punto 1), luego crear `apps/web/lib/db/` (punto 2).
