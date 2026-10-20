import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { EstadoEnlacePago } from '@/components/store/pagar/EstadoEnlacePago';
import { esPais } from '@/lib/store/pais';
import { abrirEnlacePago } from '@/lib/store/pagar/datos';
import { tienda } from '@/lib/store/datos';
import { TC } from '@/lib/store/textos-checkout';

type Props = { params: Promise<{ country: string; token: string }> };

// Cada visita cuenta un clic y el estado depende del pago: nunca se cachea ni se indexa.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (!esPais(country)) return {};
  return { title: TC.pagar.titulo, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Link de marca del abono (`/{pais}/pagar/{token}`, §12.2): lleva al pago vigente o explica por qué ya no hace falta. */
export default async function PaginaPagar({ params }: Props) {
  const { country: pais, token } = await params;
  if (!esPais(pais)) notFound();

  const resultado = await abrirEnlacePago(pais, token);
  // Token inexistente, mal formado o de otro país: 404 real, sin confirmar nada.
  if (resultado.tipo === 'no_existe') notFound();
  if (resultado.tipo === 'redirigir') redirect(resultado.url);

  const ajustes = await tienda().ajustes(pais);
  return <EstadoEnlacePago tipo={resultado.tipo} numero={resultado.numero} pais={pais} whatsappAsesor={ajustes.whatsappAsesor} />;
}
