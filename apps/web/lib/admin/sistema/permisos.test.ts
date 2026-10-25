import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: Sistema cae en "todo lo demás": solo el administrador. */
describe('permisos de sistema', () => {
  it('el administrador entra y reintenta jobs', () => {
    expect(puedeAccederModulo('admin', 'sistema')).toBe(true);
    expect(puede('admin', 'sistema.reintentar_job')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran a ninguna ruta de sistema', () => {
    for (const ruta of ['/admin/sistema', '/admin/sistema/auditoria']) {
      expect(moduloDeRuta(ruta), ruta).toBe('sistema');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'sistema.reintentar_job')).toBe(false);
    expect(puede(null, 'sistema.reintentar_job')).toBe(false);
  });

  it('la acción y las páginas exigen el permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    expect(leer('admin/(panel)/sistema/acciones.ts')).toContain("adminDeAccion('sistema', 'sistema.reintentar_job')");
    for (const p of ['page.tsx', 'auditoria/page.tsx']) {
      expect(leer(`admin/(panel)/sistema/${p}`), p).toContain("requerirAdmin({ modulo: 'sistema' })");
    }
  });
});
