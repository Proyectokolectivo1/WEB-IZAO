import { describe, expect, it, vi } from 'vitest';
import { cargarContexto, type ClienteAuth } from './contexto';
import { decidirAcceso } from './decision';
import { crearMarca } from './marca-sesion';

const SECRETO = Buffer.alloc(32, 5).toString('base64');
const AHORA = 1_800_000_000_000;

function clienteSimulado(opciones: {
  usuario: { id: string; email?: string } | null;
  /** Usuario con un factor TOTP inscrito de antes (D-054): no debe cambiar nada. */
  conFactorHeredado?: boolean;
  errorUsuario?: boolean;
}): ClienteAuth {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: opciones.usuario
            ? {
                ...opciones.usuario,
                app_metadata: opciones.conFactorHeredado ? { mfa_factor_aprobado: 'factor-viejo' } : {},
              }
            : null,
        },
        error: opciones.errorUsuario ? new Error('jwt') : null,
      })),
    },
  };
}

describe('cargarContexto + decidirAcceso con mocks (solo correo y contraseña)', () => {
  it('sesión activa y vigente: permite, sin pedir ningún segundo factor', async () => {
    const marca = await crearMarca('u1', AHORA - 1000, SECRETO);
    const buscarAdmin = vi.fn(async () => ({ role: 'admin', isActive: true }));
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u1', email: 'a@b.co' } }),
      buscarAdmin,
      marca,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(buscarAdmin).toHaveBeenCalledWith('u1');
    expect(ctx.email).toBe('a@b.co');
    expect(decidirAcceso({ pathname: '/admin/productos', esApi: false, ...ctx })).toEqual({ tipo: 'permitir' });
    expect(decidirAcceso({ pathname: '/api/admin/media', esApi: true, ...ctx })).toEqual({ tipo: 'permitir' });
  });

  it('usuario con un factor TOTP inscrito de antes entra igual (no se rompe el login)', async () => {
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u1' }, conFactorHeredado: true }),
      buscarAdmin: async () => ({ role: 'admin', isActive: true }),
      marca: await crearMarca('u1', AHORA - 1000, SECRETO),
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx })).toEqual({ tipo: 'permitir' });
  });

  it('token inválido: sin sesión, no consulta admin_users', async () => {
    const buscarAdmin = vi.fn();
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: null, errorUsuario: true }),
      buscarAdmin,
      marca: undefined,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(buscarAdmin).not.toHaveBeenCalled();
    expect(ctx.sesion).toBeNull();
    expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx }).tipo).toBe('redirigir');
  });

  it('operador no entra a productos', async () => {
    const marca = await crearMarca('u2', AHORA, SECRETO);
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u2' } }),
      buscarAdmin: async () => ({ role: 'operator', isActive: true }),
      marca,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(decidirAcceso({ pathname: '/admin/productos', esApi: false, ...ctx })).toEqual({
      tipo: 'redirigir',
      destino: '/admin/sin-permiso',
    });
    expect(decidirAcceso({ pathname: '/admin/pedidos', esApi: false, ...ctx })).toEqual({ tipo: 'permitir' });
  });

  it('usuario desactivado tras iniciar sesión: pierde el acceso en la siguiente petición', async () => {
    const marca = await crearMarca('u3', AHORA, SECRETO);
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u3' } }),
      buscarAdmin: async () => ({ role: 'admin', isActive: false }),
      marca,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx })).toMatchObject({
      tipo: 'redirigir',
      cerrarSesion: true,
    });
  });

  it('marca de otro usuario: la sesión se considera no vigente', async () => {
    const marcaAjena = await crearMarca('otro', AHORA, SECRETO);
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u1' } }),
      buscarAdmin: async () => ({ role: 'admin', isActive: true }),
      marca: marcaAjena,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(ctx.sesionVigente).toBe(false);
  });

  it('marca vencida (más de 12 h): sesión expirada y cierre de sesión', async () => {
    const vieja = AHORA - 13 * 60 * 60 * 1000;
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u1' } }),
      buscarAdmin: async () => ({ role: 'admin', isActive: true }),
      marca: await crearMarca('u1', vieja, SECRETO),
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx })).toMatchObject({
      tipo: 'redirigir',
      destino: '/admin/login?error=sesion-expirada',
      cerrarSesion: true,
    });
  });
});
