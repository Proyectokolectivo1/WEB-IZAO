/**
 * Callback de Addi (documentación oficial, `OnlineLoanApplicationCallbackRequest`, D-031).
 * - Autenticación HTTP Basic con el usuario y la clave que el comercio entregó a Addi (comparación en tiempo
 *   constante sobre digests). Addi no firma el cuerpo.
 * - Cuerpo `{orderId, applicationId, approvedAmount, currency, status, statusTimestamp}`; `approvedAmount`
 *   es 0 en todo lo que no sea APPROVED.
 * - Id de idempotencia: `{applicationId}.{status}.{statusTimestamp}`. Addi reintenta cada 30 min durante
 *   24 h hasta recibir 200 con el **mismo objeto** en el cuerpo de la respuesta (lo hace la ruta).
 * - Addi no documenta una consulta de estado para e-commerce: el callback autenticado es la confirmación;
 *   el job igual compara referencia, monto y moneda con `payments` antes de aprobar.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ProviderStatus, VerifiedEvent } from '@izao/core/contracts';
import { ESTADOS_ADDI, estadoPagoAddi } from './estado';
import { parseMontoAddi } from './montos';

const callbackSchema = z.object({
  orderId: z.string().regex(/^[A-Za-z0-9-]{1,60}$/),
  applicationId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  approvedAmount: z.union([z.string().max(30), z.number()]),
  currency: z.string().max(8),
  status: z.enum(ESTADOS_ADDI),
  statusTimestamp: z.union([z.string().regex(/^\d{1,13}$/), z.number().int().nonnegative()]),
});

export interface CallbackAddi {
  orderId: string;
  applicationId: string;
  approvedAmount: string;
  currency: string;
  status: (typeof ESTADOS_ADDI)[number];
  statusTimestamp: string;
}

export type ResultadoCallbackAddi =
  | { ok: true; evento: VerifiedEvent; callback: CallbackAddi }
  | { ok: false; motivo: 'autenticacion' | 'cuerpo' };

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
const iguales = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function autenticado(cabecera: string | undefined, usuario: string, clave: string): boolean {
  const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec((cabecera ?? '').trim());
  if (!m) return false;
  const texto = Buffer.from(m[1] as string, 'base64').toString('utf8');
  const i = texto.indexOf(':');
  if (i < 0) return false;
  // Ambas comparaciones siempre se ejecutan (sin cortocircuito).
  const u = iguales(texto.slice(0, i), usuario);
  const c = iguales(texto.slice(i + 1), clave);
  return u && c;
}

export function verificarCallbackAddi(
  crudo: Uint8Array,
  cabeceras: Readonly<Record<string, string>>,
  claves: { usuario: string; clave: string },
): ResultadoCallbackAddi {
  if (!claves.usuario || !claves.clave) return { ok: false, motivo: 'autenticacion' };
  if (!autenticado(cabeceras.authorization, claves.usuario, claves.clave)) return { ok: false, motivo: 'autenticacion' };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(crudo));
  } catch {
    return { ok: false, motivo: 'cuerpo' };
  }
  const p = callbackSchema.safeParse(json);
  if (!p.success) return { ok: false, motivo: 'cuerpo' };
  const callback: CallbackAddi = {
    ...p.data,
    approvedAmount: String(p.data.approvedAmount),
    statusTimestamp: String(p.data.statusTimestamp),
  };
  const segundos = Number(callback.statusTimestamp);
  const ms = callback.statusTimestamp.length > 10 ? segundos : segundos * 1000;
  return {
    ok: true,
    callback,
    evento: {
      provider: 'addi',
      event_id: `${callback.applicationId}.${callback.status}.${callback.statusTimestamp}`,
      event_type: `online_application.${callback.status}`,
      occurred_at: Number.isSafeInteger(ms) ? new Date(ms).toISOString() : null,
      refs: { provider_transaction_id: callback.applicationId, provider_reference: callback.orderId, payment_link_id: null },
      payload: callback,
    },
  };
}

/** Estado para el job. `amount` en pesos solo si la moneda es COP y no hay centavos; si no, `null` (no se aprueba). */
export function estadoCallbackAddi(c: CallbackAddi): ProviderStatus {
  const esCop = c.currency === 'COP';
  return {
    status: estadoPagoAddi(c.status),
    provider_transaction_id: c.applicationId,
    amount: esCop ? parseMontoAddi(c.approvedAmount) : null,
    currency_code: esCop ? 'COP' : null,
    fee_amount: null,
    raw: { ...c },
  };
}
