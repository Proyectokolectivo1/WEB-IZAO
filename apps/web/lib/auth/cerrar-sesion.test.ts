import { describe, expect, it } from 'vitest';
import { cerrarSesionLocal } from './cerrar-sesion';

describe('cerrarSesionLocal', () => {
  it('cierra solo la sesión de este navegador (alcance local), no las demás del usuario', async () => {
    const llamadas: unknown[] = [];
    const cliente = {
      auth: {
        signOut: async (opciones?: unknown) => {
          llamadas.push(opciones);
          return { error: null };
        },
      },
    };
    await cerrarSesionLocal(cliente);
    expect(llamadas).toEqual([{ scope: 'local' }]);
  });
});

describe('ningún código del panel llama a signOut() sin alcance', () => {
  it('solo cerrar-sesion.ts invoca auth.signOut', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const raiz = path.resolve(__dirname, '../..');
    const hallazgos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        // `.next*` incluye los builds por variante (.next-ejemplo, .next-tienda…), que pesan miles de archivos y vencían la prueba.
        if (['node_modules', 'test'].includes(nombre) || nombre.startsWith('.next')) continue;
        const ruta = path.join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.ts$/.test(nombre) && nombre !== 'cerrar-sesion.ts') {
          if (/\.signOut\(/.test(readFileSync(ruta, 'utf8'))) hallazgos.push(path.relative(raiz, ruta));
        }
      }
    };
    recorrer(raiz);
    expect(hallazgos).toEqual([]);
  });
});
