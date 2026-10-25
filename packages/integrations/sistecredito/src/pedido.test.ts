import { describe, expect, it } from 'vitest';
import { validarPedidoSistecredito, type PedidoSistecredito } from './pedido';

// Caso 4 de §11.3 con recargo del 10 %: subtotal 200.000, recargo 20.000, total 220.000 (sin código).
const BASE: PedidoSistecredito = {
  number: 'IZ-CO-000123',
  country_code: 'CO',
  currency_code: 'COP',
  subtotal: 200_000n,
  discount_amount: 0n,
  financing_surcharge_amount: 20_000n,
  total_customer: 220_000n,
  items: [
    { sku: 'A-100', quantity: 1, unit_price: 120_000n, line_discount: 0n },
    { sku: 'B-50', quantity: 2, unit_price: 40_000n, line_discount: 0n },
  ],
};

describe('validarPedidoSistecredito (§11.2, §12.4)', () => {
  it('acepta el pedido con recargo y monto a financiar = total_customer', () => {
    expect(validarPedidoSistecredito(BASE)).toEqual({ ok: true, montoFinanciado: 220_000n });
  });

  it('acepta recargo 0 (porcentaje configurado en 0)', () => {
    const r = validarPedidoSistecredito({ ...BASE, financing_surcharge_amount: 0n, total_customer: 200_000n });
    expect(r).toEqual({ ok: true, montoFinanciado: 200_000n });
  });

  it('solo Colombia en pesos', () => {
    expect(validarPedidoSistecredito({ ...BASE, country_code: 'EC' })).toEqual({ ok: false, motivo: 'moneda' });
    expect(validarPedidoSistecredito({ ...BASE, currency_code: 'USD' })).toEqual({ ok: false, motivo: 'moneda' });
  });

  it('rechaza descuentos de pedido o de línea (la financiación no admite códigos)', () => {
    expect(validarPedidoSistecredito({ ...BASE, discount_amount: 1n })).toEqual({ ok: false, motivo: 'descuento' });
    const items = BASE.items.map((i, n) => (n === 0 ? { ...i, line_discount: 5_000n } : i));
    expect(validarPedidoSistecredito({ ...BASE, items })).toEqual({ ok: false, motivo: 'descuento' });
  });

  it('rechaza totales que no cuadran', () => {
    expect(validarPedidoSistecredito({ ...BASE, total_customer: 219_999n }).ok).toBe(false);
    expect(validarPedidoSistecredito({ ...BASE, subtotal: 199_000n, total_customer: 219_000n }).ok).toBe(false);
    expect(validarPedidoSistecredito({ ...BASE, financing_surcharge_amount: -1n, total_customer: 199_999n }).ok).toBe(false);
    expect(validarPedidoSistecredito({ ...BASE, items: [] }).ok).toBe(false);
    const fraccion = [{ sku: 'X', quantity: 1.5, unit_price: 1n, line_discount: 0n }];
    expect(validarPedidoSistecredito({ ...BASE, items: fraccion }).ok).toBe(false);
    const cero = { ...BASE, subtotal: 0n, financing_surcharge_amount: 0n, total_customer: 0n, items: [{ sku: 'X', quantity: 1, unit_price: 0n, line_discount: 0n }] };
    expect(validarPedidoSistecredito(cero)).toEqual({ ok: false, motivo: 'totales' });
  });
});
