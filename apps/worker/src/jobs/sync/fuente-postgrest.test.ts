import { describe, expect, it } from 'vitest';
import { fetchFalso } from '../fetch-falso.js';
import { crearFuenteBilleteraPostgrest, crearFuentePollingPostgrest } from './fuente-postgrest.js';

const OPC = { supabaseUrl: 'https://x.supabase.co', secretKey: 'llave-servidor-ficticia', claveCifrado: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=' };

describe('fuente PostgREST de la billetera', () => {
  const gasto = { external_ref: '90001', date: '2026-10-19', amount: 300n, description: 'Cobro por envío mensaje de WhatsApp' };

  it('gasto: categoría mastershop, source mastershop_wallet, monto entero; 23505 → ya existía', async () => {
    let inserts = 0;
    const { f, llamadas } = fetchFalso((l) => {
      if (l.url.includes('expense_categories')) return { status: 200, cuerpo: [{ id: 'cat-ms' }] };
      inserts++;
      return inserts === 1 ? { status: 201 } : { status: 409, cuerpo: { code: '23505' } };
    });
    const fuente = crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f });
    expect(await fuente.registrarGasto(gasto, 'CO')).toBe(true);
    expect(await fuente.registrarGasto(gasto, 'CO')).toBe(false);
    expect(llamadas.find((l) => l.metodo === 'POST')!.cuerpo).toEqual({
      country_code: 'CO', category_id: 'cat-ms', date: '2026-10-19', amount: '300', currency_code: 'COP',
      description: 'Cobro por envío mensaje de WhatsApp', source: 'mastershop_wallet', external_ref: '90001',
    });
    expect(llamadas.filter((l) => l.url.includes('expense_categories'))).toHaveLength(1);
  });

  it('gasto de Ecuador: país EC y moneda USD (D-052)', async () => {
    const { f, llamadas } = fetchFalso((l) => (l.url.includes('expense_categories') ? { status: 200, cuerpo: [{ id: 'cat-ms' }] } : { status: 201 }));
    await crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f }).registrarGasto({ ...gasto, amount: 475n }, 'EC');
    expect(llamadas.find((l) => l.metodo === 'POST')!.cuerpo).toMatchObject({ country_code: 'EC', amount: '475', currency_code: 'USD' });
  });

  it('saldo y llave por país: lee y escribe country_settings de EC', async () => {
    const { f, llamadas } = fetchFalso(() => ({ status: 200, cuerpo: [] }));
    const fuente = crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f });
    await fuente.estadoSaldo('EC');
    await fuente.guardarSaldo(null, false, new Date(), 'EC');
    await fuente.credenciales('EC');
    expect(llamadas[0]!.url).toContain('country_settings?country_code=eq.EC');
    expect(llamadas[1]!.url).toContain('country_settings?country_code=eq.EC');
    expect(llamadas[2]!.url).toContain('integration_credentials?provider=eq.mastershop&country_code=eq.EC');
  });

  it('saldo: sin las columnas nuevas (42703) devuelve null en vez de fallar', async () => {
    const { f } = fetchFalso(() => ({ status: 400, cuerpo: { code: '42703' } }));
    expect(await crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f }).estadoSaldo('CO')).toBeNull();
  });

  it('saldo: lee umbral y alerta activa', async () => {
    const { f } = fetchFalso(() => ({ status: 200, cuerpo: [{ carrier_wallet_low_balance: 100000, carrier_wallet_low_alert_at: '2026-10-19T00:00:00Z' }] }));
    expect(await crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f }).estadoSaldo('CO')).toEqual({ umbral: 100000n, alertaActiva: true });
  });

  it('pedidos por id de MasterShop en lotes con in.()', async () => {
    const { f, llamadas } = fetchFalso(() => ({ status: 200, cuerpo: [{ order_id: 'o1', provider_order_id: 1001, orders: { carrier_fees: { envio: 1 } } }] }));
    const r = await crearFuenteBilleteraPostgrest({ ...OPC, fetchImpl: f }).pedidosPorIdProveedor([1001, 1002]);
    expect(r).toEqual([{ order_id: 'o1', provider_order_id: 1001, carrier_fees: { envio: 1 } }]);
    expect(llamadas[0]!.url).toContain('provider_order_id=in.(1001,1002)');
  });
});

describe('fuente PostgREST del polling', () => {
  it('lee solo envíos con id de MasterShop y pedido no terminal', async () => {
    const { f, llamadas } = fetchFalso(() => ({
      status: 200,
      cuerpo: [
        { order_id: 'o1', external_order_id: 'IZ-CO-000001', provider_order_id: 1001, provider_status_id: 2, has_novelty: false, tracking_code: null, last_synced_at: '2026-10-19T15:00:00Z', orders: { status: 'enviado_transportadora' } },
        { order_id: 'o2', external_order_id: 'IZ-CO-000002', provider_order_id: null },
        { order_id: 'o3', external_order_id: 'IZ-CO-000003', provider_order_id: 1003, provider_status_id: 3, has_novelty: false, tracking_code: '75070783091', last_synced_at: null, label_url: 'https://cdn.bemaster.com/x.pdf', label_local_path: null },
        { order_id: 'o4', external_order_id: 'IZ-CO-000004', provider_order_id: 1004, provider_status_id: 3, has_novelty: false, tracking_code: '1', last_synced_at: null, label_url: 'https://cdn.bemaster.com/y.pdf', label_local_path: 'labels/IZ-CO-000004.pdf' },
      ],
    }));
    const r = await crearFuentePollingPostgrest({ ...OPC, fetchImpl: f }).enviosAbiertos('CO');
    expect(llamadas[0]!.url).toContain('orders.country_code=eq.CO');
    expect(r).toEqual([
      { order_id: 'o1', external_order_id: 'IZ-CO-000001', provider_order_id: 1001, provider_status_id: 2, has_novelty: false, tracking_code: null, last_synced_at: new Date('2026-10-19T15:00:00Z') },
      { order_id: 'o3', external_order_id: 'IZ-CO-000003', provider_order_id: 1003, provider_status_id: 3, has_novelty: false, tracking_code: '75070783091', last_synced_at: null, etiqueta_pendiente: true },
      { order_id: 'o4', external_order_id: 'IZ-CO-000004', provider_order_id: 1004, provider_status_id: 3, has_novelty: false, tracking_code: '1', last_synced_at: null },
    ]);
    const url = llamadas[0]!.url;
    expect(url).toContain('provider_order_id=not.is.null');
    expect(url).toContain('orders!inner(status,country_code)');
    expect(url).toMatch(/orders\.status=not\.in\.\((?=.*cancelado)(?=.*devuelto)(?=.*reclamacion)[a-z_,]+\)/);
  });
});
