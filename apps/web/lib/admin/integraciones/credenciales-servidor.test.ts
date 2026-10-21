import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import {
  byteaDesdePostgrest,
  byteaParaPostgrest,
  cifrarCredenciales,
  descifrarCredenciales,
} from '@izao/core/credentials';
import { clienteFalso } from '../crud/cliente-falso';
import {
  activarCredencialBd,
  desactivarCredencialBd,
  guardarCredencialBd,
  listarCredenciales,
  probarConexionBd,
  registrarWebhooksBd,
} from './credenciales-servidor';

const CLAVE = Buffer.alloc(32, 7).toString('base64');
const ID = '11111111-1111-4111-8111-111111111111';
const comun = { actor: 'admin-1', ip: null };

const WOMPI = {
  public_key: 'pub_test_abc123',
  private_key: 'prv_test_privada_0001',
  events_secret: 'test_events_secreto_0002',
  integrity_secret: 'test_integrity_secreto_0003',
};

async function filaCifrada(valores: Record<string, string>, extra: Record<string, unknown> = {}) {
  const c = await cifrarCredenciales(
    CLAVE,
    { provider: 'wompi', country_code: 'CO', environment: 'sandbox' },
    valores,
  );
  return {
    id: ID,
    provider: 'wompi',
    country_code: 'CO',
    environment: 'sandbox',
    data_encrypted: byteaParaPostgrest(c.data_encrypted),
    iv: byteaParaPostgrest(c.iv),
    key_version: c.key_version,
    is_active: true,
    ...extra,
  };
}

beforeEach(() => auditar.mockClear());

describe('listarCredenciales', () => {
  it('pide solo columnas públicas: nunca los bytes cifrados', async () => {
    const { cliente, llamadas } = clienteFalso({ 'integration_credentials.select': { data: [] } });
    await listarCredenciales(cliente);
    const columnas = String(llamadas[0]!.args[0]);
    expect(columnas).toContain('masked_preview');
    expect(columnas).not.toContain('data_encrypted');
    expect(columnas.split(',').map((c) => c.trim())).not.toContain('iv');
  });
});

describe('guardarCredencialBd', () => {
  it('cifra con el contexto proveedor|país|ambiente, guarda la vista enmascarada y activa la primera', async () => {
    const { cliente, llamadas } = clienteFalso({
      'integration_credentials.select': [{ data: null }, { data: [] }],
      'integration_credentials.insert': { data: { id: ID } },
      'integration_credentials.update': { data: null },
    });
    const r = await guardarCredencialBd({ cliente, ...comun, clave: CLAVE, proveedorId: 'wompi', pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/activadas/);

    const insertado = llamadas.find((l) => l.clave === 'integration_credentials.insert')!.args[0] as Record<string, unknown>;
    expect(insertado.provider).toBe('wompi');
    expect(insertado.is_active).toBe(false);
    expect(insertado.masked_preview).toMatchObject({ public_key: 'pub_test_abc123', private_key: 'prv_test_****0001' });
    // El texto plano no aparece en lo que se envía a la base.
    expect(JSON.stringify(insertado)).not.toContain('privada_0001');
    // Se descifra con el mismo contexto.
    const abierto = await descifrarCredenciales(
      CLAVE,
      { provider: 'wompi', country_code: 'CO', environment: 'sandbox' },
      {
        data_encrypted: byteaDesdePostgrest(String(insertado.data_encrypted)),
        iv: byteaDesdePostgrest(String(insertado.iv)),
        key_version: Number(insertado.key_version),
      },
    );
    expect(abierto).toEqual(WOMPI);
    // Con otro ambiente no abre (AAD).
    await expect(
      descifrarCredenciales(
        CLAVE,
        { provider: 'wompi', country_code: 'CO', environment: 'production' },
        { data_encrypted: byteaDesdePostgrest(String(insertado.data_encrypted)), iv: byteaDesdePostgrest(String(insertado.iv)) },
      ),
    ).rejects.toThrow();
    // Auditoría sin valores.
    expect(auditar).toHaveBeenCalledTimes(1);
    const e = auditar.mock.calls[0]![0] as { accion: string; diff: Record<string, unknown> };
    expect(e.accion).toBe('integracion.credencial_creada');
    expect(JSON.stringify(e)).not.toContain('privada');
    expect(e.diff.campos_cambiados).toEqual(['public_key', 'private_key', 'events_secret', 'integrity_secret']);
  });

  it('no activa sola si ya hay otra activa para ese proveedor y país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'integration_credentials.select': [{ data: null }, { data: [{ id: 'otra' }] }],
      'integration_credentials.insert': { data: { id: ID } },
    });
    const r = await guardarCredencialBd({ cliente, ...comun, clave: CLAVE, proveedorId: 'wompi', pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(r.mensaje).toMatch(/Actívalas/);
    expect(llamadas.some((l) => l.clave === 'integration_credentials.update')).toBe(false);
  });

  it('al editar con secretos en blanco conserva los guardados', async () => {
    const guardada = await filaCifrada(WOMPI);
    const { cliente, llamadas } = clienteFalso({
      'integration_credentials.select': [{ data: guardada }, { data: [{ id: ID }] }],
      'integration_credentials.update': { data: null },
    });
    const r = await guardarCredencialBd({
      cliente,
      ...comun,
      clave: CLAVE,
      proveedorId: 'wompi',
      pais: 'CO',
      ambiente: 'sandbox',
      valores: { public_key: 'pub_test_nueva999', private_key: '', events_secret: '', integrity_secret: '' },
    });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'integration_credentials.update')!.args[0] as Record<string, unknown>;
    expect(upd.last_test_ok).toBeNull();
    const abierto = await descifrarCredenciales(
      CLAVE,
      { provider: 'wompi', country_code: 'CO', environment: 'sandbox' },
      { data_encrypted: byteaDesdePostgrest(String(upd.data_encrypted)), iv: byteaDesdePostgrest(String(upd.iv)) },
    );
    expect(abierto).toEqual({ ...WOMPI, public_key: 'pub_test_nueva999' });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'integracion.credencial_actualizada' });
  });

  it('devuelve errores por campo y no escribe si faltan datos', async () => {
    const { cliente, llamadas } = clienteFalso({ 'integration_credentials.select': { data: null } });
    const r = await guardarCredencialBd({
      cliente,
      ...comun,
      clave: CLAVE,
      proveedorId: 'wompi',
      pais: 'CO',
      ambiente: 'sandbox',
      valores: { ...WOMPI, private_key: '' },
    });
    expect(r.ok).toBe(false);
    expect(r.errores?.private_key).toBeTruthy();
    expect(llamadas.some((l) => l.clave === 'integration_credentials.insert')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('rechaza proveedor desconocido, país no admitido y falta de clave de cifrado', async () => {
    const { cliente } = clienteFalso({});
    const base = { cliente, ...comun, clave: CLAVE, ambiente: 'sandbox', valores: WOMPI };
    expect((await guardarCredencialBd({ ...base, proveedorId: 'x', pais: 'CO' })).ok).toBe(false);
    const ec = await guardarCredencialBd({ ...base, proveedorId: 'wompi', pais: 'EC' });
    expect(ec.ok).toBe(false);
    expect(ec.errores?.pais).toBeTruthy();
    const sinClave = await guardarCredencialBd({ ...base, clave: undefined, proveedorId: 'wompi', pais: 'CO' });
    expect(sinClave.mensaje).toMatch(/APP_ENCRYPTION_KEY/);
  });

  it('si la clave de cifrado cambió pide escribir los secretos de nuevo', async () => {
    const guardada = await filaCifrada(WOMPI);
    const otraClave = Buffer.alloc(32, 9).toString('base64');
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: guardada } });
    const r = await guardarCredencialBd({
      cliente,
      ...comun,
      clave: otraClave,
      proveedorId: 'wompi',
      pais: 'CO',
      ambiente: 'sandbox',
      valores: { public_key: WOMPI.public_key, private_key: '', events_secret: '', integrity_secret: '' },
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/clave de cifrado/);
  });
});

describe('activar y desactivar', () => {
  const publica = {
    id: ID,
    provider: 'wompi',
    country_code: 'CO',
    environment: 'sandbox',
    is_active: false,
  };

  const ANTERIOR = '22222222-2222-4222-8222-222222222222';

  it('activa con la función atómica (sin escribir is_active desde aquí) y audita la desactivada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'integration_credentials.select': { data: publica } });
    const activar = vi.fn(async () => ({
      ok: true as const,
      estado: 'activada' as const,
      id: ID,
      provider: 'wompi',
      country_code: 'CO',
      environment: 'sandbox' as const,
      anterior_id: ANTERIOR,
      anterior_environment: 'production' as const,
    }));
    const r = await activarCredencialBd({ cliente, ...comun, id: ID, activar });
    expect(r.ok).toBe(true);
    expect(activar).toHaveBeenCalledExactlyOnceWith(ID);
    expect(llamadas.some((l) => l.clave === 'integration_credentials.update')).toBe(false);
    expect(auditar.mock.calls[0]![0]).toMatchObject({
      accion: 'integracion.credencial_activada',
      diff: { desactivada_id: ANTERIOR, desactivada_ambiente: 'production' },
    });
  });

  it('si la función falla o la credencial ya no existe, no audita', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: publica } });
    const falla = vi.fn(async () => {
      throw new Error('red');
    });
    const r1 = await activarCredencialBd({ cliente, ...comun, id: ID, activar: falla });
    expect(r1.ok).toBe(false);
    const noExiste = vi.fn(async () => ({ ok: false as const, motivo: 'no_existe' as const }));
    const r2 = await activarCredencialBd({ cliente, ...comun, id: ID, activar: noExiste });
    expect(r2).toMatchObject({ ok: false, mensaje: 'Esa credencial ya no existe.' });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si la función responde ya_activa (otra pestaña la activó), no audita', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: publica } });
    const activar = vi.fn(async () => ({
      ok: true as const,
      estado: 'ya_activa' as const,
      id: ID,
      provider: 'wompi',
      country_code: 'CO',
      environment: 'sandbox' as const,
    }));
    const r = await activarCredencialBd({ cliente, ...comun, id: ID, activar });
    expect(r.ok).toBe(true);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('una credencial ya activa no se vuelve a tocar', async () => {
    const { cliente, llamadas } = clienteFalso({ 'integration_credentials.select': { data: { ...publica, is_active: true } } });
    const r = await activarCredencialBd({ cliente, ...comun, id: ID });
    expect(r.ok).toBe(true);
    expect(llamadas.some((l) => l.clave === 'integration_credentials.update')).toBe(false);
  });

  it('desactiva y audita', async () => {
    const { cliente } = clienteFalso({
      'integration_credentials.select': { data: { ...publica, is_active: true } },
      'integration_credentials.update': { data: null },
    });
    expect((await desactivarCredencialBd({ cliente, ...comun, id: ID })).ok).toBe(true);
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'integracion.credencial_desactivada' });
  });
});

describe('probarConexionBd', () => {
  it('descifra en memoria, guarda el resultado y no filtra secretos del mensaje', async () => {
    const fila = await filaCifrada(WOMPI);
    const { cliente, llamadas } = clienteFalso({
      'integration_credentials.select': { data: fila },
      'integration_credentials.update': { data: null },
    });
    const sonda = vi.fn(async () => ({ ok: false, message: `Rechazada ${WOMPI.private_key}` }));
    const r = await probarConexionBd({ cliente, ...comun, clave: CLAVE, id: ID, sondas: { wompi: sonda } });
    expect(sonda).toHaveBeenCalledWith({ pais: 'CO', ambiente: 'sandbox', valores: WOMPI });
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain('privada_0001');
    const upd = llamadas.find((l) => l.clave === 'integration_credentials.update')!.args[0] as Record<string, unknown>;
    expect(upd.last_test_ok).toBe(false);
    expect(String(upd.last_test_message)).not.toContain('privada_0001');
    expect(JSON.stringify(auditar.mock.calls)).not.toContain('privada');
  });

  it('una prueba correcta queda guardada como correcta', async () => {
    const fila = await filaCifrada(WOMPI);
    const { cliente, llamadas } = clienteFalso({
      'integration_credentials.select': { data: fila },
      'integration_credentials.update': { data: null },
    });
    const r = await probarConexionBd({
      cliente,
      ...comun,
      clave: CLAVE,
      id: ID,
      sondas: { wompi: async () => ({ ok: true, message: 'Conexión correcta.' }) },
    });
    expect(r.ok).toBe(true);
    expect((llamadas.find((l) => l.clave === 'integration_credentials.update')!.args[0] as Record<string, unknown>).last_test_ok).toBe(true);
  });

  it('si la sonda lanza una excepción, devuelve un mensaje genérico', async () => {
    const fila = await filaCifrada(WOMPI);
    const { cliente } = clienteFalso({
      'integration_credentials.select': { data: fila },
      'integration_credentials.update': { data: null },
    });
    const r = await probarConexionBd({
      cliente,
      ...comun,
      clave: CLAVE,
      id: ID,
      sondas: {
        wompi: async () => {
          throw new Error(`boom ${WOMPI.private_key}`);
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain('boom');
  });

  it('sin clave de cifrado o con otra clave no prueba', async () => {
    const fila = await filaCifrada(WOMPI);
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: fila } });
    expect((await probarConexionBd({ cliente, ...comun, clave: undefined, id: ID, sondas: {} })).ok).toBe(false);
    const otra = Buffer.alloc(32, 9).toString('base64');
    expect((await probarConexionBd({ cliente, ...comun, clave: otra, id: ID, sondas: {} })).ok).toBe(false);
  });
});

describe('registrarWebhooksBd', () => {
  const MS = { api_key: 'llave-mastershop-secreta-9999' };
  async function filaMs() {
    const c = await cifrarCredenciales(CLAVE, { provider: 'mastershop', country_code: 'CO', environment: 'production' }, MS);
    return {
      id: ID,
      provider: 'mastershop',
      country_code: 'CO',
      environment: 'production',
      data_encrypted: byteaParaPostgrest(c.data_encrypted),
      iv: byteaParaPostgrest(c.iv),
      key_version: 1,
    };
  }

  it('registra con la llave descifrada y el ambiente de la credencial, y audita los eventos', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaMs() } });
    const registrar = vi.fn(async () => ({
      registrados: [
        { idWebhook: 16, eventName: 'creacion_pedido' },
        { idWebhook: 17, eventName: 'cambio_estado' },
      ],
    }));
    const r = await registrarWebhooksBd({ cliente, ...comun, clave: CLAVE, id: ID, modo: 'real', registrar });
    expect(registrar).toHaveBeenCalledWith(MS.api_key, 'production');
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain('creacion_pedido');
    expect(auditar.mock.calls[0]![0]).toMatchObject({
      accion: 'integracion.webhooks_registrados',
      diff: { eventos: ['creacion_pedido', 'cambio_estado'] },
    });
  });

  it('si ya estaban registrados lo dice', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaMs() } });
    const r = await registrarWebhooksBd({ cliente, ...comun, clave: CLAVE, id: ID, modo: 'real', registrar: async () => ({ registrados: [] }) });
    expect(r.mensaje).toMatch(/ya estaban/);
  });

  it('en modo mock no llama a MasterShop', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaMs() } });
    const registrar = vi.fn();
    const r = await registrarWebhooksBd({ cliente, ...comun, clave: CLAVE, id: ID, modo: 'mock', registrar });
    expect(registrar).not.toHaveBeenCalled();
    expect(r.mensaje).toMatch(/Simulación/);
  });

  it('un fallo no muestra la llave ni el secreto de la ruta', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaMs() } });
    const err = Object.assign(new Error(`rechazado ${MS.api_key} /api/webhooks/mastershop/SECRETO_DE_RUTA_123`), { name: 'MasterShopError' });
    const r = await registrarWebhooksBd({
      cliente,
      ...comun,
      clave: CLAVE,
      id: ID,
      modo: 'real',
      registrar: async () => {
        throw err;
      },
      secretosExtra: ['SECRETO_DE_RUTA_123'],
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain(MS.api_key);
    expect(r.mensaje).not.toContain('SECRETO_DE_RUTA_123');
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un error desconocido da un mensaje genérico', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaMs() } });
    const r = await registrarWebhooksBd({
      cliente,
      ...comun,
      clave: CLAVE,
      id: ID,
      modo: 'real',
      registrar: async () => {
        throw new Error('ECONNRESET 10.0.0.5');
      },
    });
    expect(r.mensaje).toBe('No se pudieron registrar los webhooks. Inténtalo de nuevo.');
  });

  it('solo aplica a MasterShop de Colombia', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await filaCifrada(WOMPI) } });
    const r = await registrarWebhooksBd({ cliente, ...comun, clave: CLAVE, id: ID, modo: 'real', registrar: async () => ({ registrados: [] }) });
    expect(r.ok).toBe(false);
  });
});
