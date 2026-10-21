import { describe, expect, it } from 'vitest';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopMock } from './mock';
import {
  costosPedido,
  esGastoSinPedido,
  evaluarSaldo,
  montoBilletera,
  saldoMasReciente,
  type MovimientoBilletera,
} from './wallet';

const DIA = 86_400_000;
const LLAVE = 'llave-billetera-prueba';

function mov(p: Partial<MovimientoBilletera> & { id: number; concepto: string; valor: bigint }): MovimientoBilletera {
  return { idOrder: null, estado: 'SUCCESS', moneda: 'COP', saldoNuevo: null, fecha: '2026-10-19T10:00:00.000Z', guia: null, ...p };
}

describe('montoBilletera: decimales sin float', () => {
  it('COP: redondea a peso con medio hacia arriba (alejándose de cero)', () => {
    expect(montoBilletera(85000.5, 'COP')).toBe(85001n);
    expect(montoBilletera('85000.49', 'COP')).toBe(85000n);
    expect(montoBilletera(-12000.5, 'COP')).toBe(-12001n);
    expect(montoBilletera(12000, 'COP')).toBe(12000n);
  });
  it('USD: a centavos', () => {
    expect(montoBilletera('10.005', 'USD')).toBe(1001n);
    expect(montoBilletera(3, 'USD')).toBe(300n);
  });
  it('rechaza notación científica y no números', () => {
    expect(montoBilletera(1e21, 'COP')).toBeNull();
    expect(montoBilletera('abc', 'COP')).toBeNull();
    expect(montoBilletera(null, 'COP')).toBeNull();
  });
});

describe('costosPedido', () => {
  it('suma por concepto, shipping_cost_real = envío + devolución, magnitud de cada cobro', () => {
    const c = costosPedido({}, [
      mov({ id: 1, concepto: 'Cobro por Envío', valor: -12000n }),
      mov({ id: 2, concepto: 'Comisión de plataforma', valor: -1500n }),
      mov({ id: 3, concepto: 'Cobro por Devolución', valor: -9000n }),
      mov({ id: 4, concepto: 'Ingreso por venta como Dropshipper', valor: 80000n }),
    ]);
    expect(c.shipping_cost_real).toBe(21000n);
    expect(c.carrier_fees).toMatchObject({ envio: 12000, devolucion: 9000, plataforma: 1500, whatsapp: 0 });
    expect(Object.keys(c.carrier_fees.movimientos)).toEqual(['1', '2', '3']);
  });

  it('idempotente: volver a aplicar los mismos movimientos no duplica; los anteriores se conservan', () => {
    const primero = costosPedido({}, [mov({ id: 1, concepto: 'Cobro por Envío', valor: -12000n })]);
    const segundo = costosPedido(primero.carrier_fees, [
      mov({ id: 1, concepto: 'Cobro por Envío', valor: -12000n }),
      mov({ id: 7, concepto: 'Cobro por envío mensaje de WhatsApp', valor: -300n }),
    ]);
    expect(segundo.shipping_cost_real).toBe(12000n);
    expect(segundo.carrier_fees.whatsapp).toBe(300);
    expect(costosPedido(segundo.carrier_fees, [])).toEqual(segundo);
  });

  it('un movimiento que pasa a ERROR deja de contar', () => {
    const a = costosPedido({}, [mov({ id: 1, concepto: 'Cobro por Envío', valor: -12000n })]);
    const b = costosPedido(a.carrier_fees, [mov({ id: 1, concepto: 'Cobro por Envío', valor: -12000n, estado: 'ERROR' })]);
    expect(b.shipping_cost_real).toBe(0n);
  });

  it('tolera carrier_fees con forma vieja', () => {
    expect(costosPedido({ recaudo: 1 }, []).shipping_cost_real).toBe(0n);
    expect(costosPedido(null, []).carrier_fees.movimientos).toEqual({});
  });
});

describe('gastos, saldo y alerta', () => {
  it('solo los cobros (no recargas, ingresos ni retiros) son gasto sin pedido', () => {
    expect(esGastoSinPedido(mov({ id: 1, concepto: 'Cobro por envío mensaje de WhatsApp', valor: -300n }))).toBe(true);
    expect(esGastoSinPedido(mov({ id: 2, concepto: 'Cuota de Manejo Shopcard', valor: -5000n }))).toBe(true);
    expect(esGastoSinPedido(mov({ id: 3, concepto: 'Recarga de billetera', valor: 100000n }))).toBe(false);
    expect(esGastoSinPedido(mov({ id: 4, concepto: 'Retiro de billetera', valor: -100000n }))).toBe(false);
    expect(esGastoSinPedido(mov({ id: 5, concepto: 'Cobro por Envío', valor: -1n, estado: 'ERROR' }))).toBe(false);
  });

  it('saldo = newBalance del movimiento más reciente', () => {
    expect(
      saldoMasReciente([
        mov({ id: 1, concepto: 'x', valor: 0n, saldoNuevo: 10n, fecha: '2026-10-18T00:00:00Z' }),
        mov({ id: 2, concepto: 'x', valor: 0n, saldoNuevo: 20n, fecha: '2026-10-19T00:00:00Z' }),
      ]),
    ).toEqual({ saldo: 20n, fecha: '2026-10-19T00:00:00Z' });
    expect(saldoMasReciente([])).toBeNull();
  });

  it('alerta de saldo bajo: una vez al cruzar, se rearma al recuperarse', () => {
    expect(evaluarSaldo(40_000n, 50_000n, false)).toBe('nueva');
    expect(evaluarSaldo(40_000n, 50_000n, true)).toBe('activa');
    expect(evaluarSaldo(60_000n, 50_000n, true)).toBe('resuelta');
    expect(evaluarSaldo(60_000n, 50_000n, false)).toBe('ok');
    expect(evaluarSaldo(1n, null, false)).toBe('sin_umbral');
    expect(evaluarSaldo(null, 50_000n, false)).toBe('sin_saldo');
  });
});

describe('cliente: movimientos de billetera contra el mock', () => {
  function setup() {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: LLAVE, clock });
    const client = new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock });
    return { clock, mock, client };
  }

  it('mock: sin filtros solo 7 días; limit > 50 recortado; filtro desconocido → 400', async () => {
    const { mock, clock } = setup();
    mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -1, balanceMovementDate: new Date(clock.now() - 2 * DIA) });
    mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -1, balanceMovementDate: new Date(clock.now() - 10 * DIA) });
    for (let i = 0; i < 60; i++) mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -1, balanceMovementDate: new Date(clock.now() - i * 1000) });
    const pedir = (q: string, b: unknown) =>
      mock.fetch(`https://prod.api.mastershop.com/api/wallets/movements/list?${q}`, { method: 'POST', headers: { 'ms-api-key': LLAVE }, body: JSON.stringify(b) });
    expect(((await (await pedir('page=2&limit=100', {})).json()) as unknown[]).length).toBe(11);
    expect(((await (await pedir('page=2&limit=50', { startDate: new Date(clock.now() - 45 * DIA).toISOString() })).json()) as unknown[]).length).toBe(12);
    expect((await pedir('page=1', { estado: 'x' })).status).toBe(400);
  });

  it('sin startDate no llama (la API devolvería solo 7 días)', async () => {
    const { client, mock } = setup();
    await expect(client.listWalletMovements({ startDate: new Date(Number.NaN), page: 1 })).rejects.toThrow(/startDate/);
    expect(mock.requests).toHaveLength(0);
  });

  it('pagina hasta una página vacía con limit 50, envía startDate y lee decimales', async () => {
    const { client, mock, clock } = setup();
    for (let i = 0; i < 120; i++) {
      mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -12000.5, idOrder: 1001 + i, balanceMovementDate: new Date(clock.now() - i * 60_000), newBalance: 500000 - i });
    }
    const viejo = mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -1, balanceMovementDate: new Date(clock.now() - 10 * DIA) });
    const r = await client.listAllWalletMovements({ startDate: new Date(clock.now() - 3 * DIA) });
    expect(r.movimientos).toHaveLength(120);
    expect(r.movimientos.some((m) => m.id === viejo.idBalanceMovement)).toBe(false);
    expect(r.movimientos[0]).toMatchObject({ valor: -12001n, saldoNuevo: 500000n, idOrder: 1001 });
    const pedidas = mock.requests.filter((q) => q.path === '/api/wallets/movements/list');
    expect(pedidas.map((q) => q.query.page)).toEqual(['1', '2', '3', '4']);
    expect(pedidas.every((q) => q.query.limit === '50')).toBe(true);
    expect(JSON.parse(pedidas[0]!.body!)).toEqual({ startDate: new Date(clock.now() - 3 * DIA).toISOString() });
  });

  it('una fila con moneda distinta se omite con aviso, sin tumbar la página', async () => {
    const { client, mock, clock } = setup();
    mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -5, currency: 'USD', balanceMovementDate: clock.date() });
    mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -7000, balanceMovementDate: clock.date() });
    const r = await client.listAllWalletMovements({ startDate: new Date(clock.now() - DIA) });
    expect(r.movimientos).toHaveLength(1);
    expect(r.avisos).toEqual([expect.objectContaining({ motivo: 'moneda_no_soportada' })]);
  });
});
