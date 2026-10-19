/**
 * Pedido interno → cuerpo de `POST /api/orders` de MasterShop (§14.3).
 *
 * Reglas de la documentación de MasterShop:
 * - `id_order` = `orders.number`, solo letras, números y guiones.
 * - Todas las claves son obligatorias aunque admitan `null` (`company`, `zip`, `address2`).
 * - `order_transaction.total` = Σ price × quantity + Σ additional_charge.value, exacto.
 * - `currency` legal en el país de la dirección.
 * - `documentType` y `documentNumber` van los dos o ninguno.
 * - `phone` nacional; nombres solo letras y espacios.
 */
import { COUNTRY_CURRENCY, formatMoney, money } from '@izao/core/money';
import type { Order, OrderItem } from '@izao/core/contracts';
import { z } from 'zod';
import { buildCarrierLines, CarrierLinesError } from './lines';
import type { CarrierDiscountMode, CarrierLines, CarrierPaymentKind } from './lines';

/** Tipos de documento que acepta MasterShop. */
export const MASTERSHOP_DOCUMENT_TYPES = [
  'CC',
  'NIT',
  'CE',
  'DIE',
  'NITEXT',
  'PAS',
  'RC',
  'TE',
  'TI',
] as const;
export type MasterShopDocumentType = (typeof MASTERSHOP_DOCUMENT_TYPES)[number];

/** Países donde opera MasterShop y su moneda legal. */
export const MASTERSHOP_COUNTRIES = { CO: 'COP' } as const;

export const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;
/** `[VERIFICAR]` si MasterShop acepta tildes y ñ como "letras". */
const NAME_PATTERN = /^[\p{L} ]+$/u;
const NATIONAL_PHONE_PATTERN = /^\d{10}$/;

// ---------------------------------------------------------------------------
// Esquema del cuerpo (zod)
// ---------------------------------------------------------------------------

const nameSchema = z.string().min(1).regex(NAME_PATTERN, 'Solo letras y espacios');
const phoneSchema = z.string().regex(NATIONAL_PHONE_PATTERN, 'Teléfono nacional de 10 dígitos');
const nonEmpty = z.string().trim().min(1);

export const MasterShopAddressSchema = z.strictObject({
  zip: z.string().min(1).nullable(),
  country: z.string().length(2),
  city: nonEmpty,
  state: nonEmpty,
  address1: nonEmpty,
  address2: z.string().min(1).nullable(),
  district: z.string().min(1).nullable(),
  full_name: nameSchema,
  first_name: nameSchema,
  last_name: nameSchema,
  phone: phoneSchema,
  company: z.string().min(1).nullable(),
});

export const MasterShopOrderItemSchema = z.strictObject({
  id_product: z.number().int().positive(),
  id_variant: z.number().int().positive().nullable(),
  quantity: z.number().int().positive(),
  sku: nonEmpty,
  name: nonEmpty,
  weight: z.number().positive().finite(),
  price: z.bigint().nonnegative(),
});

export const MasterShopOrderBodySchema = z
  .strictObject({
    id_order: z.string().regex(ORDER_NUMBER_PATTERN, 'Solo letras, números y guiones'),
    shipping_address: MasterShopAddressSchema,
    billing_address: MasterShopAddressSchema,
    order_transaction: z.strictObject({
      total: z.bigint().positive(),
      currency: z.enum(['COP', 'USD']),
      payment_method: z.enum(['cod', 'pia']),
      payment_gateway: nonEmpty,
    }),
    customer: z.strictObject({
      full_name: nameSchema,
      first_name: nameSchema,
      last_name: nameSchema,
      phone: phoneSchema,
      email: z.email().nullable(),
      documentType: z.enum(MASTERSHOP_DOCUMENT_TYPES).nullable(),
      documentNumber: z.string().min(1).nullable(),
      tags: z.array(z.string()),
    }),
    order_items: z.array(MasterShopOrderItemSchema).min(1),
    additional_charge: z.array(z.strictObject({ type_charge: nonEmpty, value: z.bigint() })),
    notes: z.array(z.string()),
    tags: z.array(z.string()),
  })
  .superRefine((body, ctx) => {
    const lines = body.order_items.reduce((a, i) => a + i.price * BigInt(i.quantity), 0n);
    const charges = body.additional_charge.reduce((a, c) => a + c.value, 0n);
    if (lines + charges !== body.order_transaction.total) {
      ctx.addIssue({
        code: 'custom',
        path: ['order_transaction', 'total'],
        message: 'total ≠ Σ price × quantity + Σ additional_charge.value',
      });
    }
    if ((body.customer.documentType === null) !== (body.customer.documentNumber === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['customer', 'documentNumber'],
        message: 'documentType y documentNumber van los dos o ninguno',
      });
    }
    const legal = (MASTERSHOP_COUNTRIES as Record<string, string>)[body.shipping_address.country];
    if (legal !== body.order_transaction.currency) {
      ctx.addIssue({
        code: 'custom',
        path: ['order_transaction', 'currency'],
        message: 'La moneda no es legal en el país de la dirección',
      });
    }
  });

export type MasterShopAddress = z.infer<typeof MasterShopAddressSchema>;
export type MasterShopOrderItem = z.infer<typeof MasterShopOrderItemSchema>;
export type MasterShopOrderBody = z.infer<typeof MasterShopOrderBodySchema>;

// ---------------------------------------------------------------------------
// Errores tipados para el panel
// ---------------------------------------------------------------------------

export type CarrierOrderIssueCode =
  | 'numero_invalido'
  | 'pais_no_soportado'
  | 'moneda_no_legal'
  | 'metodo_no_soportado'
  | 'nombre_invalido'
  | 'telefono_invalido'
  | 'correo_invalido'
  | 'documento_incompleto'
  | 'documento_tipo_invalido'
  | 'direccion_incompleta'
  | 'variante_sin_vinculo'
  | 'peso_invalido'
  | 'valor_invalido'
  | 'total_no_cuadra'
  | 'esquema_invalido';

export interface CarrierOrderIssue {
  code: CarrierOrderIssueCode;
  /** Campo del pedido interno (`contact_phone_e164`, `items.1`, …). */
  path: string;
  /** Texto en español para el panel. */
  message: string;
  sku?: string;
}

export class CarrierOrderError extends Error {
  readonly issues: CarrierOrderIssue[];
  constructor(issues: CarrierOrderIssue[]) {
    super(`El pedido no se puede enviar a MasterShop: ${issues.map((i) => i.message).join(' · ')}`);
    this.name = 'CarrierOrderError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

export interface CarrierOrderOptions {
  /** `country_settings.carrier_discount_mode`. */
  mode: CarrierDiscountMode;
  /**
   * `order_transaction.payment_gateway`: pasarela del pago completo (Wompi, Addi,
   * Sistecrédito) o, en contra entrega, la del abono.
   */
  paymentGateway: string;
  /** Referencia del pago aprobado (abono o pago completo), para `notes`. */
  paymentReference?: string | null;
}

export interface BuiltCarrierOrder {
  body: MasterShopOrderBody;
  lines: CarrierLines<OrderItem>;
}

const GATEWAY_LABEL: Readonly<Record<string, string>> = {
  wompi: 'Wompi',
  addi: 'Addi',
  sistecredito: 'Sistecrédito',
};

function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
}

/** Deja solo letras y espacios simples. */
export function sanitizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
}

/** Teléfono nacional colombiano (10 dígitos) a partir de E.164 o de un número local. */
export function nationalPhoneCO(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, '');
  let digits: string;
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+57')) return null;
    digits = compact.slice(3);
  } else {
    digits = compact;
  }
  return NATIONAL_PHONE_PATTERN.test(digits) ? digits : null;
}

function formatAmount(amount: bigint, currency: Order['currency_code']): string {
  return formatMoney(money(amount, currency)).replace(/\s/g, ' ');
}

function itemName(item: OrderItem): string {
  const name = item.name_snapshot.trim();
  const label = item.variant_label?.trim();
  if (!label || name.toLowerCase().includes(label.toLowerCase())) return name;
  return `${name} ${label}`;
}

export function buildCarrierOrder(order: Order, options: CarrierOrderOptions): BuiltCarrierOrder {
  const issues: CarrierOrderIssue[] = [];
  const add = (code: CarrierOrderIssueCode, path: string, message: string, sku?: string): void => {
    issues.push(sku === undefined ? { code, path, message } : { code, path, message, sku });
  };

  // id_order
  if (!ORDER_NUMBER_PATTERN.test(order.number)) {
    add(
      'numero_invalido',
      'number',
      order.number.includes('_')
        ? `El número ${order.number} tiene guion bajo; MasterShop no lo puede consultar.`
        : `El número "${order.number}" solo puede tener letras, números y guiones.`,
    );
  }

  // País y moneda
  const country = order.country_code;
  const legalCurrency = (MASTERSHOP_COUNTRIES as Record<string, string>)[country];
  if (legalCurrency === undefined) {
    add('pais_no_soportado', 'country_code', `MasterShop no opera en ${country}.`);
  } else if (
    order.currency_code !== legalCurrency ||
    COUNTRY_CURRENCY[country] !== order.currency_code
  ) {
    add(
      'moneda_no_legal',
      'currency_code',
      `La moneda ${order.currency_code} no es legal en ${country}.`,
    );
  }

  // Método
  const method = order.payment_method;
  if (method === 'manual') {
    add('metodo_no_soportado', 'payment_method', 'Los pedidos manuales no se envían a MasterShop.');
  }

  // Nombres
  const firstName = sanitizeName(order.contact_first_name);
  const lastName = sanitizeName(order.contact_last_name);
  if (firstName === '')
    add('nombre_invalido', 'contact_first_name', 'El nombre debe tener al menos una letra.');
  if (lastName === '')
    add('nombre_invalido', 'contact_last_name', 'El apellido debe tener al menos una letra.');
  const fullName = `${firstName} ${lastName}`.trim();

  // Teléfono
  const phone = nationalPhoneCO(order.contact_phone_e164);
  if (phone === null) {
    add(
      'telefono_invalido',
      'contact_phone_e164',
      'El celular debe ser un número de Colombia de 10 dígitos.',
    );
  }

  // Correo `[VERIFICAR]` si MasterShop admite null.
  const email = blankToNull(order.contact_email);
  if (email !== null && !z.email().safeParse(email).success) {
    add('correo_invalido', 'contact_email', 'El correo no es válido.');
  }

  // Documento: los dos o ninguno
  const docType = blankToNull(order.document_type)?.toUpperCase() ?? null;
  const docNumber = blankToNull(order.document_number);
  if ((docType === null) !== (docNumber === null)) {
    add('documento_incompleto', 'document_number', 'El tipo y el número de documento van juntos.');
  } else if (
    docType !== null &&
    !(MASTERSHOP_DOCUMENT_TYPES as readonly string[]).includes(docType)
  ) {
    add(
      'documento_tipo_invalido',
      'document_type',
      `MasterShop no acepta el tipo de documento ${docType}.`,
    );
  }

  // Dirección
  const city = blankToNull(order.shipping_city_name);
  const state = blankToNull(order.shipping_region_name);
  const address1 = blankToNull(order.shipping_address1);
  if (city === null) add('direccion_incompleta', 'shipping_city_name', 'Falta la ciudad.');
  if (state === null) add('direccion_incompleta', 'shipping_region_name', 'Falta el departamento.');
  if (address1 === null) add('direccion_incompleta', 'shipping_address1', 'Falta la dirección.');

  // Ítems: vínculo y peso
  order.items.forEach((item, i) => {
    if (item.mastershop_product_id === null || !Number.isSafeInteger(item.mastershop_product_id)) {
      add(
        'variante_sin_vinculo',
        `items.${i}`,
        `La variante ${item.sku} no está vinculada a un producto de MasterShop.`,
        item.sku,
      );
    }
    if (item.weight_kg === null || !Number.isFinite(item.weight_kg) || item.weight_kg <= 0) {
      add(
        'peso_invalido',
        `items.${i}`,
        `La variante ${item.sku} no tiene un peso válido.`,
        item.sku,
      );
    }
  });

  // Valor (§14.4)
  let lines: CarrierLines<OrderItem> | null = null;
  if (method !== 'manual') {
    const kind: CarrierPaymentKind = method;
    try {
      lines = buildCarrierLines({
        currency: order.currency_code,
        paymentKind: kind,
        mode: options.mode,
        codDeposit: kind === 'cod' ? order.cod_deposit_amount : undefined,
        items: order.items.map((it) => ({
          ...it,
          unitPrice: it.unit_price,
          lineDiscount: it.line_discount,
        })),
      }) as unknown as CarrierLines<OrderItem>;
    } catch (e) {
      if (!(e instanceof CarrierLinesError)) throw e;
      add('valor_invalido', 'items', e.message);
    }
    if (lines !== null) {
      const expected =
        kind === 'cod'
          ? order.cod_collect_amount
          : kind === 'wompi'
            ? order.total_customer
            : order.subtotal;
      if (lines.total !== expected) {
        add(
          'total_no_cuadra',
          'total_customer',
          `El valor calculado para MasterShop (${lines.total}) no coincide con el del pedido (${expected}).`,
        );
      }
    }
  }

  if (issues.length > 0 || lines === null) throw new CarrierOrderError(issues);

  const address: MasterShopAddress = {
    zip: blankToNull(order.shipping_zip),
    country,
    city: city!,
    state: state!,
    address1: address1!,
    address2: blankToNull(order.shipping_address2),
    district: blankToNull(order.shipping_district),
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    phone: phone!,
    company: null,
  };

  const kind = method as CarrierPaymentKind;
  const gatewayLabel = GATEWAY_LABEL[options.paymentGateway] ?? options.paymentGateway;
  const ref = blankToNull(options.paymentReference);
  const refText = ref === null ? '' : ` ref ${ref}`;
  const notes = [`Pedido web ${order.number}`];
  if (kind === 'cod') {
    notes.push(
      `Abono recibido ${formatAmount(order.cod_deposit_amount, order.currency_code)} ${gatewayLabel}${refText}`,
    );
  } else {
    notes.push(
      `Pago recibido ${formatAmount(order.total_customer, order.currency_code)} ${gatewayLabel}${refText}`,
    );
    if (order.financing_surcharge_amount > 0n) {
      notes.push(
        `Recargo de financiación ${formatAmount(order.financing_surcharge_amount, order.currency_code)} registrado en la tienda`,
      );
    }
  }

  const body: MasterShopOrderBody = {
    id_order: order.number,
    shipping_address: address,
    billing_address: { ...address },
    order_transaction: {
      total: lines.total,
      currency: order.currency_code,
      payment_method: lines.paymentMethod,
      payment_gateway: options.paymentGateway,
    },
    customer: {
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      phone: phone!,
      email,
      documentType: docType as MasterShopDocumentType | null,
      documentNumber: docNumber,
      tags: [],
    },
    order_items: lines.lines.map((l) => ({
      id_product: l.source.mastershop_product_id!,
      id_variant: l.source.mastershop_variant_id,
      quantity: l.quantity,
      sku: l.source.sku,
      name: itemName(l.source),
      weight: l.source.weight_kg!,
      price: l.price,
    })),
    additional_charge: lines.additionalCharges.map((c) => ({
      type_charge: c.type_charge,
      value: c.value,
    })),
    notes,
    tags: kind === 'cod' ? ['web', 'cod-abono'] : ['web', 'prepago'],
  };

  // Defensa final: el cuerpo cumple el esquema de MasterShop.
  const parsed = MasterShopOrderBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new CarrierOrderError(
      parsed.error.issues.map((i) => ({
        code: 'esquema_invalido' as const,
        path: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  return { body, lines };
}
