import { describe, expect, it } from 'vitest';
import { MasterShopClient } from '@izao/mastershop';
import { FakeClock, MasterShopMock } from '@izao/mastershop/mock';
import { almacenWebhooksSupabase, registrarWebhooksMasterShop, type DbWebhooks } from './registro';

const LLAVE = 'ms-llave-registro-web-0001';
const ENV = { SITE_URL: 'https://izaoperfumeria.com', MASTERSHOP_WEBHOOK_PATH_SECRET: 'x'.repeat(40) };

function dbFalsa() {
  const filas: Record<string, unknown>[] = [];
  const filtros: string[] = [];
  const db: DbWebhooks = {
    from: () => ({
      select: () => ({
        eq: (_c1, v1) => ({
          eq: (_c2, v2) => ({
            eq: (_c3, v3) => {
              filtros.push(`${v1}/${v2}/${v3}`);
              const data = filas.filter((f) => f.provider === v1 && f.country_code === v2 && f.environment === v3).map((f) => ({ event_id: f.event_id as number }));
              return Promise.resolve({ data, error: null });
            },
          }),
        }),
      }),
      upsert: (fila, opciones) => {
        expect(opciones.onConflict).toBe('provider,country_code,environment,event_id');
        filas.push(fila);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { db, filas, filtros };
}

describe('registro de webhooks desde la web', () => {
  it('guarda event_id/external_id en integration_webhooks y no repite los ya guardados', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: LLAVE, clock });
    const client = new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock });
    const { db, filas, filtros } = dbFalsa();
    const almacen = almacenWebhooksSupabase('production', db);
    const r = await registrarWebhooksMasterShop(LLAVE, 'production', { almacen, client, env: ENV });
    expect(r.registrados.map((w) => w.idWebhook)).toEqual([16, 17]);
    expect(filas).toEqual([
      { provider: 'mastershop', country_code: 'CO', environment: 'production', event_id: 16, event_name: 'Cambio de estado del pedido', external_id: 6001, is_enabled: true },
      { provider: 'mastershop', country_code: 'CO', environment: 'production', event_id: 17, event_name: 'Cambio de estado de la transportadora', external_id: 6002, is_enabled: true },
    ]);
    expect(JSON.stringify(filas)).not.toContain(ENV.MASTERSHOP_WEBHOOK_PATH_SECRET);
    expect(JSON.stringify(r)).not.toContain(ENV.MASTERSHOP_WEBHOOK_PATH_SECRET);
    expect(filtros[0]).toBe('mastershop/CO/production');
    expect((await registrarWebhooksMasterShop(LLAVE, 'production', { almacen, client, env: ENV })).registrados).toEqual([]);
    expect(mock.countRequests('POST', '/api/webhooks')).toBe(2);
  });

  it('sin SITE_URL o secreto no llama a MasterShop', async () => {
    const { db } = dbFalsa();
    await expect(registrarWebhooksMasterShop(LLAVE, 'sandbox', { almacen: almacenWebhooksSupabase('sandbox', db), env: {} })).rejects.toThrow(/SITE_URL/);
  });
});
