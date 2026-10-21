import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

/** §24.3: integraciones es solo del administrador (credenciales, probar conexión, webhooks). */
describe('permisos de integraciones', () => {
  it('el administrador accede y gestiona', () => {
    expect(puedeAccederModulo('admin', 'integraciones')).toBe(true);
    expect(puede('admin', 'integraciones.gestionar')).toBe(true);
  });

  it('el operador no entra a ninguna ruta ni ejecuta la acción', () => {
    for (const ruta of ['/admin/integraciones', '/admin/integraciones/wompi', '/api/admin/integraciones/wompi']) {
      expect(moduloDeRuta(ruta), ruta).toBe('integraciones');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta('admin', ruta), ruta).toBe(true);
    }
    expect(puede('operator', 'integraciones.gestionar')).toBe(false);
  });

  it('sin rol se niega todo', () => {
    expect(puede(null, 'integraciones.gestionar')).toBe(false);
    expect(puedeVerRuta(null, '/admin/integraciones')).toBe(false);
  });
});

/** Un secreto nunca debe viajar al navegador: las páginas y componentes no descifran ni leen `data_encrypted`. */
describe('los secretos no llegan al navegador', () => {
  const raiz = path.resolve(__dirname, '../../..');
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? archivos(p) : [p];
    });
  }
  const ui = [
    ...archivos(path.join(raiz, 'app/admin/(panel)/integraciones')).filter((f) => !f.endsWith('acciones.ts')),
    path.join(raiz, 'components/admin/FormularioCredencial.tsx'),
    path.join(raiz, 'components/admin/BotonAccion.tsx'),
  ];

  it.each(ui)('%s no usa descifrado ni lee los bytes cifrados', (archivo) => {
    const texto = readFileSync(archivo, 'utf8');
    expect(texto).not.toMatch(/descifrarCredenciales|data_encrypted|APP_ENCRYPTION_KEY/);
  });

  it('las acciones de servidor comprueban el permiso antes de hacer nada', () => {
    const texto = readFileSync(path.join(raiz, 'app/admin/(panel)/integraciones/acciones.ts'), 'utf8');
    const exportadas = texto.match(/export async function \w+/g) ?? [];
    expect(exportadas.length).toBe(5);
    expect((texto.match(/adminDeAccion\('integraciones', 'integraciones\.gestionar'\)/g) ?? []).length).toBe(2);
  });
});
