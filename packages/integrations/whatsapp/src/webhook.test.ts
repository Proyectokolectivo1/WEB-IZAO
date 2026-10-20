import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmaMeta, interpretarWebhook, verificarDesafio, verificarFirmaMeta } from './webhook';

const SECRETO = 'app_secret_ficticio_para_pruebas';
const crudo = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

const ESTADOS = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PN1' },
            statuses: [
              { id: 'wamid.A', status: 'delivered', timestamp: '1760000000', recipient_id: '573001234567' },
              {
                id: 'wamid.B',
                status: 'failed',
                timestamp: '1760000001',
                recipient_id: '573001234568',
                errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable', error_data: { details: 'x' } }],
              },
              { id: 'wamid.C', status: 'played', timestamp: '1760000002', recipient_id: '573001234569' },
            ],
          },
        },
      ],
    },
  ],
};

const PLANTILLA = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA1',
      time: 1760000100,
      changes: [
        {
          field: 'message_template_status_update',
          value: {
            event: 'REJECTED',
            message_template_id: 123456789,
            message_template_name: 'cobro_abono_v2',
            message_template_language: 'es',
            reason: 'INVALID_FORMAT',
            rejection_info: { reason: 'Variable al final', recommendation: 'Agrega texto' },
          },
        },
      ],
    },
  ],
};

describe('firma X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con app_secret)', () => {
  it('acepta la firma correcta, en mayúsculas o minúsculas', () => {
    const b = crudo(ESTADOS);
    const hex = createHmac('sha256', SECRETO).update(b).digest('hex');
    expect(firmaMeta(b, SECRETO)).toBe(`sha256=${hex}`);
    expect(verificarFirmaMeta(b, `sha256=${hex}`, SECRETO)).toBe(true);
    expect(verificarFirmaMeta(b, `sha256=${hex.toUpperCase()}`, SECRETO)).toBe(true);
  });

  it('rechaza firma ausente, mal formada, de otro secreto o de otro cuerpo', () => {
    const b = crudo(ESTADOS);
    expect(verificarFirmaMeta(b, null, SECRETO)).toBe(false);
    expect(verificarFirmaMeta(b, 'sha1=abc', SECRETO)).toBe(false);
    expect(verificarFirmaMeta(b, firmaMeta(b, 'otro'), SECRETO)).toBe(false);
    expect(verificarFirmaMeta(crudo({ ...ESTADOS, x: 1 }), firmaMeta(b, SECRETO), SECRETO)).toBe(false);
    expect(verificarFirmaMeta(b, firmaMeta(b, SECRETO), '')).toBe(false);
  });
});

describe('desafío GET de verificación', () => {
  it('devuelve el challenge solo con modo subscribe y el token correcto', () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    expect(verificarDesafio(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1158201444' }), 'tok')).toBe('1158201444');
    expect(verificarDesafio(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'malo', 'hub.challenge': '1' }), 'tok')).toBeNull();
    expect(verificarDesafio(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }), 'tok')).toBeNull();
    expect(verificarDesafio(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '<script>' }), 'tok')).toBeNull();
    expect(verificarDesafio(q({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '')).toBeNull();
  });
});

describe('interpretación del webhook', () => {
  it('estados de mensaje con id de evento {wamid}.{status}; ignora played', () => {
    const r = interpretarWebhook(ESTADOS);
    expect(r).toEqual([
      { tipo: 'estado_mensaje', event_id: 'wamid.A.delivered', wa_message_id: 'wamid.A', status: 'delivered', timestamp: 1760000000, error: null },
      {
        tipo: 'estado_mensaje',
        event_id: 'wamid.B.failed',
        wa_message_id: 'wamid.B',
        status: 'failed',
        timestamp: 1760000001,
        error: { code: '131026', text: 'Message undeliverable' },
      },
    ]);
  });

  it('estado de plantilla con motivo de rechazo', () => {
    expect(interpretarWebhook(PLANTILLA)).toEqual([
      {
        tipo: 'estado_plantilla',
        event_id: 'tpl.123456789.REJECTED.1760000100',
        meta_template_id: '123456789',
        meta_template_name: 'cobro_abono_v2',
        language: 'es',
        event: 'REJECTED',
        reason: 'INVALID_FORMAT: Variable al final',
      },
    ]);
  });

  it('cuerpo ajeno o mal formado no lanza y no produce eventos', () => {
    expect(interpretarWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(interpretarWebhook(null)).toEqual([]);
    expect(interpretarWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 5 }] } }] }] })).toEqual([]);
  });
});
