import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: "Pagos y países" cae en "todo lo demás": solo el administrador. */
describe('permisos de pagos y países', () => {
  it('el administrador accede y gestiona', () => {
    expect(puedeAccederModulo('admin', 'pagos')).toBe(true);
    expect(puede('admin', 'pagos.gestionar')).toBe(true);
  });

  it('el operador no entra ni gestiona', () => {
    for (const ruta of ['/admin/pagos', '/admin/pagos?pais=EC', '/api/admin/pagos']) {
      expect(moduloDeRuta(ruta), ruta).toBe('pagos');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'pagos.gestionar')).toBe(false);
    expect(puede(null, 'pagos.gestionar')).toBe(false);
  });

  it('las dos acciones de servidor exigen el permiso', () => {
    const texto = readFileSync(path.resolve(__dirname, '../../../app/admin/(panel)/pagos/acciones.ts'), 'utf8');
    expect((texto.match(/adminDeAccion\('pagos', 'pagos\.gestionar'\)/g) ?? []).length).toBe(2);
  });
});
