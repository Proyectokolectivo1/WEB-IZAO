import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: productos, precios e importación son solo del administrador. */
describe('permisos del módulo de productos', () => {
  it('el administrador gestiona e importa', () => {
    expect(puedeAccederModulo('admin', 'productos')).toBe(true);
    expect(puede('admin', 'catalogo.gestionar')).toBe(true);
    expect(puede('admin', 'catalogo.importar')).toBe(true);
  });

  it('el operador no ve las rutas ni puede ejecutar las acciones', () => {
    for (const ruta of ['/admin/productos', '/admin/productos/nuevo', '/admin/productos/importar', '/admin/productos/exportar']) {
      expect(moduloDeRuta(ruta), ruta).toBe('productos');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'catalogo.gestionar')).toBe(false);
    expect(puede('operator', 'catalogo.importar')).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'catalogo.gestionar')).toBe(false);
    expect(puedeVerRuta(null, '/admin/productos')).toBe(false);
  });
});
