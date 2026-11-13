import { beforeEach, describe, expect, it, vi } from 'vitest';

const orden: string[] = [];
const borradas: string[] = [];
const redirecciones: string[] = [];
let usuario: { id: string } | null = { id: 'usuario-1' };

vi.mock('next/headers', () => ({
  cookies: async () => ({ delete: (nombre: string) => void borradas.push(nombre) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirecciones.push(destino);
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/auth/auditoria', () => ({
  registrarAuditoria: async (e: { accion: string; actor: string }) => void orden.push(`auditoria:${e.accion}:${e.actor}`),
}));
vi.mock('@/lib/auth/cabeceras', () => ({ ipDelCliente: async () => '127.0.0.1' }));
vi.mock('@/lib/auth/supabase/servidor', () => ({
  crearClienteServidor: async () => ({
    auth: {
      getUser: async () => ({ data: { user: usuario } }),
      signOut: async (o: unknown) => void orden.push(`signOut:${JSON.stringify(o)}`),
    },
  }),
}));

import { cerrarSesion } from './acciones';
import { NOMBRE_COOKIE_MARCA } from '@/lib/auth/marca-sesion';
import { RUTA_LOGIN, RUTA_TRAS_CIERRE } from '@/lib/auth/decision';

describe('cerrarSesion (cierre voluntario del panel)', () => {
  beforeEach(() => {
    orden.length = 0;
    borradas.length = 0;
    redirecciones.length = 0;
    usuario = { id: 'usuario-1' };
  });

  it('el destino es la home pública relativa, no el login ni un país fijo ni una URL absoluta', () => {
    expect(RUTA_TRAS_CIERRE).toBe('/');
    expect(RUTA_TRAS_CIERRE).not.toBe(RUTA_LOGIN);
  });

  it('audita, cierra la sesión local, borra la cookie de marca (y la de MFA que pudo quedar) y redirige a la home', async () => {
    await expect(cerrarSesion()).rejects.toThrow('NEXT_REDIRECT');
    expect(orden).toEqual(['auditoria:logout:usuario-1', 'signOut:{"scope":"local"}']);
    expect(borradas.sort()).toEqual([NOMBRE_COOKIE_MARCA, 'izao_admin_mfa'].sort());
    expect(redirecciones).toEqual(['/']);
  });

  it('sin sesión activa igual limpia y redirige a la home, sin auditar', async () => {
    usuario = null;
    await expect(cerrarSesion()).rejects.toThrow('NEXT_REDIRECT');
    expect(orden).toEqual(['signOut:{"scope":"local"}']);
    expect(redirecciones).toEqual(['/']);
  });
});
