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
- Resultado ronda 1: 277 pasan, 45 fallan (14 pruebas = defectos), 116 omitidas.
- 2026-10-31, ronda 2 tras las correcciones de izao-tienda (commits «build:e2e usa la variable oficial…», «spec de hidratación…», «re-medición»):
  `build:e2e` usa `STORE_DATOS_PERMITIR_EJEMPLO=1` en `.next-ejemplo` (sin copia parchada); categorías de ejemplo desde `repo.catalogo`; pruebas más robustas
  (cajón del bolso, animaciones antes de axe, carga mínima de lotes). Resultado: 319 pasan, 4 fallan (3 pruebas), 117 omitidas; axe 109/109; Lighthouse acces. 100, rend. 95-96, LCP 2,66-2,76 s.
- Diagnóstico del #418: `e2e/hidratacion.spec.ts` y sección «Defectos» de `docs/fases/F1.md` (layout compartido, probable Buscador, 2-11 % de cargas, no depende de localStorage).

## Pendiente
- Abiertos en izao-tienda: #418 de hidratación (e2e/hidratacion), scroll al volver de la ficha tras ≥ 1 s, LCP > 2,5 s en este equipo. Las pruebas que fallan son el criterio de cierre.
- Con llaves/base: seed de 520 productos (`pnpm build` normal y sin STORE_DATOS), k6 (p95 < 120 ms; checkout 10 req/s), Lighthouse con imágenes reales,
  pgtap de RLS/catalog_listing, garantías/reseñas/Iza contra base y OpenRouter, `tests/iza` de regresión.
- Workflow de CI (izao-infra), `.lighthouseci/` en .gitignore, E2E de abandono con reloj simulado (F4), pruebas de contenido de F2 en el panel.

## Siguiente paso exacto
Tras los arreglos de la tienda: `pnpm build:e2e && STORE_DATOS=ejemplo pnpm test:e2e` (borrar `%TEMP%/playwright-transform-cache` si cambian los datos de ejemplo) (puertos 3110/54310 si el 3100 está ocupado) y volver a medir Lighthouse
(`LHCI_EXTERNO=1 LHCI_PUERTO=<p> CHROME_PATH=<chromium de playwright> STORE_DATOS=ejemplo pnpm lighthouse`).

## Decisiones que necesitan al líder
- Presupuesto de la ficha en k6 (p95 < 300 ms) sigue siendo supuesto mío.
- El orden por precio pone agotados al final (migración `rpc_catalogo`); si el dueño quiere orden puro, cambiaría el RPC y la prueba.
- No correr `next dev` y las pruebas sobre el mismo `.next` (ver tests/LEEME.md); un puerto 3100 ocupado por un servidor viejo no se pudo cerrar (permiso denegado).
