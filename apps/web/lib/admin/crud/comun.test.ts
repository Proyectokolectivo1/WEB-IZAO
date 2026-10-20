import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  diffCampos,
  erroresPorCampo,
  escaparBusqueda,
  leerParametrosLista,
  nulaSiVacio,
  PATRON_SLUG,
  rangoPagina,
  slugificar,
} from './comun';

describe('slugificar', () => {
  it('quita tildes, símbolos y bordes', () => {
    expect(slugificar('  Perfumería Árabe & Más! ')).toBe('perfumeria-arabe-mas');
    expect(slugificar('Eau de Parfum 100 ml')).toBe('eau-de-parfum-100-ml');
  });
  it('siempre produce un slug válido o vacío', () => {
    for (const t of ['Ñandú', '---', 'A  B', '日本']) {
      const s = slugificar(t);
      expect(s === '' || PATRON_SLUG.test(s)).toBe(true);
    }
  });
});

describe('erroresPorCampo', () => {
  it('toma el primer error por campo y une rutas anidadas', () => {
    const r = z
      .object({ nombre: z.string().min(3, 'corto'), v: z.array(z.object({ sku: z.string().min(1, 'vacío') })) })
      .safeParse({ nombre: 'a', v: [{ sku: '' }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroresPorCampo(r.error)).toEqual({ nombre: 'corto', 'v.0.sku': 'vacío' });
  });
});

describe('paginación en la URL', () => {
  it('valida q y page', () => {
    expect(leerParametrosLista({ q: ' dior ', page: '3' })).toEqual({ q: 'dior', pagina: 3 });
    expect(leerParametrosLista({ page: '-4' }).pagina).toBe(1);
    expect(leerParametrosLista({ page: 'abc' }).pagina).toBe(1);
    expect(leerParametrosLista({ page: ['2', '5'] }).pagina).toBe(2);
    expect(leerParametrosLista({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });
  it('calcula el rango inclusivo', () => {
    expect(rangoPagina(1)).toEqual([0, 24]);
    expect(rangoPagina(3, 10)).toEqual([20, 29]);
  });
  it('escapa comodines de ilike', () => {
    expect(escaparBusqueda('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
});

describe('diffCampos', () => {
  it('solo incluye lo que cambia', () => {
    expect(diffCampos({ a: 1, b: 'x' }, { a: 1, b: 'y', c: null })).toEqual({
      antes: { b: 'x' },
      despues: { b: 'y' },
    });
    expect(diffCampos(null, { a: 1 })).toEqual({ antes: { a: null }, despues: { a: 1 } });
  });
});

describe('nulaSiVacio', () => {
  it('normaliza vacíos', () => {
    expect(nulaSiVacio('  ')).toBeNull();
    expect(nulaSiVacio(undefined)).toBeNull();
    expect(nulaSiVacio(' a ')).toBe('a');
  });
});
