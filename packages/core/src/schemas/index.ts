/**
 * Esquemas zod compartidos (§10, §26.1: validación de entrada en toda ruta).
 * El cliente nunca manda precios ni totales: solo variantes y cantidades (regla 2).
 */
import { z } from 'zod';
import { DOCUMENT_TYPES, type PaymentMethod, type VerifiedEvent } from '../contracts';
import { COUNTRY_CURRENCY, MoneyError, fromDbAmount, type CountryCode } from '../money';
import { ORDER_STATUSES } from '../order-state';

export const countryCodeSchema = z.enum(['CO', 'EC']);
export const currencyCodeSchema = z.enum(['COP', 'USD']);
/** Identificador uuid (formato 8-4-4-4-12 hexadecimal). */
export const idSchema = z.guid();

// ---------------------------------------------------------------------------
// Montos
// ---------------------------------------------------------------------------

/**
 * Monto en unidad menor. Acepta `bigint`, texto de dígitos (JSON no transporta bigint)
 * o `number` entero seguro (tipos generados, B3). Salida siempre `bigint`.
 */
export const amountSchema = z
  .union([z.bigint(), z.string().regex(/^-?\d+$/), z.number().int()])
  .transform((v, ctx) => {
    try {
      return fromDbAmount(v);
    } catch (e) {
      ctx.issues.push({
        code: 'custom',
        message: e instanceof MoneyError ? e.message : 'Monto inválido.',
        input: v,
      });
      return z.NEVER;
    }
  });

// ---------------------------------------------------------------------------
// Celular (§10.1)
// ---------------------------------------------------------------------------

export interface NormalizedPhone {
  /** Número nacional: CO 10 dígitos (3…), EC 9 dígitos (9…). */
  national: string;
  e164: string;
}

const PHONE_RULES: Record<CountryCode, { prefix: string; re: RegExp; trunk: string | null }> = {
  CO: { prefix: '57', re: /^3\d{9}$/, trunk: null },
  EC: { prefix: '593', re: /^9\d{8}$/, trunk: '0' },
};

/** Normaliza un celular del país o devuelve `null` si no es válido. */
export function normalizePhone(country: CountryCode, raw: string): NormalizedPhone | null {
  const rule = PHONE_RULES[country];
  if (!rule) return null;
  const compact = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (compact.startsWith('+')) {
    if (!digits.startsWith(rule.prefix)) return null;
    digits = digits.slice(rule.prefix.length);
  } else if (!rule.re.test(digits) && digits.startsWith(rule.prefix)) {
    digits = digits.slice(rule.prefix.length);
  }
  if (rule.trunk && digits.startsWith(rule.trunk) && !rule.re.test(digits)) {
    digits = digits.slice(rule.trunk.length);
  }
  if (!rule.re.test(digits)) return null;
  return { national: digits, e164: `+${rule.prefix}${digits}` };
}

const PHONE_MESSAGE: Record<CountryCode, string> = {
  CO: 'El celular debe tener 10 dígitos y empezar por 3.',
  EC: 'El celular debe tener 9 dígitos y empezar por 9.',
};

export function phoneSchemaFor(country: CountryCode) {
  return z
    .string()
    .max(30)
    .transform((v, ctx) => {
      const p = normalizePhone(country, v);
      if (!p) {
        ctx.issues.push({ code: 'custom', message: PHONE_MESSAGE[country], input: v });
        return z.NEVER;
      }
      return p;
    });
}

// ---------------------------------------------------------------------------
// Documento (§10.1)
// ---------------------------------------------------------------------------

/**
 * Quita puntos, espacios y guiones y pasa a mayúsculas: `1.020.304.050` → `1020304050`.
 * [VERIFICAR] que MasterShop acepte el NIT sin guion y con el dígito de verificación pegado.
 */
export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase();
}

/**
 * Reglas por tipo de documento. Interpretación propia (la especificación solo fija los
 * tipos y que el documento es obligatorio); todas quedan [VERIFICAR] con MasterShop y
 * las pasarelas antes de producción.
 */
const DOCUMENT_RULES: Record<string, { re: RegExp; message: string }> = {
  // [VERIFICAR] CC: solo dígitos, 3 a 15.
  CC: { re: /^\d{3,15}$/, message: 'La cédula solo lleva números.' },
  // [VERIFICAR] TI: solo dígitos, 3 a 15.
  TI: { re: /^\d{3,15}$/, message: 'La tarjeta de identidad solo lleva números.' },
  // [VERIFICAR] NIT: solo dígitos, 3 a 15; el dígito de verificación queda pegado al quitar el guion.
  NIT: { re: /^\d{3,15}$/, message: 'El NIT solo lleva números.' },
  // [VERIFICAR] CE: letras y dígitos, 3 a 20.
  CE: { re: /^[A-Z0-9]{3,20}$/, message: 'La cédula de extranjería no es válida.' },
  // [VERIFICAR] PAS: letras y dígitos, 3 a 20.
  PAS: { re: /^[A-Z0-9]{3,20}$/, message: 'El pasaporte no es válido.' },
  // [VERIFICAR] Cédula de Ecuador: exactamente 10 dígitos (sin validar el dígito verificador).
  CEDULA: { re: /^\d{10}$/, message: 'La cédula debe tener 10 dígitos.' },
  // [VERIFICAR] RUC de Ecuador: exactamente 13 dígitos.
  RUC: { re: /^\d{13}$/, message: 'El RUC debe tener 13 dígitos.' },
  // [VERIFICAR] Pasaporte en Ecuador: letras y dígitos, 3 a 20.
  PASAPORTE: { re: /^[A-Z0-9]{3,20}$/, message: 'El pasaporte no es válido.' },
};

export function documentSchemaFor(country: CountryCode) {
  return z
    .strictObject({
      type: z.enum(DOCUMENT_TYPES[country]),
      number: z.string().max(40),
    })
    .transform((v, ctx) => {
      const number = normalizeDocumentNumber(v.number);
      const rule = DOCUMENT_RULES[v.type]!;
      if (!rule.re.test(number)) {
        ctx.issues.push({ code: 'custom', message: rule.message, input: v.number, path: ['number'] });
        return z.NEVER;
      }
      return { type: v.type, number };
    });
}

// ---------------------------------------------------------------------------
// Nombres (§10.2: MasterShop solo acepta letras y espacios)
// ---------------------------------------------------------------------------

const LETTER = 'A-Za-zÀ-ÖØ-öø-ÿ';

/**
 * Deja solo letras (incluye tildes, ñ y diéresis) y espacios. Los apóstrofos se quitan,
 * el resto de signos y dígitos se vuelven espacio; los espacios se colapsan.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/['’`´]/g, '')
    .replace(new RegExp(`[^${LETTER}\\s]`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const personNameSchema = z
  .string()
  .max(120)
  .transform((v, ctx) => {
    const n = normalizeName(v);
    if (n.length === 0 || n.length > 80) {
      ctx.issues.push({ code: 'custom', message: 'Escribe un nombre con letras.', input: v });
      return z.NEVER;
    }
    return n;
  });

// ---------------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------------

/**
 * Límite técnico contra abuso, no regla comercial: el stock real lo valida el servidor.
 */
const MAX_QUANTITY_PER_LINE = 999;
const MAX_CART_LINES = 100;

export const cartItemSchema = z.strictObject({
  variant_id: idSchema,
  quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE),
});

export const cartSchema = z
  .array(cartItemSchema)
  .max(MAX_CART_LINES)
  .refine((items) => new Set(items.map((i) => i.variant_id)).size === items.length, {
    message: 'Hay variantes repetidas en el carrito.',
  });

/** Código escrito por el cliente: mayúsculas, sin espacios, mismo patrón que la base. */
export const discountCodeInputSchema = z
  .string()
  .max(64)
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{1,40}$/, 'El código no es válido.'));

// ---------------------------------------------------------------------------
// Checkout (§10.1, §10.2)
// ---------------------------------------------------------------------------

export const checkoutPaymentMethodSchema = z.enum(['wompi', 'addi', 'sistecredito', 'cod', 'manual']);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const t = v?.trim() ?? '';
      return t === '' ? null : t;
    });

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('El correo no es válido.').max(254))
  .nullish()
  .transform((v) => v ?? null);

const rawCheckoutSchema = z.strictObject({
  country_code: countryCodeSchema,
  /** Clave de idempotencia por envío del formulario (evita pedidos duplicados). */
  idempotency_key: idSchema,
  items: cartSchema.refine((i) => i.length > 0, { message: 'El carrito está vacío.' }),
  contact: z.strictObject({
    first_name: personNameSchema,
    last_name: personNameSchema,
    phone: z.string().max(30),
    email: emailSchema,
  }),
  document: z.strictObject({ type: z.string().max(20), number: z.string().max(40) }),
  shipping: z.strictObject({
    region_id: idSchema,
    city_id: idSchema,
    district: optionalText(120),
    address1: z
      .string()
      .max(200)
      .transform((v) => v.trim())
      .pipe(z.string().min(3, 'Escribe la dirección.')),
    address2: optionalText(120),
    notes: optionalText(500),
  }),
  payment_method: checkoutPaymentMethodSchema,
  discount_code: discountCodeInputSchema.nullish().transform((v) => v ?? null),
  consents: z.strictObject({
    /** Términos y tratamiento de datos: obligatoria. */
    terms_and_data: z.literal(true, 'Debes aceptar los términos y el tratamiento de datos.'),
    /** Información del pedido por WhatsApp: obligatoria para contra entrega. */
    whatsapp: z.boolean(),
  }),
  /** Versión de la política de datos mostrada (`orders.data_policy_version`). */
  data_policy_version: z.string().min(1).max(40),
});

/** Solo forma y reglas por país. Para el método de pago usar `checkoutInputSchemaFor`. */
export const checkoutInputSchema = rawCheckoutSchema.transform((v, ctx) => {
  const country = v.country_code;
  const phone = normalizePhone(country, v.contact.phone);
  if (!phone) {
    ctx.issues.push({
      code: 'custom',
      message: PHONE_MESSAGE[country],
      input: v.contact.phone,
      path: ['contact', 'phone'],
    });
  }
  const doc = documentSchemaFor(country).safeParse(v.document);
  if (!doc.success) {
    for (const issue of doc.error.issues) {
      ctx.issues.push({
        code: 'custom',
        message: issue.message,
        input: v.document,
        path: ['document', ...issue.path.map(String)],
      });
    }
  }
  if (v.payment_method === 'cod' && !v.consents.whatsapp) {
    ctx.issues.push({
      code: 'custom',
      message: 'Para contra entrega debes autorizar la información del pedido por WhatsApp.',
      input: v.consents.whatsapp,
      path: ['consents', 'whatsapp'],
    });
  }
  if (!phone || !doc.success) return z.NEVER;
  if (v.payment_method === 'cod' && !v.consents.whatsapp) return z.NEVER;
  return {
    country_code: country,
    idempotency_key: v.idempotency_key,
    items: v.items,
    contact: {
      first_name: v.contact.first_name,
      last_name: v.contact.last_name,
      phone_national: phone.national,
      phone_e164: phone.e164,
      email: v.contact.email,
    },
    document: doc.data,
    shipping: v.shipping,
    payment_method: v.payment_method,
    discount_code: v.discount_code,
    consents: v.consents,
    data_policy_version: v.data_policy_version,
  };
});

/**
 * Checkout con el método validado contra los métodos activos del país (§5.4, A3).
 * `activeMethods` = métodos con `is_enabled` en `payment_method_settings` del país,
 * leídos en el servidor. `manual` solo se acepta si la lista está vacía.
 *
 * `checkoutInputSchema` solo valida la forma: el servidor debe usar esta variante (o
 * comprobar `calcularPrecios(...).payment_method_available`) antes de crear el pedido.
 */
export function checkoutInputSchemaFor(activeMethods: readonly PaymentMethod[]) {
  const active = new Set<string>(activeMethods);
  return checkoutInputSchema.superRefine((v, ctx) => {
    const ok = v.payment_method === 'manual' ? active.size === 0 : active.has(v.payment_method);
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        message: 'Este método de pago no está disponible en este país.',
        path: ['payment_method'],
      });
    }
  });
}

export type CheckoutInput = z.output<typeof checkoutInputSchema>;
export type CartItemInput = z.output<typeof cartItemSchema>;

// ---------------------------------------------------------------------------
// Resumen de pedido (lo que ve el cliente; montos como texto en JSON)
// ---------------------------------------------------------------------------

export const orderSummarySchema = z
  .strictObject({
    number: z.string().regex(/^[A-Za-z0-9-]+$/),
    country_code: countryCodeSchema,
    currency_code: currencyCodeSchema,
    status: z.enum(ORDER_STATUSES),
    payment_method: checkoutPaymentMethodSchema,
    lines: z.array(
      z.strictObject({
        name: z.string(),
        variant_label: z.string().nullable(),
        quantity: z.number().int().min(1),
        unit_price: amountSchema,
        line_discount: amountSchema,
      }),
    ),
    subtotal: amountSchema,
    discount: amountSchema,
    surcharge: amountSchema,
    total_customer: amountSchema,
    cod_deposit: amountSchema,
    cod_collect: amountSchema,
  })
  .superRefine((s, ctx) => {
    if (COUNTRY_CURRENCY[s.country_code] !== s.currency_code) {
      ctx.addIssue({ code: 'custom', message: 'Moneda distinta a la del país.', path: ['currency_code'] });
    }
    if (s.total_customer !== s.subtotal - s.discount + s.surcharge) {
      ctx.addIssue({ code: 'custom', message: 'El total no cuadra.', path: ['total_customer'] });
    }
    const cod = s.payment_method === 'cod';
    if (cod ? s.cod_deposit + s.cod_collect !== s.total_customer : s.cod_deposit !== 0n || s.cod_collect !== 0n) {
      ctx.addIssue({ code: 'custom', message: 'Abono y recaudo no cuadran.', path: ['cod_collect'] });
    }
  });

export type OrderSummary = z.output<typeof orderSummarySchema>;

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const verifiedEventSchema = z.strictObject({
  provider: z.string().min(1).max(40),
  event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(120),
  occurred_at: z.iso.datetime({ offset: true }).nullable(),
  refs: z.strictObject({
    provider_transaction_id: z.string().min(1).nullable(),
    provider_reference: z.string().min(1).nullable(),
    payment_link_id: z.string().min(1).nullable(),
  }),
  payload: z.unknown(),
}) satisfies z.ZodType<VerifiedEvent>;
