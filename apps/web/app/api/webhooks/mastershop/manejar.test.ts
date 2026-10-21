import { describe, expect, it } from 'vitest';
import type { DatosJobSync } from '@izao/mastershop';
import { manejarWebhookMasterShop, type DepsWebhookMasterShop } from './manejar';

const SECRETO = 's'.repeat(48);

const CUERPO = {
  eventName: 'Cambio de Estado del Pedido',
  body: {
    id_order: 1001,
    external_order_id: 'IZ-CO-000123',
    id_status: 3,
    customer: { full_name: 'Laura Gomez', phone: '3001234567' },
    date_update_order: '2026-10-02T14:32:10.000Z',
  },
};

function deps(opts: { procesado?: boolean; fallaRegistro?: boolean } = {}) {
  const registrados = new Map<string, Record<string, unknown>>();
  const encolados: DatosJobSync[] = [];
  const d: DepsWebhookMasterShop = {
    secreto: SECRETO,
    async registrar(id, payload) {
      if (opts.fallaRegistro) throw new Error('db caída');
      const ya = registrados.has(id);
      registrados.set(id, payload);
      return { procesado: ya && opts.procesado === true };
    },
    async encolar(datos) {
      encolados.push(datos);
    },
  };
  return { d, registrados, encolados };
}

const req = (cuerpo: unknown) =>
  new Request('https://izaoperfumeria.com/api/webhooks/mastershop/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });

describe('POST /api/webhooks/mastershop/{secreto}', () => {
  it('secreto inválido o sin configurar: 401 sin registrar ni encolar', async () => {
    const { d, registrados, encolados } = deps();
    expect((await manejarWebhookMasterShop(req(CUERPO), 'otro', d)).status).toBe(401);
    expect((await manejarWebhookMasterShop(req(CUERPO), SECRETO, { ...d, secreto: undefined })).status).toBe(401);
    expect(registrados.size).toBe(0);
    expect(encolados).toEqual([]);
  });

  it('registra sin datos del cliente y encola carrier.sync con la referencia', async () => {
    const { d, registrados, encolados } = deps();
    const res = await manejarWebhookMasterShop(req(CUERPO), SECRETO, d);
    expect(res.status).toBe(200);
    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatchObject({ provider_order_id: 1001, external_order_id: 'IZ-CO-000123', origen: 'webhook' });
    expect(encolados[0]!.event_id).toMatch(/^1001\.3\./);
    const payload = JSON.stringify([...registrados.values()]);
    expect(payload).not.toContain('Laura');
    expect(payload).not.toContain('3001234567');
  });

  it('una reentrega ya procesada responde 200 sin encolar', async () => {
    const { d, encolados } = deps({ procesado: true });
    await manejarWebhookMasterShop(req(CUERPO), SECRETO, d);
    const res = await manejarWebhookMasterShop(req(CUERPO), SECRETO, d);
    expect(await res.json()).toEqual({ ok: true, repetido: true });
    expect(encolados).toHaveLength(1);
  });

  it('JSON inválido 400; sin referencia 200 ignorado; base caída 503', async () => {
    const { d } = deps();
    expect((await manejarWebhookMasterShop(req('{no'), SECRETO, d)).status).toBe(400);
    const ign = await manejarWebhookMasterShop(req({ eventName: 'x', body: {} }), SECRETO, d);
    expect(await ign.json()).toEqual({ ok: true, ignorado: true });
    expect((await manejarWebhookMasterShop(req(CUERPO), SECRETO, deps({ fallaRegistro: true }).d)).status).toBe(503);
  });

  it('cuerpo demasiado grande: 413', async () => {
    const { d } = deps();
    const grande = JSON.stringify({ ...CUERPO, relleno: 'x'.repeat(300 * 1024) });
    expect((await manejarWebhookMasterShop(req(grande), SECRETO, d)).status).toBe(413);
  });
});
