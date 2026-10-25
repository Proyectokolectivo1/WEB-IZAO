import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: descuentos e influencers caen en "todo lo demás": solo el administrador. */
describe('permisos de descuentos e influencers', () => {
  it.each([
    ['descuentos', 'descuentos.gestionar'],
    ['influencers', 'influencers.gestionar'],
  ] as const)('%s: el administrador entra y gestiona', (modulo, accion) => {
    expect(puedeAccederModulo('admin', modulo)).toBe(true);
    expect(puede('admin', accion)).toBe(true);
  });

  it.each([
    ['descuentos', 'descuentos.gestionar', ['/admin/descuentos', '/admin/descuentos/nuevo', '/admin/descuentos/lote', '/api/admin/descuentos/exportar']],
    ['influencers', 'influencers.gestionar', ['/admin/influencers', '/admin/influencers/reporte', '/api/admin/influencers/reporte']],
  ] as const)('%s: el operador no entra ni gestiona', (modulo, accion, rutas) => {
    for (const ruta of rutas) {
      expect(moduloDeRuta(ruta), ruta).toBe(modulo);
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
    }
    expect(puede('operator', accion)).toBe(false);
    expect(puede(null, accion)).toBe(false);
    expect(puede(undefined, accion)).toBe(false);
  });

  it('cada Server Action y ruta de descarga exige su permiso', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const d = leer('admin/(panel)/descuentos/acciones.ts');
    // guardar, lote, alternar y eliminar
    expect((d.match(/adminDeAccion\('descuentos', 'descuentos\.gestionar'\)/g) ?? []).length).toBe(4);
    const i = leer('admin/(panel)/influencers/acciones.ts');
    expect((i.match(/adminDeAccion\('influencers', 'influencers\.gestionar'\)/g) ?? []).length).toBe(2);
    expect(leer('api/admin/descuentos/exportar/route.ts')).toContain("adminParaApiDe('descuentos', 'descuentos.gestionar')");
    expect(leer('api/admin/influencers/reporte/route.ts')).toContain("adminParaApiDe('influencers', 'influencers.gestionar')");
  });
});
