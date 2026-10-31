/**
 * Resume los informes de Lighthouse CI (tests/.resultados/lighthouse/*.report.json) en una tabla Markdown con la
 * MEDIANA de las corridas por URL: rendimiento, accesibilidad, buenas prácticas, SEO, FCP, LCP, CLS, TBT, JS
 * transferido y las auditorías de accesibilidad que fallan. Sirve para pegar la evidencia en docs/fases/F1.md.
 *
 *   node tests/lighthouse/resumen.cjs [prefijo-de-fecha]      # p. ej. 2026_10_31 (por defecto, la fecha más reciente)
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS */
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../.resultados/lighthouse');
const todos = fs.readdirSync(dir).filter((f) => f.endsWith('.report.json'));
const fechas = [...new Set(todos.map((f) => (f.match(/-(\d{4}_\d{2}_\d{2})_/) || [])[1]).filter(Boolean))].sort();
const fecha = process.argv[2] || fechas.at(-1);
const archivos = todos.filter((f) => f.includes(`-${fecha}_`) && !f.startsWith('127_0_0_1-admin_login'));

const porUrl = {};
for (const f of archivos) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  (porUrl[new URL(r.finalDisplayedUrl || r.finalUrl).pathname] ??= []).push(r);
}
const mediana = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sobre = (rs, f) => mediana(rs.map(f));

console.log(`Fecha de las corridas: ${fecha}\n`);
console.log('| URL | Rend. | Acces. | Prác. | SEO | FCP s | LCP s | CLS | TBT ms | JS KB | corridas |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const fallosA11y = new Set();
for (const [url, rs] of Object.entries(porUrl)) {
  const cat = (id) => sobre(rs, (r) => Math.round(r.categories[id].score * 100));
  const num = (id) => sobre(rs, (r) => r.audits[id].numericValue);
  const js = sobre(rs, (r) => (r.audits['resource-summary'].details.items.find((i) => i.resourceType === 'script') || { transferSize: 0 }).transferSize) / 1024;
  console.log(
    `| ${url} | ${cat('performance')} | ${cat('accessibility')} | ${cat('best-practices')} | ${cat('seo')} | ${(num('first-contentful-paint') / 1000).toFixed(2)} | ${(num('largest-contentful-paint') / 1000).toFixed(2)} | ${num('cumulative-layout-shift').toFixed(3)} | ${Math.round(num('total-blocking-time'))} | ${Math.round(js)} | ${rs.length} |`,
  );
  const r0 = rs[0];
  for (const ref of r0.categories.accessibility.auditRefs) {
    const a = r0.audits[ref.id];
    if (a.score === 0) fallosA11y.add(`${url}: ${ref.id} (${a.title})`);
  }
}
console.log('\nAuditorías de accesibilidad fallidas:', fallosA11y.size ? '\n- ' + [...fallosA11y].join('\n- ') : 'ninguna');
const r0 = Object.values(porUrl)[0]?.[0];
if (r0) {
  const tc = r0.audits['uses-text-compression'];
  console.log('\nuses-text-compression:', tc.score, JSON.stringify((tc.details?.items || []).slice(0, 5).map((i) => [i.url.replace(/^https?:\/\/[^/]+/, ''), i.totalBytes])));
  const el = r0.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  console.log('Elemento LCP (primera URL):', el ? el.snippet : 'n/d');
}
