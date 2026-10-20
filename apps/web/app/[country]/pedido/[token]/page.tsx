import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ConfirmacionPedido } from '@/components/store/checkout/ConfirmacionPedido';
import { pedidoPublico } from '@/lib/store/checkout-datos';
import { tienda } from '@/lib/store/datos';
import { textosEnvio } from '@/lib/store/envio';
import { esPais } from '@/lib/store/pais';
import { TC } from '@/lib/store/textos-checkout';

type Props = { params: Promise<{ country: string; token: string }> };

// El estado cambia con cada pago: nunca se cachea ni se indexa.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  return { title: TC.pedido.titulo, robots: { index: false, follow: false } };
}

export default async function PaginaPedido({ params }: Props) {
  const { country: pais, token } = await params;
  if (!esPais(pais)) notFound();
  const pedido = await pedidoPublico(pais, token);
  // Token inexistente o ajeno: 404 real (no se confirma si el pedido existe).
  if (!pedido) notFound();

  const [ajustes, espacios] = await Promise.all([tienda().ajustes(pais), tienda().espacios(pais)]);

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-10 sm:px-8 lg:pt-16">
      <ConfirmacionPedido pedido={pedido} whatsappAsesor={ajustes.whatsappAsesor} valorEnvio={textosEnvio(espacios).valor} />
    </div>
  );
}
