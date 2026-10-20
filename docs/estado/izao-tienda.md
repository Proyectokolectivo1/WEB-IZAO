# Bitácora izao-tienda (Oleada 2: F1 + F2)

## Hecho
- T2.1 `@izao/ui` (packages/ui): tokens (`tokens.css` + `tema/defaults.ts` sincronizados por prueba), `construirCssTema`/`resolverColores`/`resolverTipografia` (valida hex, sin inyección de CSS), contraste WCAG (`tema/contraste.ts`), movimiento con `motion/mini`, Button, Chip/ChipQuitar/Etiqueta, Skeleton/TarjetaEsqueleto, Sheet (portal, foco atrapado, Esc, scroll lock), IzaoImage (srcset + LQIP, sin next/image), Icono (set de línea fina), Revelar. Commit en `git log -- packages/ui`.
- `apps/web/lib/store/`: `types.ts`, `repo.ts` (interfaz), `repo-supabase.ts` (RPC `catalog_*` + selects públicos con `unstable_cache` y tags `content:`/`catalog:`), `repo-ejemplo.ts` (datos inventados, solo desarrollo), `datos.ts` (selector `tienda()`; `STORE_DATOS=ejemplo|supabase`), `filtros.ts` (+prueba: URL, cursor base64url), `pais.ts`, `textos.ts` (microcopy §8.6), `fuentes.ts` (6 parejas next/font).

## Decisiones propias
- Sin TanStack Query: hook propio de lote infinito + `sessionStorage` (menos KB de JS).
- Contenido de beneficios/asesoría vive en `home_sections.config` (items/ title/ body); bloque de confianza de la ficha lee la sección `benefits` del país.
- `content_slots.key = 'busquedas_populares'` (body separado por saltos de línea/comas) = búsquedas populares.
- `next.config.ts`: añadí `transpilePackages: ['@izao/ui','@izao/core']` (archivo de infra; avisar).

## Pendiente / bloqueos
- izao-db: filtro `collection` (slug) en `catalog_page` (pestañas del home y `/coleccion/{slug}`); lecturas `store_*` opcionales.
- izao-admin: redirect `/` → `/co|/ec` (cookie `country`) en middleware.
- izao-pagos: endpoint de vista previa de código de descuento del carrito (`POST /api/cart/codigo`).

## Siguiente paso exacto
T2.2: layout raíz con tema (cargarTema + clasesFuentes), `app/[country]/layout.tsx`, header/footer, home por secciones.
