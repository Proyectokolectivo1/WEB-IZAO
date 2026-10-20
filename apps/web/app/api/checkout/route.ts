import { manejarCheckout } from '@/lib/checkout/http';
import { fuenteSupabase } from '@/lib/checkout/fuente-supabase';
import { crearLimitadorMemoria, enteroEnv } from '@/lib/checkout/limite-tasa';

/**
 * `POST /api/checkout`: crea el pedido recalculando todo en el servidor (§10, §11). Contrato en
 * `lib/checkout/crear-pedido.ts` (`RespuestaPedido`, `ErrorCheckout`). Sin caché.
 */
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorMemoria({
  limite: enteroEnv(process.env.CHECKOUT_RATE_LIMIT_PER_MIN, 10),
  ventanaMs: 60_000,
});

export async function POST(req: Request) {
  return manejarCheckout(req, { fuente: () => fuenteSupabase, limitador });
}
