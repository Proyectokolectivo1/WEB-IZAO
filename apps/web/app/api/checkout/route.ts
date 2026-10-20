import { manejarCheckout } from '@/lib/checkout/http';
import { fuenteSupabase } from '@/lib/checkout/fuente-supabase';
import { fuentePagosSupabase } from '@/lib/checkout/fuente-pagos-supabase';
import { crearLimitadorMemoria, enteroEnv } from '@/lib/checkout/limite-tasa';
import { encolarInicioCod } from './cola-cod';

/**
 * `POST /api/checkout`: crea el pedido recalculando todo en el servidor (§10, §11). Contrato en
 * `lib/checkout/crear-pedido.ts` (`RespuestaPedido`, `ErrorCheckout`). Con Wompi deja listo el intento de pago
 * (`payment`, §12.2); con contra entrega encola `cod.iniciar` (§13.1). Node: firma con `node:crypto`. Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorMemoria({
  limite: enteroEnv(process.env.CHECKOUT_RATE_LIMIT_PER_MIN, 10),
  ventanaMs: 60_000,
});

export async function POST(req: Request) {
  return manejarCheckout(req, {
    fuente: () => fuenteSupabase,
    limitador,
    pagos: { fuente: () => fuentePagosSupabase, urlSitio: process.env.SITE_URL ?? 'https://izaoperfumeria.com' },
    encolarCod: encolarInicioCod,
  });
}
