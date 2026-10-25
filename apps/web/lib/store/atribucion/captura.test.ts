import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  COOKIE_CLICK_IDS,
  COOKIE_REF,
  COOKIE_UTM,
  VIGENCIA_ATRIBUCION_SEG,
  extraerAtribucion,
  hayAtribucion,
  leerAtribucion,
  normalizarRef,
  parsearCookies,
  serializarClickIds,
  serializarUtm,
} from './captura';
import { aplicarAtribucion } from './middleware';

const q = (s: string) => new URLSearchParams(s);

describe('extraerAtribucion', () => {
  it('toma ref en mayúsculas, UTM y click IDs', () => {
    const a = extraerAtribucion(q('ref=ana-10&utm_source=instagram&utm_medium=Stories&fbclid=IwAR0abc&gclid=Cj0K&ttclid=E.C.P'));
    expect(a.ref).toBe('ANA-10');
    expect(a.utm).toEqual({ utm_source: 'instagram', utm_medium: 'Stories' });
    expect(a.clickIds).toEqual({ fbclid: 'IwAR0abc', gclid: 'Cj0K', ttclid: 'E.C.P' });
    expect(hayAtribucion(a)).toBe(true);
  });

  it('descarta valores inválidos, largos o con marcado', () => {
    const a = extraerAtribucion(q(`ref=${encodeURIComponent('A B;DROP')}&utm_source=${encodeURIComponent('<script>')}&utm_campaign=${'x'.repeat(101)}`));
    expect(a).toEqual({ ref: null, utm: {}, clickIds: {} });
    expect(hayAtribucion(a)).toBe(false);
  });

  it('normalizarRef acepta solo A-Z, 0-9, guion y guion bajo (máx. 40)', () => {
    expect(normalizarRef(' lucia_5 ')).toBe('LUCIA_5');
    expect(normalizarRef('a'.repeat(41))).toBeNull();
    expect(normalizarRef('')).toBeNull();
    expect(normalizarRef(null)).toBeNull();
  });
});

describe('leerAtribucion (lectura del servidor)', () => {
  it('reconstruye ref, utm y click_ids desde el encabezado Cookie', () => {
    const cookie = [
      `${COOKIE_REF}=ANA10`,
      `${COOKIE_UTM}=${encodeURIComponent(serializarUtm({ utm_source: 'meta', utm_medium: 'cpc' }))}`,
      `${COOKIE_CLICK_IDS}=${encodeURIComponent(serializarClickIds({ fbclid: 'abc123' }))}`,
      'otra=1',
    ].join('; ');
    expect(leerAtribucion(cookie)).toEqual({
      ref: 'ANA10',
      utm: { utm_source: 'meta', utm_medium: 'cpc' },
      click_ids: { fbclid: 'abc123' },
    });
  });

  it('sin cookies o con cookies alteradas devuelve vacío', () => {
    expect(leerAtribucion(null)).toEqual({ ref: null, utm: {}, click_ids: {} });
    expect(leerAtribucion(`${COOKIE_UTM}=%7Bno-json; ${COOKIE_CLICK_IDS}=[1,2]; ${COOKIE_REF}=%E0%A4%A`)).toEqual({
      ref: null,
      utm: {},
      click_ids: {},
    });
  });

  it('ignora claves ajenas y valores no válidos dentro del JSON', () => {
    const utm = encodeURIComponent(JSON.stringify({ utm_source: 'ok', utm_medium: '<b>', inventada: 'x', utm_term: 5 }));
    expect(leerAtribucion(`${COOKIE_UTM}=${utm}`).utm).toEqual({ utm_source: 'ok' });
  });

  it('parsearCookies conserva la primera aparición', () => {
    expect(parsearCookies('a=1; a=2; b=x=y')).toEqual({ a: '1', b: 'x=y' });
  });
});

describe('aplicarAtribucion (middleware de la tienda)', () => {
  const pedir = (url: string) => aplicarAtribucion(new NextRequest(`https://izaoperfumeria.com${url}`));

  it('deja las cookies de 30 días; solo ref es legible por el navegador', () => {
    const r = pedir('/co?ref=ana10&utm_source=instagram&gclid=G1');
    const ref = r.cookies.get(COOKIE_REF);
    const utm = r.cookies.get(COOKIE_UTM);
    const clk = r.cookies.get(COOKIE_CLICK_IDS);
    expect(ref?.value).toBe('ANA10');
    expect(ref?.httpOnly).toBeFalsy();
    expect(ref?.maxAge).toBe(VIGENCIA_ATRIBUCION_SEG);
    expect(ref?.sameSite).toBe('lax');
    expect(ref?.path).toBe('/');
    expect(utm?.httpOnly).toBe(true);
    expect(clk?.httpOnly).toBe(true);
    expect(leerAtribucion(`${COOKIE_UTM}=${encodeURIComponent(utm?.value ?? '')}; ${COOKIE_CLICK_IDS}=${encodeURIComponent(clk?.value ?? '')}`)).toMatchObject({
      utm: { utm_source: 'instagram' },
      click_ids: { gclid: 'G1' },
    });
  });

  it('no escribe nada si los parámetros no son válidos, y no redirige', () => {
    const r = pedir('/co?ref=%3Cx%3E');
    expect(r.cookies.getAll()).toHaveLength(0);
    expect(r.headers.get('location')).toBeNull();
  });

  it('una visita sin ref no borra el referido anterior', () => {
    const r = pedir('/co/catalogo?utm_source=tiktok');
    expect(r.cookies.get(COOKIE_REF)).toBeUndefined();
    expect(r.cookies.get(COOKIE_UTM)).toBeDefined();
  });
});
