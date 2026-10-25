import { describe, expect, it } from 'vitest';
import { parseSistecreditoCredentials } from './credentials';
import {
  ESTADO_INTEGRACION_SISTECREDITO,
  ErrorSistecredito,
  crearCheckoutSistecredito,
  probarCredencialesSistecredito,
  verificarWebhookSistecredito,
} from './adaptador';
import { VALORES_SISTECREDITO_PRUEBA, fetchVigilado } from './mock';

function credenciales() {
  const r = parseSistecreditoCredentials(VALORES_SISTECREDITO_PRUEBA, 'sandbox');
  if (!r.ok) throw new Error('fixture inválido');
  return r.credenciales;
}

describe('adaptador de Sistecrédito sin documentación oficial (D-032)', () => {
  it('declara que la integración está pendiente de la documentación', () => {
    expect(ESTADO_INTEGRACION_SISTECREDITO).toBe('pendiente_documentacion');
  });

  it('"Probar conexión" no sale a la red y lo explica sin exponer valores', async () => {
    const vigia = fetchVigilado();
    const r = await probarCredencialesSistecredito(credenciales(), { fetchImpl: vigia.fetch });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/documentación/);
    expect(vigia.llamadas).toBe(0);
    for (const v of Object.values(VALORES_SISTECREDITO_PRUEBA)) expect(r.message).not.toContain(v);
  });

  it('crear el checkout falla de forma no reintentable y sin red', async () => {
    const vigia = fetchVigilado();
    await expect(crearCheckoutSistecredito(credenciales(), { fetchImpl: vigia.fetch })).rejects.toMatchObject({
      name: 'ErrorSistecredito',
      codigo: 'NO_VERIFICADO',
      reintentable: false,
    });
    expect(vigia.llamadas).toBe(0);
  });

  it('el webhook se rechaza siempre: sin esquema de autenticación verificado no se confía en nada', () => {
    const cuerpo = new TextEncoder().encode(JSON.stringify({ status: 'APPROVED', reference: 'IZ-CO-000123-S1' }));
    expect(verificarWebhookSistecredito(cuerpo, { authorization: 'Bearer x' })).toEqual({ ok: false, motivo: 'no_verificado' });
  });

  it('ErrorSistecredito no incluye credenciales en el mensaje', () => {
    const e = new ErrorSistecredito('NO_VERIFICADO', false);
    expect(e.message).toBe('Sistecrédito: NO_VERIFICADO');
  });
});
