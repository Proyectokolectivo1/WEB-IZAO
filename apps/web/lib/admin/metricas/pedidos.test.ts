import { describe, expect, it } from 'vitest';
import { ingresoConfirmado } from '@izao/core/metrics';
import { aPedidoMetrica, type FilaPedidoMetrica } from './pedidos';

const fila = (o: Partial<FilaPedidoMetrica> = {}): FilaPedidoMetrica => ({
  id: 'o1',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'wompi',
  status: 'entregado',
  created_at: '2026-11-01T10:00:00+00:00',
  paid_at: '2026-11-01T10:05:00+00:00',
  total_customer: 100000,
  discount_amount: 5000,
  financing_surcharge_amount: 0,
  cod_deposit_amount: 0,
  cod_collect_amount: 0,
  product_cost_total: 40000,
  gateway_fee_estimated: 3000,
  carrier_fees: { plataforma: 800 },
  shipping_cost_real: null,
  ...o,
});

describe('aPedidoMetrica', () => {
  it('convierte los montos a bigint y respeta las definiciones del núcleo', () => {
    const p = aPedidoMetrica(fila(), { envioEstimadoPais: 12000 });
    expect(p).toMatchObject({ pais: 'CO', moneda: 'COP', metodo: 'wompi', estado: 'entregado', total: 100000n, descuento: 5000n });
    expect(p?.comisionPlataforma).toBe(800n);
    expect(p?.envioEstimadoPais).toBe(12000n);
    expect(p && ingresoConfirmado(p)).toBe(100000n);
  });

  it('la comisión sale de los pagos aprobados si todos traen comisión; si no, de la estimada', () => {
    const pagos = [{ order_id: 'o1', fee_amount: 2500 }, { order_id: 'otro', fee_amount: 9999 }];
    expect(aPedidoMetrica(fila(), { pagos })?.comisionPasarela).toBe(2500n);
    expect(aPedidoMetrica(fila(), { pagos: [{ order_id: 'o1', fee_amount: null }] })?.comisionPasarela).toBe(3000n);
    expect(aPedidoMetrica(fila())?.comisionPasarela).toBe(3000n);
  });

  it('contra entrega: el ingreso depende del estado', () => {
    const cod = fila({ payment_method: 'cod', cod_deposit_amount: 20000, cod_collect_amount: 80000 });
    expect(ingresoConfirmado(aPedidoMetrica(cod)!)).toBe(100000n);
    expect(ingresoConfirmado(aPedidoMetrica({ ...cod, status: 'devuelto' })!)).toBe(20000n);
  });

  it('descarta métodos o estados desconocidos en vez de inventarlos', () => {
    expect(aPedidoMetrica(fila({ payment_method: 'cripto' }))).toBeNull();
    expect(aPedidoMetrica(fila({ status: 'raro' }))).toBeNull();
  });

  it('un monto inseguro lanza en vez de perder precisión', () => {
    expect(() => aPedidoMetrica(fila({ total_customer: 2 ** 60 }))).toThrow();
  });

  it('la comisión de plataforma acepta enteros en texto pero no texto raro, decimales ni negativos', () => {
    const c = (plataforma: unknown) => aPedidoMetrica(fila({ carrier_fees: { plataforma } }))?.comisionPlataforma;
    expect(c('800')).toBe(800n);
    expect(c(' 1500 ')).toBe(1500n);
    for (const raro of ['8.5', '-3', 'abc', '', '1e3', 800.5, -1, null, {}]) expect(c(raro), String(raro)).toBe(0n);
  });

  it('tolera carrier_fees vacío o con forma vieja', () => {
    expect(aPedidoMetrica(fila({ carrier_fees: {} }))?.comisionPlataforma).toBe(0n);
    expect(aPedidoMetrica(fila({ carrier_fees: null }))?.comisionPlataforma).toBe(0n);
    expect(aPedidoMetrica(fila({ shipping_cost_real: 9000 }))?.envioReal).toBe(9000n);
  });
});
