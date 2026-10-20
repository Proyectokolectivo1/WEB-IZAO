/**
 * Lighthouse CI con los presupuestos de §27 y §30 (móvil, red 4G simulada, valores por defecto de Lighthouse):
 *   - Rendimiento >= 90 en home, listado y ficha (accesibilidad >= 95 según skill izao-qa-lanzamiento)
 *   - LCP < 2,5 s, CLS < 0,1, INP < 200 ms, JS inicial < 170 KB gzip
 *
 * Correr desde apps/web contra la build local:
 *   pnpm build && pnpm lighthouse
 * Requiere Chrome instalado (o CHROME_PATH). El servidor usa tu `.env.local` y la base de prueba con el seed de
 * 520 productos; sin datos las páginas públicas no se pueden medir. Las salidas van a tests/.resultados/lighthouse/.
 *
 * Notas de medición:
 *  - INP no se mide en laboratorio de carga: se usa TBT < 200 ms como proxy en Lighthouse y el INP real se
 *    verifica en Playwright (pendiente en e2e/f1-catalogo.spec.ts) y con datos de campo tras el lanzamiento.
 *  - `resource-summary:script:size` es el peso TRANSFERIDO (comprimido) de todo el JS de la página: es una cota
 *    superior del "JS inicial"; si falla por JS diferido, se afina con `bundle analyzer` y se registra en DECISIONES.md.
 *  - Con CHECKOUT=1 se agrega el checkout (accesibilidad >= 95 también ahí).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- configuración CommonJS que exige lhci */
const fs = require('node:fs');
const path = require('node:path');

const PUERTO = process.env.LHCI_PUERTO || '3100';
const BASE = `http://127.0.0.1:${PUERTO}`;

const productos = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../packages/db/seed/data/productos.json'), 'utf8'),
);
const slugCo = productos.find((p) => p.status === 'active' && p.countries.co && p.countries.co.visible).slug;
const slugEc = productos.find((p) => p.status === 'active' && p.countries.ec && p.countries.ec.visible).slug;

const urls = [
  `${BASE}/co`,
  `${BASE}/co/categoria/hombre`,
  `${BASE}/co/perfume/${slugCo}`,
  `${BASE}/ec`,
  `${BASE}/ec/perfume/${slugEc}`,
];
if (process.env.CHECKOUT === '1') urls.push(`${BASE}/co/checkout`);

const JS_INICIAL_MAX_BYTES = 170 * 1024; // §27: 170 KB gzip

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: Number(process.env.LHCI_CORRIDAS || 3), // mediana de 3 para absorber ruido
      startServerCommand: `pnpm exec next start -H 127.0.0.1 -p ${PUERTO}`,
      startServerReadyPattern: 'Ready|ready|Local:',
      startServerReadyTimeout: 60000,
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3, disabled: false },
        locale: 'es-CO',
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        // Proxy de INP en laboratorio.
        'total-blocking-time': ['error', { maxNumericValue: 200, aggregationMethod: 'median' }],
        'resource-summary:script:size': ['error', { maxNumericValue: JS_INICIAL_MAX_BYTES, aggregationMethod: 'median' }],
        'is-crawlable': 'error',
        'image-alt': 'error',
        'color-contrast': 'error',
        'uses-text-compression': 'warn',
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: path.resolve(__dirname, '../.resultados/lighthouse'),
    },
  },
};
