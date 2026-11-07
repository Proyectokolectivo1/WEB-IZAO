/**
 * Mediana de varias corridas de produccion.cjs (solo móvil) y comparación con la línea base de F9.
 *   node tests/lighthouse/mediana.cjs <carpeta-con-corridaN> <resumen-base.json> <salida.json>
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS de apoyo */
const fs = require('node:fs');
const path = require('node:path');

const [dir, basePath, salida] = process.argv.slice(2).map((p) => path.resolve(p));
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const corridas = fs.readdirSync(dir).filter((d) => /^corrida\d+$/.test(d)).sort()
  .map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, 'resumen.json'), 'utf8')));
const base = JSON.parse(fs.readFileSync(basePath, 'utf8')).filter((r) => r.modo === 'mobile');
const campos = ['rendimiento', 'accesibilidad', 'buenasPracticas', 'seo', 'lcp_s', 'cls', 'tbt_ms', 'fcp_s', 'ttfb_ms', 'js_kb_transferido'];
const rutas = [...new Set(corridas[0].map((r) => r.ruta))];
const out = rutas.map((ruta) => {
  const rs = corridas.map((c) => c.find((r) => r.ruta === ruta)).filter((r) => r && !r.error);
  const b = base.find((r) => r.ruta === ruta);
  const med = Object.fromEntries(campos.map((k) => [k, +mediana(rs.map((r) => r[k])).toFixed(3)]));
  return {
    ruta, corridas: rs.length, mediana: med,
    lcp_s_corridas: rs.map((r) => r.lcp_s),
    lcpElemento: rs.map((r) => r.lcpElemento),
    base_f9: b && Object.fromEntries(campos.map((k) => [k, b[k]])),
    baja_de_2_5_s: med.lcp_s < 2.5,
    fallan: [...new Set(rs.flatMap((r) => r.fallan))],
  };
});
fs.writeFileSync(salida, JSON.stringify({ commit: process.env.COMMIT, modo: 'mobile', corridasPorPagina: corridas.length, paginas: out }, null, 1));
for (const o of out) console.log(o.ruta, JSON.stringify(o.mediana), 'LCP corridas', o.lcp_s_corridas, 'base', o.base_f9 && `${o.base_f9.lcp_s}s/${o.base_f9.js_kb_transferido}KB`);
