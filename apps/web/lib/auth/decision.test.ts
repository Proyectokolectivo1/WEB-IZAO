import { describe, expect, it } from 'vitest';
import {
  decidirAcceso,
  rutaSiguienteSegura,
  type AdminInfo,
  type EntradaDecision,
  type SesionAuth,
} from './decision';

const completa: SesionAuth = { userId: 'u1' };

const admin: AdminInfo = { role: 'admin', isActive: true };
const operador: AdminInfo = { role: 'operator', isActive: true };

function entrada(parcial: Partial<EntradaDecision>): EntradaDecision {
  return {
    pathname: '/admin',
    esApi: false,
    sesion: completa,
    admin,
    sesionVigente: true,
    ...parcial,
  };
}

describe('sin sesión', () => {
  it('redirige al login con el destino pedido', () => {
    expect(decidirAcceso(entrada({ sesion: null, admin: null, pathname: '/admin/pedidos?estado=pagado' })))
      .toEqual({ tipo: 'redirigir', destino: '/admin/login?siguiente=%2Fadmin%2Fpedidos%3Festado%3Dpagado' });
  });

  it('desde el inicio redirige al login sin parámetros', () => {
    expect(decidirAcceso(entrada({ sesion: null, admin: null }))).toEqual({
      tipo: 'redirigir',
      destino: '/admin/login',
    });
  });

  it('la pantalla de login es pública', () => {
    expect(decidirAcceso(entrada({ sesion: null, admin: null, pathname: '/admin/login' }))).toEqual({
      tipo: 'permitir',
    });
  });

  it('la API responde 401 en lugar de redirigir', () => {
    expect(
      decidirAcceso(entrada({ sesion: null, admin: null, esApi: true, pathname: '/api/admin/x' })),
    ).toEqual({ tipo: 'rechazar', status: 401, motivo: 'sin-sesion' });
  });
});

describe('vigencia de 12 h', () => {
  it('con la marca vencida cierra la sesión y avisa', () => {
    const d = decidirAcceso(entrada({ sesionVigente: false, pathname: '/admin/pedidos' }));
    expect(d).toEqual({
      tipo: 'redirigir',
      destino: '/admin/login?error=sesion-expirada&siguiente=%2Fadmin%2Fpedidos',
      cerrarSesion: true,
    });
  });

  it('con la marca vencida la API responde 401', () => {
    expect(decidirAcceso(entrada({ sesionVigente: false, esApi: true }))).toMatchObject({
      tipo: 'rechazar',
      status: 401,
    });
  });

  it('el login no redirige al inicio si la marca venció', () => {
    expect(decidirAcceso(entrada({ sesionVigente: false, pathname: '/admin/login' }))).toEqual({
      tipo: 'permitir',
    });
  });
});

describe('usuario en admin_users', () => {
  it('sin fila: cierra la sesión y vuelve al login', () => {
    expect(decidirAcceso(entrada({ admin: null }))).toEqual({
      tipo: 'redirigir',
      destino: '/admin/login?error=sin-acceso',
      cerrarSesion: true,
    });
  });

  it('usuario inactivo: cierra la sesión y vuelve al login', () => {
    expect(decidirAcceso(entrada({ admin: { role: 'admin', isActive: false } }))).toEqual({
      tipo: 'redirigir',
      destino: '/admin/login?error=sin-acceso',
      cerrarSesion: true,
    });
  });

  it('rol desconocido: se trata como sin acceso', () => {
    expect(decidirAcceso(entrada({ admin: { role: 'dios', isActive: true } }))).toMatchObject({
      tipo: 'redirigir',
      cerrarSesion: true,
    });
  });

  it('en la API responde 403', () => {
    expect(
      decidirAcceso(entrada({ admin: { role: 'admin', isActive: false }, esApi: true })),
    ).toEqual({ tipo: 'rechazar', status: 403, motivo: 'sin-acceso' });
  });

  it('un inactivo con sesión completa no es redirigido desde el login al inicio', () => {
    expect(
      decidirAcceso(entrada({ pathname: '/admin/login', admin: { role: 'admin', isActive: false } })),
    ).toEqual({ tipo: 'permitir' });
  });
});

describe('sin segundo factor (D-054)', () => {
  it('con sesión, usuario activo y marca vigente, el panel se permite sin pantallas intermedias', () => {
    expect(decidirAcceso(entrada({ pathname: '/admin/pedidos' }))).toEqual({ tipo: 'permitir' });
    expect(decidirAcceso(entrada({ esApi: true, pathname: '/api/admin/x' }))).toEqual({ tipo: 'permitir' });
  });

  it('las rutas de MFA ya no existen: un marcador viejo lleva al inicio, y sin sesión al login', () => {
    for (const pathname of ['/admin/mfa/verificar', '/admin/mfa/inscribir']) {
      expect(decidirAcceso(entrada({ pathname })), pathname).toEqual({ tipo: 'redirigir', destino: '/admin' });
      expect(decidirAcceso(entrada({ pathname, sesion: null, admin: null }))).toMatchObject({ tipo: 'redirigir' });
    }
  });

  it('el login no vuelve a las pantallas de MFA retiradas', () => {
    expect(rutaSiguienteSegura('/admin/mfa/verificar')).toBe('/admin');
    expect(rutaSiguienteSegura('/admin/mfa/inscribir?x=1')).toBe('/admin');
  });

  it('con sesión, el login lleva al inicio', () => {
    expect(decidirAcceso(entrada({ pathname: '/admin/login' }))).toEqual({ tipo: 'redirigir', destino: '/admin' });
  });

  it('el rol de operador sigue limitado por módulo', () => {
    expect(decidirAcceso(entrada({ admin: operador, pathname: '/admin/pedidos' }))).toEqual({ tipo: 'permitir' });
    expect(decidirAcceso(entrada({ admin: operador, pathname: '/admin/productos' }))).toEqual({
      tipo: 'redirigir',
      destino: '/admin/sin-permiso',
    });
  });
});

describe('rol y módulo (activo, vigente)', () => {
  it('el administrador entra a todo, incluidas rutas futuras', () => {
    for (const pathname of ['/admin', '/admin/pedidos', '/admin/productos', '/admin/usuarios', '/admin/modulo-futuro']) {
      expect(decidirAcceso(entrada({ pathname })), pathname).toEqual({ tipo: 'permitir' });
    }
  });

  it('el operador entra a pedidos, garantías, agente e inicio', () => {
    for (const pathname of ['/admin', '/admin/pedidos', '/admin/pedidos/IZ-CO-000001', '/admin/garantias', '/admin/agente-impresion', '/admin/sin-permiso']) {
      expect(decidirAcceso(entrada({ admin: operador, pathname })), pathname).toEqual({ tipo: 'permitir' });
    }
  });

  it('el operador no entra a los demás módulos: lo lleva a "sin permiso"', () => {
    for (const pathname of ['/admin/productos', '/admin/usuarios', '/admin/integraciones', '/admin/metricas', '/admin/clientes', '/admin/modulo-futuro']) {
      expect(decidirAcceso(entrada({ admin: operador, pathname })), pathname).toEqual({
        tipo: 'redirigir',
        destino: '/admin/sin-permiso',
      });
    }
  });

  it('la API responde 403 al operador fuera de su alcance y deja pasar lo suyo', () => {
    expect(decidirAcceso(entrada({ admin: operador, esApi: true, pathname: '/api/admin/usuarios' }))).toEqual({
      tipo: 'rechazar',
      status: 403,
      motivo: 'sin-permiso',
    });
    expect(decidirAcceso(entrada({ admin: operador, esApi: true, pathname: '/api/admin/pedidos/1' }))).toEqual({
      tipo: 'permitir',
    });
  });

  it('el operador no esquiva el permiso con la consulta ni con barras finales', () => {
    expect(decidirAcceso(entrada({ admin: operador, pathname: '/admin/usuarios/?x=/admin/pedidos' }))).toMatchObject({
      tipo: 'redirigir',
      destino: '/admin/sin-permiso',
    });
  });
});

describe('rutaSiguienteSegura', () => {
  it('acepta rutas internas del panel, con consulta', () => {
    expect(rutaSiguienteSegura('/admin/pedidos')).toBe('/admin/pedidos');
    expect(rutaSiguienteSegura('/admin/pedidos?estado=pagado&pagina=2')).toBe('/admin/pedidos?estado=pagado&pagina=2');
  });

  it('rechaza todo lo que no sea una ruta interna de /admin', () => {
    for (const malo of [
      'https://malo.com',
      '//malo.com',
      '/admin//malo.com',
      '/admin/../etc/passwd',
      '/tienda',
      '/admin\\malo',
      'javascript:alert(1)',
      '/admin/pedidos?x=<script>',
      '',
      null,
      undefined,
    ]) {
      expect(rutaSiguienteSegura(malo as string | null | undefined), String(malo)).toBe('/admin');
    }
  });

  it('no vuelve a las pantallas de acceso', () => {
    expect(rutaSiguienteSegura('/admin/login')).toBe('/admin');
  });
});
