import { manejarPago } from '@/lib/checkout/http';
import { fuentePagosSupabase } from '@/lib/checkout/fuente-pagos-supabase';
import { crearLimitadorMemoria, enteroEnv } from '@/lib/checkout/limite-tasa';

/**
 * `POST /api/checkout/pago` `{country, token}`: intento de pago con Wompi del pedido (crear o reutilizar;
 * reintento tras rechazo). Contrato en `lib/checkout/http.ts` (`manejarPago`). Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorMemoria({
  limite: enteroEnv(process.env.CHECKOUT_PAY_RATE_LIMIT_PER_MIN, 20),
  ventanaMs: 60_000,
});

export async function POST(req: Request) {
  return manejarPago(req, {
    pagos: { fuente: () => fuentePagosSupabase, urlSitio: process.env.SITE_URL ?? 'https://izaoperfumeria.com' },
    limitador,
  });
}
