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
  it('es estable, no distingue mayúsculas ni espacios y no contiene el correo', () => {
    const a = huellaCorreo('Dueno@Ejemplo.com ', 's1');
    expect(a).toBe(huellaCorreo('dueno@ejemplo.com', 's1'));
    expect(a).not.toContain('dueno');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('cambia con el secreto y con el correo', () => {
    expect(huellaCorreo('a@b.co', 's1')).not.toBe(huellaCorreo('a@b.co', 's2'));
    expect(huellaCorreo('a@b.co', 's1')).not.toBe(huellaCorreo('c@b.co', 's1'));
  });
});
