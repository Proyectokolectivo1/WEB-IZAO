import { describe, expect, it } from 'vitest';
import { construirSolicitudAddi, referenciaAddi, type PedidoFinanciado } from './solicitud';

/** Caso 4 de §11.3: 1 × 90.000 con Addi, código retirado, recargo 9.000, total 99.000. */
function caso4(extra: Partial<PedidoFinanciado> = {}): PedidoFinanciado {
  return {
    number: 'IZ-CO-000123',
    public_token: 'tok_publico_ficticio_0001',
    country_code: 'CO',
    currency_code: 'COP',
    subtotal: 90_000n,
    discount_amount: 0n,
    financing_surcharge_amount: 9_000n,
    total_customer: 99_000n,
    contact_first_name: 'Ana María',
    contact_last_name: 'Gómez Ruiz',
    contact_email: 'ana@example.com',
    contact_phone_e164: '+573001234567',
    document_type: 'CC',
    document_number: '1020304050',
    shipping_address1: 'Cra 43A # 1-50',
    shipping_address2: 'Apto 301',
    shipping_city_name: 'Medellín',
    items: [{ sku: 'IZ-001-100', name: 'Fragancia Uno', variant_label: '100 ml', quantity: 1, unit_price: 90_000n, line_discount: 0n }],
    ...extra,
  };
}

const URLS = { urlSitio: 'https://izaoperfumeria.com', referencia: 'IZ-CO-000123-A1' };

describe('solicitud de crédito en línea de Addi (POST /v1/online-applications)', () => {
  it('caso 4 de §11.3: totalAmount 99.000 con el recargo como ítem separado', () => {
    const r = construirSolicitudAddi(caso4(), URLS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo).toEqual({
      orderId: 'IZ-CO-000123-A1',
      totalAmount: '99000.0',
      shippingAmount: '0.0',
      currency: 'COP',
      items: [
        { sku: 'IZ-001-100', name: 'Fragancia Uno 100 ml', quantity: '1', unitPrice: '90000.0' },
        { sku: 'CARGO-FINANCIACION', name: 'Cargo por financiación', quantity: '1', unitPrice: '9000.0' },
      ],
      client: {
        idType: 'CC',
        idNumber: '1020304050',
        firstName: 'Ana María',
        lastName: 'Gómez Ruiz',
        email: 'ana@example.com',
        cellphone: '3001234567',
        cellphoneCountryCode: '+57',
        address: { lineOne: 'Cra 43A # 1-50 Apto 301', city: 'Medellín', country: 'CO' },
      },
      shippingAddress: { lineOne: 'Cra 43A # 1-50 Apto 301', city: 'Medellín', country: 'CO' },
      allyUrlRedirection: {
        callbackUrl: 'https://izaoperfumeria.com/api/webhooks/addi',
        redirectionUrl: 'https://izaoperfumeria.com/co/pedido/tok_publico_ficticio_0001',
      },
    });
  });

  it('caso 5 de §11.3 (mismo patrón): 90.000 + 120.000, recargo 21.000, total 231.000', () => {
    const r = construirSolicitudAddi(
      caso4({
        subtotal: 210_000n,
        financing_surcharge_amount: 21_000n,
        total_customer: 231_000n,
        items: [
          { sku: 'A', name: 'Uno', variant_label: null, quantity: 1, unit_price: 90_000n, line_discount: 0n },
          { sku: 'B', name: 'Dos', variant_label: null, quantity: 1, unit_price: 120_000n, line_discount: 0n },
        ],
      }),
      URLS,
    );
    expect(r.ok && r.cuerpo.totalAmount).toBe('231000.0');
    expect(r.ok && r.cuerpo.items.map((i) => i.unitPrice)).toEqual(['90000.0', '120000.0', '21000.0']);
  });

  it('sin recargo configurado (0) no agrega ítem de cargo', () => {
    const r = construirSolicitudAddi(caso4({ financing_surcharge_amount: 0n, total_customer: 90_000n }), URLS);
    expect(r.ok && r.cuerpo.items).toHaveLength(1);
  });

  it('no envía si los montos no cuadran (descuento, total, ítems o descuento por línea)', () => {
    expect(construirSolicitudAddi(caso4({ discount_amount: 1_000n, total_customer: 98_000n }), URLS)).toEqual({ ok: false, motivo: 'descuento' });
    expect(construirSolicitudAddi(caso4({ total_customer: 100_000n }), URLS)).toEqual({ ok: false, motivo: 'totales' });
    expect(construirSolicitudAddi(caso4({ subtotal: 80_000n, total_customer: 89_000n }), URLS)).toEqual({ ok: false, motivo: 'totales' });
    const conLinea = caso4();
    conLinea.items[0]!.line_discount = 500n;
    expect(construirSolicitudAddi(conLinea, URLS)).toEqual({ ok: false, motivo: 'descuento' });
  });

  it('Addi solo recibe cédula de ciudadanía (CC) y exige correo', () => {
    expect(construirSolicitudAddi(caso4({ document_type: 'CE' }), URLS)).toEqual({ ok: false, motivo: 'documento' });
    expect(construirSolicitudAddi(caso4({ document_number: null }), URLS)).toEqual({ ok: false, motivo: 'documento' });
    expect(construirSolicitudAddi(caso4({ contact_email: null }), URLS)).toEqual({ ok: false, motivo: 'correo' });
  });

  it('celular colombiano E.164 obligatorio; dirección y ciudad obligatorias', () => {
    expect(construirSolicitudAddi(caso4({ contact_phone_e164: '+593991234567' }), URLS)).toEqual({ ok: false, motivo: 'celular' });
    expect(construirSolicitudAddi(caso4({ shipping_city_name: null }), URLS)).toEqual({ ok: false, motivo: 'direccion' });
    expect(construirSolicitudAddi(caso4({ shipping_address1: '  ' }), URLS)).toEqual({ ok: false, motivo: 'direccion' });
  });

  it('solo Colombia en COP', () => {
    expect(construirSolicitudAddi(caso4({ country_code: 'EC', currency_code: 'USD' }), URLS)).toEqual({ ok: false, motivo: 'moneda' });
  });

  it('exige SITE_URL https y referencia con forma de intento', () => {
    expect(() => construirSolicitudAddi(caso4(), { ...URLS, urlSitio: 'http://izao.test' })).toThrow(RangeError);
    expect(() => construirSolicitudAddi(caso4(), { ...URLS, referencia: 'IZ CO' })).toThrow(RangeError);
  });

  it('referencia por intento: número + "-A{n}"', () => {
    expect(referenciaAddi('IZ-CO-000123', 1)).toBe('IZ-CO-000123-A1');
    expect(referenciaAddi('IZ-CO-000123', 3)).toBe('IZ-CO-000123-A3');
    expect(() => referenciaAddi('IZ-CO-000123', 0)).toThrow(RangeError);
  });
});
