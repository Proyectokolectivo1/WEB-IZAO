import { describe, expect, it } from 'vitest';
import { auditarMfaNoAprobada } from './mfa-no-aprobada';

describe('auditarMfaNoAprobada (una fila por usuario y ventana)', () => {
  it('la primera petición audita y las siguientes de la ventana no insertan nada', async () => {
    let filas = 0;
    const deps = {
      contar: async () => filas,
      registrar: async () => ((filas += 1), true),
    };
    for (let i = 0; i < 50; i += 1) await auditarMfaNoAprobada('u1', '203.0.113.9', deps);
    expect(filas).toBe(1);
  });

  it('si no se puede contar, no escribe', async () => {
    let filas = 0;
    await auditarMfaNoAprobada('u1', null, {
      contar: async () => null,
      registrar: async () => ((filas += 1), true),
    });
    expect(filas).toBe(0);
  });
});
