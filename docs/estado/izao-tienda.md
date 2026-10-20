# Bitácora izao-tienda (Oleada 2: F1 + F2)

## Hecho (commits en `git log`)
- T2.1 `@izao/ui` (packages/ui): tokens (`tokens.css` = `tema/defaults.ts`, sincronizados por prueba), `construirCssTema`/`resolverColores`/`resolverTipografia` (valida hex; sin inyección CSS), contraste WCAG (`tema/contraste.ts`, 9 pruebas: muted y accent advierten), movimiento con `motion/mini`, Button, Chip/ChipQuitar/Etiqueta, Skeleton/TarjetaEsqueleto, Sheet (portal `#izao-portal`, foco atrapado, Esc, scroll lock, `testId`), IzaoImage, Icono, Revelar. Commit "feat(ui)…(T2.1)".
- T2.2 (commit 38d322c "…(T2.2)"): `app/layout.tsx` (tema global + fuente), `app/page.tsx` (`/` → cookie `country` o `/co`), `app/[country]/` (layout con override de país, home, not-found, error, `cambiar-pais`), header (anuncios, menús, buscador combobox, bolso), footer + selector de país, home por `home_sections`, `lib/store/*` (types, repo + repo-supabase usando `@/lib/db/catalogo` + repo-ejemplo, filtros/cursor con pruebas, pais, textos, seo, tema, carrito/lógica con pruebas).
- Adelantado de T2.3/T2.4 (ya commiteado): `TarjetaProducto`, `VistaRapida`, `PanelCompra`, `Cantidad`, `CarritoProvider` + `CarritoDrawer` (localStorage `izao:carrito:{pais}`), `app/api/catalog/{route,suggest,related,product}`.
- Pruebas: ui 9 + web store 14 verdes; `next build` verde (NEXT_DIST_DIR=.next-tienda); First Load JS `/[country]` 127 kB (comprimido).

## Decisiones propias
- Sin TanStack Query (hook propio + sessionStorage). Carrito: subtotal local con `calcularPrecios`; `lib/store/carrito/adaptador.ts` (`SERVIDOR_DISPONIBLE=false`) se activa cuando izao-pagos publique `POST /api/checkout/preview` (Oleada 3; contrato en `contrato.ts`).
- Beneficios/confianza y asesoría salen de `home_sections.config` (`items[{icon,title,text}]`, `title/body/cta_label/cta_url`); `content_slots` keys: `medios_de_pago`, `asesoria`, `busquedas_populares`. Pedir a izao-admin que el panel use esas claves.
- Microcopy de UI en `lib/store/textos.ts` (seed). Aún hay unos pocos aria-label sueltos en español en componentes (Hero, Pestañas, AnuncioBarra): moverlos a `T`.

## Pendiente
- T2.3 hecha (listado infinito, filtros, páginas catalogo/buscar/categoria|marca|familia|coleccion/[slug], pagina/[slug] legal). Falta verificar visualmente testids del listado (centinela-scroll, fin-resultados, abrir-filtros, chip-filtro, limpiar-filtros, selector-orden, precio-min/max, esqueleto-tarjeta) y mover aria-label sueltos a `T`.
- T2.4: ficha `perfume/[slug]` (galería+zoom, PanelCompra, pirámide olfativa, confianza desde `benefits`, reseñas, relacionados, barra fija móvil, JSON-LD sin brand, botón Iza), `error`/metadata.
- Lighthouse móvil (≥ 90), revisión 360/768/1440, axe: sin medir. `STORE_DATOS=ejemplo` para ver la tienda sin llaves.

## Punto de retoma
Empezar T2.4: crear `app/[country]/perfume/[slug]/page.tsx` y componentes de ficha en `components/store/ficha/`.
