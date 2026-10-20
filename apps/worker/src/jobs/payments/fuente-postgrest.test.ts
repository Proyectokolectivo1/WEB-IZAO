import { describe, expect, it } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { transicionar } from '@izao/core/order-state';
import { crearFuentePostgrest } from './fuente-postgrest.js';

const CLAVE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const LLAVE_SB = 'llave-de-servidor-ficticia';
const VALORES = {
  public_key: 'pub_test_ficticia0001',
  private_key: 'prv_test_ficticia0002',
  events_secret: 'test_events_ficticio0003',
  integrity_secret: 'test_integrity_ficticio0004',
};

interface Llamada {
  url: string;
  metodo: string;
  cuerpo: unknown;
  cabeceras: Headers;
}

function fetchFalso(responder: (l: Llamada) => { status: number; cuerpo?: unknown }) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const l = { url, metodo: init?.method ?? 'GET', cuerpo: init?.body ? JSON.parse(String(init.body)) : null, cabeceras: new Headers(init?.headers) };
    llamadas.push(l);
    const r = responder(l);
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status });
  }) as typeof fetch;
  return { f, llamadas };
}

describe('fuente PostgREST de pagos', () => {
  it('descifra la credencial activa de Wompi (bytea hex) y valida el ambiente', async () => {
    const c = await cifrarCredenciales(CLAVE, { provider: 'wompi', country_code: 'CO', environment: 'sandbox' }, VALORES);
    const { f, llamadas } = fetchFalso(() => ({
      status: 200,
      cuerpo: [{ environment: 'sandbox', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: 1 }],
    }));
    const fuente = crearFuentePostgrest({ supabaseUrl: 'https://x.supabase.co/', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f });
    const cred = await fuente.credencialesWompi();
    expect(cred).toMatchObject({ ambiente: 'sandbox', llavePrivada: 'prv_test_ficticia0002' });
    expect(llamadas[0]!.url).toContain('/rest/v1/integration_credentials?provider=eq.wompi&country_code=eq.CO&is_active=is.true');
    expect(llamadas[0]!.cabeceras.get('authorization')).toBe(`Bearer ${LLAVE_SB}`);
  });

  it('credencial cifrada para otro ambiente o clave equivocada → null, sin lanzar', async () => {
    const c = await cifrarCredenciales(CLAVE, { provider: 'wompi', country_code: 'CO', environment: 'production' }, VALORES);
    const { f } = fetchFalso(() => ({
      status: 200,
      cuerpo: [{ environment: 'sandbox', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: 1 }],
    }));
    const fuente = crearFuentePostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f });
    expect(await fuente.credencialesWompi()).toBeNull();
  });

  it('dos credenciales activas → null (ambiguo)', async () => {
    const { f } = fetchFalso(() => ({ status: 200, cuerpo: [{}, {}] }));
    const fuente = crearFuentePostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f });
    expect(await fuente.credencialesWompi()).toBeNull();
  });

  it('aplicarTransicion: update condicionado al estado leído y evento; sin fila actualizada no registra evento', async () => {
    const r = transicionar({ from: 'pendiente_pago', to: 'pagado', actor: 'webhook:wompi', payload: { payment_id: 'p1' } });
    if (!r.ok) throw new Error('transición inválida');
    let filas: unknown[] = [{ id: 'o1' }];
    const { f, llamadas } = fetchFalso((l) => (l.metodo === 'PATCH' ? { status: 200, cuerpo: filas } : { status: 201 }));
    const fuente = crearFuentePostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f });
    expect(await fuente.aplicarTransicion('o1', r.event, { paid_at: new Date('2026-10-20T15:00:00.000Z') })).toBe(true);
    expect(llamadas[0]!.url).toContain('orders?id=eq.o1&status=eq.pendiente_pago');
    expect(llamadas[0]!.cuerpo).toEqual({ status: 'pagado', paid_at: '2026-10-20T15:00:00.000Z' });
    expect(llamadas[1]!.cuerpo).toMatchObject({ order_id: 'o1', type: 'status_changed', from_status: 'pendiente_pago', to_status: 'pagado', actor: 'webhook:wompi' });
    filas = [];
    expect(await fuente.aplicarTransicion('o1', r.event)).toBe(false);
    expect(llamadas).toHaveLength(3);
  });

  it('errores HTTP no incluyen la llave ni el cuerpo', async () => {
    const { f } = fetchFalso(() => ({ status: 500, cuerpo: { message: 'detalle interno' } }));
    const fuente = crearFuentePostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: LLAVE_SB, claveCifrado: CLAVE, fetchImpl: f });
    const e = (await fuente.pedido('o1').then(
      () => new Error('no lanzó'),
      (x: unknown) => x,
    )) as Error;
    expect(e.message).toBe('PostgREST orders respondió HTTP 500');
    expect(e.message).not.toContain(LLAVE_SB);
  });
});
