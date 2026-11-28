import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCapi,
  GRAPH_VERSION_DEFECTO,
  datosUsuario,
  enviarEventosCapi,
  eventoCompra,
  normalizarCorreo,
  normalizarTelefono,
  sha256Hex,
  versionGraph,
} from './capi';
import { esPixelId, idContenido, idEventoCompra, monedaDePais, parametrosContenido, valorEvento } from './eventos';

describe('conversión de montos (solo para el evento)', () => {
  it('COP tiene exponente 0: el entero es el valor', () => {
    expect(valorEvento(90000n, 'COP')).toBe(90000);
    expect(valorEvento('1250000', 'COP')).toBe(1250000);
  });
  it('USD tiene exponente 2: pasa de centavos a decimal exacto', () => {
    expect(valorEvento(9982n, 'USD')).toBe(99.82);
    expect(valorEvento(5, 'USD')).toBe(0.05);
    expect(valorEvento(4990, 'USD')).toBe(49.9);
    expect(valorEvento(10000, 'USD')).toBe(100);
  });
  it('rechaza monedas desconocidas y montos no enteros', () => {
    expect(() => valorEvento(1n, 'EUR')).toThrow();
    expect(() => valorEvento(1.5, 'USD')).toThrow();
  });
  it('la moneda sale del país', () => {
    expect(monedaDePais('co')).toBe('COP');
    expect(monedaDePais('EC')).toBe('USD');
    expect(() => monedaDePais('pe')).toThrow();
  });
});

describe('identificadores', () => {
  it('el event_id del Purchase es determinista por pedido', () => {
    expect(idEventoCompra('IZ-CO-000123')).toBe('purchase_IZ-CO-000123');
    expect(idEventoCompra('IZ-CO-000123')).toBe(idEventoCompra('IZ-CO-000123'));
  });
  it('el id de contenido es el SKU; sin SKU, el id de la variante', () => {
    expect(idContenido(' AFN-9PM-100 ', 'v1')).toBe('AFN-9PM-100');
    expect(idContenido(null, 'v1')).toBe('v1');
    expect(idContenido('  ', 'v1')).toBe('v1');
  });
  it('Pixel ID: solo dígitos', () => {
    expect(esPixelId('123456789012345')).toBe(true);
    expect(esPixelId('12a')).toBe(false);
    expect(esPixelId("1234567');alert(1);//")).toBe(false);
    expect(esPixelId(123456)).toBe(false);
  });
});

describe('parámetros de contenido', () => {
  it('suma precio por cantidad en la moneda del país', () => {
    const p = parametrosContenido(
      [
        { id: 'A', cantidad: 2, precioUnitario: 4990 },
        { id: 'B', cantidad: 1, precioUnitario: 1000 },
      ],
      'USD',
    );
    expect(p.value).toBe(109.8);
    expect(p.currency).toBe('USD');
    expect(p.num_items).toBe(3);
    expect(p.content_ids).toEqual(['A', 'B']);
    expect(p.contents[0]).toEqual({ id: 'A', quantity: 2, item_price: 49.9 });
  });
  it('el valor del Purchase es el total del pedido, no la suma de líneas', () => {
    const p = parametrosContenido([{ id: 'A', cantidad: 1, precioUnitario: 90000 }], 'COP', 99000n);
    expect(p.value).toBe(99000);
  });
});

describe('datos de usuario con hash', () => {
  it('normaliza antes de aplicar SHA-256', () => {
    expect(normalizarCorreo('  Ana.Perez@Gmail.COM ')).toBe('ana.perez@gmail.com');
    expect(normalizarCorreo('sin-arroba')).toBeNull();
    expect(normalizarTelefono('+57 300 123 4567')).toBe('573001234567');
    expect(normalizarTelefono('0573001234567')).toBe('573001234567');
    expect(normalizarTelefono('123')).toBeNull();
  });
  it('no deja correo ni teléfono en claro', () => {
    const u = datosUsuario({ correo: 'Ana@Correo.com', telefono: '+573001234567', pais: 'CO' });
    expect(u.em).toEqual([sha256Hex('ana@correo.com')]);
    expect(u.ph).toEqual([sha256Hex('573001234567')]);
    expect(u.country).toEqual([sha256Hex('co')]);
    const texto = JSON.stringify(u);
    expect(texto).not.toContain('ana@correo');
    expect(texto).not.toContain('573001234567');
  });
  it('sin correo ni teléfono solo va el país', () => {
    expect(Object.keys(datosUsuario({ pais: 'EC' }))).toEqual(['country']);
  });
  it('SHA-256 con vector conocido', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

const evento = () =>
  eventoCompra({
    eventId: 'purchase_IZ-CO-000123',
    pagadoEn: new Date('2026-11-24T15:00:00Z'),
    correo: 'ana@correo.com',
    telefono: '+573001234567',
    pais: 'CO',
    contenido: parametrosContenido([{ id: 'SKU1', cantidad: 1, precioUnitario: 90000 }], 'COP'),
  });

describe('evento Purchase del servidor', () => {
  it('lleva el mismo event_id que el navegador y action_source website', () => {
    const e = evento();
    expect(e.event_id).toBe(idEventoCompra('IZ-CO-000123'));
    expect(e.event_name).toBe('Purchase');
    expect(e.action_source).toBe('website');
    expect(e.event_time).toBe(Math.floor(Date.parse('2026-11-24T15:00:00Z') / 1000));
    expect(e.custom_data.value).toBe(90000);
    expect(e.custom_data.currency).toBe('COP');
  });
});

describe('envío a la Graph API', () => {
  const ok = (cuerpo: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status }));

  it('envía a /{versión}/{pixel}/events con el token en el cuerpo y nunca en la URL', async () => {
    const fetchImpl = ok({ events_received: 1, fbtrace_id: 'T1' });
    const r = await enviarEventosCapi({ pixelId: '123456789', token: 'EAAsecreto123', eventos: [evento()], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ eventosRecibidos: 1, fbtraceId: 'T1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_VERSION_DEFECTO}/123456789/events`);
    expect(url).not.toContain('EAAsecreto123');
    const cuerpo = JSON.parse(String(init.body)) as { access_token: string; data: unknown[] };
    expect(cuerpo.access_token).toBe('EAAsecreto123');
    expect(cuerpo.data).toHaveLength(1);
  });

  it('un 5xx o un límite de Meta es reintentable; un token inválido no', async () => {
    const f500 = ok({ error: { message: 'boom', code: 2 } }, 500);
    await expect(enviarEventosCapi({ pixelId: '123456789', token: 't', eventos: [evento()], fetchImpl: f500 as unknown as typeof fetch })).rejects.toMatchObject({ reintentable: true });
    const f190 = ok({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
    await expect(enviarEventosCapi({ pixelId: '123456789', token: 't', eventos: [evento()], fetchImpl: f190 as unknown as typeof fetch })).rejects.toMatchObject({ reintentable: false, codigo: 190 });
  });

  it('el mensaje de error no contiene el token', async () => {
    const f = ok({ error: { message: 'Token EAAsecreto123 vencido', code: 190, fbtrace_id: 'X' } }, 400);
    const e = await enviarEventosCapi({ pixelId: '123456789', token: 'EAAsecreto123', eventos: [evento()], fetchImpl: f as unknown as typeof fetch }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorCapi);
    expect((e as ErrorCapi).message).not.toContain('EAAsecreto123');
    expect((e as ErrorCapi).fbtraceId).toBe('X');
  });

  it('un fallo de red es reintentable y no filtra la URL', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed https://graph.facebook.com/x?access_token=EAAsecreto123');
    });
    const e = await enviarEventosCapi({ pixelId: '123456789', token: 'EAAsecreto123', eventos: [evento()], fetchImpl: f as unknown as typeof fetch }).catch((x: unknown) => x);
    expect((e as ErrorCapi).reintentable).toBe(true);
    expect((e as ErrorCapi).message).not.toContain('EAAsecreto123');
  });

  it('rechaza un Pixel ID que no son dígitos y no envía nada', async () => {
    const f = ok({});
    await expect(enviarEventosCapi({ pixelId: '12/../x', token: 't', eventos: [evento()], fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(ErrorCapi);
    expect(f).not.toHaveBeenCalled();
  });

  it('la versión de la Graph API se puede cambiar por entorno, con validación', () => {
    expect(versionGraph({ META_GRAPH_VERSION: 'v27.0' } as NodeJS.ProcessEnv)).toBe('v27.0');
    expect(versionGraph({ META_GRAPH_VERSION: '../x' } as NodeJS.ProcessEnv)).toBe(GRAPH_VERSION_DEFECTO);
    expect(versionGraph({} as NodeJS.ProcessEnv)).toBe(GRAPH_VERSION_DEFECTO);
  });
});

describe('datos de usuario ampliados (calidad de coincidencia)', () => {
  it('manda nombre, apellido, ciudad y external_id con hash; fbp, fbc, IP y user-agent sin hash', () => {
    const u = datosUsuario({
      nombre: 'José Ángel',
      apellido: 'Núñez-Pérez',
      ciudad: 'Bogotá D.C.',
      externalId: 'IZ-CO-000054',
      navegador: { fbp: 'fb.1.1732400000000.123456789', fbc: 'fb.1.1732400000000.AbC_d-1', ip: '181.50.1.2', ua: 'Mozilla/5.0' },
      pais: 'CO',
    });
    expect(u.fn).toEqual([sha256Hex('joseangel')]);
    expect(u.ln).toEqual([sha256Hex('nunezperez')]);
    expect(u.ct).toEqual([sha256Hex('bogotadc')]);
    expect(u.external_id).toEqual([sha256Hex('IZ-CO-000054')]);
    expect(u.fbp).toBe('fb.1.1732400000000.123456789');
    expect(u.fbc).toBe('fb.1.1732400000000.AbC_d-1');
    expect(u.client_ip_address).toBe('181.50.1.2');
    expect(u.client_user_agent).toBe('Mozilla/5.0');
  });
  it('sin datos del navegador no incluye esos campos', () => {
    const u = datosUsuario({ correo: 'a@b.co', pais: 'CO', navegador: { fbp: null, ip: '' } });
    expect(Object.keys(u).sort()).toEqual(['country', 'em']);
  });
});
