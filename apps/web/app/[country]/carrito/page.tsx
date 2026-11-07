import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ScriptBolsoVacio } from '@/components/store/checkout/ScriptBolsoVacio';
import { PaginaCarrito } from '@/components/store/checkout/PaginaCarrito';
import { EsqueletoBolsoLleno } from '@/components/store/skeletons/Esqueletos';
import { esPais } from '@/lib/store/pais';
import { TC } from '@/lib/store/textos-checkout';

type Props = { params: Promise<{ country: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  // El bolso es personal: no se indexa ni compite con el catálogo en buscadores.
  return { title: TC.carrito.titulo, alternates: { canonical: `/${country}/carrito` }, robots: { index: false, follow: false } };
}

export default async function PaginaBolso({ params }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="pb-8">
        <h1 className="text-4xl md:text-5xl">{TC.carrito.titulo}</h1>
      </header>
      <ScriptBolsoVacio />
      <PaginaCarrito esqueleto={<EsqueletoBolsoLleno className="bolso-esqueleto" />} />
    </div>
  );
}
