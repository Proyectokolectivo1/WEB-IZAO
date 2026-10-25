import { describe, expect, it, vi } from 'vitest';
import type { VerifiedEvent } from '@izao/core/contracts';
import type { DatosJobAddi } from '@izao/addi';
import { CREDENCIALES_ADDI_PRUEBA, callbackAddi } from '@izao/addi/mock';
import { manejarWebhookAddi, type DepsWebhookAddi } from './manejar';

const CLAVES = { usuario: CREDENCIALES_ADDI_PRUEBA.usuarioCallback, clave: CREDENCIALES_ADDI_PRUEBA.claveCallback };
const REF = 'IZ-CO-000123-A1';

function deps(o: { creds?: boolean; falloCola?: boolean; falloRegistro?: boolean; procesado?: boolean } = {}) {
  const registrados = new Map<string, VerifiedEvent>();
  const encolados: DatosJobAddi[] = [];
  const d: DepsWebhookAddi = {
    credenciales: async () => (o.creds === false ? null : CLAVES),
    registrar: async (e) => {
      if (o.falloRegistro) throw new Error('db caída');
      if (registrados.has(e.event_id)) return { procesado: o.procesado ?? false };
      registrados.set(e.event_id, e);
      return { procesado: false };
    },
    encolar: async (datos) => {
      if (o.falloCola) throw new Error('redis caído');
      encolados.push(datos);
    },
  };
  return { d, registrados, encolados };
}

function peticion(cuerpo: string, cabeceras: Record<string, string> = {}) {
  return new Request('https://izaoperfumeria.com/api/webhooks/addi', { method: 'POST', headers: cabeceras, body: cuerpo });
}

describe('POST /api/webhooks/addi (§12.3, D-031)', () => {
  it('Basic auth válida: registra, encola addi.callback y responde 200 con el mismo objeto', async () => {
    const { d, registrados, encolados } = deps();
    const { cuerpo, headers } = callbackAddi({ orderId: REF, status: 'APPROVED', approvedAmount: '220000.0' });
    const res = await manejarWebhookAddi(peticion(cuerpo, headers), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Addi deja de reintentar solo si recibe 200 con el mismo objeto.
    expect(await res.text()).toBe(cuerpo);
    const id = 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80.APPROVED.1760972400';
    expect([...registrados.keys()]).toEqual([id]);
    expect(registrados.get(id)).toMatchObject({ provider: 'addi', refs: { provider_reference: REF } });
    expect(encolados).toEqual([
      {
        event_id: id,
        callback: {
          orderId: REF,
          applicationId: 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80',
          approvedAmount: '220000.0',
          currency: 'COP',
          status: 'APPROVED',
          statusTimestamp: '1760972400',
        },
      },
    ]);
  });

  it('callback duplicado ya procesado: 200 con el mismo objeto, sin volver a encolar', async () => {
    const { d, encolados } = deps({ procesado: true });
    const { cuerpo, headers } = callbackAddi({ orderId: REF, status: 'REJECTED' });
    expect((await manejarWebhookAddi(peticion(cuerpo, headers), d)).status).toBe(200);
    const res = await manejarWebhookAddi(peticion(cuerpo, headers), d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(cuerpo);
    expect(encolados).toHaveLength(1);
  });

  it('reentrega de un evento aún sin procesar → se vuelve a encolar (el id fijo del job deduplica)', async () => {
    const { d, encolados } = deps();
    const { cuerpo, headers } = callbackAddi({ orderId: REF, status: 'PENDING' });
    await manejarWebhookAddi(peticion(cuerpo, headers), d);
    await manejarWebhookAddi(peticion(cuerpo, headers), d);
    expect(encolados).toHaveLength(2);
    expect(encolados[0]!.event_id).toBe(encolados[1]!.event_id);
  });

  it('clave o usuario equivocados, sin cabecera o esquema distinto de Basic → 401 sin registrar ni encolar', async () => {
    const { d, registrados, encolados } = deps();
    const advertencia = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const casos = [
      callbackAddi({ orderId: REF, status: 'APPROVED' }, { clave: 'otra-clave-cualquiera-0002' }),
      callbackAddi({ orderId: REF, status: 'APPROVED' }, { usuario: 'otro' }),
      { ...callbackAddi({ orderId: REF, status: 'APPROVED' }), headers: {} },
      { ...callbackAddi({ orderId: REF, status: 'APPROVED' }), headers: { authorization: `Bearer ${CLAVES.clave}` } },
    ];
    for (const c of casos) {
      const res = await manejarWebhookAddi(peticion(c.cuerpo, c.headers), d);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="izao-addi"');
      expect(await res.text()).not.toContain(CLAVES.clave);
    }
    expect(registrados.size).toBe(0);
    expect(encolados).toEqual([]);
    expect(advertencia.mock.calls.flat().join(' ')).not.toContain(CLAVES.clave);
    advertencia.mockRestore();
  });

  it('autenticado pero con cuerpo inválido → 400 sin registrar', async () => {
    const { d, registrados } = deps();
    const advertencia = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { headers } = callbackAddi({ orderId: REF, status: 'APPROVED' });
    for (const cuerpo of ['no es json', JSON.stringify({ orderId: REF, status: 'OTRO' })]) {
      expect((await manejarWebhookAddi(peticion(cuerpo, headers), d)).status).toBe(400);
    }
    expect(registrados.size).toBe(0);
    advertencia.mockRestore();
  });

  it('cuerpo demasiado grande → 413 sin leer credenciales', async () => {
    const { d } = deps();
    const credenciales = vi.spyOn(d, 'credenciales');
    const res = await manejarWebhookAddi(peticion('x'.repeat(20_000), { 'content-type': 'application/json' }), d);
    expect(res.status).toBe(413);
    expect(credenciales).not.toHaveBeenCalled();
  });

  it('sin credenciales activas, base o Redis caídos → 503 (Addi reintenta cada 30 min durante 24 h)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cuerpo, headers } = callbackAddi({ orderId: REF, status: 'APPROVED' });
    for (const o of [{ creds: false }, { falloRegistro: true }, { falloCola: true }]) {
      const { d } = deps(o);
      const res = await manejarWebhookAddi(peticion(cuerpo, headers), d);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain(REF);
    }
    error.mockRestore();
  });
});
