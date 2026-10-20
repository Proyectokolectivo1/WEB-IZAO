import { describe, expect, it } from 'vitest';
import { manejarCheckout, manejarVistaPrevia, type DepsCheckout } from './http';
import { crearLimitadorMemoria, enteroEnv, ipCliente } from './limite-tasa';
import { AHORA, CIUDAD, REGION, V1, fuenteDePrueba } from './pruebas/datos';

function deps(limite = 100): DepsCheckout & { fuenteMem: ReturnType<typeof fuenteDePrueba> } {
  const fuenteMem = fuenteDePrueba();
  return {
    fuenteMem,
    fuente: () => fuenteMem,
    limitador: crearLimitadorMemoria({ limite, ventanaMs: 60_000 }),
    ahora: () => AHORA,
  };
}

function req(cuerpo: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/checkout/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '10.0.0.1', ...headers },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
}

const checkout = {
  country_code: 'CO',
  idempotency_key: '5f0c7a4e-8d1b-4c3a-9e2f-1a2b3c4d5e6f',
  items: [{ variant_id: V1, quantity: 1 }],
  contact: { first_name: 'Ana', last_name: 'Paz', phone: '3001234567', email: null },
  document: { type: 'CC', number: '123456' },
  shipping: { region_id: REGION, city_id: CIUDAD, district: null, address1: 'Calle 1 # 2-3', address2: null, notes: null },
  payment_method: 'wompi',
  discount_code: null,
  consents: { terms_and_data: true, whatsapp: false },
  data_policy_version: '2026-10',
};

describe('rutas HTTP del checkout', () => {
  it('vista previa: 200 sin caché', async () => {
    const res = await manejarVistaPrevia(req({ country: 'co', items: [{ variant_id: V1, quantity: 1 }] }), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = (await res.json()) as { subtotal: string };
    expect(j.subtotal).toBe('200000');
  });

  it('vista previa: 400 con entrada inválida, JSON roto o tipo de contenido distinto', async () => {
    const d = deps();
    expect((await manejarVistaPrevia(req({ country: 'xx', items: [] }), d)).status).toBe(400);
    expect((await manejarVistaPrevia(req('{roto'), d)).status).toBe(400);
    expect((await manejarVistaPrevia(req('{}', { 'content-type': 'text/plain' }), d)).status).toBe(415);
  });

  it('cuerpo demasiado grande → 413', async () => {
    const grande = JSON.stringify({ country: 'co', items: [], code: 'x'.repeat(40_000) });
    expect((await manejarVistaPrevia(req(grande), deps())).status).toBe(413);
  });

  it('límite de peticiones por IP → 429 con Retry-After', async () => {
    const d = deps(2);
    const cuerpo = { country: 'co', items: [] };
    expect((await manejarVistaPrevia(req(cuerpo), d)).status).toBe(200);
    expect((await manejarVistaPrevia(req(cuerpo), d)).status).toBe(200);
    const r = await manejarVistaPrevia(req(cuerpo), d);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    // Otra IP no se ve afectada
    expect((await manejarVistaPrevia(req(cuerpo, { 'x-real-ip': '10.0.0.2' }), d)).status).toBe(200);
  });

  it('sin base disponible → 503 sin detalles', async () => {
    const d: DepsCheckout = {
      ...deps(),
      fuente: () => {
        throw new Error('SUPABASE_URL no definida');
      },
    };
    const r = await manejarVistaPrevia(req({ country: 'co', items: [] }), d);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('SUPABASE');
  });

  it('checkout: 201 al crear y 200 al repetir la misma clave', async () => {
    const d = deps();
    const a = await manejarCheckout(req(checkout), d);
    expect(a.status).toBe(201);
    expect(a.headers.get('cache-control')).toBe('no-store');
    const b = await manejarCheckout(req(checkout), d);
    expect(b.status).toBe(200);
    expect(((await b.json()) as { repeated: boolean }).repeated).toBe(true);
    expect(d.fuenteMem.pedidos.size).toBe(1);
  });
});

describe('utilidades del límite', () => {
  it('la ventana se reinicia', () => {
    const l = crearLimitadorMemoria({ limite: 1, ventanaMs: 1_000 });
    expect(l.consumir('a', 0).permitido).toBe(true);
    expect(l.consumir('a', 500)).toEqual({ permitido: false, reintentarEnSeg: 1 });
    expect(l.consumir('a', 1_000).permitido).toBe(true);
  });

  it('no crece sin límite de claves', () => {
    const l = crearLimitadorMemoria({ limite: 1, ventanaMs: 1_000, maxClaves: 2 });
    l.consumir('a', 0);
    l.consumir('b', 0);
    expect(l.consumir('c', 0).permitido).toBe(true);
    expect(l.tamano()).toBeLessThanOrEqual(2);
  });

  it('lleno: purga primero las ventanas vencidas y conserva las vigentes', () => {
    const l = crearLimitadorMemoria({ limite: 1, ventanaMs: 1_000, maxClaves: 2 });
    l.consumir('vieja', 0);
    l.consumir('vigente', 600);
    // 'vieja' venció en 1000; 'vigente' sigue en su ventana
    expect(l.consumir('nueva', 1_200).permitido).toBe(true);
    expect(l.consumir('vigente', 1_300).permitido).toBe(false);
  });

  it('lleno sin vencidas: expulsa solo la más antigua, nunca vacía todo', () => {
    const l = crearLimitadorMemoria({ limite: 1, ventanaMs: 10_000, maxClaves: 3 });
    l.consumir('a', 0);
    l.consumir('b', 100);
    l.consumir('c', 200);
    expect(l.consumir('d', 300).permitido).toBe(true);
    expect(l.tamano()).toBe(3);
    // b y c conservan su conteo: siguen bloqueadas
    expect(l.consumir('b', 400).permitido).toBe(false);
    expect(l.consumir('c', 400).permitido).toBe(false);
    expect(l.consumir('d', 400).permitido).toBe(false);
  });

  it('una ventana renovada pasa al final del orden de expulsión', () => {
    const l = crearLimitadorMemoria({ limite: 1, ventanaMs: 1_000, maxClaves: 2 });
    l.consumir('a', 0);
    l.consumir('b', 500);
    l.consumir('a', 1_000); // a renueva su ventana (inicio 1000)
    // b vence en 1500; con el mapa lleno se purga b, no a
    expect(l.consumir('c', 1_600).permitido).toBe(true);
    expect(l.consumir('a', 1_700).permitido).toBe(false);
  });

  it('IP fuera de producción: X-Real-IP primero, luego el primer salto de X-Forwarded-For', () => {
    expect(ipCliente(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), false)).toBe('1.1.1.1');
    expect(ipCliente(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }), false)).toBe('2.2.2.2');
    expect(ipCliente(new Headers(), false)).toBe('desconocida');
  });

  it('IP en producción: solo X-Real-IP (lo fija Nginx); X-Forwarded-For no se usa', () => {
    expect(ipCliente(new Headers({ 'x-real-ip': '2001:db8::1', 'x-forwarded-for': '9.9.9.9' }), true)).toBe('2001:db8::1');
    expect(ipCliente(new Headers({ 'x-forwarded-for': '9.9.9.9' }), true)).toBe('sin-x-real-ip');
    // Valor que no es una IP: no se usa como clave
    expect(ipCliente(new Headers({ 'x-real-ip': 'abc; drop' }), true)).toBe('sin-x-real-ip');
  });

  it('enteroEnv solo acepta enteros positivos', () => {
    expect(enteroEnv('30', 5)).toBe(30);
    expect(enteroEnv('0', 5)).toBe(5);
    expect(enteroEnv('1.5', 5)).toBe(5);
    expect(enteroEnv(undefined, 5)).toBe(5);
  });
});
