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
  // Metadatos (title, meta description, favicon) siempre dentro de <head> y no en streaming dentro de <body>: Lighthouse y
  // los lectores de vista previa que no ejecutan JS solo miran <head> (F9 D-4: «sin meta description»). Costo: ninguno,
  // las páginas son ISR y sus metadatos salen de caché.
  htmlLimitedBots: /.*/,
  // El middleware (que cubre /api/admin/*) recorta el cuerpo a 10 MB por defecto; la subida de imágenes admite hasta 15 MB.
  experimental: { middlewareClientMaxBodySize: '16mb' },
  // Paquetes del workspace que se publican como TypeScript.
  transpilePackages: ['@izao/ui', '@izao/core', '@izao/wompi', '@izao/whatsapp', '@izao/addi'],
  // BullMQ se carga desde node_modules en tiempo de ejecución en vez de empaquetarse: su cliente opcional de Valkey GLIDE
  // hace `require('@valkey/valkey-glide')` dentro de un try/catch perezoso que webpack no puede resolver y avisaba en cada
  // build. Usamos ioredis, así que ese require nunca corre; el trazado de `standalone` copia bullmq igual que a `sharp`.
  serverExternalPackages: ['bullmq'],
  // Archivos de `public/` (sin hash en el nombre): se sirven de caché y se revalidan en segundo plano. Las imágenes del
  // catálogo (`/media/{tipo}/{año}/{mes}/{uuid}-{ancho}.webp`) las sirve Nginx con `immutable`; los estáticos con hash de
  // `/_next/static` ya salen `immutable` de Next.
  async headers() {
    const revalidar = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    return [
      { source: '/icono-defecto.svg', headers: revalidar },
      { source: '/media/ejemplo/:path*', headers: revalidar },
    ];
  },
  // El lint corre aparte con `pnpm lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
