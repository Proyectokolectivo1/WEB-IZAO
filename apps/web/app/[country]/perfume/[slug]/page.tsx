import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Revelar } from '@izao/ui';
import { BloqueConfianza } from '@/components/store/ficha/BloqueConfianza';
import { BotonIza } from '@/components/store/ficha/BotonIza';
import { CompraFicha } from '@/components/store/ficha/CompraFicha';
import { EncabezadoSeccion } from '@/components/store/ficha/EncabezadoSeccion';
import { Galeria } from '@/components/store/ficha/Galeria';
import { PiramideOlfativa } from '@/components/store/ficha/PiramideOlfativa';
import { Relacionados } from '@/components/store/ficha/Relacionados';
import { Resenas } from '@/components/store/ficha/Resenas';
import { leerBeneficios } from '@/components/store/home/HomeSecciones';
import { tienda } from '@/lib/store/datos';
import { descripcionCorta, imagenesDe, jsonLdMigas, jsonLdProducto, rutaDeMedio } from '@/lib/store/ficha-seo';
import { depurarHtml } from '@/lib/store/html-seguro';
import { esPais } from '@/lib/store/pais';
import { SITIO, jsonLd } from '@/lib/store/seo';
import { T } from '@/lib/store/textos';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';

type Props = { params: Promise<{ country: string; slug: string }> };

// La ficha se genera al pedirla y se renueva cada 5 min (o al guardar en el panel: `catalog:{país}`).
export const revalidate = 300;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function cargar(pais: string, slug: string): Promise<{ pais: CodigoPais; ficha: FichaProducto } | null> {
  if (!esPais(pais) || !SLUG.test(slug) || slug.length > 160) return null;
  const ficha = await tienda().producto(pais, slug);
  return ficha ? { pais, ficha } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, slug } = await params;
  const dato = await cargar(country, slug);
  if (!dato) return { title: T.ficha.noEncontrado, robots: { index: false, follow: false } };
  const { ficha, pais } = dato;
  const descripcion = descripcionCorta(ficha);
  const imagen = rutaDeMedio(imagenesDe(ficha)[0], 1200);
  const titulo = ficha.seo_title ?? ficha.name;
  return {
    title: titulo,
    description: descripcion,
    // El slug puede no existir en el otro país: sin hreflang cruzado.
    alternates: { canonical: `/${pais}/perfume/${ficha.slug}` },
    openGraph: {
      type: 'website',
      title: titulo,
      description: descripcion,
      url: `/${pais}/perfume/${ficha.slug}`,
      images: imagen ? [{ url: imagen.ruta, width: imagen.ancho ?? undefined, height: imagen.alto ?? undefined, alt: ficha.name }] : undefined,
    },
    twitter: { card: imagen ? 'summary_large_image' : 'summary', title: titulo, description: descripcion },
  };
}

const CONTENEDOR = 'mx-auto w-full max-w-[96rem] px-4 sm:px-8';

export default async function FichaPerfume({ params }: Props) {
  const { country, slug } = await params;
  const dato = await cargar(country, slug);
  if (!dato) notFound();
  const { ficha, pais } = dato;

  const repo = tienda();
  // `home` y `espacios` están cacheados por país: no suman consultas a la base en cada ficha.
  const [home, espacios, ajustes] = await Promise.all([repo.home(pais), repo.espacios(pais), repo.ajustes(pais)]);
  const beneficios = leerBeneficios(home.secciones.find((s) => s.type === 'benefits')?.config ?? {});
  const medios = espacios.find((e) => e.key === 'medios_de_pago') ?? null;

  const imagenes = imagenesDe(ficha);
  const descripcion = ficha.description_html ? depurarHtml(ficha.description_html) : '';
  const resumen = ficha.short_description ? depurarHtml(ficha.short_description) : '';
  const migas = [
    { nombre: T.ficha.inicio, ruta: '' },
    { nombre: T.ficha.aromas, ruta: '/catalogo' },
    ...(ficha.family_slug && ficha.family_name ? [{ nombre: ficha.family_name, ruta: `/familia/${ficha.family_slug}` }] : []),
    { nombre: ficha.name, ruta: `/perfume/${ficha.slug}` },
  ];
  const detalles = [ficha.concentration_name, ficha.family_name, ficha.gender_name].filter(Boolean) as string[];

  let n = 0;
  const siguiente = () => ++n;

  return (
    <article className={`${CONTENEDOR} pb-28 pt-6 lg:pb-24`} data-testid="ficha">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdProducto(ficha, pais, { sitio: SITIO, nombreTienda: ajustes.nombreTienda })) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdMigas(pais, SITIO, migas)) }} />

      <nav aria-label={T.ficha.ruta} className="pb-6">
        <ol className="flex flex-wrap items-center gap-x-2 text-[0.875rem]">
          {migas.map((m, k) => {
            const ultima = k === migas.length - 1;
            return (
              <li key={m.ruta} className="flex items-center gap-2">
                {ultima ? (
                  <span aria-current="page" className="text-ink/70">
                    {m.nombre}
                  </span>
                ) : (
                  <Link href={`/${pais}${m.ruta}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                    {m.nombre}
                  </Link>
                )}
                {!ultima ? <span aria-hidden="true">/</span> : null}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
        <Galeria imagenes={imagenes} nombre={ficha.name} />

        <div className="flex flex-col gap-7 lg:pt-2">
          <header className="flex flex-col gap-3">
            {ficha.brand_name ? <p className="etiqueta text-ink/70">{ficha.brand_name}</p> : null}
            <h1 className="text-4xl md:text-5xl">{ficha.name}</h1>
            {detalles.length > 0 ? <p className="text-[0.9375rem]">{detalles.join(' · ')}</p> : null}
            {ficha.reviews.count > 0 && ficha.reviews.avg !== null ? (
              <a href="#resenas" className="inline-flex min-h-11 w-fit items-center text-[0.9375rem] underline underline-offset-4">
                {T.ficha.resenasPromedio(ficha.reviews.avg.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), ficha.reviews.count)}
              </a>
            ) : null}
            {resumen ? <div className="contenido-legal max-w-prose text-lg" dangerouslySetInnerHTML={{ __html: resumen }} /> : null}
          </header>

          <CompraFicha ficha={ficha} pais={pais} />
          <BotonIza slug={ficha.slug} />
          <BloqueConfianza beneficios={beneficios} medios={medios} />
        </div>
      </div>

      {descripcion ? (
        <Revelar como="section" className="pt-20">
          <EncabezadoSeccion n={siguiente()} titulo={T.ficha.sobreAroma} />
          <div className="contenido-legal max-w-3xl text-lg" dangerouslySetInnerHTML={{ __html: descripcion }} />
        </Revelar>
      ) : null}

      <Revelar como="section" className="pt-20">
        <EncabezadoSeccion n={siguiente()} titulo={T.ficha.piramide} />
        <PiramideOlfativa ficha={ficha} />
      </Revelar>

      <Revelar como="section" className="pt-20">
        <div id="resenas" className="scroll-mt-24">
          <EncabezadoSeccion n={siguiente()} titulo={T.ficha.resenas} />
          <Resenas resenas={ficha.reviews} />
        </div>
      </Revelar>

      <Relacionados pais={pais} productoId={ficha.product_id} numero={siguiente()} />
    </article>
  );
}
