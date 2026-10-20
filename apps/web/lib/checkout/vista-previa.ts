/**
 * Vista previa del carrito y del resumen del checkout (§7.7, §10.1 paso 5, §11). Contrato base en
 * `lib/store/carrito/contrato.ts`; aquí se agrega `totals` (aditivo: el esquema de la tienda lo ignora).
 *
 * - Montos: enteros en unidad menor, en texto.
 * - `max_quantity = min(existencias vendibles, pedida)`; subtotal, descuento y `line_discount` se calculan
 *   sobre esa cantidad ajustada, nunca sobre lo pedido por encima del stock.
 * - Código inexistente, inactivo, de otro país o mal escrito → `CODE_INVALID` (no se revela cuál).
 * - `applied` es provisional: el límite por cliente se verifica al crear el pedido.
 */
import { z } from 'zod';
import { COUNTRY_CURRENCY, type CountryCode } from '@izao/core/money';
import {
  calcularPrecios,
  isManualAllowed,
  type DiscountRejectionCode,
  type PricingDiscountCode,
  type PricingPaymentMethod,
  type PricingResult,
} from '@izao/core/pricing';
import { cartSchema, checkoutPaymentMethodSchema, discountCodeInputSchema } from '@izao/core/schemas';
import { cruzarCarrito } from './carrito';
import type { FuenteCheckout } from './fuente';

export const paisEntradaSchema = z
  .string()
  .max(2)
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(['CO', 'EC']));

export const entradaVistaPreviaSchema = z.strictObject({
  country: paisEntradaSchema,
  items: cartSchema,
  /** Texto libre: un formato inválido no es un 400, es `CODE_INVALID`. */
  code: z.string().max(64).nullish(),
  /** Opcional (checkout): con método se calculan recargo, abono y recaudo. */
  payment_method: checkoutPaymentMethodSchema.optional(),
});
export type EntradaVistaPrevia = z.output<typeof entradaVistaPreviaSchema>;

export type MotivoCodigoPublico = Exclude<DiscountRejectionCode, 'CODE_INACTIVE' | 'CODE_WRONG_COUNTRY'>;

/** Colapsa los motivos que revelarían si un código existe en otro país o está apagado. */
export function motivoPublico(reason: DiscountRejectionCode): MotivoCodigoPublico {
  return reason === 'CODE_INACTIVE' || reason === 'CODE_WRONG_COUNTRY' ? 'CODE_INVALID' : reason;
}

export interface RespuestaVistaPreviaServidor {
  lines: {
    variant_id: string;
    quantity: number;
    unit_price: string;
    compare_at: string | null;
    max_quantity: number;
    line_discount: string;
  }[];
  subtotal: string;
  discount: string;
  code: {
    /** `withdrawn` solo si se pidió con Addi o Sistecrédito. */
    status: 'applied' | 'rejected' | 'withdrawn';
    code: string;
    reason: MotivoCodigoPublico | null;
    missing_amount: string | null;
  } | null;
  totals: {
    currency: 'COP' | 'USD';
    payment_method: PricingPaymentMethod | null;
    payment_method_available: boolean;
    surcharge: string;
    total_customer: string;
    cod_deposit: string;
    cod_collect: string;
    available_methods: { method: string; available: boolean; reason: string | null }[];
    /** §5.4: "Finalizar por WhatsApp" solo si el país no tiene métodos activos. */
    manual_allowed: boolean;
    messages: string[];
  };
}

export type CodigoResuelto =
  | { tipo: 'ninguno' }
  | { tipo: 'invalido'; texto: string }
  | { tipo: 'leido'; codigo: PricingDiscountCode };

/** Normaliza y busca el código. Formato inválido o inexistente → `invalido` (sin consultar de más). */
export async function resolverCodigo(fuente: FuenteCheckout, crudo: string | null | undefined): Promise<CodigoResuelto> {
  if (crudo === null || crudo === undefined || crudo.trim() === '') return { tipo: 'ninguno' };
  const p = discountCodeInputSchema.safeParse(crudo);
  const texto = crudo.replace(/\s+/g, '').toUpperCase().slice(0, 40);
  if (!p.success) return { tipo: 'invalido', texto };
  const c = await fuente.codigo(p.data);
  return c ? { tipo: 'leido', codigo: c } : { tipo: 'invalido', texto: p.data };
}

export function codigoDeSalida(resuelto: CodigoResuelto, r: PricingResult): RespuestaVistaPreviaServidor['code'] {
  if (resuelto.tipo === 'ninguno') return null;
  if (resuelto.tipo === 'invalido') {
    return { status: 'rejected', code: resuelto.texto, reason: 'CODE_INVALID', missing_amount: null };
  }
  const o = r.discount_code!;
  return {
    status: o.status,
    code: o.code,
    reason: o.reason ? motivoPublico(o.reason) : null,
    missing_amount: o.missing_amount === null ? null : o.missing_amount.toString(),
  };
}

export async function vistaPrevia(
  fuente: FuenteCheckout,
  entrada: EntradaVistaPrevia,
  ahora: Date,
): Promise<RespuestaVistaPreviaServidor | null> {
  const pais: CountryCode = entrada.country;
  const config = await fuente.configPais(pais);
  if (!config || COUNTRY_CURRENCY[pais] !== config.ajustes.currency_code) return null;

  const ids = entrada.items.map((i) => i.variant_id);
  const [variantes, resuelto] = await Promise.all([
    ids.length > 0 ? fuente.variantes(pais, ids) : Promise.resolve(new Map()),
    resolverCodigo(fuente, entrada.code),
  ]);
  const carrito = cruzarCarrito(entrada.items, variantes);

  const r = calcularPrecios({
    items: carrito.items,
    countrySettings: config.ajustes,
    paymentMethod: entrada.payment_method ?? null,
    paymentMethodSettings: config.metodos,
    // Vista previa: cliente sin identificar → `customer_usage_count` null (límite por cliente pendiente).
    discountCode: resuelto.tipo === 'leido' ? { ...resuelto.codigo, customer_usage_count: null } : null,
    now: ahora,
  });

  const descuentoPorVariante = new Map(r.lines.map((l) => [l.variant_id, l.line_discount]));
  return {
    lines: carrito.lineas.map((l) => ({
      variant_id: l.variant_id,
      quantity: l.quantity,
      unit_price: (l.variante?.precio ?? 0n).toString(),
      compare_at: l.variante?.tachado != null ? l.variante.tachado.toString() : null,
      max_quantity: l.max_quantity,
      line_discount: (descuentoPorVariante.get(l.variant_id) ?? 0n).toString(),
    })),
    subtotal: r.subtotal.toString(),
    discount: r.discount.toString(),
    code: codigoDeSalida(resuelto, r),
    totals: {
      currency: r.currency,
      payment_method: r.payment_method,
      payment_method_available: r.payment_method_available,
      surcharge: r.surcharge.toString(),
      total_customer: r.total_customer.toString(),
      cod_deposit: r.cod_deposit.toString(),
      cod_collect: r.cod_collect.toString(),
      available_methods: r.available_methods.map((m) => ({ method: m.method, available: m.available, reason: m.reason })),
      manual_allowed: isManualAllowed(config.metodos),
      // Los motivos del código ya van colapsados en `code`; aquí no se repiten.
      messages: r.messages.map((m) => m.code).filter((c) => !c.startsWith('CODE_')),
    },
  };
}
