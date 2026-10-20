import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { clasesBoton } from '@izao/ui';
import { PaginaListado, type ParamsBusqueda } from '@/components/store/catalogo/PaginaListado';
import { tienda } from '@/lib/store/datos';
import { parsearEstado } from '@/lib/store/filtros';
import { esPais } from '@/lib/store/pais';
import { metaListado } from '@/lib/store/seo';
import { T } from '@/lib/store/textos';

type Props = { params: Promise<{ country: string }>; searchParams: Promise<ParamsBusqueda> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  const { q } = parsearEstado(await searchParams);
  return metaListado(country, `/${country}/buscar`, q ? T.listado.resultadosParaBusqueda(q) : T.buscar.titulo, await searchParams, { noIndexar: true });
}

export default async function Buscar({ params, searchParams }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  const sp = await searchParams;
  const { q } = parsearEstado(sp);

  if (!q) {
    const populares = await tienda().busquedasPopulares(pais);
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:px-8">
        <h1 className="text-4xl md:text-5xl">{T.buscar.titulo}</h1>
        <p className="mt-3 text-ink/80">{T.buscar.ayuda}</p>
        {populares.length > 0 ? (
          <div className="mt-10 border-t border-line pt-6">
            <h2 className="etiqueta">{T.busqueda.populares}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {populares.map((p) => (
                <li key={p}>
                  <Link href={`/${pais}/buscar?q=${encodeURIComponent(p)}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-4 hover:border-ink hover:bg-surface">
                    {p}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: 'secundario', className: 'mt-10' })}>
          {T.buscar.verCatalogo}
        </Link>
      </section>
    );
  }

  return <PaginaListado pais={pais} titulo={T.listado.resultadosParaBusqueda(q)} base={`/${pais}/buscar`} searchParams={sp} esBusqueda />;
}
