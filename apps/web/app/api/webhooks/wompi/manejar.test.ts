import { describe, expect, it } from 'vitest';
import type { VerifiedEvent } from '@izao/core/contracts';
import type { DatosJobWompi } from '@izao/wompi';
import { SECRETO_EVENTOS_PRUEBA, eventoFirmado } from '@izao/wompi/mock';
import { manejarWebhookWompi, type DepsWebhookWompi } from './manejar';

const TX = { id: '1234-1610641025-49201', status: 'APPROVED' as const, amount_in_cents: 24_990_000, reference: 'IZ-CO-000123-P1' };

function deps(o: { creds?: boolean; falloCola?: boolean; falloRegistro?: boolean } = {}) {
  const registrados = new Map<string, { evento: VerifiedEvent; procesado: boolean }>();
  const encolados: DatosJobWompi[] = [];
  const d: DepsWebhookWompi = {
    credenciales: async () => (o.creds === false ? null : { ambiente: 'sandbox', secretoEventos: SECRETO_EVENTOS_PRUEBA }),
    registrar: async (e) => {
      if (o.falloRegistro) throw new Error('db caída');
      const previo = registrados.get(e.event_id);
      if (previo) return { procesado: previo.procesado };
      registrados.set(e.event_id, { evento: e, procesado: false });
      return { procesado: false };
    },
    encolar: async (datos) => {
      if (o.falloCola) throw new Error('redis caído');
      encolados.push(datos);
    },
  };
  return { d, registrados, encolados };
}

function peticion(cuerpo: string, cabeceras: Record<string, string> = {}) {
  return new Request('https://izaoperfumeria.com/api/webhooks/wompi', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabeceras },
    body: cuerpo,
  });
}

describe('POST /api/webhooks/wompi (§12.2)', () => {
  it('firma válida: registra en webhook_events, encola el job y responde 200', async () => {
    const { d, registrados, encolados } = deps();
    const { cuerpo, checksum } = eventoFirmado(TX);
    const res = await manejarWebhookWompi(peticion(cuerpo, { 'x-event-checksum': checksum }), d);
    expect(res.status).toBe(200);
    expect(registrados.has('1234-1610641025-49201.APPROVED')).toBe(true);
    expect(encolados).toEqual([{ event_id: '1234-1610641025-49201.APPROVED', transaction_id: TX.id }]);
  });

  it('doble entrega: no duplica el registro; si ya se procesó no encola de nuevo', async () => {
    const { d, registrados, encolados } = deps();
    const { cuerpo } = eventoFirmado(TX);
    await manejarWebhookWompi(peticion(cuerpo), d);
    // Segunda entrega antes de procesar: se vuelve a encolar (el id fijo del job evita duplicarlo en BullMQ).
    expect((await manejarWebhookWompi(peticion(cuerpo), d)).status).toBe(200);
    expect(registrados.size).toBe(1);
    registrados.get('1234-1610641025-49201.APPROVED')!.procesado = true;
    const res = await manejarWebhookWompi(peticion(cuerpo), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, repetido: true });
    expect(encolados).toHaveLength(2);
  });

  it('firma inválida → 401, no registra ni encola (un atacante no puede ocupar el id del evento)', async () => {
    const { d, registrados, encolados } = deps();
    const { cuerpo } = eventoFirmado(TX, { secreto: 'test_events_otro' });
    const res = await manejarWebhookWompi(peticion(cuerpo), d);
    expect(res.status).toBe(401);
    expect(registrados.size).toBe(0);
    expect(encolados).toHaveLength(0);
  });

  it('sin credenciales activas → 503 para que Wompi reintente', async () => {
    const { d } = deps({ creds: false });
    expect((await manejarWebhookWompi(peticion(eventoFirmado(TX).cuerpo), d)).status).toBe(503);
  });

  it('falla de base o de Redis → 503 (Wompi reintenta)', async () => {
    expect((await manejarWebhookWompi(peticion(eventoFirmado(TX).cuerpo), deps({ falloRegistro: true }).d)).status).toBe(503);
    expect((await manejarWebhookWompi(peticion(eventoFirmado(TX).cuerpo), deps({ falloCola: true }).d)).status).toBe(503);
  });

  it('cuerpo demasiado grande → 413 sin leerlo como evento', async () => {
    const { d } = deps();
    const res = await manejarWebhookWompi(peticion('x'.repeat(70 * 1024)), d);
    expect(res.status).toBe(413);
  });

  it('otro tipo de evento firmado: 200 sin encolar', async () => {
    const { d, encolados } = deps();
    const res = await manejarWebhookWompi(peticion(eventoFirmado(TX, { event: 'nequi_token.updated' }).cuerpo), d);
    expect(res.status).toBe(200);
    expect(encolados).toHaveLength(0);
  });

  it('la respuesta nunca incluye detalles internos', async () => {
    const { d } = deps({ falloRegistro: true });
    const res = await manejarWebhookWompi(peticion(eventoFirmado(TX).cuerpo), d);
    expect(await res.text()).not.toContain('db caída');
  });
});
