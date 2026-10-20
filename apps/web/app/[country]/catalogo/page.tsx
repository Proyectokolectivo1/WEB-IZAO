import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PaginaListado, type ParamsBusqueda } from '@/components/store/catalogo/PaginaListado';
import { esPais } from '@/lib/store/pais';
import { metaListado } from '@/lib/store/seo';
import { T } from '@/lib/store/textos';

type Props = { params: Promise<{ country: string }>; searchParams: Promise<ParamsBusqueda> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  return metaListado(country, `/${country}/catalogo`, T.listado.titulo, await searchParams);
}

export default async function Catalogo({ params, searchParams }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  return <PaginaListado pais={pais} titulo={T.listado.titulo} base={`/${pais}/catalogo`} searchParams={await searchParams} />;
}
