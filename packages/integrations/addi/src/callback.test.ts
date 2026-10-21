import { describe, expect, it } from 'vitest';
import { estadoCallbackAddi, verificarCallbackAddi } from './callback';
import { jobIdAddi } from './cola';
import { CREDENCIALES_ADDI_PRUEBA, callbackAddi } from './mock';

const CLAVES = { usuario: CREDENCIALES_ADDI_PRUEBA.usuarioCallback, clave: CREDENCIALES_ADDI_PRUEBA.claveCallback };
const bytes = (s: string) => new TextEncoder().encode(s);

describe('callback de Addi: autenticación Basic y forma del cuerpo', () => {
  it('acepta un APPROVED autenticado y arma el evento con id por aplicación, estado e instante', () => {
    const c = callbackAddi({ orderId: 'IZ-CO-000123-A1', status: 'APPROVED' });
    const r = verificarCallbackAddi(bytes(c.cuerpo), c.headers, CLAVES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento).toMatchObject({
      provider: 'addi',
      event_id: 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80.APPROVED.1760972400',
      event_type: 'online_application.APPROVED',
      occurred_at: '2025-10-20T15:00:00.000Z',
      refs: { provider_transaction_id: 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80', provider_reference: 'IZ-CO-000123-A1', payment_link_id: null },
    });
    expect(r.callback.status).toBe('APPROVED');
    expect(r.callback.approvedAmount).toBe('99000.0');
  });

  it('el mismo callback reenviado da el mismo id (idempotencia); otro estado, otro id', () => {
    const a = callbackAddi({ orderId: 'IZ-CO-000123-A1', status: 'PENDING', statusTimestamp: '1' });
    const b = callbackAddi({ orderId: 'IZ-CO-000123-A1', status: 'APPROVED', statusTimestamp: '2' });
    const ra = verificarCallbackAddi(bytes(a.cuerpo), a.headers, CLAVES);
    const ra2 = verificarCallbackAddi(bytes(a.cuerpo), a.headers, CLAVES);
    const rb = verificarCallbackAddi(bytes(b.cuerpo), b.headers, CLAVES);
    expect(ra.ok && ra2.ok && ra.evento.event_id === ra2.evento.event_id).toBe(true);
    expect(ra.ok && rb.ok && ra.evento.event_id !== rb.evento.event_id).toBe(true);
  });

  it('rechaza sin cabecera, con otro esquema, usuario o clave distintos', () => {
    const c = callbackAddi({ orderId: 'IZ-CO-000123-A1', status: 'APPROVED' });
    const casos: Record<string, string>[] = [
      {},
      { authorization: 'Bearer abc' },
      { authorization: 'Basic' },
      { authorization: 'Basic %%%' },
      callbackAddi({ orderId: 'x', status: 'APPROVED' }, { usuario: 'otro' }).headers,
      callbackAddi({ orderId: 'x', status: 'APPROVED' }, { clave: 'clave-ficticia-de-callback-0002' }).headers,
      { authorization: `Basic ${Buffer.from(CLAVES.usuario + CLAVES.clave).toString('base64')}` },
    ];
    for (const h of casos) {
      expect(verificarCallbackAddi(bytes(c.cuerpo), h, CLAVES)).toEqual({ ok: false, motivo: 'autenticacion' });
    }
  });

  it('autenticado pero con cuerpo inválido: estado desconocido, JSON roto, orderId raro', () => {
    const { headers } = callbackAddi({ orderId: 'x', status: 'APPROVED' });
    const malos = [
      '{',
      JSON.stringify({ orderId: 'IZ-1', applicationId: 'a', approvedAmount: '0', currency: 'COP', status: 'OTRO', statusTimestamp: '1' }),
      JSON.stringify({ orderId: 'IZ 1;', applicationId: 'a', approvedAmount: '0', currency: 'COP', status: 'REJECTED', statusTimestamp: '1' }),
      JSON.stringify({ orderId: 'IZ-1', approvedAmount: '0', currency: 'COP', status: 'REJECTED', statusTimestamp: '1' }),
    ];
    for (const m of malos) expect(verificarCallbackAddi(bytes(m), headers, CLAVES)).toEqual({ ok: false, motivo: 'cuerpo' });
  });

  it('acepta statusTimestamp numérico y approvedAmount numérico', () => {
    const { headers } = callbackAddi({ orderId: 'x', status: 'APPROVED' });
    const cuerpo = JSON.stringify({ orderId: 'IZ-1-A1', applicationId: 'app-1', approvedAmount: 99000, currency: 'COP', status: 'APPROVED', statusTimestamp: 1760972400 });
    const r = verificarCallbackAddi(bytes(cuerpo), headers, CLAVES);
    expect(r.ok && r.evento.event_id).toBe('app-1.APPROVED.1760972400');
  });

  it('estadoCallbackAddi: monto en pesos solo si es COP entero; estado mapeado', () => {
    const base = { orderId: 'IZ-1-A1', applicationId: 'app-1', currency: 'COP', statusTimestamp: '1' };
    expect(estadoCallbackAddi({ ...base, approvedAmount: '99000.0', status: 'APPROVED' })).toMatchObject({
      status: 'approved',
      amount: 99_000n,
      currency_code: 'COP',
      provider_transaction_id: 'app-1',
    });
    expect(estadoCallbackAddi({ ...base, approvedAmount: '99000.5', status: 'APPROVED' }).amount).toBeNull();
    expect(estadoCallbackAddi({ ...base, currency: 'USD', approvedAmount: '1', status: 'APPROVED' }).currency_code).toBeNull();
    expect(estadoCallbackAddi({ ...base, approvedAmount: '0', status: 'ABANDONED' }).status).toBe('expired');
    expect(estadoCallbackAddi({ ...base, approvedAmount: '0', status: 'INTERNAL_ERROR' }).status).toBe('error');
  });

  it('jobId sin ":" (BullMQ) y estable por evento', () => {
    expect(jobIdAddi('app-1.APPROVED.1')).toBe('addi.app-1.APPROVED.1');
    expect(jobIdAddi('a:b c')).toBe('addi.a_b_c');
  });
});
