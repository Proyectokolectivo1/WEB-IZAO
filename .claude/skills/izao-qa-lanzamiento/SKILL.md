---
name: izao-qa-lanzamiento
description: Úsala al cerrar una fase, preparar pruebas automatizadas o manuales, revisar rendimiento y accesibilidad, o ejecutar la lista de salida a producción de Izao.
---

# Calidad y lanzamiento

Referencia: `docs/ESPECIFICACION.md` §30 (criterios por fase) y §31.

## Al cerrar cualquier fase

1. `pnpm lint && pnpm typecheck && pnpm test` en verde.
2. Criterios de aceptación de la fase en §30 verificados uno por uno, con evidencia (salida de pruebas, capturas, reporte de Lighthouse) en `docs/fases/F{n}.md`.
3. *Advisors* de Supabase sin alertas críticas.
4. Revisión de textos visibles: voz de marca, sin textos de relleno, sin afirmaciones de originalidad.
5. Actualizar `docs/DECISIONES.md` con lo que se ajustó frente a la especificación.

## Pruebas automatizadas

- Unitarias (Vitest): `core` (precios, dinero, estados, métricas, prorrateo), firmas de webhooks.
- Integración: adaptadores contra *mocks* con los casos raros documentados.
- E2E (Playwright): compra con cada método; abandono de contra entrega con reloj simulado; cambio de país; scroll infinito completo sin duplicados y retorno desde ficha; flujos clave del panel.
- Base de datos: `pgtap` para RLS y `catalog_listing`.
- Carga (k6): catálogo 100 req/s, checkout 10 req/s, sin errores y p95 dentro de presupuesto.

## Rendimiento y accesibilidad

Lighthouse móvil ≥ 90 (rendimiento) y ≥ 95 (accesibilidad) en home, listado, ficha y checkout. LCP < 2,5 s en 4G, CLS < 0,1, INP < 200 ms, JS inicial < 170 KB gzip.

## Pruebas manuales

iPhone/Safari, Android/Chrome, tablet y escritorio. Navegación solo con teclado. Impresión real de 10 guías seguidas en el PC de despacho.

## Lista de salida a producción

Ejecutar la lista de §31.3 completa y dejar cada punto marcado con fecha y responsable en `docs/fases/LANZAMIENTO.md`. No se apunta el DNS al nuevo sitio hasta que todos los puntos estén marcados.
