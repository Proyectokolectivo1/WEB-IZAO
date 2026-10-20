import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: contenido (páginas y políticas) es solo del administrador. */
describe('permisos del módulo de contenido', () => {
  it('el administrador accede y gestiona', () => {
    expect(puedeAccederModulo('admin', 'contenido')).toBe(true);
    expect(puede('admin', 'contenido.gestionar')).toBe(true);
  });

  it('el operador no entra a las rutas ni ejecuta la acción', () => {
    for (const ruta of ['/admin/contenido', '/admin/contenido/paginas', '/admin/contenido/paginas/nueva', '/admin/contenido/paginas/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('contenido');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'contenido.gestionar')).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'contenido.gestionar')).toBe(false);
    expect(puedeVerRuta(null, '/admin/contenido/paginas')).toBe(false);
  });
});
