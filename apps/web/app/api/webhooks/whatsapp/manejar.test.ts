import { describe, expect, it } from 'vitest';
import { firmaMeta, type EventoWhatsApp } from '@izao/whatsapp';
import { manejarDesafioWhatsApp, manejarWebhookWhatsApp, type DepsWebhookWhatsApp } from './manejar';

const SECRETO = 'app_secret_ficticio';
const CUERPO = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA1',
      changes: [
        {
          field: 'messages',
          value: { statuses: [{ id: 'wamid.A', status: 'delivered', timestamp: '1760000000', recipient_id: '573001234567' }] },
        },
      ],
    },
  ],
});

function deps(o: { sinCreds?: boolean; procesado?: boolean; falla?: boolean } = {}) {
  const registrados: EventoWhatsApp[] = [];
  const encolados: string[] = [];
  const d: DepsWebhookWhatsApp = {
    credenciales: async () => (o.sinCreds ? null : { appSecrets: ['otro', SECRETO], tokensVerificacion: ['tok_verif'] }),
    registrar: async (e) => {
      if (o.falla) throw new Error('db');
      registrados.push(e);
      return { procesado: !!o.procesado };
    },
    encolar: async (id) => {
      encolados.push(id);
    },
  };
  return { d, registrados, encolados };
}

const post = (cuerpo: string, firma: string | null) =>
  new Request('https://izaoperfumeria.com/api/webhooks/whatsapp', {
    method: 'POST',
    body: cuerpo,
    headers: firma ? { 'x-hub-signature-256': firma } : {},
  });

describe('webhook de WhatsApp: POST con firma, idempotencia y cola', () => {
  it('firma válida: registra cada evento y encola por event_id; responde 200', async () => {
    const s = deps();
    const res = await manejarWebhookWhatsApp(post(CUERPO, firmaMeta(new TextEncoder().encode(CUERPO), SECRETO)), s.d);
    expect(res.status).toBe(200);
    expect(s.registrados.map((e) => e.event_id)).toEqual(['wamid.A.delivered']);
    expect(s.encolados).toEqual(['wamid.A.delivered']);
  });

  it('evento ya procesado: 200 sin encolar de nuevo', async () => {
    const s = deps({ procesado: true });
    const res = await manejarWebhookWhatsApp(post(CUERPO, firmaMeta(new TextEncoder().encode(CUERPO), SECRETO)), s.d);
    expect(res.status).toBe(200);
    expect(s.encolados).toEqual([]);
  });

  it('firma ausente o inválida: 401 y no registra nada', async () => {
    for (const f of [null, firmaMeta(new TextEncoder().encode(CUERPO), 'malo'), firmaMeta(new TextEncoder().encode(`${CUERPO} `), SECRETO)]) {
      const s = deps();
      const res = await manejarWebhookWhatsApp(post(CUERPO, f), s.d);
      expect(res.status).toBe(401);
      expect(s.registrados).toEqual([]);
    }
  });

  it('sin credenciales o con la base caída: 503 para que Meta reintente', async () => {
    const firma = firmaMeta(new TextEncoder().encode(CUERPO), SECRETO);
    expect((await manejarWebhookWhatsApp(post(CUERPO, firma), deps({ sinCreds: true }).d)).status).toBe(503);
    expect((await manejarWebhookWhatsApp(post(CUERPO, firma), deps({ falla: true }).d)).status).toBe(503);
  });

  it('cuerpo demasiado grande: 413; JSON inválido con firma válida: 400', async () => {
    const grande = 'x'.repeat(1024 * 1024 + 1);
    expect((await manejarWebhookWhatsApp(post(grande, firmaMeta(new TextEncoder().encode(grande), SECRETO)), deps().d)).status).toBe(413);
    expect((await manejarWebhookWhatsApp(post('{no', firmaMeta(new TextEncoder().encode('{no'), SECRETO)), deps().d)).status).toBe(400);
  });
});

describe('webhook de WhatsApp: GET de verificación', () => {
  const get = (q: string) => new Request(`https://izaoperfumeria.com/api/webhooks/whatsapp?${q}`);
  it('token correcto: 200 con el challenge en texto plano', async () => {
    const res = await manejarDesafioWhatsApp(get('hub.mode=subscribe&hub.verify_token=tok_verif&hub.challenge=1158201444'), deps().d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
  it('token incorrecto o sin credenciales: 403', async () => {
    expect((await manejarDesafioWhatsApp(get('hub.mode=subscribe&hub.verify_token=x&hub.challenge=1'), deps().d)).status).toBe(403);
    expect((await manejarDesafioWhatsApp(get('hub.mode=subscribe&hub.verify_token=tok_verif&hub.challenge=1'), deps({ sinCreds: true }).d)).status).toBe(403);
  });
});
