/**
 * Build de PRUEBA de la tienda con datos de ejemplo (sin llaves de Supabase).
 *
 * En producción la tienda nunca usa datos de ejemplo salvo que el build lo pida con la variable oficial
 * `STORE_DATOS_PERMITIR_EJEMPLO=1` (espejo público `NEXT_PUBLIC_STORE_DATOS_PERMITIR_EJEMPLO=1`; ver lib/store/modo-datos.ts).
 * Este script construye el build de producción real en un directorio aparte (`.next-ejemplo`, para no pisar `.next`):
 *
 *   pnpm build:e2e                       # next build con las variables de prueba
 *   STORE_DATOS=ejemplo pnpm test:e2e    # el config sirve ese build con `next start` y los mismos valores
 *
 * Sin NEXT_PUBLIC_STORE_DATOS el checkout llama a /api/checkout de verdad y las pruebas lo simulan con page.route.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const next = path.resolve(raiz, '../../node_modules/next/dist/bin/next');

const r = spawnSync(process.execPath, [next, 'build'], {
  cwd: raiz,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-ejemplo',
    STORE_DATOS: 'ejemplo',
    STORE_DATOS_PERMITIR_EJEMPLO: '1',
    NEXT_PUBLIC_STORE_DATOS_PERMITIR_EJEMPLO: '1',
    NEXT_PUBLIC_STORE_DATOS: '',
  },
});
process.exit(r.status ?? 1);
