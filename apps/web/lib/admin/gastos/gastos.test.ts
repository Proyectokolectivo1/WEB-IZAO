import { describe, expect, it } from 'vitest';
import {
  esPauta,
  esquemaCategoriaGasto,
  esquemaGasto,
  leerFiltrosGasto,
  parametrosDeFiltrosGasto,
  slugDeCategoria,
  PATRON_SLUG_CATEGORIA,
} from './gastos';

const CAT = '22222222-2222-4222-8222-222222222222';
const HOY = '2026-11-10';
const entrada = (o: Record<string, string> = {}) => ({ country_code: 'CO', category_id: CAT, date: '2026-11-05', amount: '150000', description: '', ...o });

describe('esquemaGasto', () => {
  it('el valor sale en unidad menor de la moneda del país', () => {
    expect(esquemaGasto('CO', HOY).parse(entrada()).amount).toBe(150000n);
    expect(esquemaGasto('EC', HOY).parse(entrada({ country_code: 'EC', amount: '1234,5' })).amount).toBe(123450n);
  });

  it('rechaza decimales en pesos, cero, negativos y texto', () => {
    for (const amount of ['10.5', '0', '-5', 'mucho', '']) {
      expect(esquemaGasto('CO', HOY).safeParse(entrada({ amount })).success, amount).toBe(false);
    }
  });

  it('rechaza fechas futuras, inexistentes y categorías inválidas', () => {
    expect(esquemaGasto('CO', HOY).safeParse(entrada({ date: '2026-11-11' })).success).toBe(false);
    expect(esquemaGasto('CO', HOY).safeParse(entrada({ date: '2026-02-30' })).success).toBe(false);
    expect(esquemaGasto('CO', HOY).safeParse(entrada({ category_id: 'x' })).success).toBe(false);
    expect(esquemaGasto('CO', HOY).safeParse(entrada({ country_code: 'MX' })).success).toBe(false);
  });

  it('descripción vacía = null; id vacío = null (alta)', () => {
    const d = esquemaGasto('CO', HOY).parse(entrada({ id: '' }));
    expect(d.description).toBeNull();
    expect(d.id).toBeNull();
    expect(esquemaGasto('CO', HOY).safeParse(entrada({ description: 'x'.repeat(301) })).success).toBe(false);
  });
});

describe('categorías', () => {
  it('el slug sale del nombre y la pauta lleva el prefijo que usa el ROAS', () => {
    expect(slugDeCategoria('Empaques y cajas', false)).toBe('empaques_y_cajas');
    expect(slugDeCategoria('TikTok Ads', true)).toBe('pauta_tiktok_ads');
    expect(slugDeCategoria('Pauta Google', true)).toBe('pauta_google');
    expect(PATRON_SLUG_CATEGORIA.test(slugDeCategoria('Envíos & devoluciones', false))).toBe(true);
    expect(esPauta('pauta_meta')).toBe(true);
    expect(esPauta('empaques')).toBe(false);
  });

  it('valida nombre y casilla', () => {
    expect(esquemaCategoriaGasto.parse({ name: ' Nómina ', es_pauta: 'on' })).toEqual({ id: null, name: 'Nómina', es_pauta: true });
    expect(esquemaCategoriaGasto.parse({ name: 'Nómina' }).es_pauta).toBe(false);
    expect(esquemaCategoriaGasto.safeParse({ name: 'a' }).success).toBe(false);
  });
});

describe('filtros', () => {
  it('lee categoría y origen válidos y descarta el resto', () => {
    expect(leerFiltrosGasto({ categoria: CAT, origen: 'meta_ads', page: '3' })).toEqual({ pagina: 3, categoria: CAT, origen: 'meta_ads' });
    expect(leerFiltrosGasto({ categoria: 'x', origen: 'otro', page: '0' })).toEqual({ pagina: 1, categoria: '', origen: '' });
    expect(parametrosDeFiltrosGasto(leerFiltrosGasto({ origen: 'manual' }))).toEqual({ origen: 'manual' });
  });
});
