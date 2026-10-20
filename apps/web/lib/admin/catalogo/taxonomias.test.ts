import { describe, expect, it } from 'vitest';
import { TAXONOMIAS, columnasEscritura, esTipoTaxonomia, esquemaTaxonomia } from './taxonomias';

describe('esquemaTaxonomia', () => {
  it('acepta un registro válido y normaliza opcionales', () => {
    const r = esquemaTaxonomia.parse({ name: ' Árabe ', slug: 'arabe', description: '  ', image_id: '' });
    expect(r).toMatchObject({ name: 'Árabe', slug: 'arabe', description: null, image_id: null, sort_order: 0 });
  });
  it('rechaza slug inválido, nombre corto y orden negativo con mensajes en español', () => {
    const r = esquemaTaxonomia.safeParse({ name: 'a', slug: 'No Valido', sort_order: '-1' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const campos = r.error.issues.map((i) => i.path[0]);
      expect(campos).toEqual(expect.arrayContaining(['name', 'slug', 'sort_order']));
    }
  });
  it('rechaza una imagen que no es uuid', () => {
    expect(esquemaTaxonomia.safeParse({ name: 'ab', slug: 'ab', image_id: 'x' }).success).toBe(false);
  });
});

describe('columnasEscritura', () => {
  const datos = esquemaTaxonomia.parse({ name: 'Eau', slug: 'eau', description: 'd', sort_order: '3' });
  it('cada tabla recibe solo sus columnas', () => {
    expect(Object.keys(columnasEscritura(TAXONOMIAS.marcas, datos)).sort()).toEqual(['description', 'image_id', 'name', 'slug']);
    expect(Object.keys(columnasEscritura(TAXONOMIAS.generos, datos)).sort()).toEqual(['name', 'slug', 'sort_order']);
    expect(Object.keys(columnasEscritura(TAXONOMIAS.familias, datos)).sort()).toEqual(['description', 'image_id', 'name', 'slug', 'sort_order']);
  });
});

describe('esTipoTaxonomia', () => {
  it('solo acepta los cuatro tipos', () => {
    expect(esTipoTaxonomia('marcas')).toBe(true);
    expect(esTipoTaxonomia('products')).toBe(false);
    expect(esTipoTaxonomia(undefined)).toBe(false);
  });
});
