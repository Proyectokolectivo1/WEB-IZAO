import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ScriptBolsoVacio } from '@/components/store/checkout/ScriptBolsoVacio';
import { FormularioCheckout } from '@/components/store/checkout/FormularioCheckout';
import { configCheckout } from '@/lib/store/checkout-datos';
import { esPais } from '@/lib/store/pais';
import { TC } from '@/lib/store/textos-checkout';

type Props = { params: Promise<{ country: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  return { title: TC.checkout.titulo, alternates: { canonical: `/${country}/checkout` }, robots: { index: false, follow: false } };
}

export default async function PaginaCheckout({ params }: Props) {
  const { country: pais } = await params;
  if (!esPais(pais)) notFound();
  const config = await configCheckout(pais);
  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="pb-8">
        <h1 className="text-4xl md:text-5xl">{TC.checkout.titulo}</h1>
      </header>
      <ScriptBolsoVacio />
      <FormularioCheckout config={config} />
    </div>
  );
}
