/**
 * Link de pago del abono de contra entrega (§12.2, §13.1, D-025). `POST /v1/payment_links` con la llave privada
 * desde el servidor. El cliente nunca recibe esta URL directamente: se le comparte `/pagar/{token}` (`pay_links`).
 * Monto en centavos = abono (unidad menor COP, exponente 0) × 100, siempre `bigint` hasta serializar.
 * Los errores nunca incluyen la llave ni el cuerpo de la respuesta.
 */
import { z } from 'zod';
import type { CurrencyCode } from '@izao/core/money';
import { ErrorWompi, type OpcionesCliente } from './cliente';
import { WOMPI_API_BASE } from './credentials';

export const URL_LINK_WOMPI = 'https://checkout.wompi.co/l/';

export interface EntradaLinkAbono {
  numeroPedido: string;
  /** Abono en unidad menor de la base (COP). */
  montoAbono: bigint;
  moneda: CurrencyCode;
  /** Vence con la reserva del pedido (`orders.stock_reserved_until`). */
  expiraEn: Date;
  /** `https://…/co/pedido/{public_token}`. */
  urlRetorno: string;
}

export interface CuerpoLinkWompi {
  name: string;
  description: string;
  single_use: true;
  collect_shipping: false;
  currency: 'COP';
  amount_in_cents: number;
  expires_at: string;
  redirect_url: string;
  sku: string;
}

export interface LinkPagoCreado {
  id: string;
  url: string;
}

/** ISO 8601 en UTC sin milisegundos ni zona, como el ejemplo oficial (`2022-12-10T14:30:00`). */
export function fechaWompiUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new RangeError('Fecha de vencimiento inválida.');
  return d.toISOString().slice(0, 19);
}

export function urlLinkPago(id: string): string {
  return `${URL_LINK_WOMPI}${encodeURIComponent(id)}`;
}

export function cuerpoLinkAbono(e: EntradaLinkAbono): CuerpoLinkWompi {
  if (e.moneda !== 'COP') throw new RangeError('Wompi solo cobra en COP.');
  if (e.montoAbono <= 0n) throw new RangeError('El abono debe ser positivo.');
  const centavos = e.montoAbono * 100n;
  if (centavos > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Abono fuera de rango.');
  if (!e.numeroPedido || e.numeroPedido.length > 36) throw new RangeError('El sku admite máximo 36 caracteres.');
  if (!/^https:\/\/[^\s]+$/.test(e.urlRetorno)) throw new RangeError('redirect_url debe ser https.');
  return {
    name: `Abono pedido ${e.numeroPedido}`,
    description: `Abono del pedido ${e.numeroPedido} con pago contra entrega`,
    single_use: true,
    collect_shipping: false,
    currency: 'COP',
    amount_in_cents: Number(centavos),
    expires_at: fechaWompiUtc(e.expiraEn),
    redirect_url: e.urlRetorno,
    sku: e.numeroPedido,
  };
}

const respuestaSchema = z.object({ data: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }) });

export async function crearLinkPago(o: OpcionesCliente, e: EntradaLinkAbono): Promise<LinkPagoCreado> {
  const cuerpo = cuerpoLinkAbono(e);
  const doFetch = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${WOMPI_API_BASE[o.ambiente]}/payment_links`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${o.llavePrivada}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
  } catch {
    throw new ErrorWompi('RED', true);
  }
  if (res.status === 401 || res.status === 403) throw new ErrorWompi('CREDENCIALES', false, res.status);
  if (!res.ok) throw new ErrorWompi('HTTP', res.status >= 500 || res.status === 429, res.status);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ErrorWompi('RESPUESTA_INVALIDA', true, res.status);
  }
  const p = respuestaSchema.safeParse(json);
  if (!p.success) throw new ErrorWompi('RESPUESTA_INVALIDA', false, res.status);
  return { id: p.data.data.id, url: urlLinkPago(p.data.data.id) };
}
