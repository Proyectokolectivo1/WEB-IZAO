import { describe, expect, it } from 'vitest';
import { esquemaCategoria, ordenarArbol, validarJerarquia, visibilidadPorPais } from './categorias';

describe('esquemaCategoria', () => {
  it('normaliza casillas, opcionales y visibilidad por país', () => {
    const d = esquemaCategoria.parse({
      name: 'Árabes',
      slug: 'arabes',
      parent_id: '',
      show_in_menu: 'on',
      visible_CO: 'on',
      orden_CO: '2',
      orden_EC: '5',
    });
    expect(d.parent_id).toBeNull();
    expect(d.show_in_menu).toBe(true);
    expect(visibilidadPorPais(d)).toEqual([
      { country_code: 'CO', is_visible: true, sort_order: 2 },
      { country_code: 'EC', is_visible: false, sort_order: 5 },
    ]);
  });
  it('una casilla ausente es falso', () => {
    expect(esquemaCategoria.parse({ name: 'Ab', slug: 'ab' }).show_in_menu).toBe(false);
  });
  it('no admite ser su propio padre', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const r = esquemaCategoria.safeParse({ id, name: 'Ab', slug: 'ab', parent_id: id });
    expect(r.success).toBe(false);
  });
  it('limita los textos de SEO', () => {
    expect(esquemaCategoria.safeParse({ name: 'Ab', slug: 'ab', seo_description: 'x'.repeat(161) }).success).toBe(false);
  });
});

describe('validarJerarquia (2 niveles)', () => {
  const principal = { id: 'p', parent_id: null };
  it('permite principal y subcategoría bajo una principal', () => {
    expect(validarJerarquia({ parentId: null, padre: null, tieneHijos: true })).toBeNull();
    expect(validarJerarquia({ id: 'h', parentId: 'p', padre: principal, tieneHijos: false })).toBeNull();
  });
  it('rechaza un tercer nivel', () => {
    expect(validarJerarquia({ id: 'n', parentId: 'h', padre: { id: 'h', parent_id: 'p' }, tieneHijos: false })).toMatch(/2 niveles/);
  });
  it('rechaza dar padre a quien tiene hijas', () => {
    expect(validarJerarquia({ id: 'p2', parentId: 'p', padre: principal, tieneHijos: true })).toMatch(/subcategorías/);
  });
  it('rechaza padre inexistente y autoreferencia', () => {
    expect(validarJerarquia({ parentId: 'x', padre: null, tieneHijos: false })).toMatch(/ya no existe/);
    expect(validarJerarquia({ id: 'a', parentId: 'a', padre: principal, tieneHijos: false })).toMatch(/propia/);
  });
});

describe('ordenarArbol', () => {
  it('agrupa hijas bajo su principal y ordena por orden y nombre', () => {
    const filas = [
      { id: 'h2', parent_id: 'a', sort_order: 2, name: 'H2' },
      { id: 'b', parent_id: null, sort_order: 2, name: 'B' },
      { id: 'a', parent_id: null, sort_order: 1, name: 'A' },
      { id: 'h1', parent_id: 'a', sort_order: 1, name: 'H1' },
      { id: 'huerfana', parent_id: 'borrada', sort_order: 9, name: 'Z' },
    ];
    expect(ordenarArbol(filas).map((f) => `${f.nivel}${f.id}`)).toEqual(['0a', '1h1', '1h2', '0b', '0huerfana']);
  });
});
