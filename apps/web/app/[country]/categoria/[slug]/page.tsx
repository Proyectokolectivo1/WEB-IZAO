import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BannerFijo } from '@/components/store/home/BannerFijo';
import { PaginaListado, type ParamsBusqueda } from '@/components/store/catalogo/PaginaListado';
import { bannersDe } from '@/lib/store/banners';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { metaListado } from '@/lib/store/seo';

type Props = { params: Promise<{ country: string; slug: string }>; searchParams: Promise<ParamsBusqueda> };

async function buscar(pais: 'co' | 'ec', slug: string) {
  return (await tienda().opcionesFiltros(pais)).categorias.find((c) => c.slug === slug)?.name ?? null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { country, slug } = await params;
  if (!esPais(country)) return {};
  const nombre = await buscar(country, slug);
  if (!nombre) return {};
  return metaListado(country, `/${country}/categoria/${slug}`, nombre, await searchParams, { idiomas: false });
}

export default async function Pagina({ params, searchParams }: Props) {
  const { country: pais, slug } = await params;
  if (!esPais(pais)) notFound();
  const nombre = await buscar(pais, slug);
  if (!nombre) notFound();
  // Banner `category` del panel (cabecera de la categoría); si no se puede leer, la página sigue sin él.
  const banner = await tienda()
    .home(pais)
    .then((h) => bannersDe(h.banners, 'category')[0] ?? null)
    .catch(() => null);
  return (
    <>
      {banner ? (
        <div className="mx-auto w-full max-w-[96rem] px-4 pt-3 sm:px-8 sm:pt-4">
          <BannerFijo banner={banner} ubicacion="category" />
        </div>
      ) : null}
      <PaginaListado pais={pais} titulo={nombre} base={`/${pais}/categoria/${slug}`} fijos={{ category: slug }} searchParams={await searchParams} />
    </>
  );
}
