import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { clienteFalso } from '../crud/cliente-falso';
import { reporteInfluencers } from './influencers-servidor';

const INF = '99999999-9999-4999-8999-999999999999';
const pedido = {
  id: 'o1',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'wompi',
  status: 'entregado',
  created_at: '2026-10-20T15:00:00+00:00',
  paid_at: '2026-10-20T15:05:00+00:00',
  total_customer: 100000,
  discount_amount: 0,
  financing_surcharge_amount: 0,
  cod_deposit_amount: 0,
  cod_collect_amount: 0,
  product_cost_total: 0,
  gateway_fee_estimated: 0,
  carrier_fees: {},
  shipping_cost_real: null,
  influencer_id: INF,
};

describe('reporteInfluencers · porcentaje de comisión sin floats', () => {
  const reporte = async (commission_pct: number | string | null) => {
    const { cliente } = clienteFalso({
      'orders.select': [{ data: [pedido] }, { data: [] }],
      'country_settings.select': { data: { shipping_cost_estimate: 0 } },
      'influencers.select': { data: [{ id: INF, name: 'Laura', handle: null, commission_pct }] },
    });
    return reporteInfluencers(cliente, { pais: 'CO', desde: '2026-10-01', hasta: '2026-10-31' });
  };

  it('12,05 % sobre 100 000 es exactamente 12 050 (con float daría 12 049 o 12 050 según el redondeo)', async () => {
    const r = await reporte(12.05);
    expect(r.filas[0]).toMatchObject({ comisionPct: '12.05', comision: 12050n });
  });

  it('acepta el porcentaje como texto de la base y la ausencia de comisión', async () => {
    expect((await reporte('7.5')).filas[0]).toMatchObject({ comisionPct: '7.5', comision: 7500n });
    expect((await reporte(null)).filas[0]).toMatchObject({ comisionPct: null, comision: null });
  });
});
