/**
 * Lighthouse contra la tienda LOCAL (build de ejemplo, `STORE_DATOS=ejemplo`) con el bolso lleno en carrito y checkout.
 * Móvil (4G simulada) y escritorio; varias corridas por URL y mediana. Zona de izao-qa.
 *
 *   BASE=http://127.0.0.1:3110 CORRIDAS_MOVIL=3 RUTAS=/co/catalogo (opcional: solo esas rutas) CORRIDAS_ESCRITORIO=1 node tests/lighthouse/local.cjs <carpeta-salida>
 *
 * Por qué no `lhci`: el carrito vive en `localStorage` y Lighthouse borra el almacenamiento antes de cada corrida; aquí se
 * abre Chromium (el de Playwright) con un perfil propio, se agrega un producto por la interfaz y se mide con
 * `disableStorageReset` para que carrito y checkout muestren una compra real y no el estado vacío. Como esa opción también
 * conserva la caché HTTP (el JS saldría con 0 KB transferidos), antes de cada corrida se vacía con `Network.clearBrowserCache`.
 * Escribe resumen.json y un .html por URL/modo (la corrida mediana por LCP).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS de apoyo */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const BASE = (process.env.BASE || 'http://127.0.0.1:3110').replace(/\/$/, '');
if (/izaoperfumeria\.com/i.test(BASE)) throw new Error('local.cjs no se usa contra producción (ver produccion.cjs).');
const salida = path.resolve(process.argv[2] || 'lh-local');
fs.mkdirSync(salida, { recursive: true });
const PUERTO = Number(process.env.PUERTO_CDP || 9344);
const N_MOVIL = Number(process.env.CORRIDAS_MOVIL || 3);
const N_ESCRITORIO = Number(process.env.CORRIDAS_ESCRITORIO || 1);

const productos = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.resultados/ejemplo.json'), 'utf8'));
const slug = productos.find((p) => p.status === 'active' && p.countries.co && p.countries.co.visible).slug;
const RUTAS = [
  { ruta: '/co' },
  { ruta: '/co/catalogo' },
  { ruta: `/co/perfume/${slug}` },
  { ruta: '/co/carrito', bolso: true },
  { ruta: '/co/checkout', bolso: true },
];

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

(async () => {
  const { default: lighthouse } = await import('lighthouse');
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'izao-lh-'));
  const ctx = await chromium.launchPersistentContext(perfil, {
    headless: true,
    args: [`--remote-debugging-port=${PUERTO}`, '--no-sandbox'],
  });
  await ctx.addCookies([{ name: 'country', value: 'co', url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/co/perfume/${slug}`);
  await page.getByTestId('boton-agregar').first().click();
  await page.getByTestId('contador-carrito').filter({ hasText: '1' }).waitFor();
  await page.close();

  const resumen = [];
  const SOLO = process.env.RUTAS ? process.env.RUTAS.split(',') : null;
  for (const { ruta, bolso } of RUTAS) {
    if (SOLO && !SOLO.includes(ruta)) continue;
    for (const modo of ['mobile', 'desktop']) {
      const n = modo === 'mobile' ? N_MOVIL : N_ESCRITORIO;
      const corridas = [];
      for (let i = 0; i < n; i++) {
        const config = {
          extends: 'lighthouse:default',
          settings: {
            onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
            disableStorageReset: true,
            formFactor: modo,
            screenEmulation:
              modo === 'mobile'
                ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 3, disabled: false }
                : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
            throttling:
              modo === 'mobile'
                ? undefined
                : { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
            locale: 'es-CO',
          },
        };
        if (!config.settings.throttling) delete config.settings.throttling;
        // `disableStorageReset` conserva localStorage (el bolso) pero también la caché HTTP: se vacía a mano para medir en frío.
        const pg = await ctx.newPage();
        await (await ctx.newCDPSession(pg)).send('Network.clearBrowserCache');
        await pg.close();
        const r = await lighthouse(`${BASE}${ruta}`, { port: PUERTO, output: ['html', 'json'], logLevel: 'error' }, config);
        const lhr = r.lhr;
        corridas.push({ lhr, html: r.report[0] });
      }
      const c0 = corridas.map((c) => c.lhr.audits['largest-contentful-paint'].numericValue);
      const medio = corridas[c0.indexOf(mediana(c0))];
      const a = medio.lhr.audits;
      const cat = medio.lhr.categories;
      const fallan = Object.values(a)
        .filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable')
        .map((x) => `${x.id}(${x.score})`);
      const escr = corridas.map((c) => c.lhr.categories);
      const fila = {
        ruta,
        modo,
        bolso: Boolean(bolso),
        corridas: n,
        rendimiento: mediana(escr.map((x) => Math.round(x.performance.score * 100))),
        accesibilidad: Math.min(...escr.map((x) => Math.round(x.accessibility.score * 100))),
        buenasPracticas: mediana(escr.map((x) => Math.round(x['best-practices'].score * 100))),
        seo: mediana(escr.map((x) => Math.round(x.seo.score * 100))),
        lcp_s: +(mediana(c0) / 1000).toFixed(2),
        lcp_s_corridas: c0.map((v) => +(v / 1000).toFixed(2)),
        cls: +Math.max(...corridas.map((c) => c.lhr.audits['cumulative-layout-shift'].numericValue)).toFixed(3),
        tbt_ms: Math.round(mediana(corridas.map((c) => c.lhr.audits['total-blocking-time'].numericValue))),
        fcp_s: +(a['first-contentful-paint'].numericValue / 1000).toFixed(2),
        ttfb_ms: Math.round(a['server-response-time'].numericValue),
        js_kb_transferido: Math.round(((a['resource-summary'].details.items.find((i) => i.resourceType === 'script') || {}).transferSize || 0) / 1024),
        imagenes_kb: Math.round(((a['resource-summary'].details.items.find((i) => i.resourceType === 'image') || {}).transferSize || 0) / 1024),
        lcpElemento: (a['largest-contentful-paint-element'].details?.items?.[0]?.items?.[0]?.node?.snippet || '').slice(0, 120),
        fallan,
        accesibilidadFallan: Object.values(a)
          .filter((x) => x.scoreDisplayMode === 'binary' && x.score === 0 && cat.accessibility.auditRefs.some((rf) => rf.id === x.id))
          .map((x) => x.id),
      };
      resumen.push(fila);
      const nombre = `${modo}-${ruta.replace(/\W+/g, '_').replace(/^_/, '')}`;
      fs.writeFileSync(path.join(salida, `${nombre}.html`), medio.html);
      fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 1));
      console.log(JSON.stringify(fila));
    }
  }
  await ctx.close();
  fs.rmSync(perfil, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
