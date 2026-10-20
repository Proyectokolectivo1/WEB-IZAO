import { describe, expect, it } from 'vitest';
import { ErrorWhatsApp, crearClienteWhatsApp, type CredencialesWhatsApp } from './cliente';
import { leerCredencialesWhatsApp, WHATSAPP_CREDENTIALS } from './credentials';
import { crearWhatsAppMock, TOKEN_PRUEBA } from './mock';
import type { MensajePlantillaMeta } from './plantillas';

const CREDS: CredencialesWhatsApp = {
  phoneNumberId: '1234567890',
  wabaId: '9876543210',
  tokenAcceso: TOKEN_PRUEBA,
  appSecret: 'app_secret_ficticio',
  tokenVerificacion: 'verificacion_ficticia',
  versionGraph: 'v26.0',
};

const MSG: MensajePlantillaMeta = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '573001234567',
  type: 'template',
  template: { name: 'cobro_abono_v1', language: { code: 'es' }, components: [] },
};

function fetchFalso(status: number, cuerpo: unknown) {
  const llamadas: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(cuerpo), { status });
  }) as typeof fetch;
  return { f, llamadas };
}

describe('cliente de la WhatsApp Cloud API', () => {
  it('envía la plantilla a /{version}/{phone_number_id}/messages con Bearer y devuelve el wamid', async () => {
    const { f, llamadas } = fetchFalso(200, { messaging_product: 'whatsapp', contacts: [{ wa_id: '573001234567' }], messages: [{ id: 'wamid.X' }] });
    const r = await crearClienteWhatsApp(CREDS, { fetchImpl: f }).enviarPlantilla(MSG);
    expect(r).toEqual({ wa_message_id: 'wamid.X' });
    expect(llamadas[0]).toMatchObject({ url: 'https://graph.facebook.com/v26.0/1234567890/messages', auth: `Bearer ${TOKEN_PRUEBA}` });
  });

  it('crea la plantilla en /{waba_id}/message_templates y devuelve id y estado', async () => {
    const { f, llamadas } = fetchFalso(200, { id: '555', status: 'PENDING', category: 'UTILITY' });
    const r = await crearClienteWhatsApp(CREDS, { fetchImpl: f }).crearPlantilla({ name: 'x_v2', language: 'es', category: 'UTILITY', components: [] });
    expect(r).toEqual({ meta_template_id: '555', status: 'PENDING' });
    expect(llamadas[0]!.url).toBe('https://graph.facebook.com/v26.0/9876543210/message_templates');
  });

  it('errores de Meta: número sin WhatsApp no se reintenta, límite y 5xx sí; nunca expone el token', async () => {
    const c = (status: number, code: number) =>
      crearClienteWhatsApp(CREDS, { fetchImpl: fetchFalso(status, { error: { message: `fallo ${TOKEN_PRUEBA}`, code, fbtrace_id: 'x' } }).f });
    const sin = await c(400, 131026).enviarPlantilla(MSG).catch((e: unknown) => e);
    expect(sin).toBeInstanceOf(ErrorWhatsApp);
    expect(sin).toMatchObject({ codigo: 'DESTINO', reintentable: false, metaCode: '131026' });
    expect(String((sin as Error).message)).not.toContain(TOKEN_PRUEBA);
    await expect(c(400, 130429).enviarPlantilla(MSG)).rejects.toMatchObject({ codigo: 'LIMITE', reintentable: true });
    await expect(c(500, 1).enviarPlantilla(MSG)).rejects.toMatchObject({ codigo: 'HTTP', reintentable: true });
    await expect(c(401, 190).enviarPlantilla(MSG)).rejects.toMatchObject({ codigo: 'CREDENCIALES', reintentable: false });
    await expect(c(400, 132001).enviarPlantilla(MSG)).rejects.toMatchObject({ codigo: 'PLANTILLA', reintentable: false });
  });

  it('versión de Graph y ids se validan antes de llamar', () => {
    expect(() => crearClienteWhatsApp({ ...CREDS, versionGraph: '26' })).toThrow(RangeError);
    expect(() => crearClienteWhatsApp({ ...CREDS, phoneNumberId: '../x' })).toThrow(RangeError);
  });
});

describe('credenciales y adaptador simulado', () => {
  it('esquema con secretos marcados y versión por defecto v26.0', () => {
    const secretos = WHATSAPP_CREDENTIALS.fields.filter((f) => f.secret).map((f) => f.key).sort();
    expect(secretos).toEqual(['access_token', 'app_secret', 'verify_token']);
    const c = leerCredencialesWhatsApp({ phone_number_id: '1234567890', waba_id: '9876543210', access_token: 't', app_secret: 's', verify_token: 'v' });
    expect(c?.versionGraph).toBe('v26.0');
    expect(leerCredencialesWhatsApp({ phone_number_id: 'x' })).toBeNull();
  });

  it('el mock registra envíos, da wamid estable y simula fallos sin credenciales reales', async () => {
    const m = crearWhatsAppMock();
    expect((await m.enviarPlantilla(MSG)).wa_message_id).toBe('wamid.mock.1');
    m.fallarCon = new ErrorWhatsApp('DESTINO', false, 400, '131026');
    await expect(m.enviarPlantilla(MSG)).rejects.toMatchObject({ codigo: 'DESTINO' });
    expect(m.enviados).toHaveLength(1);
    m.fallarCon = null;
    expect((await m.crearPlantilla({ name: 'x_v2', language: 'es', category: 'UTILITY', components: [] })).status).toBe('PENDING');
  });
});
