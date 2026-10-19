import { describe, expect, it, vi } from 'vitest';
import { cargarContexto, type ClienteAuth } from './contexto';
import { decidirAcceso } from './decision';
import { crearMarca, crearMarcaMfa } from './marca-sesion';

const SECRETO = Buffer.alloc(32, 5).toString('base64');
const AHORA = 1_800_000_000_000;
const FACTOR = 'factor-aprobado-1';

/** Marca que solo emite el servidor tras verificar el factor aprobado. */
const mfaDe = (userId: string, factor = FACTOR) => crearMarcaMfa(userId, factor, AHORA - 500, SECRETO);

function clienteSimulado(opciones: {
  usuario: { id: string; email?: string } | null;
  /** `app_metadata.mfa_factor_aprobado` que guarda el servidor al inscribir. */
  factorAprobado?: string;
  actual?: 'aal1' | 'aal2';
  siguiente?: 'aal1' | 'aal2';
  errorUsuario?: boolean;
}): ClienteAuth {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: opciones.usuario
            ? {
                ...opciones.usuario,
                app_metadata: opciones.factorAprobado ? { mfa_factor_aprobado: opciones.factorAprobado } : {},
              }
            : null,
        },
        error: opciones.errorUsuario ? new Error('jwt') : null,
      })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: opciones.actual ?? 'aal1', nextLevel: opciones.siguiente ?? 'aal1' },
          error: null,
        })),
      },
    },
  };
}

describe('cargarContexto + decidirAcceso con mocks', () => {
  it('sesión completa, activa y vigente: permite', async () => {
    const marca = await crearMarca('u1', AHORA - 1000, SECRETO);
    const buscarAdmin = vi.fn(async () => ({ role: 'admin', isActive: true }));
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u1', email: 'a@b.co' }, actual: 'aal2', siguiente: 'aal2', factorAprobado: FACTOR }),
      marcaMfa: await mfaDe('u1'),
      buscarAdmin,
      marca,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(buscarAdmin).toHaveBeenCalledWith('u1');
    expect(ctx.email).toBe('a@b.co');
    expect(decidirAcceso({ pathname: '/admin/productos', esApi: false, ...ctx })).toEqual({ tipo: 'permitir' });
  });

  it('token inválido: sin sesión, no consulta admin_users', async () => {
    const buscarAdmin = vi.fn();
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: null, errorUsuario: true }),
      buscarAdmin,
      marca: undefined,
      marcaMfa: undefined,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(buscarAdmin).not.toHaveBeenCalled();
    expect(ctx.sesion).toBeNull();
    expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx }).tipo).toBe('redirigir');
  });

  it('operador con MFA verificado no entra a productos', async () => {
    const marca = await crearMarca('u2', AHORA, SECRETO);
    const ctx = await cargarContexto({
      supabase: clienteSimulado({ usuario: { id: 'u2' }, actual: 'aal2', siguiente: 'aal2', factorAprobado: FACTOR }),
      marcaMfa: await mfaDe('u2'),
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
      supabase: clienteSimulado({ usuario: { id: 'u3' }, actual: 'aal2', siguiente: 'aal2', factorAprobado: FACTOR }),
      marcaMfa: await mfaDe('u3'),
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
      supabase: clienteSimulado({ usuario: { id: 'u1' }, actual: 'aal2', siguiente: 'aal2', factorAprobado: FACTOR }),
      marcaMfa: await mfaDe('u1'),
      buscarAdmin: async () => ({ role: 'admin', isActive: true }),
      marca: marcaAjena,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(ctx.sesionVigente).toBe(false);
  });

  it('los niveles ausentes se interpretan como aal1 (seguro por defecto)', async () => {
    const supabase: ClienteAuth = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: null, error: new Error('x') }) },
      },
    };
    const ctx = await cargarContexto({
      supabase,
      buscarAdmin: async () => ({ role: 'admin', isActive: true }),
      marca: await crearMarca('u1', AHORA, SECRETO),
      marcaMfa: undefined,
      ahoraMs: AHORA,
      secreto: SECRETO,
    });
    expect(ctx.sesion).toMatchObject({ aal: 'aal1', siguienteNivel: 'aal1' });
  });

  describe('factor MFA aprobado (A-3)', () => {
    async function cargar(opciones: {
      factorAprobado?: string;
      marcaMfa?: string | undefined;
      actual?: 'aal1' | 'aal2';
    }) {
      return cargarContexto({
        supabase: clienteSimulado({
          usuario: { id: 'u1' },
          actual: opciones.actual ?? 'aal2',
          siguiente: 'aal2',
          ...(opciones.factorAprobado ? { factorAprobado: opciones.factorAprobado } : {}),
        }),
        buscarAdmin: async () => ({ role: 'admin', isActive: true }),
        marca: await crearMarca('u1', AHORA - 1000, SECRETO),
        marcaMfa: opciones.marcaMfa,
        ahoraMs: AHORA,
        secreto: SECRETO,
      });
    }

    it('aal2 con el factor aprobado y su marca: permite', async () => {
      const ctx = await cargar({ factorAprobado: FACTOR, marcaMfa: await mfaDe('u1') });
      expect(ctx.mfaNoAprobada).toBe(false);
      expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx })).toEqual({ tipo: 'permitir' });
    });

    it('aal2 obtenido con un factor inscrito por fuera (sin marca de MFA): se rechaza', async () => {
      const ctx = await cargar({ factorAprobado: FACTOR, marcaMfa: undefined });
      expect(ctx.mfaNoAprobada).toBe(true);
      expect(ctx.sesion).toBeNull();
      expect(decidirAcceso({ pathname: '/admin', esApi: false, ...ctx }).tipo).toBe('redirigir');
    });

    it('aal2 sin ningún factor aprobado guardado por el servidor: se rechaza', async () => {
      const ctx = await cargar({ marcaMfa: await mfaDe('u1') });
      expect(ctx.mfaNoAprobada).toBe(true);
      expect(ctx.sesion).toBeNull();
    });

    it('la marca de MFA de otro factor no sirve', async () => {
      const ctx = await cargar({ factorAprobado: FACTOR, marcaMfa: await mfaDe('u1', 'factor-ajeno') });
      expect(ctx.mfaNoAprobada).toBe(true);
    });

    it('la marca de MFA de otro usuario no sirve', async () => {
      const ctx = await cargar({ factorAprobado: FACTOR, marcaMfa: await mfaDe('otro') });
      expect(ctx.mfaNoAprobada).toBe(true);
    });

    it('en aal1 no hay nada que comprobar todavía', async () => {
      const ctx = await cargar({ actual: 'aal1', factorAprobado: FACTOR });
      expect(ctx.mfaNoAprobada).toBe(false);
      expect(ctx.sesion).toMatchObject({ aal: 'aal1' });
    });
  });
});
