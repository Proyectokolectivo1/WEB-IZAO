import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { COLORES_POR_DEFECTO } from '@izao/ui/tema';
import { temaGlobal } from '@/lib/store/tema';
import './globals.css';

const SITIO = process.env.SITE_URL ?? 'https://izaoperfumeria.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITIO),
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: COLORES_POR_DEFECTO.bg,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = await temaGlobal();
  return (
    <html lang="es" className={tema.clasesFuentes}>
      <head>
        {/* Tokens de `site_settings` (valores validados en el servidor, sin parpadeo). */}
        <style dangerouslySetInnerHTML={{ __html: tema.css }} />
        {/* Las dos fuentes elegidas, precargadas para que el título grande no espere al CSS (LCP). */}
        {tema.precarga.map((href) => (
          <link key={href} rel="preload" as="font" type="font/woff2" href={href} crossOrigin="anonymous" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
