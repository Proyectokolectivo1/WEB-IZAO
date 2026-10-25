import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: las reseñas caen en "todo lo demás": solo el administrador. */
describe('permisos de reseñas', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'resenas')).toBe(true);
    expect(puede('admin', 'resenas.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran', () => {
    for (const ruta of ['/admin/resenas', '/admin/resenas/nuevo', '/admin/resenas/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('resenas');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'resenas.gestionar')).toBe(false);
    expect(puede(null, 'resenas.gestionar')).toBe(false);
  });

  it('cada Server Action y página exige el permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/resenas/acciones.ts');
    // guardar, moderar, destacar y eliminar
    expect((a.match(/adminDeAccion\('resenas', 'resenas\.gestionar'\)/g) ?? []).length).toBe(4);
    for (const p of ['page.tsx', '[id]/page.tsx']) {
      expect(leer(`admin/(panel)/resenas/${p}`), p).toContain("requerirAdmin({ modulo: 'resenas', accion: 'resenas.gestionar' })");
    }
  });
});
