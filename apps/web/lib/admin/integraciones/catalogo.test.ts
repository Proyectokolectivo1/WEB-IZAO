import { describe, expect, it } from 'vitest';
import {
  ambitosDe,
  camposDe,
  esAmbito,
  esGlobal,
  paisDb,
  mezclarConGuardados,
  proveedorPorId,
  redactarSecretos,
  validarCredencial,
  vistaPrevia,
} from './catalogo';

const wompi = proveedorPorId('wompi')!;
const mastershop = proveedorPorId('mastershop')!;
const whatsapp = proveedorPorId('whatsapp')!;

const WOMPI_SANDBOX = {
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

describe('catálogo de proveedores', () => {
  it('expone Wompi, MasterShop y WhatsApp con su esquema', () => {
    expect(proveedorPorId('wompi')?.esquema.provider).toBe('wompi');
    expect(proveedorPorId('mastershop')?.esquema.fields.map((f) => f.key)).toEqual(['api_key']);
    expect(proveedorPorId('inexistente')).toBeNull();
  });
});

describe('validarCredencial', () => {
  it('acepta credenciales correctas', () => {
    expect(validarCredencial(wompi, 'CO', 'sandbox', WOMPI_SANDBOX)).toEqual({});
    expect(validarCredencial(mastershop, 'CO', 'production', { api_key: 'llave-ms-larga-12345' })).toEqual({});
    expect(validarCredencial(whatsapp, 'EC', 'production', WA)).toEqual({});
  });

  it('rechaza país o ambiente que el proveedor no admite', () => {
    expect(validarCredencial(wompi, 'EC', 'sandbox', WOMPI_SANDBOX).pais).toBeTruthy();
    expect(validarCredencial(mastershop, 'CO', 'sandbox', { api_key: 'x'.repeat(20) }).ambiente).toBeTruthy();
    expect(validarCredencial(wompi, 'XX', 'sandbox', WOMPI_SANDBOX).pais).toBeTruthy();
  });

  it('marca los campos obligatorios vacíos sin repetir valores', () => {
    const e = validarCredencial(wompi, 'CO', 'sandbox', { ...WOMPI_SANDBOX, private_key: '' });
    expect(e.private_key).toMatch(/obligatorio/);
    expect(JSON.stringify(e)).not.toContain('prv_test');
  });

  it('Wompi: las llaves de producción no valen en sandbox', () => {
    const e = validarCredencial(wompi, 'CO', 'sandbox', { ...WOMPI_SANDBOX, public_key: 'pub_prod_abc123' });
    expect(e.public_key).toMatch(/ambiente/);
  });

  it('WhatsApp: identificadores no numéricos', () => {
    expect(validarCredencial(whatsapp, 'CO', 'production', { ...WA, phone_number_id: 'abc' })).not.toEqual({});
  });

  it('rechaza campos desconocidos', () => {
    expect(validarCredencial(mastershop, 'CO', 'production', { api_key: 'x'.repeat(20), otro: '1' }).otro).toBeTruthy();
  });
});

describe('mezclarConGuardados', () => {
  it('un secreto en blanco conserva el guardado y un campo público en blanco se vacía', () => {
    const r = mezclarConGuardados(
      whatsapp,
      { ...WA, access_token: '', graph_version: '' },
      { ...WA, graph_version: 'v25.0' },
    );
    expect(r.access_token).toBe(WA.access_token);
    expect(r.graph_version).toBeUndefined();
  });

  it('un valor nuevo reemplaza al guardado y las claves ajenas se descartan', () => {
    const r = mezclarConGuardados(mastershop, { api_key: ' nueva-llave-123456 ', basura: 'x' }, { api_key: 'vieja' });
    expect(r).toEqual({ api_key: 'nueva-llave-123456' });
  });

  it('sin guardado, el secreto en blanco queda ausente', () => {
    expect(mezclarConGuardados(mastershop, { api_key: '' }, null)).toEqual({});
  });
});

describe('vistaPrevia y redacción', () => {
  it('enmascara los secretos y deja ver los campos públicos', () => {
    const v = vistaPrevia(wompi, WOMPI_SANDBOX);
    expect(v.public_key).toBe(WOMPI_SANDBOX.public_key);
    expect(v.private_key).toBe('prv_test_****0001');
    expect(Object.values(v).join(' ')).not.toContain('privada');
  });

  it('redactarSecretos limpia cualquier secreto dentro de un texto', () => {
    const t = redactarSecretos(`Error con ${WA.access_token} y ${WA.phone_number_id}`, whatsapp, WA);
    expect(t).not.toContain(WA.access_token);
    expect(t).toContain(WA.phone_number_id);
  });
});

describe('OpenRouter (proveedor global)', () => {
  const op = proveedorPorId('openrouter')!;
  const llave = 'sk-or-v1-0123456789abcdef0123456789abcdef';

  it('es global: un solo ámbito, sin país, solo producción, con la llave como único campo secreto', () => {
    expect(esGlobal(op)).toBe(true);
    expect(ambitosDe(op)).toEqual(['global']);
    expect(op.esquema.environments).toEqual(['production']);
    expect(camposDe(op).map((c) => [c.key, c.secret, c.required])).toEqual([['api_key', true, true]]);
    expect(paisDb('global')).toBeNull();
    expect(paisDb('CO')).toBe('CO');
    expect(esAmbito('global')).toBe(true);
    expect(esAmbito('MX')).toBe(false);
  });

  it('acepta la llave en el ámbito global y rechaza países, sandbox, llaves cortas y con espacios', () => {
    expect(validarCredencial(op, 'global', 'production', { api_key: llave })).toEqual({});
    expect(validarCredencial(op, 'CO', 'production', { api_key: llave }).pais).toMatch(/global/);
    expect(validarCredencial(op, 'global', 'sandbox', { api_key: llave }).ambiente).toBeTruthy();
    expect(validarCredencial(op, 'global', 'production', { api_key: 'corta' }).api_key).toBeTruthy();
    expect(validarCredencial(op, 'global', 'production', { api_key: 'sk-or-v1-con espacio dentro 123456' }).api_key).toBeTruthy();
    expect(validarCredencial(op, 'global', 'production', {}).api_key).toBeTruthy();
  });

  it('los proveedores por país no aceptan el ámbito global', () => {
    expect(validarCredencial(proveedorPorId('mastershop')!, 'global', 'production', { api_key: llave }).pais).toBeTruthy();
  });

  it('la vista previa enmascara la llave y los mensajes la redactan', () => {
    expect(vistaPrevia(op, { api_key: llave }).api_key).toMatch(/\*{4}.{4}$/);
    expect(redactarSecretos(`error con ${llave} dentro`, op, { api_key: llave })).not.toContain(llave);
  });
});

describe('marketing: Meta Ads y píxeles (§22, §23.1)', () => {
  const casos = [
    { id: 'meta_ads', campos: [['access_token', true, true], ['ad_account_id', false, true]], ok: { access_token: 'EAAtokendeprueba1234567890', ad_account_id: 'act_1234567890' } },
    { id: 'meta_pixel', campos: [['pixel_id', false, true], ['capi_token', true, true]], ok: { pixel_id: '123456789012345', capi_token: 'EAAcapitokenprueba1234567890' } },
    { id: 'ga4', campos: [['measurement_id', false, true], ['api_secret', true, false]], ok: { measurement_id: 'G-ABC123XYZ' } },
    { id: 'tiktok_pixel', campos: [['pixel_id', false, true], ['events_api_token', true, true]], ok: { pixel_id: 'CABC123DEF456', events_api_token: 'tiktoktokenprueba1234567890' } },
  ] as const;

  it.each(casos)('$id: los campos son los de la especificación, por país y sin sandbox', ({ id, campos }) => {
    const p = proveedorPorId(id)!;
    expect(camposDe(p).map((c) => [c.key, c.secret, c.required])).toEqual(campos);
    expect(ambitosDe(p)).toEqual(['CO', 'EC']);
    expect(p.esquema.environments).toEqual(['production']);
    expect(validarCredencial(p, 'global', 'production', {}).pais).toBeTruthy();
  });

  it.each(casos)('$id: acepta valores bien formados en cada país y exige los obligatorios', ({ id, ok }) => {
    const p = proveedorPorId(id)!;
    expect(validarCredencial(p, 'CO', 'production', ok)).toEqual({});
    expect(validarCredencial(p, 'EC', 'production', ok)).toEqual({});
    expect(Object.keys(validarCredencial(p, 'CO', 'production', {})).length).toBeGreaterThan(0);
    expect(validarCredencial(p, 'CO', 'sandbox', ok).ambiente).toBeTruthy();
  });

  it('rechaza identificadores mal formados', () => {
    expect(validarCredencial(proveedorPorId('meta_ads')!, 'CO', 'production', { access_token: 'EAAx12345678901234', ad_account_id: 'cuenta' }).ad_account_id).toBeTruthy();
    expect(validarCredencial(proveedorPorId('meta_pixel')!, 'CO', 'production', { pixel_id: 'abc', capi_token: 'EAAx12345678901234' }).pixel_id).toBeTruthy();
    expect(validarCredencial(proveedorPorId('ga4')!, 'CO', 'production', { measurement_id: 'UA-123' }).measurement_id).toBeTruthy();
    expect(validarCredencial(proveedorPorId('tiktok_pixel')!, 'CO', 'production', { pixel_id: 'con espacio', events_api_token: 'tok12345678901' }).pixel_id).toBeTruthy();
    expect(validarCredencial(proveedorPorId('meta_pixel')!, 'CO', 'production', { pixel_id: '123456789', capi_token: 'tiene espacio' }).capi_token).toBeTruthy();
  });

  it('el API secret de GA4 es opcional pero secreto: no se muestra completo', () => {
    const p = proveedorPorId('ga4')!;
    expect(vistaPrevia(p, { measurement_id: 'G-ABC123XYZ', api_secret: 'secretodeprueba12345' })).toMatchObject({ measurement_id: 'G-ABC123XYZ', api_secret: expect.stringMatching(/\*{4}/) });
  });
});
