import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El panel entra solo con correo y contraseña (D-054): tras autenticar se va directo al destino, sin consultar el
 * nivel de MFA de Supabase ni pasar por pantallas intermedias. Se mantiene el resto del control: límite de intentos,
 * usuario activo con rol válido y auditoría.
 */
const redirecciones: string[] = [];
const auditoria: string[] = [];
const cookiesFijadas: string[] = [];
let respuestaLogin: { data: { user: { id: string } | null }; error: unknown } = { data: { user: { id: 'u1' } }, error: null };
let admin: { role: string; isActive: boolean; name: string } | null = { role: 'admin', isActive: true, name: 'Dueña' };
let bloqueo: { estado: 'permitido' } | { estado: 'bloqueado'; por: string } = { estado: 'permitido' };
const { cerrarLocal, mfaLlamado } = vi.hoisted(() => ({ cerrarLocal: vi.fn(async () => {}), mfaLlamado: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: async () => ({ set: (n: string) => void cookiesFijadas.push(n) }) }));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirecciones.push(destino);
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/auth/cerrar-sesion', () => ({ cerrarSesionLocal: cerrarLocal }));
vi.mock('@/lib/auth/admin-users', () => ({ buscarAdminPorId: async () => admin }));
vi.mock('@/lib/auth/auditoria', () => ({
  contarEventos: async () => 0,
  contarNetos: async () => 0,
  huellaDeCorreo: async () => 'huella',
  registrarAuditoria: async (e: { accion: string }) => void auditoria.push(e.accion),
  registrarEvento: async () => true,
}));
vi.mock('@/lib/auth/bloqueo', () => ({
  evaluarIntento: async () => bloqueo,
  registrarUnaVez: async () => {},
}));
vi.mock('@/lib/auth/cabeceras', () => ({ ipDelCliente: async () => '127.0.0.1' }));
vi.mock('@/lib/auth/captcha', () => ({ esErrorCaptcha: () => false, opcionesCaptcha: () => ({}) }));
vi.mock('@/lib/auth/env', () => ({ esProduccion: () => false, secretoSesion: () => Buffer.alloc(32, 7).toString('base64') }));
vi.mock('@/lib/auth/supabase/servidor', () => ({
  crearClienteServidor: async () => ({
    auth: {
      signInWithPassword: async () => respuestaLogin,
      mfa: { getAuthenticatorAssuranceLevel: mfaLlamado },
    },
  }),
}));

import { iniciarSesion } from './actions';

function formulario(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set('correo', 'duena@izao.co');
  f.set('contrasena', 'una-clave-larga-123');
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

beforeEach(() => {
  redirecciones.length = 0;
  auditoria.length = 0;
  cookiesFijadas.length = 0;
  cerrarLocal.mockClear();
  mfaLlamado.mockClear();
  respuestaLogin = { data: { user: { id: 'u1' } }, error: null };
  admin = { role: 'admin', isActive: true, name: 'Dueña' };
  bloqueo = { estado: 'permitido' };
});

describe('iniciarSesion sin segundo factor', () => {
  it('con correo y contraseña correctos entra directo al inicio, sin pedir MFA', async () => {
    await expect(iniciarSesion({}, formulario())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirecciones).toEqual(['/admin']);
    expect(mfaLlamado).not.toHaveBeenCalled();
    expect(cookiesFijadas).toEqual(['izao_admin_inicio']);
    expect(auditoria).toContain('login_exitoso');
  });

  it('respeta el destino pedido si es una ruta interna del panel', async () => {
    await expect(iniciarSesion({}, formulario({ siguiente: '/admin/pedidos?estado=pagado' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(redirecciones).toEqual(['/admin/pedidos?estado=pagado']);
  });

  it('un destino externo o de una pantalla de MFA retirada cae en el inicio', async () => {
    for (const siguiente of ['https://malo.example/x', '//malo.example', '/admin/mfa/verificar']) {
      redirecciones.length = 0;
      await expect(iniciarSesion({}, formulario({ siguiente }))).rejects.toThrow('NEXT_REDIRECT');
      expect(redirecciones, siguiente).toEqual(['/admin']);
    }
  });

  it('un usuario que tenía un autenticador inscrito de antes entra igual (la respuesta de Supabase no se consulta)', async () => {
    await expect(iniciarSesion({}, formulario())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirecciones).toEqual(['/admin']);
  });

  it('contraseña incorrecta: mensaje genérico, sin sesión ni cookie', async () => {
    respuestaLogin = { data: { user: null }, error: new Error('invalid') };
    const r = await iniciarSesion({}, formulario());
    expect(r.error).toBe('El correo o la contraseña no son correctos.');
    expect(redirecciones).toEqual([]);
    expect(cookiesFijadas).toEqual([]);
    expect(auditoria).toContain('login_fallido');
  });

  it('el control de acceso sigue: usuario inactivo o sin fila en admin_users no entra y se cierra la sesión', async () => {
    admin = { role: 'admin', isActive: false, name: 'X' };
    expect((await iniciarSesion({}, formulario())).error).toMatch(/no tiene acceso/);
    admin = null;
    expect((await iniciarSesion({}, formulario())).error).toMatch(/no tiene acceso/);
    expect(cerrarLocal).toHaveBeenCalledTimes(2);
    expect(redirecciones).toEqual([]);
    expect(auditoria.filter((a) => a === 'login_denegado')).toHaveLength(2);
  });

  it('el límite de intentos sigue: bloqueado no llega a autenticar', async () => {
    bloqueo = { estado: 'bloqueado', por: 'correo' };
    const r = await iniciarSesion({}, formulario());
    expect(r.error).toMatch(/demasiados intentos/);
    expect(redirecciones).toEqual([]);
    expect(cookiesFijadas).toEqual([]);
  });
});
