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

const transaccionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ESTADOS_WOMPI),
  amount_in_cents: z.number().int().positive().refine(Number.isSafeInteger),
  reference: z.string().min(1),
  currency: z.string().min(3),
  payment_link_id: z.string().nullish(),
  status_message: z.string().nullish(),
});
const respuestaSchema = z.object({ data: transaccionSchema });
/** Búsqueda: `{ data: [Transaction…], meta }` (la referencia oficial no detalla el 200; ver D-059 [VERIFICAR]). */
const busquedaSchema = z.object({ data: z.array(z.unknown()) });

export interface OpcionesCliente {
  ambiente: Environment;
  llavePrivada: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Filtros de `GET /v1/transactions` (referencia oficial 1.2.0, llave privada): `reference`, o bien
 * `from_date` + `until_date` (`AAAA-MM-DD`) con `page` y `page_size`. Wompi no filtra por `payment_link_id`:
 * para el abono se busca por fechas y se filtra aquí.
 */
export type FiltroTransacciones =
  | { reference: string }
  | { from_date: string; until_date: string; page_size?: number; max_paginas?: number };

export interface ClienteWompi {
  obtenerTransaccion(id: string): Promise<TransaccionWompi>;
  /** Todas las transacciones del filtro (pagina sola). Elementos con forma inesperada se descartan. */
  buscarTransacciones(filtro: FiltroTransacciones): Promise<TransaccionWompi[]>;
}

const ID_TRANSACCION = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGINA_POR_DEFECTO = 50;
const MAX_PAGINAS_POR_DEFECTO = 40;

function aTransaccion(d: z.infer<typeof transaccionSchema>): TransaccionWompi {
  return {
    id: d.id,
    status: d.status,
    amount_in_cents: BigInt(d.amount_in_cents),
    reference: d.reference,
    currency: d.currency,
    payment_link_id: d.payment_link_id ?? null,
    status_message: d.status_message ?? null,
  };
}

export function crearClienteWompi(o: OpcionesCliente): ClienteWompi {
  const base = WOMPI_API_BASE[o.ambiente];
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 10_000;

  async function obtenerJson(url: string): Promise<{ cuerpo: unknown; status: number }> {
    let res: Response;
    try {
      res = await doFetch(url, {
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
    try {
      return { cuerpo: await res.json(), status: res.status };
    } catch {
      throw new ErrorWompi('RESPUESTA_INVALIDA', true, res.status);
    }
  }

  /** Transacciones válidas de una página y cuántos elementos traía (para saber si hay más). */
  async function pagina(params: URLSearchParams): Promise<{ lista: TransaccionWompi[]; crudos: number }> {
    const { cuerpo, status } = await obtenerJson(`${base}/transactions?${params.toString()}`);
    const p = busquedaSchema.safeParse(cuerpo);
    if (!p.success) throw new ErrorWompi('RESPUESTA_INVALIDA', false, status);
    const lista: TransaccionWompi[] = [];
    for (const item of p.data.data) {
      const t = transaccionSchema.safeParse(item);
      if (t.success) lista.push(aTransaccion(t.data));
    }
    return { lista, crudos: p.data.data.length };
  }

  return {
    async obtenerTransaccion(id) {
      if (!ID_TRANSACCION.test(id)) throw new ErrorWompi('ID_INVALIDO', false);
      const { cuerpo, status } = await obtenerJson(`${base}/transactions/${encodeURIComponent(id)}`);
      const p = respuestaSchema.safeParse(cuerpo);
      if (!p.success) throw new ErrorWompi('RESPUESTA_INVALIDA', false, status);
      return aTransaccion(p.data.data);
    },

    async buscarTransacciones(filtro) {
      if ('reference' in filtro) {
        if (!filtro.reference || filtro.reference.length > 255) throw new ErrorWompi('ID_INVALIDO', false);
        try {
          return (await pagina(new URLSearchParams({ reference: filtro.reference }))).lista;
        } catch (e) {
          // Sin transacciones con esa referencia: algunas versiones responden 404 en vez de lista vacía.
          if (e instanceof ErrorWompi && e.codigo === 'NO_ENCONTRADA') return [];
          throw e;
        }
      }
      if (!FECHA.test(filtro.from_date) || !FECHA.test(filtro.until_date)) throw new ErrorWompi('ID_INVALIDO', false);
      const size = filtro.page_size ?? PAGINA_POR_DEFECTO;
      const max = filtro.max_paginas ?? MAX_PAGINAS_POR_DEFECTO;
      const todas: TransaccionWompi[] = [];
      for (let n = 1; n <= max; n += 1) {
        const lote = await pagina(
          new URLSearchParams({ from_date: filtro.from_date, until_date: filtro.until_date, page: String(n), page_size: String(size) }),
        );
        todas.push(...lote.lista);
        if (lote.crudos < size) return todas;
      }
      // Más páginas que el tope: se devuelve lo leído (el llamador decide; nunca se inventa un estado).
      return todas;
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
