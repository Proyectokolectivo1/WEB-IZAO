import { describe, expect, it } from 'vitest';
import { fetchFalso, type Llamada } from '../fetch-falso.js';
import { crearFuenteWaPostgrest } from './fuente-postgrest.js';

const CLAVE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

function fuenteCon(responder: (l: Llamada) => { status: number; cuerpo?: unknown }) {
  const { f, llamadas } = fetchFalso(responder);
  return { fuente: crearFuenteWaPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 'llave-ficticia', claveCifrado: CLAVE, fetchImpl: f }), llamadas };
}

const T = { id: 't2', key: 'cobro_abono', country_code: 'CO', version: 2, meta_status: 'pending', is_active: false, meta_template_id: null };

describe('fuente PostgREST de eventos de WhatsApp', () => {
  it('evento: payload y procesado desde webhook_events; marcarEvento ok/error', async () => {
    const { fuente, llamadas } = fuenteCon((l) => (l.metodo === 'GET' ? { status: 200, cuerpo: [{ payload: { tipo: 'x' }, processed_at: null }] } : { status: 204 }));
    expect(await fuente.evento('wamid.A.sent')).toEqual({ payload: { tipo: 'x' }, procesado: false });
    expect(llamadas[0]!.url).toContain('webhook_events?provider=eq.whatsapp&event_id=eq.wamid.A.sent');
    await fuente.marcarEvento('wamid.A.sent', { ok: false, error: 'mensaje_no_registrado' });
    expect(llamadas[1]).toMatchObject({ metodo: 'PATCH', cuerpo: { error: 'mensaje_no_registrado' } });
    await fuente.marcarEvento('wamid.A.sent', { ok: true });
    expect(llamadas[2]!.cuerpo).toMatchObject({ error: null });
    expect(typeof (llamadas[2]!.cuerpo as { processed_at: unknown }).processed_at).toBe('string');
  });

  it('mensajePorWamid con la clave de la plantilla; actualizarMensaje condicional por estado', async () => {
    let filasCambiadas: unknown[] = [{ id: 'm1' }];
    const { fuente, llamadas } = fuenteCon((l) =>
      l.metodo === 'GET'
        ? { status: 200, cuerpo: [{ id: 'm1', order_id: 'o1', status: 'sent', whatsapp_templates: { key: 'cobro_abono' } }] }
        : { status: 200, cuerpo: filasCambiadas },
    );
    expect(await fuente.mensajePorWamid('wamid.A')).toEqual({ id: 'm1', order_id: 'o1', status: 'sent', template_key: 'cobro_abono' });
    expect(await fuente.actualizarMensaje('m1', ['queued', 'sent'], { status: 'failed', error_code: '131026', error_text: 'x' })).toBe(true);
    expect(llamadas[1]!.url).toContain('whatsapp_messages?id=eq.m1&status=in.(queued,sent)&select=id');
    expect(llamadas[1]!.cabeceras.get('prefer')).toBe('return=representation');
    filasCambiadas = [];
    expect(await fuente.actualizarMensaje('m1', ['queued'], { status: 'sent' })).toBe(false);
  });

  it('plantillaPorMeta: por id; si no, por nombre solo si es única y sin id de Meta', async () => {
    let porNombre: unknown[] = [T];
    const { fuente, llamadas } = fuenteCon((l) => ({ status: 200, cuerpo: l.url.includes('meta_template_id=eq.') ? [] : porNombre }));
    expect(await fuente.plantillaPorMeta('555', 'cobro_abono_v2', 'es')).toEqual({ ...T, meta_status: 'pending' });
    expect(llamadas[1]!.url).toContain('meta_template_name=eq.cobro_abono_v2&language=eq.es&meta_template_id=is.null');
    porNombre = [T, { ...T, id: 't9', country_code: 'EC' }];
    expect(await fuente.plantillaPorMeta('555', 'cobro_abono_v2', 'es')).toBeNull();
  });

  it('activarPlantilla: primero desactiva la anterior y luego activa la nueva con su id de Meta', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 204 }));
    await fuente.activarPlantilla({ ...T, country_code: 'CO', meta_status: 'pending' }, '555');
    expect(llamadas[0]!.url).toContain('whatsapp_templates?key=eq.cobro_abono&country_code=eq.CO&is_active=is.true&id=neq.t2');
    expect(llamadas[0]!.cuerpo).toEqual({ is_active: false });
    expect(llamadas[1]!.url).toContain('whatsapp_templates?id=eq.t2');
    expect(llamadas[1]!.cuerpo).toEqual({ is_active: true, meta_status: 'approved', meta_rejection_reason: null, meta_template_id: '555' });
  });

  it('actualizarPlantilla guarda el motivo de rechazo (recortado)', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 204 }));
    await fuente.actualizarPlantilla('t2', { meta_status: 'rejected', meta_rejection_reason: 'x'.repeat(600) });
    expect((llamadas[0]!.cuerpo as { meta_rejection_reason: string }).meta_rejection_reason).toHaveLength(500);
    expect(llamadas[0]!.cuerpo).toMatchObject({ meta_status: 'rejected' });
  });
});
