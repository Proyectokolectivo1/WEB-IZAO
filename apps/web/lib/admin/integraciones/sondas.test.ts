import { describe, expect, it } from 'vitest';
import { crearSondas, modoIntegraciones } from './sondas';

const WOMPI = {
  public_key: 'pub_test_abc123',
  private_key: 'prv_test_privada_0001',
  events_secret: 'test_events_secreto_0002',
  integrity_secret: 'test_integrity_secreto_0003',
};
const WA = {
  phone_number_id: '1234567890',
  waba_id: '9876543210',
  access_token: 'EAAG_token_largo_de_prueba_0001',
  app_secret: 'app_secret_de_prueba_0002',
  verify_token: 'verify_token_prueba_0003',
};

function fetchPorUrl(reglas: (url: string, auth: string | null) => number | 'red'): typeof fetch {
  return (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const r = reglas(url, new Headers(init?.headers).get('authorization'));
    if (r === 'red') throw new TypeError('fallo de red');
    return new Response(JSON.stringify({ data: [], id: 'x' }), { status: r, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('modoIntegraciones', () => {
  it('mock solo fuera de producción', () => {
    expect(modoIntegraciones({ INTEGRACIONES_MODO: 'mock', NODE_ENV: 'development' })).toBe('mock');
    expect(modoIntegraciones({ INTEGRACIONES_MODO: 'mock', NODE_ENV: 'production' })).toBe('real');
    expect(modoIntegraciones({})).toBe('real');
  });
});

describe('sondas mock', () => {
  const s = crearSondas('mock', fetchPorUrl(() => 500));

  it('validan el formato sin tocar la red', async () => {
    const ok = await s.wompi({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/Simulación/);
    const mal = await s.wompi({ pais: 'CO', ambiente: 'production', valores: WOMPI });
    expect(mal.ok).toBe(false);
  });
});

describe('sondas reales', () => {
  it('Wompi: llave pública y privada válidas', async () => {
    const llamadas: string[] = [];
    const f = fetchPorUrl((url, auth) => {
      llamadas.push(url);
      if (url.includes('/merchants/')) return 200;
      return auth === `Bearer ${WOMPI.private_key}` ? 404 : 401;
    });
    const r = await crearSondas('real', f).wompi({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(r).toEqual({ ok: true, message: 'Conexión con Wompi correcta.' });
    expect(llamadas[0]).toContain('https://sandbox.wompi.co/v1/merchants/pub_test_abc123');
  });

  it('Wompi: llave privada rechazada y llave pública desconocida', async () => {
    const privadaMala = fetchPorUrl((url) => (url.includes('/merchants/') ? 200 : 401));
    const a = await crearSondas('real', privadaMala).wompi({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(a).toEqual({ ok: false, message: 'Wompi rechazó la llave privada.' });
    const publicaMala = fetchPorUrl(() => 404);
    const b = await crearSondas('real', publicaMala).wompi({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/llave pública/);
  });

  it('Wompi: fallo de red', async () => {
    const r = await crearSondas('real', fetchPorUrl(() => 'red')).wompi({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/contactar a Wompi/);
  });

  it('WhatsApp: token válido, rechazado y número inexistente', async () => {
    const ok = await crearSondas('real', fetchPorUrl(() => 200)).whatsapp({ pais: 'CO', ambiente: 'production', valores: WA });
    expect(ok.ok).toBe(true);
    const sin = await crearSondas('real', fetchPorUrl(() => 401)).whatsapp({ pais: 'CO', ambiente: 'production', valores: WA });
    expect(sin).toEqual({ ok: false, message: 'Meta rechazó el token de acceso.' });
    const no = await crearSondas('real', fetchPorUrl(() => 404)).whatsapp({ pais: 'CO', ambiente: 'production', valores: WA });
    expect(no.ok).toBe(false);
  });

  it('WhatsApp usa la versión de Graph configurada y el token en la cabecera, no en la URL', async () => {
    let visto = '';
    let auth: string | null = null;
    const f = fetchPorUrl((url, a) => {
      visto = url;
      auth = a;
      return 200;
    });
    await crearSondas('real', f).whatsapp({ pais: 'CO', ambiente: 'production', valores: { ...WA, graph_version: 'v25.0' } });
    expect(visto).toContain('/v25.0/1234567890');
    expect(visto).not.toContain(WA.access_token);
    expect(auth).toBe(`Bearer ${WA.access_token}`);
  });

  it('MasterShop: llave rechazada devuelve un mensaje sin la llave', async () => {
    const llave = 'llave-mastershop-secreta-9999';
    const r = await crearSondas('real', fetchPorUrl(() => 401)).mastershop({
      pais: 'CO',
      ambiente: 'production',
      valores: { api_key: llave },
    });
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain(llave);
  });

  it('MasterShop sin llave no llama a la red', async () => {
    const r = await crearSondas('real', fetchPorUrl(() => 500)).mastershop({ pais: 'CO', ambiente: 'production', valores: {} });
    expect(r.ok).toBe(false);
  });
});

describe('sonda de OpenRouter', () => {
  const valores = { api_key: 'sk-or-v1-0123456789abcdef0123456789abcdef' };
  const entrada = { pais: null, ambiente: 'production' as const, valores };

  it('real: lee /api/v1/key con la llave como Bearer', async () => {
    const vistos: [string, string | null][] = [];
    const f = fetchPorUrl((url, auth) => (vistos.push([url, auth]), 200));
    expect((await crearSondas('real', f).openrouter(entrada)).ok).toBe(true);
    expect(vistos).toEqual([['https://openrouter.ai/api/v1/key', `Bearer ${valores.api_key}`]]);
  });

  it('real: 401 es llave rechazada, otro código es error del proveedor y sin red lo dice; nunca filtra la llave', async () => {
    const rechazo = await crearSondas('real', fetchPorUrl(() => 401)).openrouter(entrada);
    expect(rechazo).toEqual({ ok: false, message: 'OpenRouter rechazó la llave de API.' });
    expect((await crearSondas('real', fetchPorUrl(() => 503)).openrouter(entrada)).message).toMatch(/503/);
    expect((await crearSondas('real', fetchPorUrl(() => 'red')).openrouter(entrada)).message).toMatch(/No se pudo contactar/);
    expect(JSON.stringify(rechazo)).not.toContain(valores.api_key);
  });

  it('mock: valida el formato sin red', async () => {
    const s = crearSondas('mock', fetchPorUrl(() => 500));
    expect((await s.openrouter(entrada)).ok).toBe(true);
    expect((await s.openrouter({ ...entrada, valores: { api_key: 'corta' } })).ok).toBe(false);
  });
});

describe('sondas de marketing', () => {
  const meta = { access_token: 'EAAtokendeprueba1234567890', ad_account_id: 'act_1234567890' };

  it('Meta Ads real: lee la cuenta con el token como Bearer (el prefijo act_ no se duplica)', async () => {
    const vistos: [string, string | null][] = [];
    const f = fetchPorUrl((url, auth) => (vistos.push([url, auth]), 200));
    const s = crearSondas('real', f);
    expect((await s.meta_ads({ pais: 'CO', ambiente: 'production', valores: meta })).ok).toBe(true);
    expect((await s.meta_ads({ pais: 'EC', ambiente: 'production', valores: { ...meta, ad_account_id: '1234567890' } })).ok).toBe(true);
    expect(vistos.map((v) => v[0])).toEqual([expect.stringMatching(/graph\.facebook\.com\/v[\d.]+\/act_1234567890\?fields=id$/), expect.stringMatching(/\/act_1234567890\?fields=id$/)]);
    expect(vistos[0]![1]).toBe(`Bearer ${meta.access_token}`);
  });

  it('Meta Ads real: traduce el rechazo y la cuenta inexistente, y no filtra el token', async () => {
    const rechazo = await crearSondas('real', fetchPorUrl(() => 401)).meta_ads({ pais: 'CO', ambiente: 'production', valores: meta });
    expect(rechazo.ok).toBe(false);
    expect(rechazo.message).toMatch(/rechaz/);
    expect((await crearSondas('real', fetchPorUrl(() => 404)).meta_ads({ pais: 'CO', ambiente: 'production', valores: meta })).message).toMatch(/cuenta/);
    expect(JSON.stringify(rechazo)).not.toContain(meta.access_token);
  });

  it('píxeles: solo revisan el formato y lo dicen, sin tocar la red', async () => {
    const f = fetchPorUrl(() => {
      throw new Error('no debe llamar a la red');
    });
    const s = crearSondas('real', f);
    const ok = await s.ga4({ pais: 'CO', ambiente: 'production', valores: { measurement_id: 'G-ABC123XYZ' } });
    expect(ok).toMatchObject({ ok: true, message: expect.stringMatching(/No se enviaron eventos/) });
    expect((await s.meta_pixel({ pais: 'CO', ambiente: 'production', valores: { pixel_id: 'xx', capi_token: 'EAAx12345678901234' } })).ok).toBe(false);
    expect((await s.tiktok_pixel({ pais: 'EC', ambiente: 'production', valores: { pixel_id: 'CABC123DEF456', events_api_token: 'tok12345678901' } })).ok).toBe(true);
  });

  it('mock: valida el formato de todos sin red', async () => {
    const s = crearSondas('mock', fetchPorUrl(() => 500));
    expect((await s.meta_ads({ pais: 'CO', ambiente: 'production', valores: meta })).ok).toBe(true);
    expect((await s.meta_ads({ pais: 'CO', ambiente: 'production', valores: { ...meta, ad_account_id: 'x' } })).ok).toBe(false);
    expect((await s.ga4({ pais: 'CO', ambiente: 'production', valores: { measurement_id: 'UA-1' } })).ok).toBe(false);
  });
});
