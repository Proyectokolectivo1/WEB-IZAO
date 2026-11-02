import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CarritoProvider } from '@/components/store/carrito/CarritoProvider';
import { Footer } from '@/components/store/footer/Footer';
import { LimiteError } from '@/components/store/LimiteError';
import { Header } from '@/components/store/header/Header';
import { LanzadorIza } from '@/components/store/iza/LanzadorIza';
import { chatHabilitado } from '@/lib/store/chat/fuente-supabase';
import { tienda } from '@/lib/store/datos';
import { clasesFuentes } from '@/lib/store/fuentes';
import { esPais } from '@/lib/store/pais';
import { alternos } from '@/lib/store/seo';
import { textosEnvio } from '@/lib/store/envio';
import { temaDePais } from '@/lib/store/tema';

// Sin prerender en la compilación (no depende de la base); cada ruta se genera al pedirla y se cachea.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  const ajustes = await tienda().ajustes(country);
  return {
    title: { default: ajustes.nombreTienda, template: `%s · ${ajustes.nombreTienda}` },
    alternates: alternos(country, '/'),
    openGraph: { siteName: ajustes.nombreTienda, locale: country === 'co' ? 'es_CO' : 'es_EC', type: 'website' },
  };
}

export default async function LayoutPais({ children, params }: { children: ReactNode; params: Promise<{ country: string }> }) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();

  const repo = tienda();
  const [ajustes, anuncios, menu, populares, paginas, espacios, override, iza] = await Promise.all([
    repo.ajustes(pais),
    repo.anuncios(pais),
    repo.menu(pais),
    repo.busquedasPopulares(pais),
    repo.paginas(pais),
    repo.espacios(pais),
    temaDePais(pais),
    chatHabilitado(),
  ]);

  // Nota y valor del envío editables en el panel (espacios `nota_envio` y `valor_envio`); sin ellos, los del seed.
  const envio = textosEnvio(espacios);

  return (
    <div id="tema-pais" className={override ? `tema-pais bg-bg text-ink ${clasesFuentes(override.par)}` : undefined}>
      {override ? <style dangerouslySetInnerHTML={{ __html: override.css }} /> : null}
      <CarritoProvider pais={pais} notaEnvio={envio.nota} valorEnvio={envio.valor}>
        <Header pais={pais} ajustes={ajustes} anuncios={anuncios} categorias={menu} populares={populares} />
        <main id="contenido" tabIndex={-1} className="outline-none">
          <LimiteError pais={pais}>{children}</LimiteError>
        </main>
        <Footer pais={pais} ajustes={ajustes} paginas={paginas} espacios={espacios} />
        {iza ? <LanzadorIza pais={pais} /> : null}
      </CarritoProvider>
      {/* Los diálogos se montan aquí para heredar el tema del país. */}
      <div id="izao-portal" />
    </div>
  );
}
