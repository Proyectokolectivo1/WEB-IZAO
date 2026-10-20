import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { tienda } from '@/lib/store/datos';
import { depurarHtml } from '@/lib/store/html-seguro';
import { esPais } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';

type Props = { params: Promise<{ country: string; slug: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, slug } = await params;
  if (!esPais(country)) return {};
  const pagina = await tienda().paginaLegal(country, slug);
  if (!pagina) return {};
  return {
    title: pagina.seo_title ?? pagina.title,
    description: pagina.seo_description ?? undefined,
    // Las páginas legales son propias de cada país: sin hreflang entre países.
    alternates: { canonical: `/${country}/pagina/${slug}` },
  };
}

export default async function PaginaTexto({ params }: Props) {
  const { country: pais, slug } = await params;
  if (!esPais(pais)) notFound();
  // `paginaLegal` solo devuelve páginas con status = 'published'.
  const pagina = await tienda().paginaLegal(pais, slug);
  if (!pagina) notFound();
  const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date(pagina.updated_at));

  return (
    <article className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="max-w-3xl border-b border-line pb-6">
        <h1 className="text-4xl md:text-5xl">{pagina.title}</h1>
        <p className="mt-3 text-[0.9375rem] text-ink/70">{T.pagina.actualizado(fecha)}</p>
      </header>
      <div className="contenido-legal pt-8" dangerouslySetInnerHTML={{ __html: depurarHtml(pagina.content_html) }} />
    </article>
  );
}
