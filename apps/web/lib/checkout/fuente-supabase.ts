/**
 * `FuenteCheckout` sobre Supabase con el cliente de servicio (SOLO SERVIDOR). Cada fila se valida con zod
 * antes de usarse; los montos `bigint` llegan como número o texto y salen como `bigint`
 * (`amountSchema`). Se escriben como texto (JSON no transporta bigint).
 */
import 'server-only';
import { z } from 'zod';
import type { CountryCode } from '@izao/core/money';
import type { PricingDiscountCode } from '@izao/core/pricing';
import { ORDER_STATUSES } from '@izao/core/order-state';
import type {
  ReleaseRedemptionResult,
  ReserveRedemptionResult,
  StockFunctionResult,
} from '@izao/core/contracts';
import { amountSchema, checkoutPaymentMethodSchema, countryCodeSchema, currencyCodeSchema } from '@izao/core/schemas';
import { ErrorDb, clienteDb, llamarRpc } from '@/lib/db/cliente';
import type { ConfigPais, FuenteCheckout, PedidoCreado, VarianteCheckout } from './fuente';

const uuid = z.guid();
const entero = z.number().int();
const montoNulo = amountSchema.nullable();

// ── Esquemas de filas ────────────────────────────────────────────────────────────────────────────

const filaAjustes = z.object({
  country_code: countryCodeSchema,
  cod_enabled: z.boolean(),
  cod_deposit_amount: amountSchema,
  cod_min_collect_amount: amountSchema,
  financing_surcharge_pct: z.record(z.string(), z.unknown()),
});
const filaMetodo = z.object({
  method: z.enum(['wompi', 'addi', 'sistecredito', 'cod']),
  is_enabled: z.boolean(),
  sort_order: entero,
});

export const filaVariante = z.object({
  id: uuid,
  product_id: uuid,
  sku: z.string(),
  option_value_ids: z.array(uuid).nullable(),
  weight_kg: z.union([z.number(), z.string()]).nullable(),
  mastershop_product_id: entero.nullable(),
  mastershop_variant_id: entero.nullable(),
  products: z.object({
    name: z.string(),
    status: z.string(),
    product_categories: z.array(z.object({ category_id: uuid })),
    product_countries: z.array(z.object({ country_code: z.string(), is_visible: z.boolean() })),
  }),
  variant_countries: z.array(
    z.object({
      country_code: z.string(),
      is_active: z.boolean(),
      price: amountSchema,
      compare_at_price: montoNulo,
      cost: montoNulo,
      stock: entero,
      stock_reserved: entero,
    }),
  ),
});

export const filaCodigo = z.object({
  id: uuid,
  code: z.string(),
  country_code: countryCodeSchema,
  type: z.enum(['percent', 'fixed']),
  value: amountSchema,
  max_discount_amount: montoNulo,
  min_subtotal: amountSchema,
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  is_active: z.boolean(),
  applies_to: z.enum(['all', 'categories', 'products']),
  target_ids: z.array(uuid),
  exclude_ids: z.array(uuid),
  applies_to_sale_items: z.boolean(),
  usage_limit_total: entero.nullable(),
  usage_count: entero,
  usage_limit_per_customer: entero.nullable(),
});

const COLUMNAS_PEDIDO =
  'id, number, public_token, status, country_code, currency_code, payment_method, subtotal, discount_amount, ' +
  'financing_surcharge_amount, total_customer, cod_deposit_amount, cod_collect_amount';

export const filaPedido = z.object({
  id: uuid,
  number: z.string(),
  public_token: z.string(),
  status: z.enum(ORDER_STATUSES),
  country_code: countryCodeSchema,
  currency_code: currencyCodeSchema,
  payment_method: checkoutPaymentMethodSchema,
  subtotal: amountSchema,
  discount_amount: amountSchema,
  financing_surcharge_amount: amountSchema,
  total_customer: amountSchema,
  cod_deposit_amount: amountSchema,
  cod_collect_amount: amountSchema,
});

const filaItemResumen = z.object({
  variant_id: uuid.nullable(),
  name_snapshot: z.string(),
  variant_label: z.string().nullable(),
  quantity: entero,
  unit_price: amountSchema,
  line_discount: amountSchema,
});

const resultadoFuncion = z
  .object({
    ok: z.boolean(),
    estado: z.string().nullable(),
    repetido: z.boolean().optional(),
    motivo: z.string().optional(),
    advertencia: z.string().optional(),
    faltantes: z
      .array(
        z.object({
          variant_id: uuid.nullable(),
          sku: z.string().nullable(),
          solicitado: entero,
          disponible: entero,
          motivo: z.string(),
        }),
      )
      .optional(),
  })
  .loose();

// ── Mapeos puros (probados) ──────────────────────────────────────────────────────────────────────

export function mapearVariante(
  f: z.infer<typeof filaVariante>,
  pais: CountryCode,
  valores: ReadonlyMap<string, string>,
): VarianteCheckout {
  const vc = f.variant_countries.find((x) => x.country_code === pais) ?? null;
  const visible = f.products.product_countries.some((x) => x.country_code === pais && x.is_visible);
  const etiqueta = (f.option_value_ids ?? []).map((id) => valores.get(id)).filter((v): v is string => Boolean(v));
  return {
    variant_id: f.id,
    product_id: f.product_id,
    sku: f.sku,
    nombre: f.products.name,
    etiqueta: etiqueta.length > 0 ? etiqueta.join(' / ') : null,
    category_ids: f.products.product_categories.map((c) => c.category_id),
    vendible: f.products.status === 'active' && visible && vc !== null && vc.is_active,
    precio: vc ? vc.price : null,
    tachado: vc ? vc.compare_at_price : null,
    costo: vc ? vc.cost : null,
    disponible: vc ? Math.max(0, vc.stock - vc.stock_reserved) : 0,
    peso_kg: f.weight_kg === null ? null : String(f.weight_kg),
    mastershop_product_id: f.mastershop_product_id,
    mastershop_variant_id: f.mastershop_variant_id,
  };
}

export function mapearCodigo(f: z.infer<typeof filaCodigo>): PricingDiscountCode {
  return {
    ...f,
    starts_at: f.starts_at ? new Date(f.starts_at) : null,
    ends_at: f.ends_at ? new Date(f.ends_at) : null,
    customer_usage_count: null,
  };
}

export function mapearPedido(f: z.infer<typeof filaPedido>): Omit<PedidoCreado, 'lines'> {
  return {
    id: f.id,
    number: f.number,
    public_token: f.public_token,
    status: f.status,
    country_code: f.country_code,
    currency_code: f.currency_code,
    payment_method: f.payment_method,
    subtotal: f.subtotal,
    discount: f.discount_amount,
    surcharge: f.financing_surcharge_amount,
    total_customer: f.total_customer,
    cod_deposit: f.cod_deposit_amount,
    cod_collect: f.cod_collect_amount,
  };
}

// ── Acceso ───────────────────────────────────────────────────────────────────────────────────────

function validar<S extends z.ZodType>(funcion: string, esquema: S, data: unknown): z.infer<S> {
  const r = esquema.safeParse(data);
  if (!r.success) {
    throw new ErrorDb(funcion, 'forma', `respuesta inesperada en "${r.error.issues[0]?.path.join('.') ?? ''}"`);
  }
  return r.data;
}

function revisar(funcion: string, error: { message: string; code?: string } | null): void {
  if (error) throw new ErrorDb(funcion, 'rpc', error.message, error.code ?? null);
}

const rpcPedido = <T>(funcion: string, orderId: string) =>
  llamarRpc(funcion, { p_order_id: orderId }, resultadoFuncion) as Promise<T>;

export const fuenteSupabase: FuenteCheckout = {
  async configPais(pais): Promise<ConfigPais | null> {
    const db = clienteDb();
    const [a, m] = await Promise.all([
      db
        .from('country_settings')
        .select('country_code, cod_enabled, cod_deposit_amount, cod_min_collect_amount, financing_surcharge_pct')
        .eq('country_code', pais)
        .maybeSingle(),
      db.from('payment_method_settings').select('method, is_enabled, sort_order').eq('country_code', pais),
    ]);
    revisar('country_settings', a.error);
    revisar('payment_method_settings', m.error);
    if (!a.data) return null;
    const ajustes = validar('country_settings', filaAjustes, a.data);
    return {
      ajustes: { ...ajustes, currency_code: pais === 'CO' ? 'COP' : 'USD' },
      metodos: validar('payment_method_settings', z.array(filaMetodo), m.data ?? []),
    };
  },

  async variantes(pais, ids) {
    const db = clienteDb();
    const { data, error } = await db
      .from('product_variants')
      .select(
        'id, product_id, sku, option_value_ids, weight_kg, mastershop_product_id, mastershop_variant_id, ' +
          'products(name, status, product_categories(category_id), product_countries(country_code, is_visible)), ' +
          'variant_countries(country_code, is_active, price, compare_at_price, cost, stock, stock_reserved)',
      )
      .in('id', [...ids]);
    revisar('product_variants', error);
    const filas = validar('product_variants', z.array(filaVariante), data ?? []);
    const idsValores = [...new Set(filas.flatMap((f) => f.option_value_ids ?? []))];
    const valores = new Map<string, string>();
    if (idsValores.length > 0) {
      const ov = await db.from('product_option_values').select('id, value').in('id', idsValores);
      revisar('product_option_values', ov.error);
      for (const x of validar('product_option_values', z.array(z.object({ id: uuid, value: z.string() })), ov.data ?? [])) {
        valores.set(x.id, x.value);
      }
    }
    return new Map(filas.map((f) => [f.id, mapearVariante(f, pais, valores)]));
  },

  async codigo(texto) {
    const { data, error } = await clienteDb()
      .from('discount_codes')
      .select(
        'id, code, country_code, type, value, max_discount_amount, min_subtotal, starts_at, ends_at, is_active, ' +
          'applies_to, target_ids, exclude_ids, applies_to_sale_items, usage_limit_total, usage_count, usage_limit_per_customer',
      )
      .eq('code', texto)
      .maybeSingle();
    revisar('discount_codes', error);
    return data ? mapearCodigo(validar('discount_codes', filaCodigo, data)) : null;
  },

  async usosDelCliente(codigoId, documento, celularE164, correo) {
    // Mismas claves que `reservar_canje` (documento normalizado, celular E.164 y correo del pedido).
    const claves = await llamarRpc(
      'claves_cliente',
      { p_documento: documento, p_celular: celularE164, p_correo: correo },
      z.array(z.string()),
    );
    if (claves.length === 0) return 0;
    const { count, error } = await clienteDb()
      .from('discount_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('discount_code_id', codigoId)
      .in('status', ['reserved', 'confirmed'])
      .overlaps('customer_keys', claves);
    revisar('discount_redemptions', error);
    return count ?? 0;
  },

  async ubicacion(pais, regionId, cityId) {
    const { data, error } = await clienteDb()
      .from('cities')
      .select('id, name, region_id, regions(id, name, country_code)')
      .eq('id', cityId)
      .maybeSingle();
    revisar('cities', error);
    if (!data) return null;
    const c = validar(
      'cities',
      z.object({
        id: uuid,
        name: z.string(),
        region_id: uuid,
        regions: z.object({ id: uuid, name: z.string(), country_code: z.string() }),
      }),
      data,
    );
    if (c.region_id !== regionId || c.regions.country_code !== pais) return null;
    return { region_id: c.region_id, region_nombre: c.regions.name, city_id: c.id, city_nombre: c.name };
  },

  async pedidoPorIdempotencia(clave) {
    const { data, error } = await clienteDb()
      .from('orders')
      .select(`${COLUMNAS_PEDIDO}, order_items(variant_id, name_snapshot, variant_label, quantity, unit_price, line_discount), order_events(type)`)
      .eq('checkout_idempotency_key', clave)
      .eq('order_events.type', 'created')
      .maybeSingle();
    revisar('orders', error);
    if (!data) return null;
    const f = validar(
      'orders',
      filaPedido.extend({ order_items: z.array(filaItemResumen), order_events: z.array(z.object({ type: z.string() })) }),
      data,
    );
    return {
      ...mapearPedido(f),
      lines: f.order_items.map((i) => ({
        variant_id: i.variant_id,
        name: i.name_snapshot,
        variant_label: i.variant_label,
        quantity: i.quantity,
        unit_price: i.unit_price,
        line_discount: i.line_discount,
      })),
      completo: f.order_events.some((e) => e.type === 'created'),
    };
  },

  async insertarPedido(fila) {
    const { data, error } = await clienteDb().from('orders').insert(fila).select(COLUMNAS_PEDIDO).single();
    if (error?.code === '23505' && /checkout_idempotency_key/.test(error.message)) {
      return { ok: false, motivo: 'duplicado' };
    }
    revisar('orders.insert', error);
    return { ok: true, pedido: mapearPedido(validar('orders.insert', filaPedido, data)) };
  },

  async insertarItems(orderId, items) {
    const { error } = await clienteDb()
      .from('order_items')
      .insert(items.map((i) => ({ ...i, order_id: orderId })));
    revisar('order_items.insert', error);
  },

  reservarStock: (id) => rpcPedido<StockFunctionResult>('reservar_stock', id),
  liberarStock: (id) => rpcPedido<StockFunctionResult>('liberar_stock', id),
  reservarCanje: (id) => rpcPedido<ReserveRedemptionResult>('reservar_canje', id),
  liberarCanje: (id) => rpcPedido<ReleaseRedemptionResult>('liberar_canje', id),

  async registrarEvento(orderId, evento) {
    const { error } = await clienteDb()
      .from('order_events')
      .insert({ order_id: orderId, ...evento });
    revisar('order_events.insert', error);
  },

  async eliminarPedido(orderId) {
    const { error } = await clienteDb().from('orders').delete().eq('id', orderId);
    revisar('orders.delete', error);
  },
};
