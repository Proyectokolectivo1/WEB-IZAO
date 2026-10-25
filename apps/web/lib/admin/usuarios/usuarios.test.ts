import { describe, expect, it } from 'vitest';
import { esquemaContrasena, esquemaEdicionUsuario, esquemaNuevoUsuario, validarCambioUsuario } from './usuarios';

const ID = '11111111-1111-4111-8111-111111111111';
const CLAVE = 'una-clave-larga-123';

describe('esquemaNuevoUsuario', () => {
  const base = { correo: ' Ana@Izao.CO ', nombre: ' Ana Pérez ', rol: 'operator', contrasena: CLAVE, confirmar: CLAVE };

  it('normaliza correo y nombre y no devuelve la confirmación', () => {
    const d = esquemaNuevoUsuario.parse(base);
    expect(d).toEqual({ correo: 'ana@izao.co', nombre: 'Ana Pérez', rol: 'operator', contrasena: CLAVE });
    expect(d).not.toHaveProperty('confirmar');
  });

  it('rechaza contraseñas cortas, largas o distintas, roles inventados y correos malos', () => {
    expect(esquemaNuevoUsuario.safeParse({ ...base, contrasena: 'corta', confirmar: 'corta' }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, contrasena: 'x'.repeat(73), confirmar: 'x'.repeat(73) }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, confirmar: 'otra-clave-larga-1' }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, rol: 'superadmin' }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, correo: 'no-es-correo' }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, nombre: ' ' }).success).toBe(false);
  });
});

describe('edición y contraseña', () => {
  it('lee la casilla de activo', () => {
    expect(esquemaEdicionUsuario.parse({ id: ID, nombre: 'Ana', rol: 'admin', activo: 'on' }).activo).toBe(true);
    expect(esquemaEdicionUsuario.parse({ id: ID, nombre: 'Ana', rol: 'admin' }).activo).toBe(false);
    expect(esquemaEdicionUsuario.safeParse({ id: 'x', nombre: 'Ana', rol: 'admin' }).success).toBe(false);
  });

  it('el cambio de contraseña exige confirmación', () => {
    expect(esquemaContrasena.parse({ id: ID, contrasena: CLAVE, confirmar: CLAVE })).toEqual({ id: ID, contrasena: CLAVE });
    expect(esquemaContrasena.safeParse({ id: ID, contrasena: CLAVE, confirmar: '' }).success).toBe(false);
  });
});

describe('validarCambioUsuario', () => {
  const admin = { id: ID, rol: 'admin' as const, activo: true };

  it('nadie se quita a sí mismo el rol ni se desactiva', () => {
    expect(validarCambioUsuario({ actorId: ID, antes: admin, despues: { rol: 'operator', activo: true }, adminsActivos: 3 }).ok).toBe(false);
    expect(validarCambioUsuario({ actorId: ID, antes: admin, despues: { rol: 'admin', activo: false }, adminsActivos: 3 }).ok).toBe(false);
    expect(validarCambioUsuario({ actorId: ID, antes: admin, despues: { rol: 'admin', activo: true }, adminsActivos: 1 }).ok).toBe(true);
  });

  it('siempre queda al menos un administrador activo', () => {
    expect(validarCambioUsuario({ actorId: 'otro', antes: admin, despues: { rol: 'operator', activo: true }, adminsActivos: 1 }).ok).toBe(false);
    expect(validarCambioUsuario({ actorId: 'otro', antes: admin, despues: { rol: 'admin', activo: false }, adminsActivos: 1 }).ok).toBe(false);
    expect(validarCambioUsuario({ actorId: 'otro', antes: admin, despues: { rol: 'operator', activo: true }, adminsActivos: 2 }).ok).toBe(true);
  });

  it('cambiar a un operador no afecta la regla', () => {
    const op = { id: 'op', rol: 'operator' as const, activo: true };
    expect(validarCambioUsuario({ actorId: ID, antes: op, despues: { rol: 'operator', activo: false }, adminsActivos: 1 }).ok).toBe(true);
    expect(validarCambioUsuario({ actorId: ID, antes: op, despues: { rol: 'admin', activo: true }, adminsActivos: 1 }).ok).toBe(true);
  });
});
