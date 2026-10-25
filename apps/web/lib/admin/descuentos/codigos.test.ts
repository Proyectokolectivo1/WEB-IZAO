import { describe, expect, it } from 'vitest';
import {
  CODIGO_NUEVO,
  aValoresCodigo,
  describirValor,
  esquemaCodigo,
  esquemaLote,
  estadoCodigo,
  formularioAObjeto,
  generarCodigosLote,
  leerFiltrosCodigos,
  parsearSlugs,
  type FilaCodigo,
} from './codigos';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const base = {
  code: ' verano10 ',
  country_code: 'CO',
  type: 'percent',
  value: '10',
  applies_to: 'all',
};

function errores(entrada: Record<string, unknown>): Record<string, string> {
  const r = esquemaCodigo.safeParse(entrada);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('esquemaCodigo', () => {
  it('normaliza el código a mayúsculas y convierte el porcentaje', () => {
    const r = esquemaCodigo.parse(base);
    expect(r.code).toBe('VERANO10');
    expect(r.value).toBe(10n);
    expect(r.max_discount_amount).toBeNull();
    expect(r.min_subtotal).toBe(0n);
    expect(r.applies_to_sale_items).toBe(false);
  });

  it('el valor fijo se lee en unidad mayor y sale en unidad menor (COP sin decimales, USD con 2)', () => {
    expect(esquemaCodigo.parse({ ...base, type: 'fixed', value: '15000' }).value).toBe(15000n);
    expect(esquemaCodigo.parse({ ...base, country_code: 'EC', type: 'fixed', value: '5.50' }).value).toBe(550n);
    expect(errores({ ...base, type: 'fixed', value: '15000.5' }).value).toMatch(/COP/);
    expect(errores({ ...base, country_code: 'EC', type: 'fixed', value: '5.555' }).value).toMatch(/USD/);
    expect(errores({ ...base, type: 'fixed', value: '0' }).value).toMatch(/mayor que cero/);
  });

  it('rechaza porcentajes fuera de 1 a 100 o con decimales', () => {
    for (const v of ['0', '101', '10.5', '-3', 'abc', '']) {
      expect(errores({ ...base, value: v }).value, v).toMatch(/entero entre 1 y 100/);
    }
  });

  it('el tope solo aplica a porcentajes y debe ser positivo', () => {
    expect(esquemaCodigo.parse({ ...base, max_discount_amount: '50000' }).max_discount_amount).toBe(50000n);
    expect(esquemaCodigo.parse({ ...base, type: 'fixed', value: '1000', max_discount_amount: '50000' }).max_discount_amount).toBeNull();
    expect(errores({ ...base, max_discount_amount: '0' }).max_discount_amount).toMatch(/mayor que cero/);
  });

  it('valida el formato del código y que no afirme originalidad', () => {
    expect(errores({ ...base, code: 'ab' }).code).toMatch(/3 a 30/);
    expect(errores({ ...base, code: 'con espacio' }).code).toMatch(/3 a 30/);
    expect(errores({ ...base, code: 'PERFUME_ORIGINAL' }).code).toMatch(/originalidad/);
  });

  it('la vigencia es por día en hora de Bogotá y "hasta" incluye todo el día', () => {
    const r = esquemaCodigo.parse({ ...base, starts_on: '2026-11-01', ends_on: '2026-11-30' });
    expect(r.starts_at).toBe('2026-11-01T05:00:00.000Z');
    expect(r.ends_at).toBe('2026-12-01T05:00:00.000Z');
    expect(errores({ ...base, starts_on: '2026-11-10', ends_on: '2026-11-01' }).ends_on).toMatch(/anterior/);
    expect(errores({ ...base, starts_on: '2026-02-30' }).starts_on).toMatch(/válida/);
  });

  it('exige categorías o productos según el alcance', () => {
    expect(errores({ ...base, applies_to: 'categories' }).target_categories).toMatch(/al menos una/);
    expect(errores({ ...base, applies_to: 'products' }).target_products).toMatch(/al menos un producto/);
    const r = esquemaCodigo.parse({ ...base, applies_to: 'categories', target_categories: U1 });
    expect(r.target_category_ids).toEqual([U1]);
    const p = esquemaCodigo.parse({ ...base, applies_to: 'products', target_products: 'uno\nDos, uno' });
    expect(p.target_product_slugs).toEqual(['uno', 'dos']);
    // En "todo el catálogo" no se arrastran listas viejas.
    expect(esquemaCodigo.parse({ ...base, target_categories: [U1, U2] }).target_category_ids).toEqual([]);
  });

  it('los límites de uso son enteros positivos', () => {
    const r = esquemaCodigo.parse({ ...base, usage_limit_total: '100', usage_limit_per_customer: '1' });
    expect(r.usage_limit_total).toBe(100);
    expect(r.usage_limit_per_customer).toBe(1);
    expect(errores({ ...base, usage_limit_total: '0' }).usage_limit_total).toMatch(/entre 1 y/);
    expect(errores({ ...base, usage_limit_per_customer: '1.5' }).usage_limit_per_customer).toMatch(/entre 1 y/);
  });

  it('formularioAObjeto agrupa las casillas repetidas', () => {
    const fd = new FormData();
    fd.append('target_categories', U1);
    fd.append('target_categories', U2);
    fd.append('code', 'CODIGO1');
    const r = esquemaCodigo.parse({ ...base, ...formularioAObjeto(fd), applies_to: 'categories' });
    expect(r.target_category_ids).toEqual([U1, U2]);
  });
});

describe('esquemaLote', () => {
  it('prefijo en mayúsculas y cantidad entre 1 y 500', () => {
    const r = esquemaLote.parse({ ...base, prefix: 'verano', quantity: '25' });
    expect(r.prefix).toBe('VERANO');
    expect(r.quantity).toBe(25);
    const e = (q: string) => {
      const x = esquemaLote.safeParse({ ...base, prefix: 'AB', quantity: q });
      return x.success ? '' : x.error.issues[0]?.message;
    };
    expect(e('0')).toMatch(/Mínimo/);
    expect(e('501')).toMatch(/Máximo 500/);
    expect(e('')).toMatch(/cuántos/);
    const p = esquemaLote.safeParse({ ...base, prefix: 'A-B', quantity: '3' });
    expect(p.success).toBe(false);
  });
});

describe('generarCodigosLote', () => {
  it('genera códigos únicos con el formato PREFIJO-XXXXXX', () => {
    // mulberry32 con semilla fija: reproducible
    let t = 12345;
    const azar = (max: number) => {
      t = (t + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * max);
    };
    const codigos = generarCodigosLote('VERANO', 200, azar);
    expect(new Set(codigos).size).toBe(200);
    for (const c of codigos) expect(c).toMatch(/^VERANO-[A-HJKMN-Z2-9]{6}$/);
  });

  it('no repite códigos ocupados y falla si no hay espacio', () => {
    const ocupados = new Set(['AB-AAAAAA']);
    const siempreA = () => 0;
    expect(() => generarCodigosLote('AB', 1, siempreA, ocupados)).toThrow(/otro prefijo/);
  });
});

describe('estado y textos', () => {
  const ahora = new Date('2026-11-15T12:00:00Z');
  const fila = (o: Partial<FilaCodigo>): FilaCodigo => ({
    id: U1,
    code: 'CODIGO1',
    country_code: 'CO',
    type: 'percent',
    value: 10,
    max_discount_amount: null,
    min_subtotal: 0,
    starts_at: null,
    ends_at: null,
    usage_limit_total: null,
    usage_limit_per_customer: null,
    usage_count: 0,
    applies_to: 'all',
    target_ids: [],
    exclude_ids: [],
    applies_to_sale_items: true,
    influencer_id: null,
    origin: 'manual',
    iza_can_offer: false,
    is_active: true,
    created_at: '2026-11-01T00:00:00Z',
    ...o,
  });

  it('calcula el estado visible', () => {
    expect(estadoCodigo(fila({}), ahora)).toBe('vigente');
    expect(estadoCodigo(fila({ is_active: false }), ahora)).toBe('inactivo');
    expect(estadoCodigo(fila({ ends_at: '2026-11-15T05:00:00Z' }), ahora)).toBe('vencido');
    expect(estadoCodigo(fila({ starts_at: '2026-11-16T05:00:00Z' }), ahora)).toBe('programado');
    expect(estadoCodigo(fila({ usage_limit_total: 5, usage_count: 5 }), ahora)).toBe('agotado');
  });

  it('describe el valor con el formato de la moneda', () => {
    expect(describirValor(fila({ value: 15 }))).toBe('15 %');
    expect(describirValor(fila({ value: 15, max_discount_amount: 20000 }))).toContain('tope');
    expect(describirValor(fila({ type: 'fixed', value: 10000 }))).toMatch(/10\.000/);
    expect(describirValor(fila({ type: 'fixed', country_code: 'EC', value: 550 }))).toMatch(/5,50/);
  });

  it('round-trip: la fila guardada vuelve al formulario y de nuevo a datos iguales', () => {
    const f = fila({
      type: 'fixed',
      value: 15000,
      min_subtotal: 80000,
      starts_at: '2026-11-01T05:00:00.000Z',
      ends_at: '2026-12-01T05:00:00.000Z',
      applies_to: 'products',
      target_ids: ['p1'],
      exclude_ids: [U1, 'p2'],
      usage_limit_total: 50,
    });
    const v = aValoresCodigo(f, new Map([['p1', 'uno'], ['p2', 'dos']]), new Set([U1]));
    expect(v.value).toBe('15000');
    expect(v.min_subtotal).toBe('80000');
    expect(v.starts_on).toBe('2026-11-01');
    expect(v.ends_on).toBe('2026-11-30');
    expect(v.target_products).toBe('uno');
    expect(v.exclude_categories).toEqual([U1]);
    expect(v.exclude_products).toBe('dos');
    const r = esquemaCodigo.parse({ ...v, applies_to_sale_items: 'on' });
    expect(r.value).toBe(15000n);
    expect(r.ends_at).toBe('2026-12-01T05:00:00.000Z');
    expect(r.target_product_slugs).toEqual(['uno']);
  });

  it('valores del formulario nuevo no traen listas compartidas', () => {
    expect(CODIGO_NUEVO.target_categories).toEqual([]);
    expect(CODIGO_NUEVO.applies_to_sale_items).toBe(true);
  });
});

describe('filtros de la lista', () => {
  it('lee la URL con valores seguros', () => {
    const f = leerFiltrosCodigos({ pais: 'EC', estado: 'vencido', origen: 'batch', q: 'ver<ano>%', page: '3' });
    expect(f).toEqual({ pais: 'EC', estado: 'vencido', origen: 'batch', q: 'VERANO', pagina: 3 });
    expect(leerFiltrosCodigos({ pais: 'XX', estado: 'raro', page: '-2' })).toMatchObject({ pais: 'CO', estado: '', pagina: 1 });
  });

  it('parsearSlugs rechaza lo que no es una URL de producto', () => {
    expect(parsearSlugs('uno dos\nTres')).toEqual(['uno', 'dos', 'tres']);
    expect(parsearSlugs('con espacio-raro!')).toBeNull();
    expect(parsearSlugs('')).toEqual([]);
  });
});
