import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archivoLatinDe, extraerArchivoLatin, reiniciarCachePrecarga, TTL_NEGATIVO_MS } from './precarga';

const CSS =
  '@font-face{font-family:Cormorant Garamond;font-style:normal;font-weight:300 700;font-display:swap;src:url(/_next/static/media/aaa111-s.woff2) format("woff2");unicode-range:u+0460-052f,u+1c80-1c8a}' +
  '@font-face{font-family:Cormorant Garamond;font-style:normal;font-weight:300 700;font-display:swap;src:url(/_next/static/media/lat111-s.woff2) format("woff2");unicode-range:u+00??,u+0131,u+0152-0153}' +
  '@font-face{font-family:Cormorant Garamond;font-style:italic;font-weight:300 700;font-display:swap;src:url(/_next/static/media/ita111-s.woff2) format("woff2");unicode-range:u+00??,u+0131}' +
  '@font-face{font-family:Cormorant Garamond Fallback;src:local("Times New Roman");ascent-override:90%}' +
  '@font-face{font-family:Manrope;font-style:normal;font-weight:200 800;font-display:swap;src:url(/_next/static/media/man111-s.woff2) format("woff2");unicode-range:U+00??,U+0131}';

describe('extraerArchivoLatin', () => {
  it('toma el subset latin normal de la familia, no el cirílico, el cursivo ni el de respaldo', () => {
    expect(extraerArchivoLatin(CSS, 'Cormorant Garamond')).toBe('/_next/static/media/lat111-s.woff2');
    expect(extraerArchivoLatin(CSS, 'Manrope')).toBe('/_next/static/media/man111-s.woff2');
  });
  it('devuelve null si la familia no está o la ruta no es de /_next/static/media', () => {
    expect(extraerArchivoLatin(CSS, 'Lora')).toBeNull();
    expect(extraerArchivoLatin('@font-face{font-family:Lora;font-style:normal;src:url(https://x.com/a.woff2);unicode-range:u+00??}', 'Lora')).toBeNull();
  });
});

describe('archivoLatinDe (caché)', () => {
  beforeEach(() => reiniciarCachePrecarga());
  it('recuerda el resultado negativo durante el TTL y reintenta después', () => {
    const leer = vi.fn(() => [CSS]);
    expect(archivoLatinDe('Lora', 0, leer)).toBeNull();
    expect(archivoLatinDe('Lora', TTL_NEGATIVO_MS - 1, leer)).toBeNull();
    expect(leer).toHaveBeenCalledTimes(1);
    expect(archivoLatinDe('Lora', TTL_NEGATIVO_MS + 1, leer)).toBeNull();
    expect(leer).toHaveBeenCalledTimes(2);
  });
  it('un acierto se recuerda sin releer, y un fallo previo se corrige al reintentar', () => {
    let css: string[] = [];
    const leer = vi.fn(() => css);
    expect(archivoLatinDe('Manrope', 0, leer)).toBeNull();
    css = [CSS];
    expect(archivoLatinDe('Manrope', 10, leer)).toBeNull(); // aún dentro del TTL
    expect(archivoLatinDe('Manrope', TTL_NEGATIVO_MS + 1, leer)).toBe('/_next/static/media/man111-s.woff2');
    const n = leer.mock.calls.length;
    expect(archivoLatinDe('Manrope', 10 * TTL_NEGATIVO_MS, leer)).toBe('/_next/static/media/man111-s.woff2');
    expect(leer).toHaveBeenCalledTimes(n);
  });
});
