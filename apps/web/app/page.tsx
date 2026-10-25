import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PARAMETROS_ATRIBUCION } from '@/lib/store/atribucion/captura';
import { PAIS_POR_DEFECTO, esPais } from '@/lib/store/pais';

/**
 * `/` lleva al país de la cookie `country`; sin cookie, a Colombia (la geolocalización por IP queda para
 * el middleware). Cualquier otro valor cae en `/co` (§5.1). Conserva `ref`, UTM y click IDs para que el enlace
 * de un influencer o de un anuncio sin país no pierda su atribución.
 */
export default async function Inicio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pais = (await cookies()).get('country')?.value?.toLowerCase();
  const sp = await searchParams;
  const reenviar = new URLSearchParams();
  for (const k of PARAMETROS_ATRIBUCION) {
    const v = sp[k];
    const valor = Array.isArray(v) ? v[0] : v;
    if (valor) reenviar.set(k, valor);
  }
  const consulta = reenviar.toString();
  redirect(`/${esPais(pais) ? pais : PAIS_POR_DEFECTO}${consulta ? `?${consulta}` : ''}`);
}
