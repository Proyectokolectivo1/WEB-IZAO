import { describe, expect, it } from 'vitest';
import { filasVentasDiarias } from '@izao/core/metrics';
import { fetchFalso, type Llamada } from '../fetch-falso.js';
import { crearFuenteMetricasPostgrest } from './fuente-postgrest.js';

const CLAVE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

function fuenteCon(responder: (l: Llamada) => { status: number; cuerpo?: unknown }, tamanoPagina?: number) {
  const { f, llamadas } = fetchFalso(responder);
  const fuente = crearFuenteMetricasPostgrest({
    supabaseUrl: 'https://x.supabase.co/',
    secretKey: 'llave-de-servidor-ficticia',
    claveCifrado: CLAVE,
    fetchImpl: f,
    ...(tamanoPagina ? { tamanoPagina } : {}),
  });
  return { fuente, llamadas };
}

const FILA = {
  id: '00000000-0000-4000-8000-0000000000aa',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'wompi',
  status: 'entregado',
  created_at: '2026-10-20T15:00:00+00:00',
  paid_at: '2026-10-20T15:05:00+00:00',
  total_customer: 200000,
  discount_amount: 10000,
  financing_surcharge_amount: 0,
  cod_deposit_amount: 0,
  cod_collect_amount: 0,
  product_cost_total: 80000,
  gateway_fee_estimated: 7500,
  shipping_cost_real: null,
  carrier_fees: { fuente: 'mastershop_wallet', envio: 0, devolucion: 0, plataforma: 1500, whatsapp: 0, movimientos: {} },
  payments: [
    { status: 'approved', fee_amount: 7140 },
    { status: 'declined', fee_amount: null },
  ],
  shipments: [
    { shipping_rate: 9000, created_at: '2026-10-20T16:00:00+00:00' },
    { shipping_rate: 11000, created_at: '2026-10-21T16:00:00+00:00' },
  ],
};

function responderBase(filas: unknown[] = [FILA]) {
  return (l: Llamada) => {
    if (l.url.includes('/country_settings?')) return { status: 200, cuerpo: [{ shipping_cost_estimate: 14000 }] };
    if (l.url.includes('/orders?')) return { status: 200, cuerpo: filas };
    return { status: 404 };
  };
}

describe('fuente PostgREST de métricas', () => {
  it('consulta el día de Bogotá por paid_at o, sin pago, created_at, del país', async () => {
    const { fuente, llamadas } = fuenteCon(responderBase());
    await fuente.pedidosDelDia('2026-10-20', 'CO');
    const orders = llamadas.find((l) => l.url.includes('/orders?'))!;
    expect(orders.url).toContain('country_code=eq.CO');
    expect(orders.url).toContain(
      'or=(and(paid_at.gte.2026-10-20T05:00:00.000Z,paid_at.lt.2026-10-21T05:00:00.000Z),and(paid_at.is.null,created_at.gte.2026-10-20T05:00:00.000Z,created_at.lt.2026-10-21T05:00:00.000Z))',
    );
    expect(orders.url).toContain('payments(status,fee_amount)');
    expect(orders.url).toContain('shipments(shipping_rate,created_at)');
    expect(orders.url).toContain('order=id.asc');
    const cs = llamadas.find((l) => l.url.includes('/country_settings?'))!;
    expect(cs.url).toContain('country_code=eq.CO');
    expect(orders.cabeceras.get('apikey')).toBe('llave-de-servidor-ficticia');
  });

  it('mapea a PedidoMetrica: enteros bigint, comisión real de pagos aprobados, tarifa del envío más reciente, plataforma', async () => {
    const { fuente } = fuenteCon(responderBase());
    const [p] = await fuente.pedidosDelDia('2026-10-20', 'CO');
    expect(p).toEqual({
      id: FILA.id,
      pais: 'CO',
      moneda: 'COP',
      metodo: 'wompi',
      estado: 'entregado',
      creadoEn: new Date('2026-10-20T15:00:00Z'),
      pagadoEn: new Date('2026-10-20T15:05:00Z'),
      total: 200_000n,
      descuento: 10_000n,
      recargo: 0n,
      abono: 0n,
      recaudo: 0n,
      costoProducto: 80_000n,
      comisionPasarela: 7_140n,
      comisionPlataforma: 1_500n,
      envioReal: null,
      tarifaEnvio: 11_000n,
      envioEstimadoPais: 14_000n,
    });
  });

  it('sin pagos aprobados usa gateway_fee_estimated; sin carrier_fees ni envíos usa 0 y null', async () => {
    const fila = { ...FILA, payments: [], shipments: [], carrier_fees: {}, shipping_cost_real: 12000 };
    const { fuente } = fuenteCon(responderBase([fila]));
    const [p] = await fuente.pedidosDelDia('2026-10-20', 'CO');
    expect(p).toMatchObject({ comisionPasarela: 7_500n, comisionPlataforma: 0n, tarifaEnvio: null, envioReal: 12_000n });
  });

  it('pagina por bloques hasta un bloque incompleto', async () => {
    const filas = [1, 2, 3].map((n) => ({ ...FILA, id: `00000000-0000-4000-8000-00000000000${n}` }));
    const { fuente, llamadas } = fuenteCon((l) => {
      if (l.url.includes('/country_settings?')) return { status: 200, cuerpo: [{ shipping_cost_estimate: 14000 }] };
      const offset = Number(/offset=(\d+)/.exec(l.url)?.[1] ?? '0');
      return { status: 200, cuerpo: filas.slice(offset, offset + 2) };
    }, 2);
    const pedidos = await fuente.pedidosDelDia('2026-10-20', 'CO');
    expect(pedidos.map((p) => p.id)).toEqual(filas.map((f) => f.id));
    const urls = llamadas.filter((l) => l.url.includes('/orders?')).map((l) => l.url);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('limit=2&offset=0');
    expect(urls[1]).toContain('limit=2&offset=2');
  });

  it('rechaza montos no enteros, negativos o fuera de rango y estados o métodos desconocidos', async () => {
    for (const malo of [
      { total_customer: 1.5 },
      { total_customer: -1 },
      { total_customer: 2 ** 60 },
      { product_cost_total: 'abc' },
      { status: 'perdido' },
      { payment_method: 'paypal' },
      { country_code: 'EC' },
    ]) {
      const { fuente } = fuenteCon(responderBase([{ ...FILA, ...malo }]));
      await expect(fuente.pedidosDelDia('2026-10-20', 'CO')).rejects.toThrow(RangeError);
    }
  });

  it('sin country_settings del país no calcula', async () => {
    const { fuente } = fuenteCon((l) => (l.url.includes('/country_settings?') ? { status: 200, cuerpo: [] } : { status: 200, cuerpo: [] }));
    await expect(fuente.pedidosDelDia('2026-10-20', 'CO')).rejects.toThrow(/country_settings/);
  });

  it('guardarFilas: upsert por (date, country_code, payment_method), montos como texto exacto y recalculated_at', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 201 }));
    const filas = filasVentasDiarias([], '2026-10-20', 'CO').map((f) =>
      f.payment_method === 'wompi' ? { ...f, gross_sales: 9_007_199_254_740_993n, orders_created: 3 } : f,
    );
    await fuente.guardarFilas(filas, new Date('2026-10-24T12:00:00Z'));
    expect(llamadas).toHaveLength(1);
    const l = llamadas[0]!;
    expect(l.metodo).toBe('POST');
    expect(l.url).toContain('/daily_sales_stats?on_conflict=date,country_code,payment_method');
    expect(l.cabeceras.get('prefer')).toBe('resolution=merge-duplicates,return=minimal');
    const cuerpo = l.cuerpo as Record<string, unknown>[];
    expect(cuerpo).toHaveLength(5);
    const wompi = cuerpo.find((c) => c.payment_method === 'wompi')!;
    expect(wompi.gross_sales).toBe('9007199254740993');
    expect(wompi.orders_created).toBe(3);
    expect(wompi.confirmed_revenue).toBe('0');
    expect(wompi.recalculated_at).toBe('2026-10-24T12:00:00.000Z');
    expect(Object.keys(wompi).sort()).toEqual([...Object.keys(filas[0]!), 'recalculated_at'].sort());
  });

  it('guardarFilas sin filas no llama a la base; error HTTP se propaga con SQLSTATE y sin cuerpo', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 400, cuerpo: { code: '23514', message: 'detalle interno' } }));
    await fuente.guardarFilas([], new Date());
    expect(llamadas).toHaveLength(0);
    const e = (await fuente.guardarFilas(filasVentasDiarias([], '2026-10-20', 'CO'), new Date()).then(
      () => null,
      (x: unknown) => x,
    )) as Error | null;
    expect(e).toBeInstanceOf(Error);
    expect(e?.message).toContain('23514');
    expect(e?.message).not.toContain('detalle interno');
  });
});
