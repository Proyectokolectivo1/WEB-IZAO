import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PARES_TIPOGRAFICOS } from '@izao/ui/tema';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_FUENTE,
  FUENTES_CATALOGO,
  descripcionPesos,
  fuentePorFamilia,
  fuentePorId,
  parejaDe,
  pesoDisponible,
  pilaFuente,
  resolverFuentes,
  variableCssFuente,
} from './catalogo';

describe('catálogo de tipografías', () => {
  it('tiene entre 30 y 40 fuentes, sin repetidas, con id en minúsculas', () => {
    expect(FUENTES_CATALOGO.length).toBeGreaterThanOrEqual(30);
    expect(FUENTES_CATALOGO.length).toBeLessThanOrEqual(40);
    expect(new Set(FUENTES_CATALOGO.map((f) => f.id)).size).toBe(FUENTES_CATALOGO.length);
    expect(new Set(FUENTES_CATALOGO.map((f) => f.familia)).size).toBe(FUENTES_CATALOGO.length);
    for (const f of FUENTES_CATALOGO) {
      expect(f.id, f.familia).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(CATEGORIAS_FUENTE).toContain(f.categoria);
      expect(f.pesos.length, f.familia).toBeGreaterThan(0);
      expect(f.usos.length, f.familia).toBeGreaterThan(0);
    }
  });

  it('incluye las dos fuentes de cada pareja curada y hay opciones para títulos y para texto', () => {
    for (const p of PARES_TIPOGRAFICOS) {
      expect(fuentePorFamilia(p.titulos), p.titulos).not.toBeNull();
      expect(fuentePorFamilia(p.texto), p.texto).not.toBeNull();
    }
    expect(FUENTES_CATALOGO.filter((f) => f.usos.includes('titulos')).length).toBeGreaterThanOrEqual(15);
    expect(FUENTES_CATALOGO.filter((f) => f.usos.includes('texto')).length).toBeGreaterThanOrEqual(15);
  });

  it('el módulo de vista previa declara exactamente las fuentes del catálogo (y la tienda no lo importa)', () => {
    const fuente = readFileSync(path.resolve(__dirname, 'fuentes-previa.ts'), 'utf8');
    for (const f of FUENTES_CATALOGO) {
      expect(fuente, f.familia).toContain(`${f.familia.replace(/ /g, '_')}({`);
      expect(fuente, f.familia).toContain(`variable: '${variableCssFuente(f)}'`);
      // Una fuente de un solo peso exige `weight`; una variable no.
      const linea = fuente.split('\n').find((l) => l.includes(`variable: '${variableCssFuente(f)}'`)) ?? '';
      expect(linea.includes("weight: '400'"), f.familia).toBe(!f.variable);
    }
    const declaradas = (fuente.match(/variable: '--fuente-/g) ?? []).length;
    expect(declaradas).toBe(FUENTES_CATALOGO.length);
    expect(fuente).toContain("preload: false");
    expect(fuente).toContain("display: 'swap'");
    expect(fuente).toContain("subsets: ['latin']");
  });

  it('búsqueda por familia (valor guardado) o id; lo desconocido es nulo', () => {
    expect(fuentePorFamilia('Prata')?.id).toBe('prata');
    expect(fuentePorFamilia(' Prata ')?.id).toBe('prata');
    expect(fuentePorId('plus-jakarta-sans')?.familia).toBe('Plus Jakarta Sans');
    expect(fuentePorFamilia('Comic Sans MS')).toBeNull();
    expect(fuentePorFamilia(12)).toBeNull();
    expect(fuentePorFamilia(undefined)).toBeNull();
  });

  it('pila de respaldo según el tipo y comillas si el nombre lleva espacios', () => {
    expect(pilaFuente(fuentePorFamilia('Playfair Display')!)).toBe("'Playfair Display', Georgia, serif");
    expect(pilaFuente(fuentePorFamilia('Jost')!)).toBe('Jost, system-ui, sans-serif');
  });

  it('peso disponible: variable se limita al rango; estática toma el más cercano', () => {
    const marcellus = fuentePorFamilia('Marcellus')!;
    expect(pesoDisponible(marcellus, 700)).toBe(400);
    const baskerville = fuentePorFamilia('Libre Baskerville')!; // 400 y 700
    expect(pesoDisponible(baskerville, 500)).toBe(400);
    expect(pesoDisponible(baskerville, 600)).toBe(700);
    const cormorant = fuentePorFamilia('Cormorant Garamond')!; // variable 300–700
    expect(pesoDisponible(cormorant, 800)).toBe(700);
    expect(pesoDisponible(cormorant, 500)).toBe(500);
    expect(descripcionPesos(marcellus)).toContain('único');
    expect(descripcionPesos(cormorant)).toBe('300 a 700');
  });
});

describe('qué fuentes carga la tienda', () => {
  it('sin datos: la pareja 1', () => {
    const f = resolverFuentes(null);
    expect([f.titulos.familia, f.texto.familia]).toEqual(['Cormorant Garamond', 'Manrope']);
  });

  it('solo pair (datos anteriores): las fuentes de esa pareja', () => {
    const f = resolverFuentes({ pair: 3 });
    expect([f.titulos.familia, f.texto.familia]).toEqual(['Fraunces', 'Inter Tight']);
  });

  it('heading_font y body_font mandan sobre pair; un país pisa al sitio', () => {
    const sitio = { pair: 2, heading_font: 'Prata', body_font: 'Figtree' };
    expect(resolverFuentes(sitio).titulos.familia).toBe('Prata');
    const pais = resolverFuentes(sitio, { heading_font: 'Italiana' });
    expect([pais.titulos.familia, pais.texto.familia]).toEqual(['Italiana', 'Figtree']);
  });

  it('un nombre que no es del catálogo se ignora (nunca llega a la tienda)', () => {
    const f = resolverFuentes({ pair: 2, heading_font: 'x; } body{display:none', body_font: 'Arial' });
    expect([f.titulos.familia, f.texto.familia]).toEqual(['Playfair Display', 'Jost']);
  });

  it('parejaDe reconoce las parejas curadas', () => {
    expect(parejaDe('Marcellus', 'Mulish')).toBe(5);
    expect(parejaDe('Marcellus', 'Jost')).toBeNull();
  });
});
