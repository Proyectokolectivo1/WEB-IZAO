import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CarruselCatalogo } from '@/components/store/catalogo/CarruselCatalogo';
import { PaginaListado, type ParamsBusqueda } from '@/components/store/catalogo/PaginaListado';
import { parsearEstado } from '@/lib/store/filtros';
import { esPais } from '@/lib/store/pais';
import { tienda } from '@/lib/store/datos';
import { metaListado } from '@/lib/store/seo';
import { textosSeo } from '@/lib/store/seo-textos';
import { T } from '@/lib/store/textos';

type Props = { params: Promise<{ country: string }>; searchParams: Promise<ParamsBusqueda> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  const espacios = await tienda().espacios(country).catch(() => []);
  return metaListado(country, `/${country}/catalogo`, T.listado.titulo, await searchParams, {
    descripcion: textosSeo(country, espacios).catalogoDescripcion,
  });
}

export default async function Catalogo({ params, searchParams }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  const sp = await searchParams;
  return (
    <>
      {/* Solo en la primera página: las siguientes (respaldo sin JavaScript) van directo a los productos. */}
      {parsearEstado(sp).pagina === 1 ? <CarruselCatalogo pais={pais} /> : null}
      <PaginaListado pais={pais} titulo={T.listado.titulo} base={`/${pais}/catalogo`} searchParams={sp} />
    </>
  );
}
