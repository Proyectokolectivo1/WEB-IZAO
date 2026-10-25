import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import type { Cliente } from '../catalogo/taxonomias-servidor';
import { clienteFalso, type RespuestaOLista } from '../crud/cliente-falso';
import { esquemaContrasena, esquemaEdicionUsuario, esquemaNuevoUsuario } from './usuarios';
import { crearUsuarioBd, editarUsuarioBd, listarUsuarios, reiniciarMfaBd, restablecerContrasenaBd } from './servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const CLAVE = 'una-clave-larga-123';
const comun = { actor: OTRO, ip: null };

/** Cliente con tablas falsas y una API de administración de Auth simulada. */
function conAuth(respuestas: Record<string, RespuestaOLista>, admin: Record<string, unknown> = {}) {
  const f = clienteFalso(respuestas);
  const auth = {
    admin: {
      createUser: vi.fn(async (_a: unknown) => ({ data: { user: { id: ID } }, error: null })),
      deleteUser: vi.fn(async (_id: string) => ({ error: null })),
      updateUserById: vi.fn(async (_id: string, _a: unknown) => ({ error: null })),
      getUserById: vi.fn(async (_id: string) => ({
        data: { user: { email: 'ana@izao.co', last_sign_in_at: '2026-10-20T10:00:00Z', app_metadata: { mfa_factor_aprobado: 'f1' } } },
      })),
      mfa: {
        listFactors: vi.fn(async (_a: unknown) => ({ data: { factors: [{ id: 'f1' }, { id: 'f2' }] }, error: null })),
        deleteFactor: vi.fn(async (_a: unknown) => ({ error: null })),
      },
      ...admin,
    },
  };
  return { ...f, auth, cliente: Object.assign(f.cliente as object, { auth }) as unknown as Cliente };
}

beforeEach(() => auditar.mockClear());

describe('crearUsuarioBd', () => {
  const datos = esquemaNuevoUsuario.parse({ correo: 'ana@izao.co', nombre: 'Ana', rol: 'operator', contrasena: CLAVE, confirmar: CLAVE });

  it('crea la cuenta con la ventana de MFA, inserta la fila y audita sin la contraseña', async () => {
    const { cliente, auth, llamadas } = conAuth({ 'admin_users.insert': {} });
    expect(await crearUsuarioBd({ cliente, datos, ahoraMs: Date.UTC(2026, 9, 20), ...comun })).toEqual({ ok: true, id: ID });
    const arg = auth.admin.createUser.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ email: 'ana@izao.co', email_confirm: true, app_metadata: { mfa_enrolamiento_hasta: '2026-10-21T00:00:00.000Z' } });
    expect(llamadas.find((l) => l.clave === 'admin_users.insert')!.args[0]).toEqual({
      auth_user_id: ID,
      role: 'operator',
      name: 'Ana',
      is_active: true,
      mfa_required: true,
    });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain(CLAVE);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'usuarios.creado', entidadId: ID }));
  });

  it('si falla la fila, deshace la cuenta de Auth', async () => {
    const { cliente, auth } = conAuth({ 'admin_users.insert': { error: { code: '23514', message: 'check' } } });
    const r = await crearUsuarioBd({ cliente, datos, ...comun });
    expect(r.ok).toBe(false);
    expect(auth.admin.deleteUser).toHaveBeenCalledWith(ID);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un correo que ya existe no se adopta desde el panel', async () => {
    const { cliente, llamadas } = conAuth(
      {},
      { createUser: vi.fn(async () => ({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } })) },
    );
    expect(await crearUsuarioBd({ cliente, datos, ...comun })).toMatchObject({ ok: false, errores: { correo: expect.any(String) } });
    expect(llamadas.some((l) => l.clave === 'admin_users.insert')).toBe(false);
  });
});

describe('editarUsuarioBd', () => {
  const fila = { auth_user_id: ID, role: 'admin', is_active: true, name: 'Ana' };
  const datos = () => esquemaEdicionUsuario.parse({ id: ID, nombre: 'Ana', rol: 'operator', activo: 'on' });

  it('cambia el rol de otro administrador si queda otro activo, con diff', async () => {
    const { cliente } = conAuth({ 'admin_users.select': [{ data: fila }, { count: 2 }], 'admin_users.update': {} });
    expect(await editarUsuarioBd({ cliente, datos: datos(), ...comun })).toEqual({ ok: true, id: ID });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'usuarios.actualizado', diff: { antes: { role: 'admin' }, despues: { role: 'operator' } } }),
    );
  });

  it('no deja el panel sin administradores ni deja que alguien se degrade a sí mismo', async () => {
    const solo = conAuth({ 'admin_users.select': [{ data: fila }, { count: 1 }] });
    expect(await editarUsuarioBd({ cliente: solo.cliente, datos: datos(), ...comun })).toMatchObject({
      ok: false,
      mensaje: expect.stringMatching(/al menos un administrador/),
    });
    const yo = conAuth({ 'admin_users.select': [{ data: fila }, { count: 3 }] });
    expect(await editarUsuarioBd({ cliente: yo.cliente, datos: datos(), actor: ID, ip: null })).toMatchObject({
      ok: false,
      mensaje: expect.stringMatching(/a ti mismo/),
    });
    expect(yo.llamadas.some((l) => l.clave === 'admin_users.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('contraseña y MFA', () => {
  const claveValida = () => esquemaContrasena.parse({ id: ID, contrasena: CLAVE, confirmar: CLAVE });

  it('restablecer fija la contraseña y audita solo el hecho', async () => {
    const { cliente, auth } = conAuth({ 'admin_users.select': { data: { auth_user_id: ID } } });
    expect((await restablecerContrasenaBd({ cliente, datos: claveValida(), ...comun })).ok).toBe(true);
    expect(auth.admin.updateUserById).toHaveBeenCalledWith(ID, { password: CLAVE });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain(CLAVE);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'usuarios.contrasena_restablecida' }));
  });

  it('un usuario que no es del panel no se toca', async () => {
    const { cliente, auth } = conAuth({ 'admin_users.select': { data: null } });
    expect((await restablecerContrasenaBd({ cliente, datos: claveValida(), ...comun })).ok).toBe(false);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('reiniciar el MFA borra los factores, limpia la aprobación y reabre la ventana', async () => {
    const { cliente, auth } = conAuth({ 'admin_users.select': { data: { auth_user_id: ID } } });
    expect(await reiniciarMfaBd({ cliente, id: ID, ahoraMs: Date.UTC(2026, 9, 20), ...comun })).toEqual({ ok: true, id: ID });
    expect(auth.admin.mfa.deleteFactor).toHaveBeenCalledTimes(2);
    expect(auth.admin.updateUserById).toHaveBeenCalledWith(ID, {
      app_metadata: { mfa_factor_aprobado: null, mfa_enrolamiento_hasta: '2026-10-21T00:00:00.000Z' },
    });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'usuarios.mfa_reiniciado', diff: { despues: { factores_borrados: 2 } } }));
  });
});

describe('listarUsuarios', () => {
  it('une admin_users con el correo y el estado del MFA de Auth', async () => {
    const { cliente } = conAuth({
      'admin_users.select': { data: [{ auth_user_id: ID, role: 'admin', name: 'Ana', is_active: true, created_at: '2026-10-01T00:00:00Z' }] },
    });
    expect(await listarUsuarios(cliente)).toEqual([
      { id: ID, nombre: 'Ana', rol: 'admin', activo: true, correo: 'ana@izao.co', mfaActivo: true, ultimoIngreso: '2026-10-20T10:00:00Z', creado: '2026-10-01T00:00:00Z' },
    ]);
  });
});
