/**
 * Intento de pago con Wompi para `next_step = pay_wompi` (§12.2). Puro sobre `FuentePagos`.
 *
 * - Crea una fila `payments` (`provider wompi`, `purpose full`, `status created`) con `checkout_url` https del
 *   Web Checkout firmado y `expires_at` = `orders.stock_reserved_until` (la expiración va firmada: Wompi no deja
 *   pagar después de que vence la reserva). La tienda muestra el botón en `/{pais}/pedido/{token}`.
 * - Idempotente: si hay un intento `created`/`pending` vigente lo devuelve; la referencia `{número}-P{n}` es única
 *   por intento y Wompi no admite dos transacciones con la misma, así que reutilizarla evita cobros dobles.
 * - Reintento tras `pago_rechazado`: vuelve a `pendiente_pago` con `transicionar` y crea `P{n+1}`.
 * - Monto = `total_customer` recalculado por el servidor al crear el pedido; nunca llega del navegador.
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';
import { transicionar, type OrderStatus, type OrderStatusEvent } from '@izao/core/order-state';
import type { PaymentPurpose, PaymentStatus } from '@izao/core/contracts';
import { referenciaIntento, urlWebCheckout, type WompiCredentials } from '@izao/wompi';

export interface PedidoParaPago {
  id: string;
  number: string;
  public_token: string;
  status: OrderStatus;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  payment_method: string;
  total_customer: bigint;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string | null;
  contact_phone_e164: string;
  stock_reserved_until: Date | null;
}

export interface IntentoPago {
  id: string;
  status: PaymentStatus;
  purpose: PaymentPurpose;
  amount: bigint;
  provider_reference: string | null;
  checkout_url: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface NuevoIntento {
  order_id: string;
  amount: bigint;
  currency_code: CurrencyCode;
  provider_reference: string;
  checkout_url: string;
  expires_at: Date;
}

export interface FuentePagos {
  pedidoPorId(id: string): Promise<PedidoParaPago | null>;
  pedidoPorToken(pais: CountryCode, token: string): Promise<PedidoParaPago | null>;
  /** Intentos de Wompi del pedido (todos los propósitos), del más antiguo al más reciente. */
  intentosWompi(orderId: string): Promise<IntentoPago[]>;
  credencialesWompi(): Promise<WompiCredentials | null>;
  /** `duplicado` si ya existe un pago de Wompi con esa referencia (índice único). */
  insertarIntento(n: NuevoIntento): Promise<{ ok: true; intento: IntentoPago } | { ok: false; motivo: 'duplicado' }>;
  /** Cambia `orders.status` solo si sigue en `from_status` y registra el evento; `false` si no. */
  aplicarTransicion(orderId: string, evento: OrderStatusEvent): Promise<boolean>;
}

export interface OpcionesPago {
  ahora: Date;
  /** Origen público del sitio, https (`SITE_URL`). */
  urlSitio: string;
  /** Tiempo mínimo que debe quedarle a la reserva para ofrecer el pago (defecto 2 min). */
  margenMs?: number;
}

export interface PagoListo {
  checkout_url: string;
  expires_at: Date;
  reference: string;
}

export type MotivoSinPago = 'metodo' | 'estado' | 'pagado' | 'vencido' | 'sin_credenciales' | 'conflicto';

export type ResultadoPago = { ok: true; reutilizado: boolean; pago: PagoListo } | { ok: false; motivo: MotivoSinPago };

const COBRABLES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['pendiente_pago', 'pago_rechazado']);
const PAGADOS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pagado',
  'enviado_transportadora',
  'error_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);

function vigente(i: IntentoPago, limite: number): i is IntentoPago & { checkout_url: string; expires_at: Date; provider_reference: string } {
  return (
    i.purpose === 'full' &&
    (i.status === 'created' || i.status === 'pending') &&
    !!i.checkout_url?.startsWith('https://') &&
    !!i.provider_reference &&
    i.expires_at !== null &&
    i.expires_at.getTime() > limite
  );
}

function listo(i: IntentoPago & { checkout_url: string; expires_at: Date; provider_reference: string }): PagoListo {
  return { checkout_url: i.checkout_url, expires_at: i.expires_at, reference: i.provider_reference };
}

export async function prepararPagoWompi(
  fuente: FuentePagos,
  pedido: PedidoParaPago,
  o: OpcionesPago,
): Promise<ResultadoPago> {
  if (!/^https:\/\/[^\s/]+$/.test(o.urlSitio.replace(/\/+$/, ''))) throw new RangeError('SITE_URL debe ser un origen https.');
  if (pedido.payment_method !== 'wompi' || pedido.currency_code !== 'COP' || pedido.country_code !== 'CO') {
    return { ok: false, motivo: 'metodo' };
  }
  if (PAGADOS.has(pedido.status)) return { ok: false, motivo: 'pagado' };
  const intentos = (await fuente.intentosWompi(pedido.id)).filter((i) => i.purpose === 'full');
  if (intentos.some((i) => i.status === 'approved')) return { ok: false, motivo: 'pagado' };
  if (!COBRABLES.has(pedido.status)) return { ok: false, motivo: 'estado' };

  const limite = o.ahora.getTime() + (o.margenMs ?? 120_000);
  const vence = pedido.stock_reserved_until;
  if (!vence || vence.getTime() <= limite) return { ok: false, motivo: 'vencido' };

  const actual = intentos.at(-1);
  if (pedido.status === 'pendiente_pago' && actual && vigente(actual, limite)) {
    return { ok: true, reutilizado: true, pago: listo(actual) };
  }

  const creds = await fuente.credencialesWompi();
  if (!creds) return { ok: false, motivo: 'sin_credenciales' };

  if (pedido.status === 'pago_rechazado') {
    const t = transicionar({ from: 'pago_rechazado', to: 'pendiente_pago', actor: 'system', payload: { motivo: 'reintento_pago' } });
    if (!t.ok) return { ok: false, motivo: 'estado' };
    if (!(await fuente.aplicarTransicion(pedido.id, t.event))) return { ok: false, motivo: 'conflicto' };
  }

  const referencia = referenciaIntento(pedido.number, intentos.length + 1);
  const web = urlWebCheckout({
    credenciales: creds,
    referencia,
    monto: pedido.total_customer,
    moneda: pedido.currency_code,
    expiraEn: vence,
    urlRetorno: `${o.urlSitio.replace(/\/+$/, '')}/${pedido.country_code.toLowerCase()}/pedido/${encodeURIComponent(pedido.public_token)}`,
    cliente: {
      email: pedido.contact_email,
      nombreCompleto: `${pedido.contact_first_name} ${pedido.contact_last_name}`.trim(),
      celularE164: pedido.contact_phone_e164,
    },
  });
  const ins = await fuente.insertarIntento({
    order_id: pedido.id,
    amount: pedido.total_customer,
    currency_code: pedido.currency_code,
    provider_reference: referencia,
    checkout_url: web.url,
    expires_at: vence,
  });
  if (ins.ok) return { ok: true, reutilizado: false, pago: { checkout_url: web.url, expires_at: vence, reference: referencia } };

  // Otra petición creó el mismo intento al mismo tiempo: se devuelve el suyo.
  const ganador = (await fuente.intentosWompi(pedido.id)).find((i) => i.provider_reference === referencia);
  if (ganador && vigente(ganador, limite)) return { ok: true, reutilizado: true, pago: listo(ganador) };
  return { ok: false, motivo: 'conflicto' };
}
