import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Los componentes se prueban con `renderToStaticMarkup`: JSX automático (tsconfig usa `preserve` para Next).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next*/**', 'tests/.resultados/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` lanza fuera de Next; en pruebas se sustituye por un módulo vacío.
      'server-only': path.resolve(__dirname, 'test/server-only-vacio.ts'),
    },
  },
});
