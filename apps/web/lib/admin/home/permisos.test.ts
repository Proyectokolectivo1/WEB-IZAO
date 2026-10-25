import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: el home cae en "todo lo demás": solo el administrador. */
describe('permisos del home', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'home')).toBe(true);
    expect(puede('admin', 'home.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran', () => {
    for (const ruta of ['/admin/home', '/admin/home/nuevo', '/admin/home/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('home');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'home.gestionar')).toBe(false);
    expect(puede(null, 'home.gestionar')).toBe(false);
  });

  it('cada Server Action y página exige el permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/home/acciones.ts');
    // guardar, mover, alternar y eliminar
    expect((a.match(/adminDeAccion\('home', 'home\.gestionar'\)/g) ?? []).length).toBe(4);
    // `activa` llega del navegador: la acción lo valida como booleano antes de escribir.
    expect(a).toContain("typeof activa === 'boolean'");
    for (const p of ['page.tsx', '[id]/page.tsx']) {
      expect(leer(`admin/(panel)/home/${p}`), p).toContain("requerirAdmin({ modulo: 'home', accion: 'home.gestionar' })");
    }
  });
});
