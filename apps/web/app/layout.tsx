import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { COLORES_POR_DEFECTO } from '@izao/ui/tema';
import { tienda } from '@/lib/store/datos';
import { rutaDeMedio } from '@/lib/store/ficha-seo';
import { temaGlobal } from '@/lib/store/tema';
import './globals.css';

const SITIO = process.env.SITE_URL ?? 'https://izaoperfumeria.com';

/** Icono por defecto (neutro); el favicon que sube el panel en Apariencia (`site_settings`) lo reemplaza. */
const ICONO_POR_DEFECTO = '/icono-defecto.svg';

export async function generateMetadata(): Promise<Metadata> {
  // El favicon es global (no depende del país): se lee de los ajustes del sitio; si la base no responde, el de respaldo.
  const favicon = await tienda()
    .ajustes('co')
    .then((a) => rutaDeMedio(a.favicon, 192))
    .catch(() => null);
  return {
    metadataBase: new URL(SITIO),
    robots: { index: true, follow: true },
    icons: favicon ? { icon: favicon.ruta, apple: favicon.ruta } : { icon: { url: ICONO_POR_DEFECTO, type: 'image/svg+xml' } },
  };
}

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
