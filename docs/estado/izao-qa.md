# Bitácora de izao-qa

## Hecho
- Oleada 2 (996a209, 229582a, ce73e78, b46408c): Playwright (datos/escritorio/móvil), humo, k6 y Lighthouse, a11y del login.
- 2026-10-31, tienda sin llaves (`STORE_DATOS=ejemplo`): activa f1-catalogo y a11y; e2e con mocks (ficha, carrito/checkout, garantías, reseñas, Iza);
  axe 16 rutas x 2 países x 3 anchos; Lighthouse móvil con evidencia en `docs/fases/F1.md`. `build:e2e` usa `STORE_DATOS_PERMITIR_EJEMPLO=1`.
- Ronda 2 (tras arreglos de izao-tienda): 319 pasan, 4 fallan (3 pruebas), 117 omitidas; axe 109/109; Lighthouse acces. 100, rend. 95-96, LCP 2,66-2,76 s.
- 2026-11-06 F9 contra PRODUCCIÓN (solo lectura): informe `docs/fases/F9-lanzamiento.md`; evidencia `docs/fases/F9-evidencia/`.
  Nuevos: `tests/produccion/f9-produccion.spec.ts` (35 pruebas, 31 pasan, 4 fallan = defectos), `tests/playwright.produccion.config.ts`,
  `tests/lighthouse/produccion.cjs`; `playwright.config.ts` ignora `produccion/**`. Lighthouse: rend./acces. >= 97/100; LCP carrito/checkout 2,57-2,59 s.
- 2026-11-07 Lighthouse móvil en producción tras a65978e (3 corridas, mediana; `docs/fases/F9-evidencia/lighthouse-post-rendimiento.json`): LCP 1,42-1,82 s en home, catálogo,
  ficha, bolso y checkout (antes hasta 2,59 s); rend. 98-100, CLS <= 0,003, TBT <= 10 ms, JS 144-166 KB; SEO 100 (carrito/checkout 66 por noindex intencional).
  Todo LCP es texto: producción sin fotos. Una corrida de checkout dio 3,56 s por TTFB. Scripts: `produccion.cjs` (env `MODOS`), `mediana.cjs`. En Git Bash usar `MSYS_NO_PATHCONV=1`.
- 2026-11-09 QA de lanzamiento CO (rama `chore/qa-lanzamiento-co`, sobre 3efe7ef): k6 ejecutado contra el build de ejemplo + Supabase falso
  (`k6/soporte/`; nuevos `checkout.js`, `paginas.js`; `DATOS`/`PAIS` en `lib/comun.js`): catálogo 100 req/s p95 2,26 ms, checkout 10/s p95 110,8 ms, 0 % errores.
  Lighthouse local con bolso lleno (`tests/lighthouse/local.cjs`) y de producción (3 corridas); e2e 527/6/191; lista de salida en `docs/fases/LANZAMIENTO.md`; evidencia en `docs/fases/F9-qa-co-2026-11-09/`.

## Pendiente
- Defectos abiertos (detalle y dueños en F9-lanzamiento.md): EC sin productos y CO con 2; políticas sin publicar y placeholders `[...]`; píxeles/feeds inexistentes
  y CSP; meta description en home/catálogo/EC; restauración real de backup; HSTS includeSubDomains y versión de nginx.
- Abiertos en izao-tienda (de antes): #418 de hidratación, scroll al volver de la ficha, LCP con fotos reales sin medir (hoy ninguna ficha tiene fotos).
- Defectos nuevos D-Q1..D-Q10 (LANZAMIENTO.md): CSP bloquea LQIP `data:`, LCP de /co/catalogo 3,0 s con foto real, contraste en placeholder, prueba Iza §20.2.
- Con staging/llaves: k6 con la base real (`DATOS=seed`), Lighthouse de carrito/checkout en producción, pgTAP RLS,
  Iza contra OpenRouter, e2e de abandono con reloj simulado (F4), pruebas manuales en iPhone/Android y teclado.

## Siguiente paso exacto
Tras corregir D-Q1/D-Q2 y cargar catálogo, EC y políticas: repetir LANZAMIENTO.md (k6 en staging, produccion.cjs x3) y marcar §31.3. Antes: repetir `cd apps/web && pnpm exec playwright test -c tests/playwright.produccion.config.ts` y
`CHROME_PATH=<chromium> node tests/lighthouse/produccion.cjs ../../docs/fases/F9-evidencia/lighthouse`; luego marcar §31.3 con fecha y responsable.

## Decisiones que necesitan al líder
- Si autoriza k6 contra staging (no producción) o un humo de <= 10 VUs en producción con la guarda del script retirada.
- Presupuesto de la ficha en k6 (p95 < 300 ms) sigue siendo supuesto mío.
- El orden por precio pone agotados al final (RPC `rpc_catalogo`); si el dueño quiere orden puro, cambia el RPC y la prueba.
