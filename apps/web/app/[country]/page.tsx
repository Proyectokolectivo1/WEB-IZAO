import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { HomeSecciones } from '@/components/store/home/HomeSecciones';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { alternos, jsonLd, SITIO } from '@/lib/store/seo';
import { textosSeo } from '@/lib/store/seo-textos';

export const revalidate = 300;

type Params = Promise<{ country: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  const repo = tienda();
  const [ajustes, espacios] = await Promise.all([repo.ajustes(country), repo.espacios(country).catch(() => [])]);
  const seo = textosSeo(country, espacios);
  return {
    // Título propio del inicio: la marca y qué ofrece, sin repetir el nombre de la tienda de la plantilla.
    title: { absolute: [ajustes.nombreTienda, seo.inicioTitulo].filter(Boolean).join(' · ') },
    description: seo.inicioDescripcion,
    alternates: alternos(country, '/'),
  };
}

export default async function Inicio({ params }: { params: Params }) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  const repo = tienda();
  const [contenido, ajustes] = await Promise.all([repo.home(pais), repo.ajustes(pais)]);

  const estructura = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: ajustes.nombreTienda, url: `${SITIO}/${pais}` },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: ajustes.nombreTienda,
      url: `${SITIO}/${pais}`,
      potentialAction: { '@type': 'SearchAction', target: `${SITIO}/${pais}/buscar?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    },
  ];

  return (
    <>
      <h1 className="solo-lectores">{ajustes.nombreTienda}</h1>
      <HomeSecciones contenido={contenido} pais={pais} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(estructura) }} />
    </>
  );
}
