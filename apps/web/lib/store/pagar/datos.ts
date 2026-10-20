/**
 * Datos de servidor de `/{pais}/pagar/{token}`: comprueba que el link sea del país, cuenta el clic y decide el destino.
 * Rol de servicio (RLS niega todo a `anon`); nunca devuelve más que el número del pedido y, si procede, la URL https.
 *
 * El clic, el estado y el destino los entrega `registrarClicPayLinkDb` (`pay_link_click`, izao-db): suma el clic de forma
 * atómica y responde `vigente` (con `target_url`), `pagado` o `vencido`. Si la base falla, la excepción sube a la página de
 * error: sin respuesta de la base no se sabe si el abono sigue pendiente, y no se redirige a ciegas.
 */
import 'server-only';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { registrarClicPayLinkDb } from '@/lib/db/pay-links';
import { usarSupabase } from '../checkout-datos';
import type { CodigoPais } from '../types';
import { REGEX_TOKEN_PAGAR, resolverPagar, urlHttps, type ResultadoPagar } from './logica';

type Fila = Record<string, unknown>;

const uno = (v: unknown): Fila | null => {
  const f = Array.isArray(v) ? v[0] : v;
  return f && typeof f === 'object' ? (f as Fila) : null;
};

/** ¿El link existe y su pedido es de este país? Se mira antes de contar el clic: un link de otro país no suma visitas. */
async function esDelPais(pais: CodigoPais, token: string): Promise<boolean> {
  const r = await crearClienteServicio().from('pay_links').select('orders!inner(country_code)').eq('token', token).maybeSingle();
  if (r.error) throw new Error(`pay_links: ${r.error.message}`);
  const pedido = uno(uno(r.data)?.orders);
  return pedido !== null && String(pedido.country_code).toLowerCase() === pais;
}

const EJEMPLOS: Record<string, ResultadoPagar> = {
  ejemplovigente000000: { tipo: 'redirigir', url: 'https://checkout.wompi.co/l/ejemplo' },
  ejemplopagado0000000: { tipo: 'pagado', numero: 'IZ-CO-000000' },
  ejemplovencido000000: { tipo: 'vencido', numero: 'IZ-CO-000000' },
};

/**
 * Resuelve `/{pais}/pagar/{token}`: 404 si el token no existe (o es de otro país), redirección al pago vigente,
 * «ya pagado» o «vencido». Cada visita a un link existente suma un clic.
 */
export async function abrirEnlacePago(pais: CodigoPais, token: string): Promise<ResultadoPagar> {
  if (!REGEX_TOKEN_PAGAR.test(token)) return { tipo: 'no_existe' };
  if (!usarSupabase()) return EJEMPLOS[token] ?? { tipo: 'no_existe' };

  if (!(await esDelPais(pais, token))) return { tipo: 'no_existe' };
  const r = await registrarClicPayLinkDb(token);
  if (!r.ok) return { tipo: 'no_existe' };
  const numero = r.order_number ?? '';
  // Un link «vigente» cuyo destino no sea https se trata como vencido (resolverPagar).
  return resolverPagar(r.estado, numero, r.estado === 'vigente' ? urlHttps(r.target_url) : null);
}
