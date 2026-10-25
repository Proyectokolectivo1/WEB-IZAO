import { describe, expect, it } from 'vitest';
import {
  ACCIONES,
  MODULOS,
  modulosVisibles,
  moduloDeRuta,
  puede,
  puedeAccederModulo,
  puedeVerRuta,
  type AccionId,
  type ModuloId,
} from './permissions';

/** Matriz literal de §24.3: lo que cada rol puede hacer. */
const MODULOS_OPERADOR: ModuloId[] = ['inicio', 'pedidos', 'garantias', 'agente'];

describe('permisos por módulo (§24.3)', () => {
  it('el administrador accede a todos los módulos', () => {
    for (const id of Object.keys(MODULOS) as ModuloId[]) {
      expect(puedeAccederModulo('admin', id), id).toBe(true);
    }
  });

  it('el operador solo accede a pedidos, garantías y agente de impresión (más el inicio)', () => {
    for (const id of Object.keys(MODULOS) as ModuloId[]) {
      expect(puedeAccederModulo('operator', id), id).toBe(MODULOS_OPERADOR.includes(id));
    }
  });

  it('un rol ausente o desconocido no accede a nada', () => {
    expect(puedeAccederModulo(null, 'inicio')).toBe(false);
    expect(puedeAccederModulo(undefined, 'pedidos')).toBe(false);
    expect(puedeAccederModulo('superusuario' as never, 'pedidos')).toBe(false);
  });
});

describe('permisos por acción (§24.3)', () => {
  const soloAdmin: AccionId[] = [
    'pedidos.cancelar',
    'pedidos.marcar_pagado',
    'clientes.gestionar',
    'catalogo.gestionar',
    'catalogo.importar',
    'contenido.gestionar',
    'whatsapp.plantillas',
    'integraciones.gestionar',
    'pagos.gestionar',
    'agente.gestionar',
  ];

  it('cancelar y marcar pagado son exclusivos del administrador', () => {
    expect(puede('admin', 'pedidos.cancelar')).toBe(true);
    expect(puede('operator', 'pedidos.cancelar')).toBe(false);
    expect(puede('admin', 'pedidos.marcar_pagado')).toBe(true);
    expect(puede('operator', 'pedidos.marcar_pagado')).toBe(false);
  });

  it('el operador puede ver, reenviar cobro, reintentar envío, reimprimir y anotar', () => {
    for (const a of [
      'pedidos.ver',
      'pedidos.reenviar_cobro',
      'pedidos.copiar_link_cobro',
      'pedidos.reintentar_envio',
      'pedidos.reimprimir',
      'pedidos.nota',
      'garantias.gestionar',
      'agente.ver_estado',
      'agente.reimprimir',
      'agente.pagina_prueba',
    ] as AccionId[]) {
      expect(puede('operator', a), a).toBe(true);
    }
  });

  it('el operador ve el contacto del cliente solo desde el pedido', () => {
    expect(puede('operator', 'clientes.ver_contacto_desde_pedido')).toBe(true);
    expect(puede('operator', 'clientes.gestionar')).toBe(false);
    expect(puedeAccederModulo('operator', 'clientes')).toBe(false);
  });

  it('el administrador puede todas las acciones', () => {
    for (const a of Object.keys(ACCIONES) as AccionId[]) {
      expect(puede('admin', a), a).toBe(true);
    }
  });

  it('las acciones exclusivas del administrador se niegan al operador', () => {
    for (const a of soloAdmin) expect(puede('operator', a), a).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'pedidos.ver')).toBe(false);
    expect(puede('otro' as never, 'pedidos.ver')).toBe(false);
  });
});

describe('navegación filtrada por rol', () => {
  it('el operador ve solo sus módulos disponibles', () => {
    const ids = modulosVisibles('operator').map((m) => m.id);
    expect(ids).toEqual(['inicio', 'pedidos', 'garantias', 'agente']);
  });

  it('el administrador ve los módulos que ya existen, no los futuros', () => {
    const ids = modulosVisibles('admin').map((m) => m.id);
    expect(ids).toEqual(['inicio', 'pedidos', 'garantias', 'agente', 'dashboard', 'productos', 'categorias', 'catalogo_auxiliar', 'colecciones', 'contenido', 'descuentos', 'influencers', 'whatsapp', 'pagos', 'integraciones']);
    expect(ids).not.toContain('usuarios');
  });

  it('un rol desconocido no ve nada', () => {
    expect(modulosVisibles(null)).toEqual([]);
  });
});

describe('módulo de una ruta', () => {
  it('reconoce las rutas de los módulos y del inicio', () => {
    expect(moduloDeRuta('/admin')).toBe('inicio');
    expect(moduloDeRuta('/admin/')).toBe('inicio');
    expect(moduloDeRuta('/admin/pedidos')).toBe('pedidos');
    expect(moduloDeRuta('/admin/pedidos/IZ-CO-000001')).toBe('pedidos');
    expect(moduloDeRuta('/admin/agente-impresion')).toBe('agente');
    expect(moduloDeRuta('/admin/sin-permiso')).toBe('inicio');
    expect(moduloDeRuta('/api/admin/pedidos/123')).toBe('pedidos');
    expect(moduloDeRuta('/admin/productos?pagina=2')).toBe('productos');
  });

  it('las rutas desconocidas no pertenecen a ningún módulo', () => {
    expect(moduloDeRuta('/admin/nuevo-modulo')).toBeNull();
    expect(moduloDeRuta('/admin/pedidosx')).toBeNull();
  });

  it('un recorrido con .. no se confunde con un módulo permitido', () => {
    expect(moduloDeRuta('/admin/pedidos/../usuarios')).toBeNull();
    expect(puedeVerRuta('operator', '/admin/pedidos/../usuarios')).toBe(false);
  });

  it('las rutas desconocidas exigen rol administrador', () => {
    expect(puedeVerRuta('admin', '/admin/nuevo-modulo')).toBe(true);
    expect(puedeVerRuta('operator', '/admin/nuevo-modulo')).toBe(false);
  });

  it('el operador no entra a los módulos del administrador, ni por la API', () => {
    expect(puedeVerRuta('operator', '/admin/productos')).toBe(false);
    expect(puedeVerRuta('operator', '/admin/usuarios')).toBe(false);
    expect(puedeVerRuta('operator', '/api/admin/integraciones/wompi')).toBe(false);
    expect(puedeVerRuta('operator', '/admin//usuarios')).toBe(false);
    expect(puedeVerRuta('operator', '/admin/pedidos')).toBe(true);
    expect(puedeVerRuta('operator', '/admin/sin-permiso')).toBe(true);
  });
});
