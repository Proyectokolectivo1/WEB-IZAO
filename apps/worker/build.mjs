// Empaqueta el worker en un solo archivo: los paquetes del workspace (@izao/*) exportan .ts
// y tsc con rootDir=src no los compila. bullmq e ioredis quedan externos (se instalan en la imagen).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['bullmq', 'ioredis'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
