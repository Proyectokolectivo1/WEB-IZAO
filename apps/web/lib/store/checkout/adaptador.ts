/**
 * Adaptador de `POST /api/checkout`. En desarrollo con datos de ejemplo (`NEXT_PUBLIC_STORE_DATOS=ejemplo`, sin base)
 * responde con un mock local que NO crea nada y lleva a la confirmación de ejemplo; en cualquier otro caso llama
 * a la ruta real (`SERVIDOR_DISPONIBLE` de `carrito/adaptador.ts`).
 */
import { SERVIDOR_DISPONIBLE } from '../carrito/adaptador';
import { ErrorCheckout, RUTA_CHECKOUT, RespuestaPedidoCreado, type CuerpoCheckout } from './contrato';

export const TOKEN_EJEMPLO = 'ejemplo0000000000000000000000000';

const USAR_MOCK = !SERVIDOR_DISPONIBLE || (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_STORE_DATOS === 'ejemplo');

export type ResultadoCrear =
  | { tipo: 'creado'; pedido: RespuestaPedidoCreado }
  | { tipo: 'error'; estado: number; error: ErrorCheckout }
  | { tipo: 'red' }
  | { tipo: 'invalida'; estado: number };

export async function crearPedido(cuerpo: CuerpoCheckout, senal?: AbortSignal): Promise<ResultadoCrear> {
  if (USAR_MOCK) {
    if (process.env.NODE_ENV === 'production') return { tipo: 'error', estado: 503, error: { error: 'UNAVAILABLE' } };
    await new Promise((r) => setTimeout(r, 700));
    return {
      tipo: 'creado',
      pedido: { order: { number: `IZ-${cuerpo.country_code}-000000` }, public_token: TOKEN_EJEMPLO, next_step: 'manual_whatsapp' },
    };
  }
  let res: Response;
  try {
    res = await fetch(RUTA_CHECKOUT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: senal,
    });
  } catch {
    return { tipo: 'red' };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { tipo: 'invalida', estado: res.status };
  }
  if (res.ok) {
    const ok = RespuestaPedidoCreado.safeParse(json);
    return ok.success ? { tipo: 'creado', pedido: ok.data } : { tipo: 'invalida', estado: res.status };
  }
  const e = ErrorCheckout.safeParse(json);
  return e.success ? { tipo: 'error', estado: res.status, error: e.data } : { tipo: 'invalida', estado: res.status };
}
