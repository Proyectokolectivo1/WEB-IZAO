import { describe, expect, it } from 'vitest';
import { verificarEvento } from './eventos';
import { SECRETO_EVENTOS_PRUEBA, eventoFirmado, type TransaccionPrueba } from './mock';

const enc = new TextEncoder();
const TX: TransaccionPrueba = {
  id: '1234-1610641025-49201',
  status: 'APPROVED',
  amount_in_cents: 24_990_000,
  reference: 'IZ-CO-000123-P1',
};

function verificar(cuerpo: string, cabeceras: Record<string, string> = {}, ambiente: 'sandbox' | 'production' = 'sandbox') {
  return verificarEvento(enc.encode(cuerpo), cabeceras, { secretoEventos: SECRETO_EVENTOS_PRUEBA, ambiente });
}

describe('verificación del webhook de Wompi (§12.2)', () => {
  it('evento válido: id de idempotencia = transacción + estado, referencias para asociar', () => {
    const { cuerpo, checksum } = eventoFirmado(TX);
    const r = verificar(cuerpo, { 'x-event-checksum': checksum.toUpperCase() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento).toMatchObject({
      provider: 'wompi',
      event_id: '1234-1610641025-49201.APPROVED',
      event_type: 'transaction.updated',
      occurred_at: '2026-10-20T15:00:00.000Z',
      refs: {
        provider_transaction_id: '1234-1610641025-49201',
        provider_reference: 'IZ-CO-000123-P1',
        payment_link_id: null,
      },
    });
  });

  it('el mismo evento reenviado produce el mismo event_id; otro estado, otro id', () => {
    const a = verificar(eventoFirmado(TX, { timestamp: 1 }).cuerpo);
    const b = verificar(eventoFirmado(TX, { timestamp: 2 }).cuerpo);
    const c = verificar(eventoFirmado({ ...TX, status: 'DECLINED' }).cuerpo);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.evento.event_id).toBe(b.evento.event_id);
      expect(c.evento.event_id).not.toBe(a.evento.event_id);
    }
  });

  it('respeta el orden y la lista de signature.properties que manda Wompi', () => {
    const { cuerpo } = eventoFirmado(TX, { properties: ['transaction.status', 'transaction.reference', 'transaction.id'] });
    expect(verificar(cuerpo).ok).toBe(true);
  });

  it('firma con otro secreto → firma_invalida', () => {
    const { cuerpo } = eventoFirmado(TX, { secreto: 'test_events_otro' });
    expect(verificar(cuerpo)).toEqual({ ok: false, motivo: 'firma_invalida' });
  });

  it('cuerpo alterado después de firmar → firma_invalida', () => {
    const { cuerpo } = eventoFirmado(TX);
    expect(verificar(cuerpo.replace('"APPROVED"', '"DECLINED"'))).toEqual({ ok: false, motivo: 'firma_invalida' });
    expect(verificar(cuerpo.replace('24990000', '100'))).toEqual({ ok: false, motivo: 'firma_invalida' });
  });

  it('alterar un campo no firmado (reference) no cambia la firma, pero el job reconsulta la API', () => {
    // Documentado: solo se firman las propiedades listadas. Por eso el job nunca confía en el payload.
    const { cuerpo } = eventoFirmado(TX);
    expect(verificar(cuerpo.replace('IZ-CO-000123-P1', 'IZ-CO-000999-P1')).ok).toBe(true);
  });

  it('cabecera X-Event-Checksum distinta del cuerpo → firma_invalida', () => {
    const { cuerpo } = eventoFirmado(TX);
    expect(verificar(cuerpo, { 'x-event-checksum': 'a'.repeat(64) })).toEqual({ ok: false, motivo: 'firma_invalida' });
  });

  it('evento de sandbox en producción (o al revés) → ambiente', () => {
    expect(verificar(eventoFirmado(TX).cuerpo, {}, 'production')).toEqual({ ok: false, motivo: 'ambiente' });
    expect(verificar(eventoFirmado(TX, { environment: 'prod' }).cuerpo)).toEqual({ ok: false, motivo: 'ambiente' });
  });

  it('JSON inválido, sin firma, propiedades vacías o rutas inexistentes → rechazado', () => {
    expect(verificar('{no json')).toEqual({ ok: false, motivo: 'json_invalido' });
    const base = JSON.parse(eventoFirmado(TX).cuerpo) as Record<string, unknown>;
    expect(verificar(JSON.stringify({ ...base, signature: undefined })).ok).toBe(false);
    expect(verificar(JSON.stringify({ ...base, signature: { properties: [], checksum: 'a'.repeat(64) } })).ok).toBe(false);
    const { cuerpo } = eventoFirmado(TX, { properties: ['transaction.no_existe'] });
    expect(verificar(cuerpo).ok).toBe(false);
    expect(verificar(JSON.stringify({ ...base, timestamp: '1' })).ok).toBe(false);
    const proto = eventoFirmado(TX, { properties: ['__proto__.toString'] }).cuerpo;
    expect(verificar(proto).ok).toBe(false);
  });

  it('secreto vacío nunca valida', () => {
    const { cuerpo } = eventoFirmado(TX);
    expect(
      verificarEvento(enc.encode(cuerpo), {}, { secretoEventos: '', ambiente: 'sandbox' }),
    ).toEqual({ ok: false, motivo: 'sin_secreto' });
  });

  it('otro tipo de evento con firma válida: verificado, sin referencias de transacción', () => {
    const { cuerpo } = eventoFirmado(TX, { event: 'nequi_token.updated' });
    const r = verificar(cuerpo);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evento.event_type).toBe('nequi_token.updated');
  });
});
