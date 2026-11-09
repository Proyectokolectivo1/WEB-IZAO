import { describe, expect, it } from 'vitest';
import { MasterShopClient, type CarrierFees } from '@izao/mastershop';
import { FakeClock, MasterShopMock } from '@izao/mastershop/mock';
import { billeteraMasterShop, fechaBogota, type DepsBilletera, type EstadoSaldo, type GastoBilletera } from './billetera.js';

const DIA = 86_400_000;
const LLAVE = 'llave-billetera-worker';

function escenario(estado: EstadoSaldo | null = { umbral: 100_000n, alertaActiva: false }) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: LLAVE, clock });
  const pedidos = new Map<number, { order_id: string; carrier_fees: unknown; shipping_cost_real: bigint | null }>([
    [1001, { order_id: 'ord-1', carrier_fees: {}, shipping_cost_real: null }],
    [1002, { order_id: 'ord-2', carrier_fees: {}, shipping_cost_real: null }],
  ]);
  const gastos = new Map<string, GastoBilletera>();
  const avisos: bigint[] = [];
  const saldos: { valor: bigint | null; activa: boolean }[] = [];
  let est = estado;
  const deps: DepsBilletera = {
    fuente: {
      credenciales: async () => ({ apiKey: LLAVE }),
      async pedidosPorIdProveedor(ids) {
        return ids.flatMap((id) => {
          const p = pedidos.get(id);
          return p ? [{ order_id: p.order_id, provider_order_id: id, carrier_fees: p.carrier_fees }] : [];
        });
      },
      async guardarCostos(orderId, real, fees: CarrierFees) {
        for (const p of pedidos.values()) if (p.order_id === orderId) Object.assign(p, { carrier_fees: fees, shipping_cost_real: real });
      },
      async registrarGasto(g) {
        if (gastos.has(g.external_ref)) return false;
        gastos.set(g.external_ref, g);
        return true;
      },
      estadoSaldo: async () => est,
      async guardarSaldo(s, activa) {
        saldos.push({ valor: s?.valor ?? null, activa });
        if (est) est = { ...est, alertaActiva: activa };
      },
    },
    listar: (c, desde) => new MasterShopClient({ apiKey: c.apiKey, fetch: mock.fetch, clock }).listAllWalletMovements({ startDate: desde }),
    avisarSaldoBajo: async (s) => {
      avisos.push(s);
    },
    ahora: () => clock.date(),
  };
  return { clock, mock, pedidos, gastos, avisos, saldos, deps };
}

describe('job de billetera de MasterShop', () => {
  it('asigna costos reales al pedido, registra gastos sin pedido y guarda el saldo', async () => {
    const { clock, mock, pedidos, gastos, deps, saldos } = escenario();
    const t = (h: number) => new Date(clock.now() - h * 3_600_000);
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: t(5), newBalance: 300000 });
    mock.seedMovement({ idOrder: 1001, movementType: 'Comisión de plataforma', movementValue: -1500.5, balanceMovementDate: t(4), newBalance: 298499.5 });
    mock.seedMovement({ idOrder: 1002, movementType: 'Cobro por Devolución', movementValue: -9000, balanceMovementDate: t(3), newBalance: 289499.5 });
    mock.seedMovement({ idOrder: 1002, movementType: 'Ingreso por venta como Dropshipper', movementValue: 80000, balanceMovementDate: t(2), newBalance: 369499.5 });
    const sinPedido = mock.seedMovement({ idOrder: null, movementType: 'Cobro por envío mensaje de WhatsApp', movementValue: -300, balanceMovementDate: t(1), newBalance: 369199.5 });
    mock.seedMovement({ idOrder: 7777, movementType: 'Cobro por Envío', movementValue: -11000, balanceMovementDate: t(0.5), newBalance: 358199.5 });
    mock.seedMovement({ idOrder: null, movementType: 'Recarga de billetera', movementValue: 50000, balanceMovementDate: t(0.2), newBalance: 408199.5 });

    const r = await billeteraMasterShop(deps);
    expect(r).toMatchObject({ movimientos: 7, pedidos_actualizados: 2, gastos_creados: 2, alerta_saldo: 'ok' });
    expect(pedidos.get(1001)).toMatchObject({ shipping_cost_real: 12000n, carrier_fees: { envio: 12000, plataforma: 1501 } });
    expect(pedidos.get(1002)).toMatchObject({ shipping_cost_real: 9000n, carrier_fees: { devolucion: 9000 } });
    // D-052: referencia con país; en CO se reconoce también la anterior sin prefijo.
    expect(gastos.get(`CO:${sinPedido.idBalanceMovement}`)).toMatchObject({
      amount: 300n,
      description: 'Cobro por envío mensaje de WhatsApp',
      refs_previas: [String(sinPedido.idBalanceMovement)],
    });
    expect([...gastos.values()].some((g) => g.description.includes('pedido MasterShop 7777'))).toBe(true);
    expect(saldos.at(-1)).toEqual({ valor: 408200n, activa: false });
  });

  it('idempotente: una segunda corrida no duplica gastos ni reescribe pedidos', async () => {
    const { clock, mock, deps, gastos } = escenario();
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: clock.date() });
    mock.seedMovement({ movementType: 'Cuota de Manejo Shopcard', movementValue: -5000, balanceMovementDate: clock.date() });
    await billeteraMasterShop(deps);
    const r2 = await billeteraMasterShop(deps);
    expect(r2).toMatchObject({ pedidos_actualizados: 0, gastos_creados: 0, gastos_existentes: 1 });
    expect(gastos.size).toBe(1);
  });

  it('pide solo los últimos 3 días: lo anterior ya quedó asignado y se conserva', async () => {
    const { clock, mock, deps, pedidos } = escenario();
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: clock.date() });
    await billeteraMasterShop(deps);
    clock.advance(10 * DIA);
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Devolución', movementValue: -9000, balanceMovementDate: clock.date() });
    await billeteraMasterShop(deps);
    expect(pedidos.get(1001)!.shipping_cost_real).toBe(21000n);
    const cuerpo = JSON.parse(mock.requests.at(-1)!.body!) as { startDate: string };
    expect(Date.parse(cuerpo.startDate)).toBe(clock.now() - 3 * DIA);
  });

  it('saldo bajo: avisa una vez, no repite, se rearma al recargar', async () => {
    const { clock, mock, deps, avisos } = escenario({ umbral: 100_000n, alertaActiva: false });
    mock.seedMovement({ movementType: 'Cobro por Envío', idOrder: 1001, movementValue: -12000, newBalance: 40000, balanceMovementDate: clock.date() });
    expect((await billeteraMasterShop(deps)).alerta_saldo).toBe('nueva');
    expect((await billeteraMasterShop(deps)).alerta_saldo).toBe('activa');
    expect(avisos).toEqual([40000n]);
    clock.advance(60_000);
    mock.seedMovement({ movementType: 'Recarga de billetera', movementValue: 200000, newBalance: 240000, balanceMovementDate: clock.date() });
    expect((await billeteraMasterShop(deps)).alerta_saldo).toBe('resuelta');
    expect((await billeteraMasterShop(deps)).alerta_saldo).toBe('ok');
  });

  it('sin columnas de saldo (pendiente de izao-db) los costos igual se asignan', async () => {
    const { clock, mock, deps, pedidos } = escenario(null);
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: clock.date() });
    expect((await billeteraMasterShop(deps)).alerta_saldo).toBe('no_configurado');
    expect(pedidos.get(1001)!.shipping_cost_real).toBe(12000n);
  });

  it('sin credenciales no llama a la API', async () => {
    const { mock, deps } = escenario();
    expect((await billeteraMasterShop({ ...deps, fuente: { ...deps.fuente, credenciales: async () => null } })).accion).toBe('sin_credenciales');
    expect(mock.requests).toHaveLength(0);
  });

  it('encola el recálculo de métricas solo de los pedidos cuyos costos cambiaron (§21.4)', async () => {
    const { clock, mock, deps } = escenario();
    const recalculados: string[] = [];
    const conMetricas: DepsBilletera = { ...deps, recalcularMetricas: async (id) => void recalculados.push(id) };
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: clock.date() });
    mock.seedMovement({ idOrder: 1002, movementType: 'Comisión de plataforma', movementValue: -800, balanceMovementDate: clock.date() });
    mock.seedMovement({ idOrder: null, movementType: 'Cobro por envío mensaje de WhatsApp', movementValue: -300, balanceMovementDate: clock.date() });
    await billeteraMasterShop(conMetricas);
    expect(recalculados.sort()).toEqual(['ord-1', 'ord-2']);
    await billeteraMasterShop(conMetricas);
    expect(recalculados).toHaveLength(2);
  });

  it('si el recálculo falla los costos quedan guardados y el job termina', async () => {
    const { clock, mock, deps, pedidos } = escenario();
    mock.seedMovement({ idOrder: 1001, movementType: 'Cobro por Envío', movementValue: -12000, balanceMovementDate: clock.date() });
    const r = await billeteraMasterShop({
      ...deps,
      recalcularMetricas: async () => {
        throw new Error('redis caído');
      },
    });
    expect(r).toMatchObject({ accion: 'procesado', pedidos_actualizados: 1 });
    expect(pedidos.get(1001)).toMatchObject({ shipping_cost_real: 12000n });
  });

  it('la fecha del gasto es la de Bogotá', () => {
    expect(fechaBogota('2026-10-20T03:00:00.000Z')).toBe('2026-10-19');
  });
});

describe('billetera por país (D-052)', () => {
  it('Ecuador: llave propia, montos en centavos USD y gasto con país EC', async () => {
    const clock = new FakeClock();
    const mockEC = new MasterShopMock({ apiKey: 'llave-ec', clock, currency: 'USD' });
    mockEC.seedMovement({ movementType: 'Cobro por envío mensaje de WhatsApp', movementValue: -0.35, balanceMovementDate: new Date(clock.now() - 60_000) });
    const gastos: { g: GastoBilletera; pais: string }[] = [];
    const paisesPedidos: string[] = [];
    const deps: DepsBilletera = {
      paises: ['CO', 'EC'],
      fuente: {
        credenciales: async (pais) => (pais === 'EC' ? { apiKey: 'llave-ec' } : null),
        pedidosPorIdProveedor: async (_ids, pais) => {
          paisesPedidos.push(pais);
          return [];
        },
        guardarCostos: async () => undefined,
        registrarGasto: async (g, pais) => {
          gastos.push({ g, pais });
          return true;
        },
        estadoSaldo: async () => null,
        guardarSaldo: async () => undefined,
      },
      listar: (c, desde, pais) =>
        new MasterShopClient({ apiKey: c.apiKey, fetch: mockEC.fetch, clock, currency: pais === 'EC' ? 'USD' : 'COP' }).listAllWalletMovements({ startDate: desde }),
      avisarSaldoBajo: async () => undefined,
      ahora: () => clock.date(),
    };
    const r = await billeteraMasterShop(deps);
    expect(r).toMatchObject({ accion: 'procesado', gastos_creados: 1, por_pais: { CO: { accion: 'sin_credenciales' }, EC: { accion: 'procesado' } } });
    expect(gastos).toEqual([{ g: expect.objectContaining({ amount: 35n }), pais: 'EC' }]);
    expect(gastos[0]!.g.external_ref).toMatch(/^EC:\d+$/);
    expect(gastos[0]!.g.refs_previas).toBeUndefined();
  });
});
