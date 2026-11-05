import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { construirCssTema, resolverColores, resolverTipografia } from '@izao/ui/tema';
import { FUENTES_CATALOGO, resolverFuentes } from './catalogo';
import { CARGADORES_FUENTE } from './cargadores.generado';

const ruta = (id: string) => fileURLToPath(new URL(`./tienda/${id}.ts`, import.meta.url));

describe('fuentes de la tienda (una declaración estática por fuente del catálogo)', () => {
  it('cada fuente del catálogo tiene su módulo y su cargador, y no sobra ninguno', () => {
    const ids = FUENTES_CATALOGO.map((f) => f.id).sort();
    expect(Object.keys(CARGADORES_FUENTE).sort()).toEqual(ids);
    for (const id of ids) expect(existsSync(ruta(id)), `falta lib/tipografia/tienda/${id}.ts: ejecuta scripts/generar-fuentes-tienda.ts`).toBe(true);
  });

  it('cada módulo declara solo su fuente: swap, subset latin, sin precarga masiva y su variable propia', () => {
    for (const f of FUENTES_CATALOGO) {
      const src = readFileSync(ruta(f.id), 'utf8');
      expect(src).toContain(`import { ${f.familia.replace(/ /g, '_')} } from 'next/font/google'`);
      expect(src).toContain(`variable: '--ft-${f.id}'`);
      expect(src).toContain(`display: 'swap'`);
      expect(src).toContain(`subsets: ['latin']`);
      expect(src).toContain('preload: false');
      // Las que no son variables necesitan sus pesos reales.
      if (!f.variable) for (const p of f.pesos) expect(src).toContain(`'${p}'`);
    }
  });

  it('la pareja 1–6 anterior se resuelve a dos fuentes del catálogo', () => {
    const { titulos, texto } = resolverFuentes({ pair: 4 });
    expect([titulos.familia, texto.familia]).toEqual(['Libre Caslon Display', 'Karla']);
    const sinNada = resolverFuentes();
    expect([sinNada.titulos.familia, sinNada.texto.familia]).toEqual(['Cormorant Garamond', 'Manrope']);
  });
});

describe('construirCssTema con las pilas de la tienda', () => {
  const c = resolverColores();
  const t = resolverTipografia();
  it('usa las pilas válidas', () => {
    const css = construirCssTema(c, t, ':root', { titulos: 'var(--ft-lora),Georgia,serif', texto: 'var(--ft-inter),system-ui,sans-serif' });
    expect(css).toContain('--font-display:var(--ft-lora),Georgia,serif');
    expect(css).toContain('--font-body:var(--ft-inter),system-ui,sans-serif');
  });
  it('descarta pilas con otra forma (nada se cuela al CSS) y vuelve a la pareja', () => {
    const css = construirCssTema(c, t, ':root', { titulos: 'red;}body{display:none', texto: 'var(--ft-x);color:red' });
    expect(css).toContain('--font-display:var(--font-par1-titulos)');
    expect(css).toContain('--font-body:var(--font-par1-texto)');
    expect(css).not.toContain('display:none');
  });
});
