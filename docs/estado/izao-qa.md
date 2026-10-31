# Bitácora de izao-qa

## Hecho
- Oleada 2 inicial (996a209, 229582a, ce73e78, b46408c): Playwright (datos/escritorio/móvil), humo, k6 y Lighthouse listos, a11y del login.
- 2026-10-31, tienda publicada, sin llaves (`STORE_DATOS=ejemplo`), un commit por tarea:
  1. Quita `fixme` de f1-catalogo y a11y. Infra sin llaves: `pnpm build:e2e` (copia `apps/.e2e-web` sin compuerta NODE_ENV), globalSetup
     vuelca `repo-ejemplo` a `.resultados/ejemplo.json`, `support/entorno.ts` MODO_EJEMPLO. Commit «activa f1-catalogo y a11y…».
  2. E2E nuevos con mocks (`page.route`): f1-ficha, f3-carrito-checkout, f2-garantias, f2-resenas, f8-iza. Commit «e2e de ficha, carrito…».
  3. axe 16 rutas × 2 países × 360/768/1440 px. Commit «axe WCAG 2.2 AA…». Luego «cumple eslint…».
  4. Lighthouse móvil (3 corridas, mediana) de home, catálogo, listado y ficha CO/EC; `lighthouserc.cjs` acepta ejemplo/servidor externo;
     `lighthouse/resumen.cjs`, `support/resumen-playwright.cjs`; evidencia en `docs/fases/F1.md` y `F1-evidencia/`.
- Resultado: 277 pasan, 45 fallan (14 pruebas = 12 defectos del producto, sin debilitar nada), 116 omitidas. lint, typecheck y vitest verdes.

## Pendiente
- Que izao-tienda corrija los defectos 1-12 de `docs/fases/F1.md` y reabrir (las pruebas que fallan son el criterio de cierre).
- Con llaves/base: seed de 520 productos (`pnpm build` normal y sin STORE_DATOS), k6 (p95 < 120 ms; checkout 10 req/s), Lighthouse con imágenes reales,
  pgtap de RLS/catalog_listing, garantías/reseñas/Iza contra base y OpenRouter, `tests/iza` de regresión.
- Workflow de CI (izao-infra), `.lighthouseci/` en .gitignore, E2E de abandono con reloj simulado (F4), pruebas de contenido de F2 en el panel.
- Pedir a izao-tienda una variable oficial (p. ej. `STORE_DATOS_PERMITIR_EJEMPLO=1`) para no depender de la copia parchada de `build:e2e`.

## Siguiente paso exacto
Tras los arreglos de la tienda: `pnpm build:e2e && STORE_DATOS=ejemplo pnpm test:e2e` (puertos 3110/54310 si el 3100 está ocupado) y volver a medir Lighthouse
(`LHCI_EXTERNO=1 LHCI_PUERTO=<p> CHROME_PATH=<chromium de playwright> STORE_DATOS=ejemplo pnpm lighthouse`).

## Decisiones que necesitan al líder
- `apps/.e2e-web` (copia parchada) es una solución temporal; la limpia es una variable explícita en `lib/store/datos.ts`/`checkout-datos.ts` (dueño izao-tienda).
- Presupuesto de la ficha en k6 (p95 < 300 ms) sigue siendo supuesto mío.
- El orden por precio pone agotados al final (migración `rpc_catalogo`); si el dueño quiere orden puro, cambiaría el RPC y la prueba.
- No correr `next dev` y las pruebas sobre el mismo `.next` (ver tests/LEEME.md); un puerto 3100 ocupado por un servidor viejo no se pudo cerrar (permiso denegado).
