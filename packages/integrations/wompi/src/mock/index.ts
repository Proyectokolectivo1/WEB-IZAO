/**
 * Utilidades de prueba de Wompi, sin red: eventos firmados con secretos ficticios y un `fetch` falso
 * que responde `GET /transactions/{id}` como la API de sandbox. Nunca usar en producción.
 */
import { checksumEvento } from '../firmas';
import type { EstadoWompi } from '../estado';

export const SECRETO_EVENTOS_PRUEBA = 'test_events_ficticio_para_pruebas';
export const LLAVE_PRIVADA_PRUEBA = 'prv_test_ficticia_para_pruebas';

export interface TransaccionPrueba {
  id: string;
  status: EstadoWompi;
  amount_in_cents: number;
  reference: string;
  currency?: string;
  payment_link_id?: string | null;
  customer_email?: string;
}

export interface OpcionesEvento {
  secreto?: string;
  timestamp?: number;
  environment?: 'test' | 'prod';
  properties?: string[];
  event?: string;
}

/** Cuerpo de `transaction.updated` firmado como lo envía Wompi. Devuelve el texto crudo y el checksum. */
export function eventoFirmado(tx: TransaccionPrueba, o: OpcionesEvento = {}): { cuerpo: string; checksum: string } {
  const properties = o.properties ?? ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const timestamp = o.timestamp ?? 1_760_000_000;
  const data = {
    transaction: {
      id: tx.id,
      amount_in_cents: tx.amount_in_cents,
      reference: tx.reference,
      customer_email: tx.customer_email ?? 'cliente@example.com',
      currency: tx.currency ?? 'COP',
      payment_method_type: 'CARD',
      redirect_url: 'https://izaoperfumeria.com/co/pedido/x',
      status: tx.status,
      shipping_address: null,
      payment_link_id: tx.payment_link_id ?? null,
      payment_source_id: null,
    },
  };
  const valores = properties.map((p) => {
    let v: unknown = data;
    for (const parte of p.split('.')) v = (v as Record<string, unknown>)[parte];
    return String(v);
  });
  const checksum = checksumEvento(valores, timestamp, o.secreto ?? SECRETO_EVENTOS_PRUEBA);
  const cuerpo = JSON.stringify({
    event: o.event ?? 'transaction.updated',
    data,
    environment: o.environment ?? 'test',
    signature: { properties, checksum },
    timestamp,
    sent_at: '2026-10-20T15:00:00.000Z',
  });
  return { cuerpo, checksum };
}

export interface FetchFalso {
  fetch: typeof fetch;
  llamadas: { url: string; autorizacion: string | null }[];
  transacciones: Map<string, TransaccionPrueba>;
  /** Fuerza la próxima respuesta (p. ej. 500 o 401). */
  fallarCon: number | null;
}

export function fetchWompiFalso(iniciales: TransaccionPrueba[] = []): FetchFalso {
  const estado: FetchFalso = {
    llamadas: [],
    transacciones: new Map(iniciales.map((t) => [t.id, t])),
    fallarCon: null,
    fetch: undefined as unknown as typeof fetch,
  };
  estado.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const cab = new Headers(init?.headers);
    estado.llamadas.push({ url, autorizacion: cab.get('authorization') });
    if (estado.fallarCon !== null) {
      const s = estado.fallarCon;
      estado.fallarCon = null;
      return new Response(JSON.stringify({ error: { type: 'ERROR' } }), { status: s });
    }
    if (cab.get('authorization') !== `Bearer ${LLAVE_PRIVADA_PRUEBA}`) {
      return new Response(JSON.stringify({ error: { type: 'INVALID_ACCESS_TOKEN' } }), { status: 401 });
    }
    const m = /\/v1\/transactions\/([^/?]+)$/.exec(new URL(url).pathname);
    const tx = m ? estado.transacciones.get(decodeURIComponent(m[1]!)) : undefined;
    if (!tx) return new Response(JSON.stringify({ error: { type: 'NOT_FOUND_ERROR' } }), { status: 404 });
    return new Response(
      JSON.stringify({
        data: {
          id: tx.id,
          created_at: '2026-10-20T14:59:00.000Z',
          amount_in_cents: tx.amount_in_cents,
          reference: tx.reference,
          currency: tx.currency ?? 'COP',
          payment_method_type: 'CARD',
          status: tx.status,
          status_message: null,
          payment_link_id: tx.payment_link_id ?? null,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return estado;
}
