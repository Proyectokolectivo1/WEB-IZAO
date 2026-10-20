import { describe, expect, it } from 'vitest';
import { huellaSolicitud, type DatosSolicitud } from './huella';

const BASE: DatosSolicitud = {
  country_code: 'CO',
  payment_method: 'wompi',
  discount_code: 'DESC10',
  items: [
    { variant_id: '11111111-1111-4111-8111-111111111111', quantity: 2 },
    { variant_id: '22222222-2222-4222-8222-222222222222', quantity: 1 },
  ],
  shipping: {
    region_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    city_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    district: 'Laureles',
    address1: 'Calle 10 # 20-30',
    address2: null,
    notes: null,
  },
};

describe('huella de la solicitud del checkout', () => {
  it('SHA-256 en hexadecimal, estable', () => {
    const h = huellaSolicitud(BASE);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaSolicitud(structuredClone(BASE))).toBe(h);
  });

  it('no depende del orden de las líneas ni de mayúsculas en los UUID', () => {
    const otra: DatosSolicitud = {
      ...BASE,
      items: [
        { variant_id: '22222222-2222-4222-8222-222222222222', quantity: 1 },
        { variant_id: '11111111-1111-4111-8111-111111111111'.toUpperCase(), quantity: 2 },
      ],
      shipping: { ...BASE.shipping, city_id: BASE.shipping.city_id.toUpperCase() },
    };
    expect(huellaSolicitud(otra)).toBe(huellaSolicitud(BASE));
  });

  it.each<[string, Partial<DatosSolicitud>]>([
    ['cantidad', { items: [{ ...BASE.items[0]!, quantity: 3 }, BASE.items[1]!] }],
    ['línea de más', { items: [...BASE.items, { variant_id: '33333333-3333-4333-8333-333333333333', quantity: 1 }] }],
    ['método', { payment_method: 'cod' }],
    ['código', { discount_code: null }],
    ['país', { country_code: 'EC' }],
    ['dirección', { shipping: { ...BASE.shipping, address1: 'Carrera 1 # 2-3' } }],
    ['ciudad', { shipping: { ...BASE.shipping, city_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }],
    ['notas', { shipping: { ...BASE.shipping, notes: 'portería' } }],
  ])('cambia si cambia %s', (_n, cambio) => {
    expect(huellaSolicitud({ ...BASE, ...cambio })).not.toBe(huellaSolicitud(BASE));
  });
});
