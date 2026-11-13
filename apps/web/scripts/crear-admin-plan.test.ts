import { describe, expect, it } from 'vitest';
import { planearAdmin } from './crear-admin-plan';

const base = { nombre: 'Dueña', confirmarExistente: false };

describe('planearAdmin: usuario nuevo', () => {
  it('crea el usuario y la fila como administrador activo, sin segundo factor', () => {
    const p = planearAdmin({ ...base, existeEnAuth: false, filaActual: null });
    expect(p).toEqual({
      tipo: 'ok',
      crearUsuario: true,
      fijarContrasena: false,
      fila: { accion: 'insertar', valores: { role: 'admin', name: 'Dueña', is_active: true, mfa_required: false } },
      avisos: [],
    });
  });

  it('respeta --rol operator al crear', () => {
    const p = planearAdmin({ ...base, existeEnAuth: false, filaActual: null, rol: 'operator' });
    expect(p.tipo === 'ok' && p.fila.accion === 'insertar' && p.fila.valores.role).toBe('operator');
  });
});

describe('planearAdmin: el correo ya existe en Auth', () => {
  const existe = { ...base, existeEnAuth: true };

  it('exige confirmación explícita y no cambia nada sin ella', () => {
    const p = planearAdmin({ ...existe, filaActual: null });
    expect(p.tipo).toBe('error');
  });

  it('con confirmación fija la contraseña y no crea el usuario', () => {
    const p = planearAdmin({ ...existe, confirmarExistente: true, filaActual: null });
    expect(p.tipo === 'ok' && p.crearUsuario).toBe(false);
    expect(p.tipo === 'ok' && p.fijarContrasena).toBe(true);
  });

  it('no reactiva a un administrador desactivado sin --activar', () => {
    const p = planearAdmin({
      ...existe,
      confirmarExistente: true,
      filaActual: { role: 'admin', is_active: false, name: 'X', mfa_required: true },
    });
    expect(p.tipo === 'ok' && p.fila.accion).toBe('ninguna');
    expect(p.tipo === 'ok' && p.avisos.join(' ')).toMatch(/desactivado/);
  });

  it('reactiva solo con --activar', () => {
    const p = planearAdmin({
      ...existe,
      confirmarExistente: true,
      activar: true,
      filaActual: { role: 'admin', is_active: false, name: 'X', mfa_required: true },
    });
    expect(p.tipo === 'ok' && p.fila).toEqual({ accion: 'actualizar', valores: { is_active: true } });
  });

  it('no convierte a un operador en admin sin --rol', () => {
    const p = planearAdmin({
      ...existe,
      confirmarExistente: true,
      filaActual: { role: 'operator', is_active: true, name: 'Op', mfa_required: true },
    });
    expect(p.tipo === 'ok' && p.fila.accion).toBe('ninguna');
    expect(p.tipo === 'ok' && p.avisos.join(' ')).toMatch(/operator/);
  });

  it('cambia el rol solo con --rol explícito', () => {
    const p = planearAdmin({
      ...existe,
      confirmarExistente: true,
      rol: 'admin',
      filaActual: { role: 'operator', is_active: true, name: 'Op', mfa_required: true },
    });
    expect(p.tipo === 'ok' && p.fila).toEqual({ accion: 'actualizar', valores: { role: 'admin' } });
  });

  it('si no tenía fila en admin_users, la crea', () => {
    const p = planearAdmin({ ...existe, confirmarExistente: true, filaActual: null });
    expect(p.tipo === 'ok' && p.fila.accion).toBe('insertar');
  });
});
