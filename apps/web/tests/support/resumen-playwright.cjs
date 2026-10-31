/**
 * Resume un informe JSON de Playwright (cuentas por archivo y lista de pruebas que fallan) para pegarlo como
 * evidencia en docs/fases/. Uso:
 *   pnpm exec playwright test -c tests/playwright.config.ts --reporter=json > tests/.resultados/todo.json
 *   node tests/support/resumen-playwright.cjs tests/.resultados/todo.json > ../../docs/fases/F1-evidencia/playwright-resumen.txt
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS */
const fs = require('node:fs');

const j = JSON.parse(fs.readFileSync(process.argv[2] || 'tests/.resultados/todo.json', 'utf8'));
const porArchivo = {};
const fallos = new Map();

function recorrer(suite) {
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      const archivo = (spec.file || '').split('\\').join('/');
      const cuenta = (porArchivo[archivo] ??= { ok: 0, fallo: 0, omitido: 0 });
      if (t.status === 'expected') cuenta.ok += 1;
      else if (t.status === 'skipped') cuenta.omitido += 1;
      else {
        cuenta.fallo += 1;
        const clave = `${archivo} :: ${spec.title.replace(/\((co|ec), \d+ px\)/, '(co|ec, 360|768|1440 px)')}`;
        if (!fallos.has(clave)) fallos.set(clave, new Set());
        fallos.get(clave).add(t.projectName);
      }
    }
  }
  for (const hija of suite.suites || []) recorrer(hija);
}
for (const s of j.suites) recorrer(s);

const e = j.stats;
let salida = `Resumen Playwright (${e.startTime.slice(0, 10)}; STORE_DATOS=ejemplo, build .next-ejemplo)\n`;
salida += `Total: ${e.expected} pasan, ${e.unexpected} fallan, ${e.skipped} omitidas, ${e.flaky} inestables; duración ${Math.round(e.duration / 1000)} s\n\n`;
salida += 'Por archivo (pasan / fallan / omitidas)\n';
for (const [archivo, c] of Object.entries(porArchivo)) salida += `  ${archivo.padEnd(34)} ${c.ok} / ${c.fallo} / ${c.omitido}\n`;
salida += '\nPruebas que fallan (cada una es un defecto del producto; ver docs/fases/F1.md)\n';
for (const [clave, proyectos] of fallos) salida += `  - ${clave}  [${[...proyectos].join(', ')}]\n`;
process.stdout.write(salida);
