import { describe, expect, it } from 'vitest';
import { clienteFalso } from '../crud/cliente-falso';
import { cargarDashboard } from './servidor';

const RANGO = { desde: '2026-11-02', hasta: '2026-11-03' };

const pedido = (o: Record<string, unknown> = {}) => ({
  id: 'o1',
  number: 'IZ-CO-000001',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'wompi',
  status: 'entregado',
  created_at: '2026-11-02T15:00:00+00:00',
  paid_at: '2026-11-02T15:05:00+00:00',
  total_customer: 100000,
  discount_amount: 0,
  financing_surcharge_amount: 0,
  cod_deposit_amount: 0,
  cod_collect_amount: 0,
  product_cost_total: 40000,
  gateway_fee_estimated: 3000,
  carrier_fees: { plataforma: 800 },
  shipping_cost_real: null,
  influencer_id: 'i1',
  shipping_city_name: 'Medellín',
  shipping_region_name: 'Antioquia',
  discount_code_id: 'c1',
  utm: { utm_source: 'instagram' },
  click_ids: {},
  order_items: [{ product_id: 'p1', sku: 'A1', name_snapshot: 'Perfume A', quantity: 2, unit_price: 50000, unit_cost: 20000, line_discount: 0 }],
  // PostgREST devuelve objeto o lista según la relación: se aceptan ambos.
  shipments: { provider_status_name: 'Entregado', provider_status_parent: 'Finalizadas', has_novelty: false, shipping_rate: 8000 },
  payments: [
    { order_id: 'o1', status: 'approved', fee_amount: 2900 },
    { order_id: 'o1', status: 'declined', fee_amount: 9999 },
  ],
  ...o,
});

const AJUSTES = { data: [{ country_code: 'CO', shipping_cost_estimate: 12000, fx_rate_to_cop: 1 }, { country_code: 'EC', shipping_cost_estimate: 400, fx_rate_to_cop: '4100.5' }] };

describe('cargarDashboard', () => {
  it('arma el modelo del país desde orders, pagos aprobados, tráfico, gastos y garantías', async () => {
    const { cliente, filtros } = clienteFalso({
      'country_settings.select': AJUSTES,
      'orders.select': [{ data: [pedido()] }, { data: [] }, { data: [] }, { data: [] }],
      'daily_traffic_stats.select': { data: [{ date: '2026-11-02', sessions: 50, product_views: 30, add_to_cart: 10, checkout_started: 5 }] },
      'expenses.select': { data: [{ date: '2026-11-02', amount: 10000, currency_code: 'COP', expense_categories: { slug: 'pauta_meta' } }] },
      'warranty_claims.select': { data: [{ status: 'aprobada', cost_amount: 3000 }, { status: 'rara', cost_amount: 1 }] },
      'discount_codes.select': { data: [{ id: 'c1', code: 'IZAO10' }] },
      'influencers.select': { data: [{ id: 'i1', name: 'Laura' }] },
    });
    const v = await cargarDashboard(cliente, { pais: 'CO', rango: RANGO, preset: null });
    expect(v.paises).toHaveLength(1);
    expect(v.consolidado).toBeNull();
    const r = v.paises[0]!.actual.resumen;
    expect(r.ventasBrutas).toBe(100000n);
    expect(r.comisiones.wompi).toBe(2900n); // el pago aprobado, no el rechazado ni el estimado
    expect(r.costoEnvios).toBe(8000n); // shippingRate (aún sin costo real)
    expect(r.enviosEstimados).toBe(1);
    expect(r.embudo.sesiones).toBe(50n);
    expect(r.gastoPauta).toBe(10000n);
    expect(r.garantias.casos).toBe(1); // el estado desconocido se descarta
    expect(v.nombres).toEqual({ codigos: { c1: 'IZAO10' }, influencers: { i1: 'Laura' } });
    expect(v.paises[0]!.actual.fuentes[0]?.clave).toBe('instagram');
    expect(v.paises[0]!.actual.guias.porGrupo).toEqual([{ grupo: 'Finalizadas', cantidad: 1 }]);
    expect(v.anterior).toEqual({ desde: '2026-10-31', hasta: '2026-11-01' });
    expect(v.truncado).toBe(false);
    // Atribución de §21.1: pagados por paid_at, sin pagar por created_at, en días de Bogotá (UTC-5).
    const consultas = filtros.filter((f) => f.tabla === 'orders');
    expect(consultas.some((f) => f.metodo === 'gte' && f.args[0] === 'paid_at' && f.args[1] === '2026-11-02T05:00:00.000Z')).toBe(true);
    expect(consultas.some((f) => f.metodo === 'lt' && f.args[0] === 'paid_at' && f.args[1] === '2026-11-04T05:00:00.000Z')).toBe(true);
    expect(consultas.some((f) => f.metodo === 'is' && f.args[0] === 'paid_at' && f.args[1] === null)).toBe(true);
  });

  it('"Todos" consolida en COP con la tasa del panel y avisa si falta', async () => {
    const base = {
      'orders.select': { data: [] },
      'daily_traffic_stats.select': { data: [] },
      'expenses.select': { data: [] },
      'warranty_claims.select': { data: [] },
    };
    const con = clienteFalso({ ...base, 'country_settings.select': AJUSTES });
    const v = await cargarDashboard(con.cliente, { pais: 'TODOS', rango: RANGO, preset: 'hoy' });
    expect(v.paises.map((p) => p.actual.pais)).toEqual(['CO', 'EC']);
    expect(v.consolidado && 'error' in v.consolidado).toBe(false);

    const sin = clienteFalso({ ...base, 'country_settings.select': { data: [{ country_code: 'CO', shipping_cost_estimate: 0, fx_rate_to_cop: 1 }, { country_code: 'EC', shipping_cost_estimate: 0, fx_rate_to_cop: null }] } });
    const w = await cargarDashboard(sin.cliente, { pais: 'TODOS', rango: RANGO, preset: null });
    expect(w.consolidado).toEqual({ error: 'sin_tasa', pais: 'EC' });
  });

  it('un error de la base se propaga con un mensaje claro', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': AJUSTES,
      'orders.select': { error: { message: 'boom' } },
    });
    await expect(cargarDashboard(cliente, { pais: 'CO', rango: RANGO, preset: null })).rejects.toThrow(/pedidos pagados/);
  });

  it('pagina de a 1 000 filas y avisa si llega al tope', async () => {
    const mil = Array.from({ length: 1000 }, (_, i) => pedido({ id: `o${i}` }));
    const { cliente } = clienteFalso({
      'country_settings.select': AJUSTES,
      'orders.select': { data: mil },
      'daily_traffic_stats.select': { data: [] },
      'expenses.select': { data: [] },
      'warranty_claims.select': { data: [] },
    });
    const v = await cargarDashboard(cliente, { pais: 'CO', rango: RANGO, preset: null });
    expect(v.truncado).toBe(true);
  });
});
