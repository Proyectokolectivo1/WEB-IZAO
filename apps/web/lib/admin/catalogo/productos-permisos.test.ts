import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: productos, precios e importación son solo del administrador. */
describe('permisos del módulo de productos', () => {
  it('el administrador gestiona e importa', () => {
    expect(puedeAccederModulo('admin', 'productos')).toBe(true);
    expect(puede('admin', 'catalogo.gestionar')).toBe(true);
    expect(puede('admin', 'catalogo.importar')).toBe(true);
  });

  it('el operador no ve las rutas ni puede ejecutar las acciones', () => {
    for (const ruta of ['/admin/productos', '/admin/productos/nuevo', '/admin/productos/importar', '/admin/productos/exportar']) {
      expect(moduloDeRuta(ruta), ruta).toBe('productos');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'catalogo.gestionar')).toBe(false);
    expect(puede('operator', 'catalogo.importar')).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'catalogo.gestionar')).toBe(false);
    expect(puedeVerRuta(null, '/admin/productos')).toBe(false);
  });
});

describe('eliminar y restaurar productos (D-055)', () => {
  const RAIZ = path.resolve(__dirname, '../../..');
  const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');

  it('eliminar usa el permiso catalogo.gestionar: solo administrador', () => {
    expect(puede('admin', 'catalogo.gestionar')).toBe(true);
    expect(puede('operator', 'catalogo.gestionar')).toBe(false);
    expect(puede(null, 'catalogo.gestionar')).toBe(false);
  });

  it('cada Server Action de producto verifica el permiso en el servidor antes de actuar', () => {
    const acciones = leer('app/admin/(panel)/productos/acciones.ts');
    for (const nombre of ['guardarProductoAccion', 'duplicarProductoAccion', 'archivarProductoAccion', 'eliminarProductoAccion', 'restaurarProductoAccion']) {
      const cuerpo = acciones.slice(acciones.indexOf(`export async function ${nombre}`));
      const siguiente = cuerpo.indexOf('\nexport async function', 10);
      const bloque = siguiente === -1 ? cuerpo : cuerpo.slice(0, siguiente);
      expect(bloque, nombre).toContain("adminDeAccion('productos', 'catalogo.gestionar')");
      expect(bloque.indexOf('adminDeAccion'), nombre).toBeLessThan(bloque.indexOf('crearClienteServicio'));
    }
  });

  it('los botones de la lista solo se muestran con el permiso', () => {
    expect(leer('app/admin/(panel)/productos/page.tsx')).toContain("puede(admin.rol, 'catalogo.gestionar')");
  });
});
