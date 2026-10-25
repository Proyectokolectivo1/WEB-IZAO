import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: el operador ve el contacto solo desde el pedido; el módulo Clientes y la anonimización son del administrador. */
describe('permisos de clientes', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'clientes')).toBe(true);
    expect(puede('admin', 'clientes.gestionar')).toBe(true);
  });

  it('el operador no entra a ninguna ruta de clientes, pero sí ve el contacto desde el pedido', () => {
    for (const ruta of ['/admin/clientes', '/admin/clientes/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('clientes');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'clientes.gestionar')).toBe(false);
    expect(puede(null, 'clientes.gestionar')).toBe(false);
    expect(puede('operator', 'clientes.ver_contacto_desde_pedido')).toBe(true);
  });

  it('la acción y las páginas exigen el permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/clientes/acciones.ts');
    expect((a.match(/adminDeAccion\('clientes', 'clientes\.gestionar'\)/g) ?? []).length).toBe(1);
    for (const p of ['page.tsx', '[id]/page.tsx']) {
      expect(leer(`admin/(panel)/clientes/${p}`), p).toContain("requerirAdmin({ modulo: 'clientes', accion: 'clientes.gestionar' })");
    }
  });
});
