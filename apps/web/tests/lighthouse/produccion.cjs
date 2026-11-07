/**
 * Lighthouse contra producción (solo lectura) — móvil y escritorio, una corrida por URL.
 *   BASE=https://izaoperfumeria.com CHROME_PATH=<chrome> node tests/lighthouse/produccion.cjs <carpeta-salida>
 * Escribe resumen.json (puntajes, métricas y auditorías que fallan) y un .html por corrida.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS de apoyo */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BASE = process.env.BASE || 'https://izaoperfumeria.com';
const salida = path.resolve(process.argv[2] || 'lh-prod');
fs.mkdirSync(salida, { recursive: true });
const rutas = (process.env.RUTAS || '/co,/co/perfume/9pm-afnan-para-hombres,/ec,/co/catalogo,/co/carrito,/co/checkout').split(',');
const bin = path.resolve(__dirname, '../../../../node_modules/.bin/lighthouse' + (process.platform === 'win32' ? '.CMD' : ''));
const resumen = [];
for (const ruta of rutas) {
  for (const modo of ['mobile', 'desktop']) {
    const base = `${modo}-${ruta.replace(/\W+/g, '_').replace(/^_/, '')}`;
    const args = [`${BASE}${ruta}`, '--output=json', '--output=html', `--output-path=${path.join(salida, base)}`,
      '--only-categories=performance,accessibility,best-practices,seo', '--quiet',
      `--chrome-flags=--headless=new --no-sandbox`, ...(modo === 'desktop' ? ['--preset=desktop'] : [])];
    const r = spawnSync(bin, args, { encoding: 'utf8', shell: true, timeout: 240000 });
    const jf = path.join(salida, base + '.report.json');
    if (!fs.existsSync(jf)) { resumen.push({ ruta, modo, error: (r.stderr || '').slice(0, 300) }); continue; }
    const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
    const c = j.categories, a = j.audits;
    const fallan = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable')
      .map((x) => `${x.id}(${x.score})`);
    resumen.push({
      ruta, modo,
      rendimiento: Math.round(c.performance.score * 100), accesibilidad: Math.round(c.accessibility.score * 100),
      buenasPracticas: Math.round(c['best-practices'].score * 100), seo: Math.round(c.seo.score * 100),
      lcp_s: +(a['largest-contentful-paint'].numericValue / 1000).toFixed(2), cls: +a['cumulative-layout-shift'].numericValue.toFixed(3),
      tbt_ms: Math.round(a['total-blocking-time'].numericValue), fcp_s: +(a['first-contentful-paint'].numericValue / 1000).toFixed(2),
      ttfb_ms: Math.round(a['server-response-time'].numericValue), js_kb_transferido: Math.round((a['resource-summary'].details.items.find((i) => i.resourceType === 'script') || {}).transferSize / 1024),
      lcpElemento: (a['largest-contentful-paint-element'].details?.items?.[0]?.items?.[0]?.node?.snippet || '').slice(0, 120),
      fallan,
    });
    fs.unlinkSync(jf); // el HTML queda como evidencia; el JSON completo pesa demasiado
    fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 1));
    console.log(JSON.stringify(resumen[resumen.length - 1]));
  }
}
