import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: los leads son datos personales y caen en "todo lo demás": solo el administrador. */
describe('permisos de leads', () => {
  it('el administrador entra y exporta', () => {
    expect(puedeAccederModulo('admin', 'leads')).toBe(true);
    expect(puede('admin', 'leads.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran a la página ni a la descarga', () => {
    for (const ruta of ['/admin/leads', '/api/admin/leads/exportar']) {
      expect(moduloDeRuta(ruta), ruta).toBe('leads');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'leads.gestionar')).toBe(false);
    expect(puede(null, 'leads.gestionar')).toBe(false);
  });

  it('la página y la descarga exigen el permiso en el servidor, y la descarga se audita sin el texto buscado', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    expect(leer('admin/(panel)/leads/page.tsx')).toContain("requerirAdmin({ modulo: 'leads', accion: 'leads.gestionar' })");
    const ruta = leer('api/admin/leads/exportar/route.ts');
    expect(ruta).toContain("adminParaApiDe('leads', 'leads.gestionar')");
    expect(ruta).toContain("accion: 'leads.exportado'");
    expect(ruta).toContain('con_busqueda');
    expect(ruta).toContain('filtros: sinBusqueda');
  });
});
