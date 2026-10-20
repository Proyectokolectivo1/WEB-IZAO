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

## Pendientes de activar (`test.fixme`)

`e2e/f1-catalogo.spec.ts` y los casos públicos de `a11y/paginas.spec.ts`: se activan quitando `fixme` cuando
izao-tienda publique las rutas y los `data-testid` de `support/rutas.ts`.

## CI

El workflow (`.github/`, de izao-infra) debe: `pnpm install --frozen-lockfile` -> `playwright install --with-deps chromium`
-> `pnpm build` -> `pnpm --filter @izao/web test:e2e` con `CI=1`; subir `apps/web/tests/.resultados/` como artefacto.
Lighthouse CI y k6 van en jobs aparte (ver `lighthouse/` y `k6/LEEME.md`).

## Reloj simulado

Flujos con tiempo (contra entrega, expiraciones): `page.clock.install()` / `page.clock.fastForward()`; nunca esperas reales.
