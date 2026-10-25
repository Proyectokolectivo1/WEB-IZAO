import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: los gastos caen en "todo lo demás": solo el administrador. */
describe('permisos de gastos', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'gastos')).toBe(true);
    expect(puede('admin', 'gastos.gestionar')).toBe(true);
  });

  it('el operador no entra a ninguna ruta de gastos, ni a la descarga', () => {
    for (const ruta of ['/admin/gastos', '/admin/gastos/nuevo', '/admin/gastos/categorias', '/api/admin/gastos/exportar']) {
      expect(moduloDeRuta(ruta), ruta).toBe('gastos');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'gastos.gestionar')).toBe(false);
    expect(puede(null, 'gastos.gestionar')).toBe(false);
  });

  it('cada Server Action, página y descarga exige su permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/gastos/acciones.ts');
    // guardar y eliminar gasto, guardar y eliminar categoría
    expect((a.match(/adminDeAccion\('gastos', 'gastos\.gestionar'\)/g) ?? []).length).toBe(4);
    for (const p of ['page.tsx', '[id]/page.tsx', 'categorias/page.tsx']) {
      expect(leer(`admin/(panel)/gastos/${p}`), p).toContain("requerirAdmin({ modulo: 'gastos', accion: 'gastos.gestionar' })");
    }
    expect(leer('api/admin/gastos/exportar/route.ts')).toContain("adminParaApiDe('gastos', 'gastos.gestionar')");
  });
});
