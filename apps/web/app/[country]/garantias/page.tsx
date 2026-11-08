import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { FormularioGarantia } from '@/components/store/garantias/FormularioGarantia';
import { enlaceWhatsapp } from '@/lib/store/contacto';
import { tienda } from '@/lib/store/datos';
import { ajustesGarantia } from '@/lib/store/garantias/datos';
import { TG } from '@/lib/store/garantias/textos';
import { esPais } from '@/lib/store/pais';

type Props = { params: Promise<{ country: string }> };

// La clave de Turnstile se lee del entorno en cada petición y los ajustes ya tienen su propia caché (`content:{PAÍS}`).
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  return { title: TG.titulo, description: TG.seo, alternates: { canonical: `/${country}/garantias` } };
}

/** Formulario público de garantías (`/{pais}/garantias`, §19). Motivos, plazos y textos salen de /admin/garantias. */
export default async function PaginaGarantias({ params }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();

  const repo = tienda();
  const [ajustes, tiendaAjustes, politica] = await Promise.all([
    ajustesGarantia(pais),
    repo.ajustes(pais).catch(() => null),
    repo.paginaPorTipo(pais, 'tratamiento_datos').catch(() => null),
  ]);

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="bloque-calido textura-calida max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <p className="etiqueta text-ink/70">{TG.migas}</p>
        <h1 className="pt-2 text-4xl md:text-5xl">{TG.titulo}</h1>
        <p className="pt-4 text-lg text-ink/90">{TG.intro}</p>
      </header>

      <div className="grid gap-12 pt-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
        <div className="max-w-3xl">
          <FormularioGarantia
            pais={pais}
            motivos={ajustes.motivos}
            diasPlazo={ajustes.diasPlazo}
            diasRespuesta={ajustes.diasRespuesta}
            turnstileKey={process.env.TURNSTILE_SITE_KEY?.trim() || null}
            enlaceDatos={politica ? { href: `/${pais}/pagina/${politica.slug}`, titulo: politica.title } : null}
            enlaceAsesor={enlaceWhatsapp(tiendaAjustes?.whatsappAsesor ?? null, TG.mensajeAsesor)}
          />
        </div>

        {ajustes.instruccionesHtml || ajustes.condicionesHtml ? (
          <aside className="flex flex-col gap-8 order-first lg:order-last lg:sticky lg:top-28 lg:h-fit" aria-label={TG.condiciones}>
            {ajustes.instruccionesHtml ? (
              <section aria-labelledby="titulo-instrucciones" className="bloque-calido-acento p-5 sm:p-7">
                <h2 id="titulo-instrucciones" className="text-2xl">
                  {TG.instrucciones}
                </h2>
                <div className="contenido-legal pt-3" dangerouslySetInnerHTML={{ __html: ajustes.instruccionesHtml }} />
              </section>
            ) : null}
            {ajustes.condicionesHtml ? (
              <section aria-labelledby="titulo-condiciones" className="bloque-calido p-5 sm:p-7">
                <h2 id="titulo-condiciones" className="text-2xl">
                  {TG.condiciones}
                </h2>
                <div className="contenido-legal pt-3" dangerouslySetInnerHTML={{ __html: ajustes.condicionesHtml }} />
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
