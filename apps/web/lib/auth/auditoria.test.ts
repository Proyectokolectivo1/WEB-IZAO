import { describe, expect, it } from 'vitest';
import { construirFilaAuditoria, huellaCorreo } from './auditoria';

describe('construirFilaAuditoria', () => {
  it('completa los valores por defecto', () => {
    expect(construirFilaAuditoria({ actor: 'u1', accion: 'login_exitoso' })).toEqual({
      actor: 'u1',
      action: 'login_exitoso',
      entity: 'sesion_admin',
      entity_id: null,
      diff: null,
      ip: null,
    });
  });

  it('conserva una IP válida (v4 y v6) y descarta una inválida', () => {
    expect(construirFilaAuditoria({ actor: 'a', accion: 'logout', ip: '203.0.113.9' }).ip).toBe('203.0.113.9');
    expect(construirFilaAuditoria({ actor: 'a', accion: 'logout', ip: '2001:db8::1' }).ip).toBe('2001:db8::1');
    expect(construirFilaAuditoria({ actor: 'a', accion: 'logout', ip: 'no-es-ip' }).ip).toBeNull();
    expect(construirFilaAuditoria({ actor: 'a', accion: 'logout', ip: "1.2.3.4'; drop table" }).ip).toBeNull();
  });
});

describe('huellaCorreo', () => {
  const S1 = Buffer.alloc(32, 1).toString('base64');
  const S2 = Buffer.alloc(32, 2).toString('base64');

  it('es estable, no distingue mayúsculas ni espacios y no contiene el correo', async () => {
    const a = await huellaCorreo('Dueno@Ejemplo.com ', S1);
    expect(a).toBe(await huellaCorreo('dueno@ejemplo.com', S1));
    expect(a).not.toContain('dueno');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('cambia con el secreto y con el correo', async () => {
    expect(await huellaCorreo('a@b.co', S1)).not.toBe(await huellaCorreo('a@b.co', S2));
    expect(await huellaCorreo('a@b.co', S1)).not.toBe(await huellaCorreo('c@b.co', S1));
  });

  it('rechaza una clave que no sea de 32 bytes en base64', async () => {
    await expect(huellaCorreo('a@b.co', 's1')).rejects.toThrow();
  });
});
