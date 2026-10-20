import { describe, expect, it } from 'vitest';
import {
  columnasColeccion,
  construirRegla,
  descomponerRegla,
  esquemaColeccion,
  moverEnLista,
  renumerar,
} from './colecciones';

describe('construirRegla', () => {
  it('arma cada regla de §6.2', () => {
    expect(construirRegla('badge', 'hot_sale')).toEqual({ regla: { badge: 'hot_sale' } });
    expect(construirRegla('new_days', '30')).toEqual({ regla: { new_days: 30 } });
    expect(construirRegla('best_sellers_days', '7')).toEqual({ regla: { best_sellers_days: 7 } });
    expect(construirRegla('category_id', '11111111-1111-4111-8111-111111111111')).toHaveProperty('regla.category_id');
  });
  it('rechaza valores inválidos', () => {
    expect(construirRegla('badge', 'Hot Sale')).toHaveProperty('error');
    expect(construirRegla('new_days', '0')).toHaveProperty('error');
    expect(construirRegla('new_days', '3.5')).toHaveProperty('error');
    expect(construirRegla('new_days', '999')).toHaveProperty('error');
    expect(construirRegla('category_id', 'x')).toHaveProperty('error');
  });
  it('descomponerRegla invierte construirRegla', () => {
    expect(descomponerRegla({ new_days: 30 })).toEqual({ tipo: 'new_days', valor: '30' });
    expect(descomponerRegla(null)).toEqual({ tipo: '', valor: '' });
  });
});

describe('esquemaColeccion', () => {
  const base = { country_code: 'CO', name: 'Hot Sale', slug: 'hot-sale' };
  it('una manual no necesita regla y guarda rule = null', () => {
    const d = esquemaColeccion.parse({ ...base, type: 'manual', is_active: 'on' });
    expect(columnasColeccion(d)).toMatchObject({ type: 'manual', rule: null, is_active: true, show_in_home_tabs: false });
  });
  it('una de regla exige regla válida', () => {
    expect(esquemaColeccion.safeParse({ ...base, type: 'rule' }).success).toBe(false);
    const r = esquemaColeccion.safeParse({ ...base, type: 'rule', regla_tipo: 'new_days', regla_valor: 'x' });
    expect(r.success).toBe(false);
    const ok = esquemaColeccion.parse({ ...base, type: 'rule', regla_tipo: 'new_days', regla_valor: '30' });
    expect(columnasColeccion(ok).rule).toEqual({ new_days: 30 });
  });
  it('el país debe ser CO o EC', () => {
    expect(esquemaColeccion.safeParse({ ...base, country_code: 'PE', type: 'manual' }).success).toBe(false);
  });
});

describe('orden de listas', () => {
  it('moverEnLista intercambia vecinos y respeta los bordes', () => {
    expect(moverEnLista(['a', 'b', 'c'], 'b', 'arriba')).toEqual(['b', 'a', 'c']);
    expect(moverEnLista(['a', 'b', 'c'], 'b', 'abajo')).toEqual(['a', 'c', 'b']);
    expect(moverEnLista(['a', 'b'], 'a', 'arriba')).toEqual(['a', 'b']);
    expect(moverEnLista(['a', 'b'], 'b', 'abajo')).toEqual(['a', 'b']);
    expect(moverEnLista(['a'], 'z', 'abajo')).toEqual(['a']);
  });
  it('renumerar empieza en 1', () => {
    expect(renumerar(['x', 'y'])).toEqual([
      { valor: 'x', posicion: 1 },
      { valor: 'y', posicion: 2 },
    ]);
  });
});
