---
name: izao-catalogo
description: Úsala al construir o modificar el catálogo público de Izao — listado con scroll infinito, filtros, barra de precio, búsqueda, tarjeta con imagen hover, vista rápida, ficha de producto, carrito o la caché de esas vistas.
---

# Catálogo público de Izao

Referencia: `docs/ESPECIFICACION.md` §7, §6.4, §6.5, §27.

## Datos

- Listados leen **solo** `catalog_listing` filtrado por `country_code` e `is_visible`. Nunca joins a `products` en el listado.
- Paginación **keyset**, 25 por lote. Cursor opaco en base64url con `{orden, valor, product_id}`. Prohibido `OFFSET`.
- Órdenes: destacados (`sort_featured desc, product_id`), más vendidos (`sales_30d desc`), novedades (`published_at desc`), precio asc/desc (`min_price`), mayor descuento (`discount_pct desc`).
- Endpoint `GET /api/catalog` valida con `zod`; respuesta `{ items, nextCursor }`. Caché Redis 60 s por clave normalizada; invalidación por `revalidateTag('catalog:{país}')` al guardar en el panel.
- Meta: p95 < 120 ms.

## Listado infinito

- Primer lote renderizado en servidor (SEO/LCP). Siguientes con TanStack Query `useInfiniteQuery`.
- Centinela `IntersectionObserver` con `rootMargin: '800px'`.
- Esqueletos con la proporción exacta de la tarjeta (CLS = 0).
- Estado de filtros y orden en la URL. Restauración de lotes y scroll al volver de la ficha.
- `content-visibility: auto; contain-intrinsic-size` en tarjetas.
- Enlaces `?page=N` rastreables con `rel="next"` para buscadores.

## Filtros

Género, marca, familia, concentración, categoría, disponibilidad y **rango de precio con doble manija** + campos numéricos, usando el mínimo y máximo reales del país (consulta agregada cacheada). Móvil: hoja inferior con contador en vivo. Chips de filtros activos.

## Búsqueda

`unaccent` + `pg_trgm` + `tsvector` español. Sugerencias con *debounce* 200 ms y cancelación de peticiones previas (`AbortController`).

## Tarjeta

- Imagen 4:5 con `srcset` 400/800 y LQIP de fondo.
- Hover solo con `@media (hover: hover) and (pointer: fine)`: crossfade 450 ms a la imagen `hover` + escala 1.03. La imagen hover se carga en el primer `pointerenter` de la grilla o en `requestIdleCallback`.
- Táctil: deslizar entre las 2 primeras imágenes con puntos.
- Etiquetas (% descuento, Nuevo, Hot Sale, Agotado), lista de deseos, vista rápida, agregar.

## Ficha

Galería con zoom, variantes en chips, pirámide olfativa, bloque de confianza desde el panel, reseñas, relacionados, barra fija en móvil, botón "Pregúntale a Iza", JSON-LD `Product`/`Offer`/`AggregateRating` **sin `brand`**. `revalidateTag('product:{id}')`.

## Carrito

Drawer; `localStorage` envuelto en `try/catch`; sincronización al iniciar sesión; el servidor revalida precio, stock y código en cada cambio relevante.

## Verificación

Con 400 productos de prueba por país: lotes sin saltos ni duplicados (prueba e2e que recorre todo el listado y compara contra la base), Lighthouse móvil ≥ 90, CLS < 0,1.
