import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Raíz del monorepo para que el trazado de archivos incluya los paquetes del workspace.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // Paquetes del workspace que se publican como TypeScript.
  transpilePackages: ['@izao/ui', '@izao/core'],
  // El lint corre aparte con `pnpm lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
