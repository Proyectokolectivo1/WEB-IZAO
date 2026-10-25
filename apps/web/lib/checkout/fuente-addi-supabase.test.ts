import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import { aPedidoAddi, fuenteAddiSupabase } from './fuente-addi-supabase';

afterEach(() => fijarClienteDbParaPruebas(null));

const O = '00000000-0000-4000-8000-000000000001';
const P = '00000000-0000-4000-8000-0000000000a1';

const FILA = {
  id: O,
  number: 'IZ-CO-000123',
  public_token: 'tok_publico_123',
  status: 'pendiente_pago',
  payment_method: 'addi',
  country_code: 'CO',
  currency_code: 'COP',
  subtotal: 200000,
  discount_amount: 0,
  financing_surcharge_amount: '20000',
  total_customer: 220000,
  contact_first_name: 'Ana',
  contact_last_name: 'Pérez',
  contact_email: 'ana@example.com',
  contact_phone_e164: '+573001234567',
  document_type: 'CC',
  document_number: '1020304050',
  shipping_address1: 'Calle 10 # 43-12',
  shipping_address2: null,
  shipping_city_name: 'Medellín',
  stock_reserved_until: '2026-10-20T16:00:00+00:00',
  order_items: [
    { sku: 'B-2', name_snapshot: 'Fragancia B', variant_label: null, quantity: 1, unit_price: 50000, line_discount: 0 },
    { sku: 'A-1', name_snapshot: 'Fragancia A', variant_label: '100 ml', quantity: 3, unit_price: '50000', line_discount: 0 },
  ],
};

/** Constructor de consultas falso: registra la cadena de llamadas y resuelve con `resultado`. */
function consulta(resultado: { data: unknown; error: unknown }) {
  const llamadas: [string, unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq', 'order', 'maybeSingle', 'single']) {
    q[m] = (...a: unknown[]) => {
      llamadas.push([m, a]);
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok);
  const from = vi.fn(() => q);
  fijarClienteDbParaPruebas({ from } as never);
  return { llamadas, from };
}

describe('fuente de Addi sobre Supabase', () => {
  it('aPedidoAddi: montos a bigint, líneas con nombre del snapshot y orden estable por SKU', () => {
    const p = aPedidoAddi(FILA);
    expect(p).toMatchObject({ subtotal: 200_000n, financing_surcharge_amount: 20_000n, total_customer: 220_000n, discount_amount: 0n });
    expect(p.stock_reserved_until).toEqual(new Date('2026-10-20T16:00:00Z'));
    expect(p.items).toEqual([
      { sku: 'A-1', name: 'Fragancia A', variant_label: '100 ml', quantity: 3, unit_price: 50_000n, line_discount: 0n },
      { sku: 'B-2', name: 'Fragancia B', variant_label: null, quantity: 1, unit_price: 50_000n, line_discount: 0n },
    ]);
  });

  it('aPedidoAddi: monto con decimales o cantidad 0 → lanza (nunca se envía a Addi)', () => {
    expect(() => aPedidoAddi({ ...FILA, total_customer: 220000.5 })).toThrow();
    expect(() => aPedidoAddi({ ...FILA, order_items: [{ ...FILA.order_items[0], quantity: 0 }] })).toThrow();
  });

  it('pedidoAddiPorId lee orders con sus líneas embebidas', async () => {
    const { llamadas, from } = consulta({ data: FILA, error: null });
    expect((await fuenteAddiSupabase.pedidoAddiPorId(O))?.number).toBe('IZ-CO-000123');
    expect(from).toHaveBeenCalledWith('orders');
    expect(String(llamadas[0]![1][0])).toContain('order_items(sku,name_snapshot,variant_label,quantity,unit_price,line_discount)');
  });

  it('intentosAddi filtra provider addi y purpose financing, del más antiguo al más reciente', async () => {
    const { llamadas } = consulta({ data: [], error: null });
    await fuenteAddiSupabase.intentosAddi(O);
    expect(llamadas.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([
      ['order_id', O],
      ['provider', 'addi'],
      ['purpose', 'financing'],
    ]);
    expect(llamadas.find(([m]) => m === 'order')![1]).toEqual(['created_at', { ascending: true }]);
  });

  it('insertarIntentoAddi: fila created de financiación; 23505 → duplicado', async () => {
    const fila = { id: P, status: 'created', amount: 220000, provider_reference: 'IZ-CO-000123-A1', checkout_url: null, expires_at: '2026-10-20T16:00:00Z', created_at: '2026-10-20T15:00:00Z' };
    const { llamadas } = consulta({ data: fila, error: null });
    const n = { order_id: O, amount: 220_000n, currency_code: 'COP' as const, provider_reference: 'IZ-CO-000123-A1', expires_at: new Date('2026-10-20T16:00:00Z') };
    const r = await fuenteAddiSupabase.insertarIntentoAddi(n);
    expect(r.ok && r.intento.amount).toBe(220_000n);
    expect(llamadas[0]).toEqual([
      'insert',
      [{ order_id: O, provider: 'addi', purpose: 'financing', amount: 220000, currency_code: 'COP', status: 'created', provider_reference: 'IZ-CO-000123-A1', expires_at: '2026-10-20T16:00:00.000Z' }],
    ]);
    consulta({ data: null, error: { code: '23505' } });
    expect(await fuenteAddiSupabase.insertarIntentoAddi(n)).toEqual({ ok: false, motivo: 'duplicado' });
  });

  it('completarIntentoAddi solo toca un intento de Addi aún created y guarda el código de error', async () => {
    const { llamadas } = consulta({ data: null, error: null });
    await fuenteAddiSupabase.completarIntentoAddi(P, { status: 'declined', checkout_url: null, error: 'CLIENTE_CON_CREDITO' });
    expect(llamadas[0]).toEqual([
      'update',
      [{ status: 'declined', checkout_url: null, raw_last_event: { origen: 'crear_solicitud', error: 'CLIENTE_CON_CREDITO' } }],
    ]);
    expect(llamadas.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([
      ['id', P],
      ['provider', 'addi'],
      ['status', 'created'],
    ]);
  });
});
