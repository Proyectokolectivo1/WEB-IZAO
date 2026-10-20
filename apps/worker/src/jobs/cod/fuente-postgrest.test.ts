import { describe, expect, it } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { transicionar } from '@izao/core/order-state';
import { fetchFalso, type Llamada } from '../fetch-falso.js';
import { crearFuenteCodPostgrest } from './fuente-postgrest.js';

const CLAVE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const LLAVE_SB = 'llave-de-servidor-ficticia';
const ORDER = '00000000-0000-4000-8000-0000000000aa';

function fuenteCon(responder: (l: Llamada) => { status: number; cuerpo?: unknown }) {
  const { f, llamadas } = fetchFalso(responder);
  return { fuente: crearFuenteCodPostgrest({ supabaseUrl: 'https://x.supabase.co/', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f }), llamadas };
}

const FILA_PEDIDO = {
  id: ORDER,
  number: 'IZ-CO-000123',
  public_token: 'tok123',
  status: 'esperando_abono',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'cod',
  stock_state: 'reserved',
  cod_deposit_amount: 30000,
  cod_collect_amount: 159900,
  contact_first_name: 'Ana',
  contact_email: null,
  contact_phone_e164: '+573001234567',
  created_at: '2026-10-20T15:00:00+00:00',
  stock_reserved_until: '2026-10-21T15:00:00+00:00',
};

describe('fuente PostgREST de contra entrega', () => {
  it('pedido: montos bigint, fechas y columnas del contacto; inexistente → null', async () => {
    const { fuente, llamadas } = fuenteCon((l) => ({ status: 200, cuerpo: l.url.includes(ORDER) ? [FILA_PEDIDO] : [] }));
    const p = await fuente.pedido(ORDER);
    expect(p).toMatchObject({ number: 'IZ-CO-000123', cod_deposit_amount: 30000n, cod_collect_amount: 159900n, contact_email: null });
    expect(p!.created_at.toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(p!.stock_reserved_until!.toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(llamadas[0]!.url).toContain(`/rest/v1/orders?id=eq.${ORDER}&select=`);
    expect(llamadas[0]!.url).toContain('public_token');
    expect(llamadas[0]!.cabeceras.get('authorization')).toBe(`Bearer ${LLAVE_SB}`);
    expect(await fuente.pedido('00000000-0000-4000-8000-0000000000bb')).toBeNull();
  });

  it('config: offsets, horario silencioso y zona de countries; sin fila → null', async () => {
    const { fuente, llamadas } = fuenteCon((l) => ({
      status: 200,
      cuerpo: l.url.includes('country_code=eq.CO')
        ? [{ cod_reminder_offsets_minutes: [180, 720, 1260], cod_quiet_hours_start: '21:00:00', cod_quiet_hours_end: '07:00:00', countries: { timezone: 'America/Bogota' } }]
        : [],
    }));
    expect(await fuente.config('CO')).toEqual({ offsetsMinutos: [180, 720, 1260], silencio: { inicio: '21:00:00', fin: '07:00:00' }, zona: 'America/Bogota' });
    expect(llamadas[0]!.url).toContain('country_settings?country_code=eq.CO&select=');
    expect(llamadas[0]!.url).toContain('countries(timezone)');
    expect(await fuente.config('EC')).toBeNull();
  });

  it('abonos: solo wompi/cod_deposit del pedido, en orden, con montos bigint', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({
      status: 200,
      cuerpo: [{ id: 'p1', status: 'created', amount: 30000, provider_reference: 'IZ-CO-000123-A1', payment_link_id: null, checkout_url: null, expires_at: '2026-10-21T15:00:00+00:00' }],
    }));
    const [a] = await fuente.abonos(ORDER);
    expect(a).toEqual({ id: 'p1', status: 'created', amount: 30000n, provider_reference: 'IZ-CO-000123-A1', payment_link_id: null, checkout_url: null, expires_at: new Date('2026-10-21T15:00:00.000Z') });
    expect(llamadas[0]!.url).toContain(`payments?order_id=eq.${ORDER}&provider=eq.wompi&purpose=eq.cod_deposit&order=created_at.asc`);
  });

  it('reservarAbono: inserta la fila created con el monto entero; 23505 → duplicado; otro error lanza', async () => {
    let respuesta: { status: number; cuerpo?: unknown } = { status: 201, cuerpo: [{ id: 'p9' }] };
    const { fuente, llamadas } = fuenteCon(() => respuesta);
    const n = { order_id: ORDER, amount: 30000n, currency_code: 'COP' as const, provider_reference: 'IZ-CO-000123-A1', expires_at: new Date('2026-10-21T15:00:00.000Z') };
    expect(await fuente.reservarAbono(n)).toEqual({ ok: true, id: 'p9' });
    expect(llamadas[0]!.metodo).toBe('POST');
    expect(llamadas[0]!.cabeceras.get('prefer')).toBe('return=representation');
    expect(llamadas[0]!.cuerpo).toEqual({
      order_id: ORDER,
      provider: 'wompi',
      purpose: 'cod_deposit',
      amount: 30000,
      currency_code: 'COP',
      status: 'created',
      provider_reference: 'IZ-CO-000123-A1',
      expires_at: '2026-10-21T15:00:00.000Z',
    });
    respuesta = { status: 409, cuerpo: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    expect(await fuente.reservarAbono(n)).toEqual({ ok: false, motivo: 'duplicado' });
    respuesta = { status: 500, cuerpo: { code: 'XX000', message: 'interno' } };
    await expect(fuente.reservarAbono(n)).rejects.toThrow(/HTTP 500 \(XX000\)/);
  });

  it('guardarLink y crearPayLink (23505 → duplicado); payLink toma el más reciente', async () => {
    let status = 201;
    const { fuente, llamadas } = fuenteCon((l) => {
      if (l.metodo === 'GET') return { status: 200, cuerpo: [{ token: 'tk', payment_id: 'p1', target_url: 'https://checkout.wompi.co/l/abc', expires_at: '2026-10-21T15:00:00Z' }] };
      return status === 409 ? { status, cuerpo: { code: '23505' } } : { status: 204 };
    });
    await fuente.guardarLink('p1', { payment_link_id: 'abc', checkout_url: 'https://checkout.wompi.co/l/abc' });
    expect(llamadas[0]).toMatchObject({ metodo: 'PATCH', cuerpo: { payment_link_id: 'abc', checkout_url: 'https://checkout.wompi.co/l/abc' } });
    expect(llamadas[0]!.url).toContain('payments?id=eq.p1');
    const pl = { token: 'tk', payment_id: 'p1', target_url: 'https://checkout.wompi.co/l/abc', expires_at: new Date('2026-10-21T15:00:00.000Z'), order_id: ORDER };
    expect(await fuente.crearPayLink(pl)).toEqual({ ok: true });
    expect(llamadas[1]!.cuerpo).toEqual({ ...pl, expires_at: '2026-10-21T15:00:00.000Z' });
    status = 409;
    expect(await fuente.crearPayLink(pl)).toEqual({ ok: false, motivo: 'duplicado' });
    expect(await fuente.payLink(ORDER)).toEqual({ token: 'tk', payment_id: 'p1', target_url: 'https://checkout.wompi.co/l/abc', expires_at: new Date('2026-10-21T15:00:00.000Z') });
    expect(llamadas.at(-1)!.url).toContain(`pay_links?order_id=eq.${ORDER}&order=created_at.desc&limit=1`);
  });

  it('plantillaActiva: activa y aprobada por país y clave', async () => {
    const fila = { id: 't1', key: 'cobro_abono', meta_template_name: 'cobro_abono_v1', language: 'es', body_text: 'Hola, {{1}}.', footer_text: null, button_text: 'Pagar', button_url: 'https://izaoperfumeria.com/pagar/{{1}}', variables_map: { '1': 'nombre' } };
    const { fuente, llamadas } = fuenteCon(() => ({ status: 200, cuerpo: [fila] }));
    expect(await fuente.plantillaActiva('CO', 'cobro_abono')).toEqual(fila);
    expect(llamadas[0]!.url).toContain('whatsapp_templates?country_code=eq.CO&key=eq.cobro_abono&is_active=is.true&meta_status=eq.approved');
  });

  it('mensajes: clave de la plantilla embebida y fechas', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({
      status: 200,
      cuerpo: [
        { id: 'm1', scheduled_for: '2026-10-20T15:00:00Z', status: 'sent', wa_message_id: 'wamid.A', whatsapp_templates: { key: 'cobro_abono' } },
        { id: 'm2', scheduled_for: null, status: 'queued', wa_message_id: null, whatsapp_templates: null },
      ],
    }));
    expect(await fuente.mensajes(ORDER)).toEqual([
      { id: 'm1', template_key: 'cobro_abono', scheduled_for: new Date('2026-10-20T15:00:00.000Z'), status: 'sent', wa_message_id: 'wamid.A' },
      { id: 'm2', template_key: '', scheduled_for: null, status: 'queued', wa_message_id: null },
    ]);
    expect(llamadas[0]!.url).toContain('whatsapp_templates(key)');
  });

  it('prepararMensaje: reutiliza la fila de (pedido, plantilla, hora); si no existe la crea queued', async () => {
    let existentes: unknown[] = [{ id: 'm1' }];
    const { fuente, llamadas } = fuenteCon((l) => (l.metodo === 'GET' ? { status: 200, cuerpo: existentes } : { status: 201, cuerpo: [{ id: 'm2' }] }));
    const m = { order_id: ORDER, template_id: 't1', to_e164: '+573001234567', scheduled_for: new Date('2026-10-20T15:00:00.000Z') };
    expect(await fuente.prepararMensaje(m)).toBe('m1');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url).toContain(`whatsapp_messages?order_id=eq.${ORDER}&template_id=eq.t1&scheduled_for=eq.2026-10-20T15:00:00.000Z`);
    existentes = [];
    expect(await fuente.prepararMensaje(m)).toBe('m2');
    expect(llamadas[2]).toMatchObject({ metodo: 'POST', cuerpo: { ...m, scheduled_for: '2026-10-20T15:00:00.000Z', status: 'queued' } });
  });

  it('prepararMensaje: carrera con el índice único (23505) → relee la fila', async () => {
    let lecturas = 0;
    const { fuente } = fuenteCon((l) => {
      if (l.metodo === 'GET') return { status: 200, cuerpo: lecturas++ === 0 ? [] : [{ id: 'm7' }] };
      return { status: 409, cuerpo: { code: '23505' } };
    });
    expect(await fuente.prepararMensaje({ order_id: ORDER, template_id: 't1', to_e164: '+57300', scheduled_for: new Date(0) })).toBe('m7');
  });

  it('marcarMensaje: sent con wamid y hora; failed con código y texto', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 204 }));
    await fuente.marcarMensaje('m1', { status: 'sent', wa_message_id: 'wamid.A', sent_at: new Date('2026-10-20T15:00:01.000Z') });
    await fuente.marcarMensaje('m1', { status: 'failed', error_code: '131026', error_text: 'DESTINO' });
    expect(llamadas[0]!.cuerpo).toEqual({ status: 'sent', wa_message_id: 'wamid.A', sent_at: '2026-10-20T15:00:01.000Z' });
    expect(llamadas[1]!.cuerpo).toEqual({ status: 'failed', error_code: '131026', error_text: 'DESTINO' });
  });

  it('aplicarTransicion por aplicar_transicion_pedido con abandoned_at; liberar_stock y liberar_canje por RPC', async () => {
    const t = transicionar({ from: 'esperando_abono', to: 'abandonado', actor: 'system', payload: { motivo: 'abono_no_recibido' } });
    if (!t.ok) throw new Error('transición inválida');
    const { fuente, llamadas } = fuenteCon((l) =>
      l.url.endsWith('aplicar_transicion_pedido')
        ? { status: 200, cuerpo: { ok: true, event_id: 'e1' } }
        : { status: 200, cuerpo: { ok: true } },
    );
    expect(await fuente.aplicarTransicion(ORDER, t.event, { abandoned_at: new Date('2026-10-21T15:00:00.000Z') })).toBe(true);
    expect(llamadas[0]!.cuerpo).toEqual({
      p: { order_id: ORDER, from_status: 'esperando_abono', to_status: 'abandonado', actor: 'system', payload: { motivo: 'abono_no_recibido' }, fechas: { abandoned_at: '2026-10-21T15:00:00.000Z' } },
    });
    expect(await fuente.liberarStock(ORDER)).toEqual({ ok: true });
    expect(await fuente.liberarCanje(ORDER)).toEqual({ ok: true });
    expect(llamadas[1]).toMatchObject({ url: 'https://x.supabase.co/rest/v1/rpc/liberar_stock', cuerpo: { p_order_id: ORDER } });
    expect(llamadas[2]).toMatchObject({ url: 'https://x.supabase.co/rest/v1/rpc/liberar_canje', cuerpo: { p_order_id: ORDER } });
  });

  it('credencialesWhatsApp: descifra la credencial activa del país; incompleta → null', async () => {
    const valores = { phone_number_id: '1234567890', waba_id: '9876543210', access_token: 'EAAficticio', app_secret: 'secreto-ficticio', verify_token: 'verif-ficticio' };
    const c = await cifrarCredenciales(CLAVE, { provider: 'whatsapp', country_code: 'EC', environment: 'production' }, valores);
    const fila = { environment: 'production', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: 1 };
    const { fuente, llamadas } = fuenteCon(() => ({ status: 200, cuerpo: [fila] }));
    expect(await fuente.credencialesWhatsApp('EC')).toMatchObject({ phoneNumberId: '1234567890', wabaId: '9876543210', versionGraph: 'v26.0' });
    expect(llamadas[0]!.url).toContain('integration_credentials?provider=eq.whatsapp&country_code=eq.EC&is_active=is.true');
    const inc = await cifrarCredenciales(CLAVE, { provider: 'whatsapp', country_code: 'EC', environment: 'production' }, { phone_number_id: '1234567890' });
    const { fuente: f2 } = fuenteCon(() => ({ status: 200, cuerpo: [{ ...fila, data_encrypted: byteaParaPostgrest(inc.data_encrypted), iv: byteaParaPostgrest(inc.iv) }] }));
    expect(await f2.credencialesWhatsApp('EC')).toBeNull();
  });

  it('registrarAlerta: order_events tipo alerta con actor system', async () => {
    const { fuente, llamadas } = fuenteCon(() => ({ status: 201 }));
    await fuente.registrarAlerta(ORDER, 'whatsapp_fallido', { plantilla: 'cobro_abono' });
    expect(llamadas[0]!.cuerpo).toEqual({ order_id: ORDER, type: 'alerta', actor: 'system', payload: { motivo: 'whatsapp_fallido', plantilla: 'cobro_abono' } });
  });

  describe('lecturas del barrido', () => {
    it('pedidosPorVencer: RPC pedidos_por_vencer con la hora y el límite', async () => {
      const { fuente, llamadas } = fuenteCon(() => ({
        status: 200,
        cuerpo: [{ order_id: ORDER, number: 'IZ-CO-000123', estado_actual: 'pendiente_pago', nuevo_estado: 'expirado', stock_state: 'reserved' }],
      }));
      expect(await fuente.pedidosPorVencer(new Date('2026-10-21T15:00:00.000Z'), 100)).toEqual([
        { order_id: ORDER, estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' },
      ]);
      expect(llamadas[0]).toMatchObject({ url: 'https://x.supabase.co/rest/v1/rpc/pedidos_por_vencer', cuerpo: { p_ahora: '2026-10-21T15:00:00.000Z', p_limite: 100 } });
    });

    it('pedidosSinLink: contra entrega esperando_abono vigente sin pay_links (anti-join)', async () => {
      const { fuente, llamadas } = fuenteCon(() => ({ status: 200, cuerpo: [{ id: ORDER, pay_links: null }] }));
      expect(await fuente.pedidosSinLink(new Date('2026-10-20T15:00:00.000Z'), new Date('2026-10-20T15:02:00.000Z'), 50)).toEqual([ORDER]);
      const u = llamadas[0]!.url;
      expect(u).toContain('orders?status=eq.esperando_abono&payment_method=eq.cod');
      expect(u).toContain('created_at=lt.2026-10-20T15:00:00.000Z');
      expect(u).toContain('stock_reserved_until=gt.2026-10-20T15:02:00.000Z');
      expect(u).toContain('select=id,pay_links(token)&pay_links=is.null');
      expect(u).toContain('limit=50');
    });

    it('reservasHuerfanas: expirado/abandonado con stock reservado', async () => {
      const { fuente, llamadas } = fuenteCon(() => ({ status: 200, cuerpo: [{ id: ORDER }] }));
      expect(await fuente.reservasHuerfanas(20)).toEqual([ORDER]);
      expect(llamadas[0]!.url).toContain('orders?status=in.(expirado,abandonado)&stock_state=eq.reserved&select=id&limit=20');
    });
  });
});
