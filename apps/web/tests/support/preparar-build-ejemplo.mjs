/**
 * Build de PRUEBA de la tienda con datos de ejemplo (sin llaves de Supabase).
 *
 * Problema: en producción la tienda NUNCA usa datos de ejemplo (`NODE_ENV === 'production'` fuerza Supabase,
 * a propósito: ver lib/store/datos.ts). Pero `next build` con NODE_ENV=development falla al prerenderizar
 * `/500` y `next dev` no sirve para medir rendimiento. Solución sin tocar el código de otros dueños:
 * se construye una COPIA de apps/web en `apps/.e2e-web` (ignorada por git) a la que se le quita
 * la compuerta de NODE_ENV en los 4 archivos que eligen entre Supabase y ejemplo. El código real no cambia.
 *
 *   node tests/support/preparar-build-ejemplo.mjs        # copia + parche + next build (carpeta .next de la copia)
 *   node tests/support/preparar-build-ejemplo.mjs --sin-build
 *
 * Después: STORE_DATOS=ejemplo pnpm test:e2e  (el config detecta la copia y levanta `next start` allí).
 * Si izao-tienda añade una variable oficial para permitir ejemplo en el build de pruebas, este script sobra.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const origen = path.resolve(aqui, '../..');
const destino = path.resolve(origen, '../.e2e-web');

const DIRECTORIOS = ['app', 'components', 'lib', 'public'];
const ARCHIVOS = ['middleware.ts', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'package.json', 'next-env.d.ts'];
const PARCHES = [
  'lib/store/datos.ts',
  'lib/store/checkout-datos.ts',
  'lib/store/checkout/adaptador.ts',
  'lib/store/chat/fuente-supabase.ts',
];

fs.mkdirSync(destino, { recursive: true });
fs.writeFileSync(path.join(destino, '.gitignore'), '*\n');

for (const d of DIRECTORIOS) {
  fs.rmSync(path.join(destino, d), { recursive: true, force: true });
  if (fs.existsSync(path.join(origen, d))) {
    fs.cpSync(path.join(origen, d), path.join(destino, d), {
      recursive: true,
      filter: (src) => !/\.test\.tsx?$/.test(src),
    });
  }
}
for (const f of ARCHIVOS) if (fs.existsSync(path.join(origen, f))) fs.copyFileSync(path.join(origen, f), path.join(destino, f));

let cambios = 0;
for (const rel of PARCHES) {
  const ruta = path.join(destino, rel);
  const antes = fs.readFileSync(ruta, 'utf8');
  const despues = antes
    .replaceAll("process.env.NODE_ENV !== 'production'", 'true')
    .replaceAll("process.env.NODE_ENV === 'production'", 'false');
  if (despues !== antes) cambios += 1;
  fs.writeFileSync(ruta, despues);
}
if (cambios === 0) throw new Error('El parche de la copia no cambió nada: revisa PARCHES en preparar-build-ejemplo.mjs');

// Sin typecheck en esta copia (el typecheck oficial corre sobre apps/web).
const cfg = path.join(destino, 'next.config.ts');
fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('const config: NextConfig = {', 'const config: NextConfig = {\n  typescript: { ignoreBuildErrors: true },'));

const enlace = path.join(destino, 'node_modules');
if (!fs.existsSync(enlace)) fs.symlinkSync(path.join(origen, 'node_modules'), enlace, 'junction');

console.log(`Copia lista en ${destino} (${cambios} archivos parchados)`);
if (process.argv.includes('--sin-build')) process.exit(0);

const r = spawnSync(process.execPath, [path.resolve(origen, '../../node_modules/next/dist/bin/next'), 'build'], {
  cwd: destino,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    STORE_DATOS: 'ejemplo',
    NEXT_PUBLIC_STORE_DATOS: 'ejemplo',
  },
});
process.exit(r.status ?? 1);
