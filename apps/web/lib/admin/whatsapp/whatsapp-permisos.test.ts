import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: las plantillas de WhatsApp son solo del administrador; copiar y reenviar el cobro, también del operador. */
describe('permisos de plantillas de WhatsApp', () => {
  it('el administrador accede y gestiona', () => {
    expect(puedeAccederModulo('admin', 'whatsapp')).toBe(true);
    expect(puede('admin', 'whatsapp.plantillas')).toBe(true);
  });

  it('el operador no entra a ninguna ruta del módulo ni ejecuta la acción', () => {
    for (const ruta of ['/admin/whatsapp', '/admin/whatsapp/plantillas', '/admin/whatsapp/plantillas/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('whatsapp');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta('admin', ruta), ruta).toBe(true);
    }
    expect(puede('operator', 'whatsapp.plantillas')).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'whatsapp.plantillas')).toBe(false);
    expect(puedeVerRuta(null, '/admin/whatsapp/plantillas')).toBe(false);
  });
});

describe('permisos del cobro desde el pedido', () => {
  it('administrador y operador pueden copiar el link y reenviar el cobro', () => {
    for (const rol of ['admin', 'operator'] as const) {
      expect(puede(rol, 'pedidos.copiar_link_cobro'), rol).toBe(true);
      expect(puede(rol, 'pedidos.reenviar_cobro'), rol).toBe(true);
      expect(puedeVerRuta(rol, '/admin/pedidos/abc'), rol).toBe(true);
    }
  });

  it('sin rol o con rol desconocido se niega', () => {
    expect(puede(null, 'pedidos.copiar_link_cobro')).toBe(false);
    expect(puede('otro' as never, 'pedidos.reenviar_cobro')).toBe(false);
  });
});
