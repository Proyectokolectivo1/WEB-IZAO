import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: las métricas caen en "todo lo demás": solo el administrador. */
describe('permisos de las métricas', () => {
  it('el administrador entra y exporta', () => {
    expect(puedeAccederModulo('admin', 'dashboard')).toBe(true);
    expect(puede('admin', 'metricas.exportar')).toBe(true);
  });

  it('el operador no entra a la página ni a la descarga, y sin rol se niega', () => {
    for (const ruta of ['/admin/metricas', '/api/admin/metricas/exportar']) {
      expect(moduloDeRuta(ruta), ruta).toBe('dashboard');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'metricas.exportar')).toBe(false);
    expect(puede(null, 'metricas.exportar')).toBe(false);
  });

  it('la página y la descarga exigen su permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    expect(leer('admin/(panel)/metricas/page.tsx')).toContain("requerirAdmin({ modulo: 'dashboard' })");
    expect(leer('api/admin/metricas/exportar/route.ts')).toContain("adminParaApiDe('dashboard', 'metricas.exportar')");
  });
});
