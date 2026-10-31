# Pruebas e2e, accesibilidad y rendimiento (izao-qa)

Zona de izao-qa. Playwright vive solo en `apps/web` (`@playwright/test`, `@axe-core/playwright`).

## Correrlas en local

```bash
cd apps/web
pnpm exec playwright install chromium      # una vez (WebKit real: ... install webkit y E2E_WEBKIT=1)
pnpm build                                 # genera .next (las pruebas usan el build, no `next dev`)
pnpm test:e2e                              # todo: datos + escritorio + movil
pnpm test:e2e:humo                         # solo humo y datos
pnpm test:a11y                             # axe WCAG 2.2 AA
pnpm exec playwright show-report tests/.resultados/informe
```

`playwright.config.ts` levanta solo: (1) `supabase-falso.mjs` (puerto 54399) y (2) `next start` (puerto 3100)
con variables de PRUEBA que apuntan al falso. Nunca se llama a Supabase real ni a ningún proveedor; no se necesitan llaves.
Las salidas van a `tests/.resultados/` (ignorada por git); la evidencia que se conserva se copia a `docs/fases/`.

## Proyectos

| Proyecto | Qué es |
|---|---|
| `datos` | Sin navegador. Valida la convención de datos del seed. |
| `escritorio` | Chrome 1440x900, puntero fino (hover). |
| `movil` | iPhone 13 (viewport, táctil, UA) sobre Chromium; `E2E_WEBKIT=1` para WebKit. |

Las pruebas solo de escritorio o solo táctiles usan `test.skip(isMobile, ...)` / `test.skip(!isMobile, ...)`.

## Convención de datos

Los 520 productos de prueba de `packages/db/seed/data/productos.json`: 400 visibles por país (100 solo en CO,
100 solo en EC, 20 borradores). `support/semilla.ts` los lee del archivo, así los resultados esperados no dependen
de consultar la base. Cuando el catálogo corra contra Supabase real, la base debe tener el seed aplicado.
`support/pais.ts`: `fijarPais(context, 'co'|'ec')` (cookie `country`), `limpiarEstado(page)`, `iniciarSinEstado(context)`.
`support/rutas.ts`: rutas y `data-testid` que se piden a izao-tienda; lo marcado "POR CONFIRMAR" se ajusta allí.

## Sin llaves: `STORE_DATOS=ejemplo`

La tienda en producción nunca usa datos de ejemplo (`NODE_ENV=production` fuerza Supabase). Para probarla sin llaves:

```bash
pnpm build:e2e                      # copia apps/web -> apps/.e2e-web (ignorada por git), quita la compuerta de NODE_ENV en 4 archivos de la copia y construye
STORE_DATOS=ejemplo pnpm test:e2e   # el config sirve esa copia con `next start`; el globalSetup vuelca los datos de ejemplo a .resultados/ejemplo.json
```

El código de la tienda no se modifica. Los datos esperados salen de `repo-ejemplo.ts` (no de la API probada). Lo que el ejemplo no tiene
(imágenes, categorías, productos solo en EC, base real) se omite con una razón y está en `docs/fases/F1.md`, sección «No medido».
Si el puerto 3100 está ocupado: `E2E_PUERTO_WEB=3110 E2E_PUERTO_SUPABASE=54310`. Resúmenes para la evidencia:
`node tests/support/resumen-playwright.cjs <json>` y `node tests/lighthouse/resumen.cjs`.

El servidor de pagos, garantías, reseñas e Iza se simulan con `page.route` (contratos en `lib/store/*/contrato.ts`); ninguna prueba llama a un proveedor.

## CI

El workflow (`.github/`, de izao-infra) debe: `pnpm install --frozen-lockfile` -> `playwright install --with-deps chromium`
-> `pnpm build` -> `pnpm --filter @izao/web test:e2e` con `CI=1`; subir `apps/web/tests/.resultados/` como artefacto.
Lighthouse CI y k6 van en jobs aparte (ver `lighthouse/` y `k6/LEEME.md`).

## Lighthouse y carga

- `pnpm lighthouse` (desde `apps/web`, tras `pnpm build`): `lighthouse/lighthouserc.cjs` con los presupuestos de §27
  (rendimiento >= 90, accesibilidad >= 95, LCP < 2,5 s, CLS < 0,1, TBT < 200 ms como proxy de INP, JS < 170 KB gzip).
  Necesita Chrome (o `CHROME_PATH`) y el seed aplicado; mide home, listado y ficha de CO y EC. `CHECKOUT=1` suma el checkout.
  Verificado el mecanismo contra `/admin/login` (pasa rendimiento, accesibilidad, LCP, CLS, TBT y peso de JS).
  `lhci` crea `apps/web/.lighthouseci/` (temporal; falta ignorarlo en el `.gitignore` raíz, de izao-infra).
- Carga: ver `k6/LEEME.md`.

## Advertencia: un solo `.next`

`pnpm build` y `next dev` escriben en la misma carpeta `apps/web/.next`. Si alguien corre `next dev` (o compila con errores
de tipos de otro agente) mientras corres `test:e2e`, el build se corrompe. Para pruebas reproducibles, corre desde una copia
limpia (`git worktree add`) o en CI. Propuesta a izao-infra: `distDir: process.env.NEXT_DIST_DIR ?? '.next'` en `next.config.ts`.

## Reloj simulado

Flujos con tiempo (contra entrega, expiraciones): `page.clock.install()` / `page.clock.fastForward()`; nunca esperas reales.
