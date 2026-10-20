import { manejarVistaPrevia } from '@/lib/checkout/http';
import { fuenteSupabase } from '@/lib/checkout/fuente-supabase';
import { crearLimitadorMemoria, enteroEnv } from '@/lib/checkout/limite-tasa';

/**
 * `POST /api/checkout/preview`: vista previa del carrito y del resumen (§7.7, §11). Contrato base en
 * `lib/store/carrito/contrato.ts`; `totals` es aditivo (ver `lib/checkout/vista-previa.ts`). Sin caché.
 */
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorMemoria({
  limite: enteroEnv(process.env.CHECKOUT_PREVIEW_RATE_LIMIT_PER_MIN, 60),
  ventanaMs: 60_000,
});

export async function POST(req: Request) {
  return manejarVistaPrevia(req, { fuente: () => fuenteSupabase, limitador });
}
