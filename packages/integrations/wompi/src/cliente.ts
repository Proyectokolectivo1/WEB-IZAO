/**
 * Cliente mínimo de la API de Wompi (docs.wompi.co, D-024). `GET /v1/transactions/{id}` solo responde
 * con la llave privada (`Authorization: Bearer prv_…`) desde el servidor; con la pública da 404.
 * Respuesta `{ data: { id, status, amount_in_cents, reference, currency, payment_link_id, … } }`.
 * Los errores nunca incluyen la llave ni el cuerpo de la respuesta.
 */
import { z } from 'zod';
import type { Environment, ProviderStatus } from '@izao/core/contracts';
import { WOMPI_API_BASE } from './credentials';
import { ESTADOS_WOMPI, estadoDePago, type EstadoWompi } from './estado';

export type CodigoErrorWompi = 'ID_INVALIDO' | 'NO_ENCONTRADA' | 'CREDENCIALES' | 'RED' | 'HTTP' | 'RESPUESTA_INVALIDA';

export class ErrorWompi extends Error {
  readonly codigo: CodigoErrorWompi;
  readonly reintentable: boolean;
  readonly status: number | null;
  constructor(codigo: CodigoErrorWompi, reintentable: boolean, status: number | null = null) {
    super(`Wompi: ${codigo}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'ErrorWompi';
    this.codigo = codigo;
    this.reintentable = reintentable;
    this.status = status;
  }
}

export interface TransaccionWompi {
  id: string;
  status: EstadoWompi;
  amount_in_cents: bigint;
  reference: string;
  currency: string;
  payment_link_id: string | null;
  status_message: string | null;
}

const respuestaSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    status: z.enum(ESTADOS_WOMPI),
    amount_in_cents: z.number().int().positive().refine(Number.isSafeInteger),
    reference: z.string().min(1),
    currency: z.string().min(3),
    payment_link_id: z.string().nullish(),
    status_message: z.string().nullish(),
  }),
});

export interface OpcionesCliente {
  ambiente: Environment;
  llavePrivada: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ClienteWompi {
  obtenerTransaccion(id: string): Promise<TransaccionWompi>;
}

const ID_TRANSACCION = /^[A-Za-z0-9_-]{1,64}$/;

export function crearClienteWompi(o: OpcionesCliente): ClienteWompi {
  const base = WOMPI_API_BASE[o.ambiente];
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 10_000;
  return {
    async obtenerTransaccion(id) {
      if (!ID_TRANSACCION.test(id)) throw new ErrorWompi('ID_INVALIDO', false);
      let res: Response;
      try {
        res = await doFetch(`${base}/transactions/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${o.llavePrivada}`, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new ErrorWompi('RED', true);
      }
      if (res.status === 404) throw new ErrorWompi('NO_ENCONTRADA', false, 404);
      if (res.status === 401 || res.status === 403) throw new ErrorWompi('CREDENCIALES', false, res.status);
      if (!res.ok) throw new ErrorWompi('HTTP', res.status >= 500 || res.status === 429, res.status);
      let cuerpo: unknown;
      try {
        cuerpo = await res.json();
      } catch {
        throw new ErrorWompi('RESPUESTA_INVALIDA', true, res.status);
      }
      const p = respuestaSchema.safeParse(cuerpo);
      if (!p.success) throw new ErrorWompi('RESPUESTA_INVALIDA', false, res.status);
      const d = p.data.data;
      return {
        id: d.id,
        status: d.status,
        amount_in_cents: BigInt(d.amount_in_cents),
        reference: d.reference,
        currency: d.currency,
        payment_link_id: d.payment_link_id ?? null,
        status_message: d.status_message ?? null,
      };
    },
  };
}

/**
 * Estado confirmado para el job. `amount` en unidad menor de la base (COP, exponente 0): si los centavos
 * no cierran a pesos enteros o la moneda no es COP, `amount`/`currency_code` quedan `null` y no se aprueba.
 */
export function estadoProveedor(t: TransaccionWompi): ProviderStatus {
  const esCop = t.currency === 'COP';
  return {
    status: estadoDePago(t.status),
    provider_transaction_id: t.id,
    amount: esCop && t.amount_in_cents % 100n === 0n ? t.amount_in_cents / 100n : null,
    currency_code: esCop ? 'COP' : null,
    fee_amount: null,
    raw: {
      id: t.id,
      status: t.status,
      reference: t.reference,
      amount_in_cents: t.amount_in_cents.toString(),
      currency: t.currency,
      payment_link_id: t.payment_link_id,
      status_message: t.status_message,
    },
  };
}
