import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PAIS_POR_DEFECTO, esPais } from '@/lib/store/pais';

/**
 * `/` lleva al país de la cookie `country`; sin cookie, a Colombia (la geolocalización por IP queda para
 * el middleware). Cualquier otro valor cae en `/co` (§5.1).
 */
export default async function Inicio() {
  const pais = (await cookies()).get('country')?.value?.toLowerCase();
  redirect(`/${esPais(pais) ? pais : PAIS_POR_DEFECTO}`);
}
