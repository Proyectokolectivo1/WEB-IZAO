import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PaginaListado, type ParamsBusqueda } from '@/components/store/catalogo/PaginaListado';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { metaListado } from '@/lib/store/seo';

type Props = { params: Promise<{ country: string; slug: string }>; searchParams: Promise<ParamsBusqueda> };

async function buscar(pais: 'co' | 'ec', slug: string) {
  return (await tienda().opcionesFiltros(pais)).familias.find((c) => c.slug === slug)?.name ?? null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { country, slug } = await params;
  if (!esPais(country)) return {};
  const nombre = await buscar(country, slug);
  if (!nombre) return {};
  return metaListado(country, `/${country}/familia/${slug}`, nombre, await searchParams, { idiomas: false });
}

export default async function Pagina({ params, searchParams }: Props) {
  const { country: pais, slug } = await params;
  if (!esPais(pais)) notFound();
  const nombre = await buscar(pais, slug);
  if (!nombre) notFound();
  return <PaginaListado pais={pais} titulo={nombre} base={`/${pais}/familia/${slug}`} fijos={{ families: [slug] }} searchParams={await searchParams} />;
}
