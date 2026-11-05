import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: Apariencia cae en "todo lo demás": solo el administrador. */
describe('permisos de apariencia', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'apariencia')).toBe(true);
    expect(puede('admin', 'apariencia.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran', () => {
    expect(moduloDeRuta('/admin/apariencia')).toBe('apariencia');
    expect(puedeVerRuta('operator', '/admin/apariencia')).toBe(false);
    expect(puedeVerRuta(null, '/admin/apariencia')).toBe(false);
    expect(puede('operator', 'apariencia.gestionar')).toBe(false);
    expect(puede(null, 'apariencia.gestionar')).toBe(false);
  });

  it('cada Server Action y la página exigen su permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/apariencia/acciones.ts');
    expect((a.match(/adminDeAccion\('apariencia', 'apariencia\.gestionar'\)/g) ?? []).length).toBe(3);
    expect(leer('admin/(panel)/apariencia/page.tsx')).toContain("requerirAdmin({ modulo: 'apariencia', accion: 'apariencia.gestionar' })");
  });
});
