import { describe, expect, it } from 'vitest';
import { ErrorAddi, crearClienteAddi, probarCredencialesAddi, urlRedireccionAddiPermitida } from './cliente';
import { ADDI_ENDPOINTS } from './credentials';
import { CREDENCIALES_ADDI_PRUEBA, fetchAddiFalso, type OpcionesFetchAddi } from './mock';
import type { SolicitudAddi } from './solicitud';

const CUERPO = { orderId: 'IZ-CO-000123-A1', totalAmount: '99000.0' } as unknown as SolicitudAddi;

function cliente(o: OpcionesFetchAddi = {}, ahora = () => new Date('2026-10-21T15:00:00Z')) {
  const f = fetchAddiFalso(o);
  return { f, c: crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch, ahora }) };
}

async function error(p: Promise<unknown>): Promise<ErrorAddi> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorAddi) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

describe('cliente de Addi', () => {
  it('pide el token con client_credentials y la audiencia del ambiente, y crea la solicitud sin seguir la redirección', async () => {
    const { f, c } = cliente();
    const r = await c.crearSolicitud(CUERPO);
    expect(r.url).toBe('https://checkout.addi-staging.com/aplicacion/IZ-CO-000123-A1');
    const [auth, sol] = f.llamadas;
    expect(auth?.url).toBe('https://auth.addi-staging.com/oauth/token');
    expect(auth?.body).toEqual({
      audience: 'https://api.staging.addi.com',
      grant_type: 'client_credentials',
      client_id: CREDENCIALES_ADDI_PRUEBA.clientId,
      client_secret: CREDENCIALES_ADDI_PRUEBA.clientSecret,
    });
    expect(sol?.url).toBe('https://api.addi-staging.com/v1/online-applications');
    expect(sol?.redirect).toBe('manual');
    expect(sol?.headers.authorization).toBe('Bearer jwt-ficticio-1');
    expect(sol?.body).toEqual(CUERPO);
  });

  it('reutiliza el token mientras no venza (margen de 60 s) y pide otro al vencer', async () => {
    let t = new Date('2026-10-21T15:00:00Z').getTime();
    const { f, c } = cliente({ expiraEn: 600 }, () => new Date(t));
    await c.crearSolicitud(CUERPO);
    t += 500_000;
    await c.crearSolicitud(CUERPO);
    expect(f.tokensEmitidos).toBe(1);
    t += 50_000; // a 50 s del vencimiento: se renueva
    await c.crearSolicitud(CUERPO);
    expect(f.tokensEmitidos).toBe(2);
  });

  it('con 401 al usar el token lo renueva una vez y reintenta', async () => {
    const { f, c } = cliente({ tokenRevocadoUnaVez: true });
    const r = await c.crearSolicitud(CUERPO);
    expect(r.url).toMatch(/^https:\/\//);
    expect(f.tokensEmitidos).toBe(2);
  });

  it('409: el cliente ya tiene crédito con Addi (no reintentable)', async () => {
    const e = await error(cliente({ solicitud: 'conflicto' }).c.crearSolicitud(CUERPO));
    expect([e.codigo, e.reintentable, e.status]).toEqual(['CLIENTE_CON_CREDITO', false, 409]);
  });

  it('400 validación (no reintentable), 5xx y red (reintentables)', async () => {
    expect((await error(cliente({ solicitud: 'validacion' }).c.crearSolicitud(CUERPO))).codigo).toBe('VALIDACION');
    const caida = await error(cliente({ solicitud: 'caida' }).c.crearSolicitud(CUERPO));
    expect([caida.codigo, caida.reintentable]).toEqual(['HTTP', true]);
    const red = await error(cliente({ solicitud: 'red' }).c.crearSolicitud(CUERPO));
    expect([red.codigo, red.reintentable]).toEqual(['RED', true]);
  });

  it('redirección sin Location o a http: respuesta inválida', async () => {
    expect((await error(cliente({ solicitud: 'sin_location' }).c.crearSolicitud(CUERPO))).codigo).toBe('RESPUESTA_INVALIDA');
    expect((await error(cliente({ solicitud: 'location_http' }).c.crearSolicitud(CUERPO))).codigo).toBe('RESPUESTA_INVALIDA');
  });

  it('credenciales malas: CREDENCIALES, y el mensaje no incluye el secreto', async () => {
    const f = fetchAddiFalso();
    const c = crearClienteAddi({ credenciales: { ...CREDENCIALES_ADDI_PRUEBA, clientSecret: 'otro-secreto-ficticio-123' }, fetchImpl: f.fetch });
    const e = await error(c.crearSolicitud(CUERPO));
    expect(e.codigo).toBe('CREDENCIALES');
    expect(e.message).not.toContain('otro-secreto');
  });

  it('probarCredencialesAddi: ok con credenciales válidas; mensaje amable si fallan', async () => {
    expect(await probarCredencialesAddi(CREDENCIALES_ADDI_PRUEBA, { fetchImpl: fetchAddiFalso().fetch })).toEqual({
      ok: true,
      message: 'Conexión con Addi verificada.',
    });
    const mal = await probarCredencialesAddi(
      { ...CREDENCIALES_ADDI_PRUEBA, clientId: 'otro' },
      { fetchImpl: fetchAddiFalso().fetch },
    );
    expect(mal.ok).toBe(false);
    expect(mal.message).toBe('Addi rechazó el client ID o el client secret.');
  });
});

describe('Location de Addi limitada a sus dominios por ambiente', () => {
  it('los dominios permitidos vienen de la configuración del ambiente', () => {
    expect(ADDI_ENDPOINTS.sandbox.dominiosRedireccion.length).toBeGreaterThan(0);
    expect(ADDI_ENDPOINTS.production.dominiosRedireccion).toEqual(['addi.com']);
  });

  it.each([
    ['https://checkout.addi-staging.com/aplicacion/x', true],
    ['https://addi.com/x', true],
    ['https://co.addi.com/x?y=1', true],
    ['https://evil.example.com/x', false],
    ['https://addi.com.evil.example/x', false],
    ['https://evilAddi.com/x', false],
    ['https://user:pw@checkout.addi.com/x', false],
    ['https://checkout.addi.com:8443/x', false],
    ['http://checkout.addi.com/x', false],
    ['javascript:alert(1)', false],
    ['', false],
  ])('%s → %s (sandbox)', (url, ok) => {
    expect(urlRedireccionAddiPermitida(url, ADDI_ENDPOINTS.sandbox.dominiosRedireccion)).toBe(ok);
  });

  it('producción no acepta el dominio de staging', () => {
    expect(urlRedireccionAddiPermitida('https://checkout.addi-staging.com/x', ADDI_ENDPOINTS.production.dominiosRedireccion)).toBe(false);
  });

  it('una Location fuera de los dominios de Addi → RESPUESTA_INVALIDA (no se entrega al navegador)', async () => {
    const { c } = cliente({ location: () => 'https://phishing.example.com/addi' });
    const e = await error(c.crearSolicitud(CUERPO));
    expect(e.codigo).toBe('RESPUESTA_INVALIDA');
    expect(e.reintentable).toBe(false);
  });

  it('los dominios se pueden fijar por opción (configuración por ambiente)', async () => {
    const f = fetchAddiFalso();
    const c = crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch, dominiosRedireccion: ['addi.com'] });
    expect((await error(c.crearSolicitud(CUERPO))).codigo).toBe('RESPUESTA_INVALIDA');
  });
});

describe('caché del token de Addi entre clientes', () => {
  it('dos clientes con las mismas credenciales y transporte comparten el token vigente', async () => {
    const f = fetchAddiFalso();
    const ahora = () => new Date('2026-10-21T15:00:00Z');
    await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch, ahora }).crearSolicitud(CUERPO);
    await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch, ahora }).crearSolicitud(CUERPO);
    expect(f.tokensEmitidos).toBe(1);
  });

  it('peticiones simultáneas piden un solo token', async () => {
    const f = fetchAddiFalso();
    const c = () => crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch });
    await Promise.all([c().crearSolicitud(CUERPO), c().crearSolicitud(CUERPO), c().crearSolicitud(CUERPO)]);
    expect(f.tokensEmitidos).toBe(1);
  });

  it('otro secreto (rotación de credenciales) no reutiliza el token anterior', async () => {
    const f = fetchAddiFalso();
    await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch }).verificarToken();
    const otras = { ...CREDENCIALES_ADDI_PRUEBA, clientSecret: `${CREDENCIALES_ADDI_PRUEBA.clientSecret}-rotado` };
    await crearClienteAddi({ credenciales: otras, fetchImpl: f.fetch }).verificarToken().catch(() => undefined);
    expect(f.llamadas.filter((l) => l.url.endsWith('/oauth/token'))).toHaveLength(2);
  });

  it('un 401 en un cliente invalida el token compartido', async () => {
    const f = fetchAddiFalso({ tokenRevocadoUnaVez: true });
    await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch }).crearSolicitud(CUERPO);
    expect(f.tokensEmitidos).toBe(2);
    const sol = await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch }).crearSolicitud(CUERPO);
    expect(sol.url).toMatch(/^https:\/\//);
    expect(f.tokensEmitidos).toBe(2);
    expect(f.llamadas.at(-1)?.headers.authorization).toBe('Bearer jwt-ficticio-2');
  });

  it('un token no se comparte entre ambientes', async () => {
    const f = fetchAddiFalso();
    await crearClienteAddi({ credenciales: CREDENCIALES_ADDI_PRUEBA, fetchImpl: f.fetch }).verificarToken();
    await crearClienteAddi({ credenciales: { ...CREDENCIALES_ADDI_PRUEBA, ambiente: 'production' }, fetchImpl: f.fetch })
      .verificarToken()
      .catch(() => undefined);
    expect(f.llamadas.filter((l) => l.url.endsWith('/oauth/token')).map((l) => l.url)).toEqual([
      'https://auth.addi-staging.com/oauth/token',
      'https://auth.addi.com/oauth/token',
    ]);
  });
});
