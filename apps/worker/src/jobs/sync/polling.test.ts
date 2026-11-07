import { describe, expect, it } from 'vitest';
import { MasterShopClient, type DatosJobSync } from '@izao/mastershop';
import { FakeClock, MasterShopMock } from '@izao/mastershop/mock';
import { jobIdPolling, pollingMasterShop, type DepsPolling, type EnvioAbierto } from './polling.js';

const DIA = 86_400_000;
const LLAVE = 'llave-prueba-polling';

function escenario(opciones: { pedidos: number; abiertos?: (i: number) => boolean }) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: LLAVE, clock });
  const locales: EnvioAbierto[] = [];
  // 120 pedidos repartidos en 40 días: la mayoría fuera de la ventana de 7 días por defecto.
  for (let i = 0; i < opciones.pedidos; i++) {
    const o = mock.seed({ externalOrderId: `IZ-CO-${String(i).padStart(6, '0')}`, createdAt: new Date(clock.now() - (i * 40 * DIA) / opciones.pedidos - 1000) });
    if (opciones.abiertos?.(i) ?? true) {
      locales.push({
        order_id: `ord-${i}`,
        external_order_id: o.externalOrderId,
        provider_order_id: o.idOrder,
        provider_status_id: 1,
        has_novelty: false,
        tracking_code: null,
        last_synced_at: new Date(clock.now() - 60_000),
      });
    }
  }
  const encolados = new Map<string, DatosJobSync>();
  const client = new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock });
  const deps: DepsPolling = {
    fuente: { credenciales: async () => ({ apiKey: LLAVE }), enviosAbiertos: async () => locales },
    listar: (c, desde) => new MasterShopClient({ apiKey: c.apiKey, fetch: mock.fetch, clock }).listAllOrders({ startDate: desde }),
    async encolarSync(datos, id) {
      if (encolados.has(id)) return 'ya_pendiente';
      encolados.set(id, datos);
      return 'encolado';
    },
    ahora: () => clock.date(),
  };
  return { clock, mock, locales, encolados, deps, client };
}

describe('polling de respaldo de MasterShop (jobs/sync)', () => {
  it('envía startDate de hace 45 días y pagina con limit 50 hasta una página vacía', async () => {
    const { mock, deps, clock } = escenario({ pedidos: 120 });
    const r = await pollingMasterShop(deps);
    expect(r.listados).toBe(120);
    const listas = mock.requests.filter((q) => q.path === '/api/orders/list');
    // 50 + 50 + 20 + página vacía: no se detiene en la página "corta".
    expect(listas.map((q) => q.query.page)).toEqual(['1', '2', '3', '4']);
    expect(listas.every((q) => q.query.limit === '50')).toBe(true);
    const cuerpo = JSON.parse(listas[0]!.body!) as { startDate: string };
    expect(Date.parse(cuerpo.startDate)).toBe(clock.now() - 45 * DIA);
  });

  it('sin cambios no encola nada; un cambio de estado fuera de los 7 días sí', async () => {
    const { mock, deps, encolados, locales } = escenario({ pedidos: 120 });
    expect((await pollingMasterShop(deps)).encolados).toBe(0);
    const viejo = locales[100]!; // ~33 días: fuera de la ventana por defecto de 7 días
    mock.setStatus(viejo.provider_order_id, 6);
    const r = await pollingMasterShop(deps);
    expect(r.encolados).toBe(1);
    expect(encolados.get(jobIdPolling(viejo.provider_order_id))).toEqual({
      event_id: null,
      provider_order_id: viejo.provider_order_id,
      external_order_id: viejo.external_order_id,
      origen: 'polling',
    });
  });

  it('D-051: una etiqueta sin copia local se sincroniza aunque el estado no cambie', async () => {
    const { deps, encolados, locales } = escenario({ pedidos: 10 });
    locales[2]!.etiqueta_pendiente = true;
    expect((await pollingMasterShop(deps)).encolados).toBe(1);
    expect([...encolados.keys()]).toEqual([jobIdPolling(locales[2]!.provider_order_id)]);
  });

  it('idempotente: dos corridas con el mismo cambio dejan un solo job pendiente', async () => {
    const { mock, deps, encolados, locales } = escenario({ pedidos: 10 });
    mock.setStatus(locales[3]!.provider_order_id, 2);
    await pollingMasterShop(deps);
    const r2 = await pollingMasterShop(deps);
    expect(r2).toMatchObject({ encolados: 0, ya_pendientes: 1 });
    expect(encolados.size).toBe(1);
  });

  it('novedad o guía nueva también disparan la sincronización', async () => {
    const { mock, deps, encolados, locales } = escenario({ pedidos: 5 });
    mock.orders.get(locales[0]!.provider_order_id)!.hasNovelty = true;
    mock.attachLabel(locales[1]!.provider_order_id, '700100');
    await pollingMasterShop(deps);
    expect([...encolados.keys()].sort()).toEqual(
      [jobIdPolling(locales[0]!.provider_order_id), jobIdPolling(locales[1]!.provider_order_id)].sort(),
    );
  });

  it('envío abierto más viejo que 45 días: se reconsulta por id, como mucho cada hora', async () => {
    const { mock, deps, encolados, locales, clock } = escenario({ pedidos: 3 });
    const o = mock.seed({ externalOrderId: 'IZ-CO-VIEJO', createdAt: new Date(clock.now() - 50 * DIA) });
    locales.push({ order_id: 'ord-v', external_order_id: o.externalOrderId, provider_order_id: o.idOrder, provider_status_id: 6, has_novelty: false, tracking_code: null, last_synced_at: new Date(clock.now() - 2 * 3_600_000) });
    expect((await pollingMasterShop(deps)).ausentes).toBe(1);
    expect(encolados.has(jobIdPolling(o.idOrder))).toBe(true);
    locales.at(-1)!.last_synced_at = clock.date();
    encolados.clear();
    expect((await pollingMasterShop(deps)).ausentes).toBe(0);
  });

  it('ignora pedidos de MasterShop sin envío local (creados fuera de la tienda)', async () => {
    const { mock, deps, encolados } = escenario({ pedidos: 6, abiertos: (i) => i < 2 });
    for (const o of mock.orders.values()) o.statusId = 3;
    const r = await pollingMasterShop(deps);
    expect(r).toMatchObject({ listados: 6, abiertos: 2, encolados: 2 });
    expect(encolados.size).toBe(2);
  });

  it('sin credenciales o sin envíos abiertos no llama a la API', async () => {
    const { mock, deps } = escenario({ pedidos: 3 });
    expect((await pollingMasterShop({ ...deps, fuente: { ...deps.fuente, credenciales: async () => null } })).accion).toBe('sin_credenciales');
    expect((await pollingMasterShop({ ...deps, fuente: { ...deps.fuente, enviosAbiertos: async () => [] } })).accion).toBe('sin_envios_abiertos');
    expect(mock.requests).toHaveLength(0);
  });

  it('un error de MasterShop se propaga para que BullMQ reintente', async () => {
    const { mock, deps } = escenario({ pedidos: 3 });
    mock.inject('list', { status: 500, body: { error: 'Error interno', success: false, data: null } });
    await expect(pollingMasterShop(deps)).rejects.toThrow();
  });
});
