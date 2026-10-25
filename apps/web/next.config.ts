import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Carpeta de salida configurable para que `next dev` y el build de pruebas no pisen `.next`.
  // Por defecto sigue siendo `.next` (el Dockerfile copia `.next/standalone`).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Raíz del monorepo para que el trazado de archivos incluya los paquetes del workspace.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // Paquetes del workspace que se publican como TypeScript.
  transpilePackages: ['@izao/ui', '@izao/core', '@izao/wompi', '@izao/whatsapp', '@izao/addi'],
  // El lint corre aparte con `pnpm lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
