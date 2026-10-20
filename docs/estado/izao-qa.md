# Bitácora de izao-qa

## Hecho (Oleada 2, parte inicial)
- T2.10 Playwright en `apps/web/tests/` (proyectos datos, escritorio, movil iPhone 13; `next start` + Supabase falso en :54399; humo de /api/health y /admin/login). Commit 996a209.
- T2.11 `e2e/f1-catalogo.spec.ts` (31 `test.fixme` con pasos exactos, citan §) + `a11y/paginas.spec.ts` (axe WCAG 2.2 AA; /admin/login ya pasa). Commit 229582a.
- T2.12 `k6/catalogo.js` y `k6/ficha.js` (sin ejecutar: no hay k6 ni /api/catalog), `tests/lighthouse/lighthouserc.cjs` (probado contra /admin/login). Commits ce73e78 y b46408c.
- Resultado verificado en copia limpia de HEAD: 19 pasan, 91 pendientes (fixme), 0 fallan.

## Pendiente
- Activar los `fixme` cuando izao-tienda publique rutas, `data-testid` (`support/rutas.ts` SEL) y clave del carrito.
- Workflow de CI (pedido a izao-infra), `.lighthouseci/` en .gitignore, `distDir` por variable en next.config.ts.
- F2: pruebas de contenido (vista previa, contraste del tema) cuando izao-admin tenga los módulos.
- Ejecutar k6 y Lighthouse reales con el catálogo en local; guardar evidencia en `docs/fases/F1.md`.

## Siguiente paso exacto
Con la tienda publicada: quitar `fixme` de a11y (poner `listo: true`) y de f1-catalogo, correr `pnpm build && pnpm test:e2e`, reportar fallos como defectos al dueño.

## Decisiones que necesitan al líder
- Presupuesto de la ficha en k6 (p95 < 300 ms) es supuesto mío; no está en la especificación.
- No correr `next dev` y las pruebas sobre el mismo `.next` (ver tests/LEEME.md).
