import { describe, expect, it } from 'vitest';
import {
  columnasBanner,
  destinoDeUrl,
  esUrlDestinoValida,
  esquemaBanner,
  estadoVigencia,
  fechaLocalAIso,
  isoAFechaLocal,
  leerUbicacion,
  objectPositionDe,
  POSICIONES_FOCALES,
  tieneMovilPropia,
  urlDeDestino,
} from './banners';

const D = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const BASE = {
  country_code: 'CO',
  placement: 'hero',
  desktop_media_id: D,
  mobile_media_id: M,
  alt: ' Frasco sobre mármol ',
  is_active: 'on',
};

describe('destino del banner', () => {
  it('producto, variante y categoría se resuelven a la ruta del país', () => {
    expect(urlDeDestino({ tipo: 'producto', slug: 'aventus', sku: null }, 'CO')).toBe('/co/perfume/aventus');
    expect(urlDeDestino({ tipo: 'producto', slug: 'aventus', sku: 'AVT-100' }, 'EC')).toBe('/ec/perfume/aventus?variante=AVT-100');
    expect(urlDeDestino({ tipo: 'categoria', slug: 'para-ella' }, 'CO')).toBe('/co/categoria/para-ella');
    expect(urlDeDestino({ tipo: 'ninguno' }, 'CO')).toBeNull();
  });

  it('destinoDeUrl es la inversa y deja el resto como URL libre', () => {
    expect(destinoDeUrl('/co/perfume/aventus?variante=AVT-100')).toEqual({ tipo: 'producto', slug: 'aventus', sku: 'AVT-100' });
    expect(destinoDeUrl('/ec/perfume/aventus')).toEqual({ tipo: 'producto', slug: 'aventus', sku: null });
    expect(destinoDeUrl('/co/categoria/para-ella')).toEqual({ tipo: 'categoria', slug: 'para-ella' });
    expect(destinoDeUrl('/co/coleccion/hot-sale')).toEqual({ tipo: 'url', url: '/co/coleccion/hot-sale' });
    expect(destinoDeUrl(null)).toEqual({ tipo: 'ninguno' });
    expect(destinoDeUrl('  ')).toEqual({ tipo: 'ninguno' });
  });

  it('solo acepta rutas internas o https; nada de javascript:, //host ni espacios', () => {
    for (const bueno of ['/co/catalogo', '/ec/coleccion/hot-sale?x=1', 'https://izaoperfumeria.com/co']) {
      expect(esUrlDestinoValida(bueno), bueno).toBe(true);
    }
    for (const malo of ['javascript:alert(1)', '//evil.com', 'http://izao.com', 'https://localhost', '/co/a b', '/co\\x', 'data:text/html,hola', '', 'co/catalogo']) {
      expect(esUrlDestinoValida(malo), malo).toBe(false);
    }
  });
});

describe('vigencia', () => {
  it('convierte la hora de Colombia a UTC y de vuelta', () => {
    expect(fechaLocalAIso('2026-11-05T14:30')).toBe('2026-11-05T19:30:00.000Z');
    expect(isoAFechaLocal('2026-11-05T19:30:00.000Z')).toBe('2026-11-05T14:30');
    expect(fechaLocalAIso('')).toBeNull();
    expect(fechaLocalAIso('mañana')).toBeNull();
    expect(isoAFechaLocal(null)).toBe('');
  });

  it('estado: desactivado, programado, vencido o visible', () => {
    const ahora = new Date('2026-11-05T12:00:00Z');
    const b = (is_active: boolean, starts_at: string | null, ends_at: string | null) =>
      estadoVigencia({ is_active, starts_at, ends_at }, ahora);
    expect(b(false, null, null)).toBe('inactivo');
    expect(b(true, '2026-11-06T00:00:00Z', null)).toBe('programado');
    expect(b(true, null, '2026-11-05T12:00:00Z')).toBe('vencido');
    expect(b(true, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z')).toBe('vigente');
    expect(b(true, null, null)).toBe('vigente');
  });
});

describe('esquemaBanner', () => {
  it('acepta lo mínimo y normaliza', () => {
    const d = esquemaBanner.parse(BASE);
    expect(d).toMatchObject({ alt: 'Frasco sobre mármol', is_active: true, destino_tipo: 'ninguno', title: null, text_position: 'left' });
    expect(columnasBanner(d, null)).toMatchObject({ country_code: 'CO', placement: 'hero', link_url: null, category_id: null, starts_at: null });
  });

  it('exige la imagen y el texto alternativo; la móvil es opcional (solo banners antiguos)', () => {
    expect(esquemaBanner.safeParse({ ...BASE, desktop_media_id: '' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, mobile_media_id: 'x' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, alt: 'ab' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, mobile_media_id: '' }).success).toBe(true);
  });

  it('una sola imagen se guarda repetida en la columna móvil (NOT NULL); la antigua se conserva', () => {
    const sola = esquemaBanner.parse({ ...BASE, mobile_media_id: '' });
    expect(sola.mobile_media_id).toBeNull();
    expect(columnasBanner(sola, null)).toMatchObject({ desktop_media_id: D, mobile_media_id: D });
    expect(columnasBanner(esquemaBanner.parse(BASE), null)).toMatchObject({ desktop_media_id: D, mobile_media_id: M });
    expect(tieneMovilPropia(D, D)).toBe(false);
    expect(tieneMovilPropia(D, M)).toBe(true);
    expect(tieneMovilPropia(D, null)).toBe(false);
  });

  it('punto focal: opcional, 0–100 y entero; sin él no toca las columnas', () => {
    expect(columnasBanner(esquemaBanner.parse(BASE), null)).not.toHaveProperty('focal_x');
    const con = esquemaBanner.parse({ ...BASE, focal_x: '100', focal_y: '0' });
    expect(columnasBanner(con, null)).toMatchObject({ focal_x: 100, focal_y: 0 });
    expect(esquemaBanner.safeParse({ ...BASE, focal_x: '101', focal_y: '50' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, focal_x: '-1', focal_y: '50' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, focal_x: 'a', focal_y: '50' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, focal_x: '50.5', focal_y: '50' }).success).toBe(false);
    expect(POSICIONES_FOCALES).toHaveLength(9);
    expect(objectPositionDe(0, 50)).toBe('0% 50%');
  });

  it('el destino pide su dato y el botón pide un destino', () => {
    const intento = (extra: Record<string, string>) => esquemaBanner.safeParse({ ...BASE, ...extra });
    expect(intento({ destino_tipo: 'producto' }).success).toBe(false);
    expect(intento({ destino_tipo: 'categoria' }).success).toBe(false);
    expect(intento({ destino_tipo: 'url', destino_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(intento({ destino_tipo: 'url', destino_url: '/co/catalogo' }).success).toBe(true);
    expect(intento({ destino_tipo: 'producto', destino_producto_id: D }).success).toBe(true);
    expect(intento({ cta_label: 'Comprar' }).success).toBe(false);
    expect(intento({ cta_label: 'Comprar', destino_tipo: 'producto', destino_producto_id: D }).success).toBe(true);
  });

  it('el banner de categoría necesita categoría; las fechas deben ir en orden', () => {
    expect(esquemaBanner.safeParse({ ...BASE, placement: 'category' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...BASE, placement: 'category', category_id: D }).success).toBe(true);
    expect(esquemaBanner.safeParse({ ...BASE, starts_at: '2026-11-10T00:00', ends_at: '2026-11-09T00:00' }).success).toBe(false);
    const ok = esquemaBanner.parse({ ...BASE, starts_at: '2026-11-10T08:00', ends_at: '2026-11-12T20:00' });
    expect(columnasBanner(ok, null)).toMatchObject({ starts_at: '2026-11-10T13:00:00.000Z', ends_at: '2026-11-13T01:00:00.000Z' });
  });

  it('color de texto: solo hex', () => {
    expect(esquemaBanner.safeParse({ ...BASE, text_color: 'red' }).success).toBe(false);
    expect(esquemaBanner.parse({ ...BASE, text_color: '#fff' }).text_color).toBe('#FFF');
  });
});

describe('leerUbicacion', () => {
  it('valores raros caen en el carrusel', () => {
    expect(leerUbicacion('mid')).toBe('mid');
    expect(leerUbicacion('otra')).toBe('hero');
    expect(leerUbicacion(undefined)).toBe('hero');
  });
});
