import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { tienda } from '@/lib/store/datos';
import { depurarHtml } from '@/lib/store/html-seguro';
import { enlaceWhatsapp } from '@/lib/store/contacto';
import { esPais, formatearFecha } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import { TP } from '@/lib/store/textos-pais';
import type { CodigoPais } from '@/lib/store/types';

type Props = { params: Promise<{ country: string; slug: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, slug } = await params;
  if (!esPais(country)) return {};
  const pagina = await tienda().paginaLegal(country, slug);
  if (!pagina) return { robots: { index: false, follow: true } };
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
  if (!pagina) return <EnPreparacion pais={pais} slug={slug} />;
  const fecha = formatearFecha(pagina.updated_at, pais);

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

/**
 * Las políticas son propias de cada país (no se muestra la de otro). Si el enlace existe en el otro país y aquí aún
 * no está publicada, en vez de un error se avisa con calidez y se ofrece WhatsApp; un enlace que no existe en ninguno es 404.
 */
async function EnPreparacion({ pais, slug }: { pais: CodigoPais; slug: string }) {
  const otro: CodigoPais = pais === 'co' ? 'ec' : 'co';
  const [existeAllá, ajustes] = await Promise.all([tienda().paginaLegal(otro, slug).catch(() => null), tienda().ajustes(pais)]);
  if (!existeAllá) notFound();
  const textos = TP.preparando;
  const wa = enlaceWhatsapp(ajustes.whatsappAsesor, textos.mensaje(existeAllá.title));
  return (
    <section className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16" data-testid="pagina-en-preparacion">
      <div className="textura-calida banda-suave max-w-3xl rounded-panel p-6 md:p-12">
        <h1 className="text-3xl leading-tight md:text-5xl">{textos.titulo(T.paises[pais])}</h1>
        <p className="mt-4 max-w-xl text-[1.0625rem] text-ink/80">{wa ? textos.texto(existeAllá.title) : textos.sinWhatsapp}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {wa ? (
            <a href={wa} rel="noopener" className="inline-flex min-h-12 items-center rounded-control bg-ink px-7 text-[0.9375rem] font-semibold text-bg hover:opacity-90">
              {textos.whatsapp}
            </a>
          ) : null}
          <Link href={`/${pais}/catalogo`} className="inline-flex min-h-12 items-center rounded-control px-4 text-[0.9375rem] font-semibold underline underline-offset-4">
            {textos.volver}
          </Link>
        </div>
      </div>
    </section>
  );
}
