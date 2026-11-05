/** Regenera `lib/tipografia/tienda/*.ts` y `cargadores.generado.ts` desde el catálogo: `pnpm exec tsx scripts/generar-fuentes-tienda.ts`. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FUENTES_CATALOGO } from '../lib/tipografia/catalogo';

const dir = fileURLToPath(new URL('../lib/tipografia/tienda', import.meta.url));
const ident = (f: string) => f.replace(/ /g, '_');
const mapa: string[] = [];
for (const f of FUENTES_CATALOGO) {
  const fn = ident(f.familia);
  const opciones = [`subsets: ['latin']`, `display: 'swap'`, `preload: false`];
  if (!f.variable) opciones.push(`weight: [${f.pesos.map((p) => `'${p}'`).join(', ')}]`);
  if (f.id === 'cormorant-garamond') opciones.push(`style: ['normal', 'italic']`);
  opciones.push(`variable: '--ft-${f.id}'`);
  const src = `// Generado por scripts/generar-fuentes-tienda.ts desde lib/tipografia/catalogo.ts: no editar a mano.
import { ${fn} } from 'next/font/google';

const fuente = ${fn}({ ${opciones.join(', ')} });

export default fuente;
`;
  fs.writeFileSync(`${dir}/${f.id}.ts`, src);
  mapa.push(`  '${f.id}': () => import('./tienda/${f.id}'),`);
}
fs.writeFileSync(`${dir}/../cargadores.generado.ts`, `// Generado: un cargador por fuente del catálogo (\`import()\` dinámico: solo se evalúan las elegidas).

export const CARGADORES_FUENTE: Record<string, () => Promise<{ default: { variable: string; className: string } }>> = {
${mapa.join('\n')}
};
`);
console.log('ok', FUENTES_CATALOGO.length);
