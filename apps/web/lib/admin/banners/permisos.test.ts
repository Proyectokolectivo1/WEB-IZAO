import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: Banners cae en «todo lo demás»: solo el administrador. */
describe('permisos de banners', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'banners')).toBe(true);
    expect(puede('admin', 'banners.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran', () => {
    expect(moduloDeRuta('/admin/banners')).toBe('banners');
    expect(moduloDeRuta('/admin/banners/nuevo')).toBe('banners');
    for (const ruta of ['/admin/banners', '/admin/banners/abc']) {
      expect(puedeVerRuta('operator', ruta)).toBe(false);
      expect(puedeVerRuta(null, ruta)).toBe(false);
    }
    expect(puede('operator', 'banners.gestionar')).toBe(false);
    expect(puede(null, 'banners.gestionar')).toBe(false);
  });

  it('todas las Server Actions pasan por el permiso y las páginas exigen el módulo', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const acciones = leer('admin/(panel)/banners/acciones.ts');
    expect((acciones.match(/adminDeAccion\('banners', 'banners\.gestionar'\)/g) ?? []).length).toBe(1);
    const exportadas = (acciones.match(/^export async function /gm) ?? []).length;
    const usanContexto = (acciones.match(/await contexto\(\)/g) ?? []).length;
    expect(usanContexto).toBe(exportadas);
    expect(leer('admin/(panel)/banners/page.tsx')).toContain("requerirAdmin({ modulo: 'banners' })");
    expect(leer('admin/(panel)/banners/[id]/page.tsx')).toContain("requerirAdmin({ modulo: 'banners' })");
  });
});
