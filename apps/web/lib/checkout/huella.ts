/**
 * Huella de la solicitud del checkout para la idempotencia (§10.2). La misma clave con otro contenido no es un
 * reintento: es otro pedido y se responde `IDEMPOTENCY_CONFLICT`.
 *
 * Se calcula sobre lo que define el pedido (país, líneas, método, código efectivo y dirección), normalizado
 * igual desde la petición y desde el pedido guardado, para poder comparar con lo que la base ya persiste. El
 * hash viaja también en la fila (`checkout_request_hash`) para cuando la base lo guarde (pedido a izao-db).
 */
import { createHash } from 'node:crypto';
import type { CountryCode } from '@izao/core/money';
import type { PricingPaymentMethod } from '@izao/core/pricing';
import { isFinancingMethod } from '@izao/core/contracts';
import type { CheckoutInput } from '@izao/core/schemas';

export interface DatosSolicitud {
  country_code: CountryCode;
  payment_method: PricingPaymentMethod;
  /** Código que el pedido usa de verdad (con Addi o Sistecrédito se retira: `null`). */
  discount_code: string | null;
  items: readonly { variant_id: string | null; quantity: number }[];
  shipping: {
    region_id: string;
    city_id: string;
    district: string | null;
    address1: string;
    address2: string | null;
    notes: string | null;
  };
}

/** Lo que la petición validada pide, con el código efectivo (el mismo criterio de `crear-pedido.ts`). */
export function solicitudDeEntrada(e: CheckoutInput): DatosSolicitud {
  const financiacion = e.payment_method !== 'manual' && isFinancingMethod(e.payment_method);
  return {
    country_code: e.country_code,
    payment_method: e.payment_method,
    discount_code: financiacion ? null : e.discount_code,
    items: e.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
    shipping: {
      region_id: e.shipping.region_id,
      city_id: e.shipping.city_id,
      district: e.shipping.district,
      address1: e.shipping.address1,
      address2: e.shipping.address2,
      notes: e.shipping.notes,
    },
  };
}

const uuid = (v: string | null) => (v === null ? null : v.trim().toLowerCase());
const texto = (v: string | null) => {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
};

/** SHA-256 (hex) de la forma canónica: claves en orden fijo, líneas ordenadas por variante, UUID en minúsculas. */
export function huellaSolicitud(d: DatosSolicitud): string {
  const items = d.items
    .map((i) => [uuid(i.variant_id), i.quantity] as const)
    .sort((a, b) => ((a[0] ?? '') < (b[0] ?? '') ? -1 : (a[0] ?? '') > (b[0] ?? '') ? 1 : a[1] - b[1]));
  const canonico = JSON.stringify([
    'v1',
    d.country_code,
    d.payment_method,
    texto(d.discount_code)?.toUpperCase() ?? null,
    items,
    [
      uuid(d.shipping.region_id),
      uuid(d.shipping.city_id),
      texto(d.shipping.district),
      texto(d.shipping.address1),
      texto(d.shipping.address2),
      texto(d.shipping.notes),
    ],
  ]);
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}
