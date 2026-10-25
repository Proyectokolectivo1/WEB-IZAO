/**
 * Creación del pedido en el servidor (`POST /api/checkout`, §10, §11, §17.1). El servidor manda: precios,
 * existencias, código y totales se recalculan aquí con `@izao/core/pricing`; el navegador solo envía
 * variantes, cantidades, datos del cliente, método y el texto del código.
 *
 * Orden (§10.2): validar con `checkoutInputSchemaFor(métodos activos)` → idempotencia por clave y huella
 * (`huella.ts`) → versión vigente de la política de datos → leer y recalcular →
 * `crear_pedido_checkout` (izao-db): pedido, líneas, `reservar_stock`, `reservar_canje` y evento `created` en
 * una sola transacción; un rechazo no deja nada escrito.
 *
 * El cobro lo prepara `http.ts`: Wompi con `pago-wompi.ts` y Addi con `pago-addi.ts`; el abono de contra entrega
 * lo encola. Pendiente: Sistecrédito (D-032), UTM y click IDs, `customer_id` y `gateway_fee_estimated`.
 */
import { z } from 'zod';
import { problemasClienteAddi } from '@izao/addi';
import { COUNTRY_CURRENCY, type CountryCode } from '@izao/core/money';
import {
  calcularPrecios,
  type PricingDiscountCode,
  type PricingPaymentMethod,
  type PricingResult,
} from '@izao/core/pricing';
import { isFinancingMethod, type RedemptionRejectReason } from '@izao/core/contracts';
import type { OrderStatus } from '@izao/core/order-state';
import { checkoutInputSchemaFor, countryCodeSchema, orderSummarySchema, type CheckoutInput } from '@izao/core/schemas';
import { cruzarCarrito } from './carrito';
import type { FilaItem, FilaPedido, FuenteCheckout, PedidoCreado } from './fuente';
import { huellaSolicitud, solicitudDeEntrada } from './huella';
import { motivoPublico, resolverCodigo, type MotivoCodigoPublico } from './vista-previa';

export type CodigoErrorCheckout =
  | 'INVALID_INPUT'
  | 'SHIPPING_LOCATION_INVALID'
  | 'STOCK_CHANGED'
  | 'CODE_REJECTED'
  | 'METHOD_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CHECKOUT_IN_PROGRESS'
  | 'DATA_POLICY_OUTDATED'
  | 'UNAVAILABLE';

export interface ErrorCheckout {
  error: CodigoErrorCheckout;
  /** `INVALID_INPUT`: ruta y mensaje; nunca el valor enviado. */
  issues?: { path: string; message: string }[];
  /** `STOCK_CHANGED`: solo las líneas que cambian; `max_quantity` 0 = agotado. */
  lines?: { variant_id: string; max_quantity: number }[];
  /** `CODE_REJECTED`: `MotivoCodigoPublico`. `METHOD_UNAVAILABLE`: `MethodUnavailableCode`. */
  reason?: string;
  missing_amount?: string | null;
  /** `DATA_POLICY_OUTDATED`: versión vigente; la tienda muestra la política y pide aceptar de nuevo. */
  current_version?: string;
}

export type SiguientePaso = 'pay_wompi' | 'pay_addi' | 'pay_sistecredito' | 'pay_cod_deposit' | 'manual_whatsapp';

export interface RespuestaPedido {
  /** Forma de `orderSummarySchema` con montos en texto. */
  order: {
    number: string;
    country_code: CountryCode;
    currency_code: 'COP' | 'USD';
    status: OrderStatus;
    payment_method: PricingPaymentMethod;
    lines: { name: string; variant_label: string | null; quantity: number; unit_price: string; line_discount: string }[];
    subtotal: string;
    discount: string;
    surcharge: string;
    total_customer: string;
    cod_deposit: string;
    cod_collect: string;
  };
  public_token: string;
  next_step: SiguientePaso;
  /** Página de estado sin login (§10.2). */
  status_path: string;
  /** `true` si la clave de idempotencia ya tenía pedido. */
  repeated: boolean;
  warnings: string[];
  /**
   * Aditivo, con `next_step = pay_wompi` o `pay_addi`: intento de pago listo (`checkout_url` https del Web
   * Checkout o de la solicitud de Addi, y vencimiento ISO). `null` si no se pudo preparar (p. ej. sin
   * credenciales o la entidad caída): la página del pedido lo reintenta con `POST /api/checkout/pago`.
   */
  payment?: { checkout_url: string; expires_at: string } | null;
}

export type ResultadoCheckout =
  /** `order_id` es interno (para preparar el cobro); nunca va en `cuerpo`. */
  | { ok: true; status: 200 | 201; order_id: string; cuerpo: RespuestaPedido }
  | { ok: false; status: 400 | 409 | 422 | 503; cuerpo: ErrorCheckout };

const ESTADO_INICIAL: Record<PricingPaymentMethod, OrderStatus> = {
  wompi: 'pendiente_pago',
  addi: 'pendiente_pago',
  sistecredito: 'pendiente_pago',
  cod: 'esperando_abono',
  manual: 'pendiente_manual',
};

const SIGUIENTE: Record<PricingPaymentMethod, SiguientePaso> = {
  wompi: 'pay_wompi',
  addi: 'pay_addi',
  sistecredito: 'pay_sistecredito',
  cod: 'pay_cod_deposit',
  manual: 'manual_whatsapp',
};

const MOTIVO_CANJE: Record<RedemptionRejectReason, MotivoCodigoPublico> = {
  codigo_inactivo: 'CODE_INVALID',
  codigo_de_otro_pais: 'CODE_INVALID',
  codigo_fuera_de_vigencia: 'CODE_EXPIRED',
  limite_total: 'CODE_LIMIT_REACHED',
  limite_por_cliente: 'CODE_LIMIT_REACHED',
};

const falla = (
  status: 400 | 409 | 422 | 503,
  cuerpo: ErrorCheckout,
): Extract<ResultadoCheckout, { ok: false }> => ({ ok: false, status, cuerpo });

const NO_DISPONIBLE = () => falla(503, { error: 'UNAVAILABLE' });

function invalido(error: z.ZodError): Extract<ResultadoCheckout, { ok: false }> {
  return falla(400, {
    error: 'INVALID_INPUT',
    issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  });
}

/** Centésimas → texto `numeric(5,2)`: 1250n → "12.50". */
export function porcentajeTexto(centesimas: bigint): string {
  return `${centesimas / 100n}.${(centesimas % 100n).toString().padStart(2, '0')}`;
}

function registrar(paso: string, e: unknown): void {
  // Sin datos del cliente ni del error de la base (podría incluir valores).
  console.error(`[checkout] fallo en ${paso}: ${e instanceof Error ? e.name : 'error'}`);
}

function respuesta(p: PedidoCreado, repetido: boolean, warnings: string[]): Extract<ResultadoCheckout, { ok: true }> {
  const order: RespuestaPedido['order'] = {
    number: p.number,
    country_code: p.country_code,
    currency_code: p.currency_code,
    status: p.status,
    payment_method: p.payment_method,
    lines: p.lines.map((l) => ({
      name: l.name,
      variant_label: l.variant_label,
      quantity: l.quantity,
      unit_price: l.unit_price.toString(),
      line_discount: l.line_discount.toString(),
    })),
    subtotal: p.subtotal.toString(),
    discount: p.discount.toString(),
    surcharge: p.surcharge.toString(),
    total_customer: p.total_customer.toString(),
    cod_deposit: p.cod_deposit.toString(),
    cod_collect: p.cod_collect.toString(),
  };
  // Defensa: lo que sale cuadra (total, abono y recaudo) o no sale.
  if (!orderSummarySchema.safeParse(order).success) throw new Error('resumen de pedido inconsistente');
  return {
    ok: true,
    status: repetido ? 200 : 201,
    order_id: p.id,
    cuerpo: {
      order,
      public_token: p.public_token,
      next_step: SIGUIENTE[p.payment_method],
      status_path: `/${p.country_code.toLowerCase()}/pedido/${p.public_token}`,
      repeated: repetido,
      warnings,
    },
  };
}

/**
 * Pedido ya creado con la clave: mismo país y misma huella (líneas, método, código efectivo y dirección) →
 * reintento (200 `repeated`); otro contenido → `IDEMPOTENCY_CONFLICT`. Sin pedido → `null`. Se compara la huella
 * guardada (`checkout_request_hash`); un pedido anterior a la columna se compara con su contenido persistido.
 */
async function porIdempotencia(
  fuente: FuenteCheckout,
  entrada: CheckoutInput,
  huella: string,
): Promise<ResultadoCheckout | null> {
  const previo = await fuente.pedidoPorIdempotencia(entrada.idempotency_key);
  if (!previo) return null;
  if (previo.country_code !== entrada.country_code) return falla(409, { error: 'IDEMPOTENCY_CONFLICT' });
  if (!previo.completo) return falla(409, { error: 'CHECKOUT_IN_PROGRESS' });
  const guardada = previo.huella ?? huellaSolicitud(previo.solicitud);
  if (guardada !== huella) return falla(409, { error: 'IDEMPOTENCY_CONFLICT' });
  return respuesta(previo, true, []);
}

function filaPedido(
  entrada: CheckoutInput,
  r: PricingResult,
  ubic: { region_id: string; region_nombre: string; city_id: string; city_nombre: string },
  codigoId: string | null,
  costoTotal: bigint,
  ahora: Date,
  politicaVigente: string,
  huella: string,
): FilaPedido {
  const metodo = entrada.payment_method;
  return {
    country_code: entrada.country_code,
    currency_code: r.currency,
    contact_first_name: entrada.contact.first_name,
    contact_last_name: entrada.contact.last_name,
    contact_phone_e164: entrada.contact.phone_e164,
    contact_email: entrada.contact.email,
    document_type: entrada.document.type,
    document_number: entrada.document.number,
    shipping_region_id: ubic.region_id,
    shipping_city_id: ubic.city_id,
    shipping_region_name: ubic.region_nombre,
    shipping_city_name: ubic.city_nombre,
    shipping_district: entrada.shipping.district,
    shipping_address1: entrada.shipping.address1,
    shipping_address2: entrada.shipping.address2,
    shipping_notes: entrada.shipping.notes,
    payment_method: metodo,
    status: ESTADO_INICIAL[metodo],
    subtotal: r.subtotal.toString(),
    discount_code_id: codigoId,
    discount_amount: r.discount.toString(),
    financing_surcharge_pct: porcentajeTexto(r.surcharge_pct_hundredths),
    financing_surcharge_amount: r.surcharge.toString(),
    total_customer: r.total_customer.toString(),
    cod_deposit_amount: r.cod_deposit.toString(),
    cod_collect_amount: r.cod_collect.toString(),
    product_cost_total: costoTotal.toString(),
    checkout_idempotency_key: entrada.idempotency_key,
    // La base la guarda y la compara en `pedido_checkout_existente(clave, país, hash)`.
    checkout_request_hash: huella,
    terms_accepted_at: ahora.toISOString(),
    data_policy_version: politicaVigente,
    whatsapp_opt_in: entrada.consents.whatsapp,
  };
}

export async function crearPedidoCheckout(
  fuente: FuenteCheckout,
  cuerpo: unknown,
  ahora: Date,
): Promise<ResultadoCheckout> {
  // 1. País primero: los métodos válidos dependen de él.
  const pre = z.object({ country_code: countryCodeSchema }).safeParse(cuerpo);
  if (!pre.success) return invalido(pre.error);
  const pais = pre.data.country_code;

  try {
    const config = await fuente.configPais(pais);
    if (!config || COUNTRY_CURRENCY[pais] !== config.ajustes.currency_code) return NO_DISPONIBLE();
    const activos = config.metodos.filter((m) => m.is_enabled).map((m) => m.method);
    const parsed = checkoutInputSchemaFor(activos).safeParse(cuerpo);
    if (!parsed.success) return invalido(parsed.error);
    const entrada = parsed.data;
    if (entrada.payment_method === 'addi') {
      // Addi solo recibe cédula de ciudadanía, correo y celular colombiano: se avisa antes de crear el pedido.
      const problemas = problemasClienteAddi({
        document_type: entrada.document.type,
        document_number: entrada.document.number,
        contact_email: entrada.contact.email,
        contact_phone_e164: entrada.contact.phone_e164,
      });
      if (problemas.length > 0) return falla(400, { error: 'INVALID_INPUT', issues: problemas.map(({ path, message }) => ({ path, message })) });
    }

    // 2. Idempotencia (doble clic, reintento del navegador): misma clave y mismo contenido
    const huella = huellaSolicitud(solicitudDeEntrada(entrada));
    const repetido = await porIdempotencia(fuente, entrada, huella);
    if (repetido) return repetido;

    // 2b. Consentimiento: solo la versión vigente de la política de datos del país (no la que diga el navegador).
    // Se valida aquí para no recalcular en vano; la base la revalida al escribir (`politica_datos_*`).
    const politica = await fuente.versionPoliticaDatos(pais);
    if (politica === null) {
      console.error(`[checkout] ${pais} sin política de tratamiento de datos publicada`);
      return NO_DISPONIBLE();
    }
    if (entrada.data_policy_version.trim() !== politica) {
      return falla(409, { error: 'DATA_POLICY_OUTDATED', current_version: politica });
    }

    // 3. Leer y recalcular
    const [variantes, ubic] = await Promise.all([
      fuente.variantes(pais, entrada.items.map((i) => i.variant_id)),
      fuente.ubicacion(pais, entrada.shipping.region_id, entrada.shipping.city_id),
    ]);
    if (!ubic) return falla(422, { error: 'SHIPPING_LOCATION_INVALID' });

    const carrito = cruzarCarrito(entrada.items, variantes);
    if (carrito.ajustado) {
      return falla(409, {
        error: 'STOCK_CHANGED',
        lines: carrito.lineas
          .filter((l) => l.max_quantity < l.quantity)
          .map((l) => ({ variant_id: l.variant_id, max_quantity: l.max_quantity })),
      });
    }

    const financiacion = entrada.payment_method !== 'manual' && isFinancingMethod(entrada.payment_method);
    const warnings: string[] = [];
    let codigo: PricingDiscountCode | null = null;
    if (entrada.discount_code !== null && financiacion) {
      // §17.1: nunca con Addi ni Sistecrédito. Se retira sin consultar.
      warnings.push('DISCOUNT_NOT_ALLOWED_WITH_FINANCING');
    } else if (entrada.discount_code !== null) {
      const resuelto = await resolverCodigo(fuente, entrada.discount_code);
      if (resuelto.tipo !== 'leido') return falla(422, { error: 'CODE_REJECTED', reason: 'CODE_INVALID', missing_amount: null });
      const usos =
        resuelto.codigo.usage_limit_per_customer === null
          ? 0
          : await fuente.usosDelCliente(
              resuelto.codigo.id,
              entrada.document.number,
              entrada.contact.phone_e164,
              entrada.contact.email,
            );
      codigo = { ...resuelto.codigo, customer_usage_count: usos };
    }

    const r = calcularPrecios({
      items: carrito.items,
      countrySettings: config.ajustes,
      paymentMethod: entrada.payment_method,
      paymentMethodSettings: config.metodos,
      discountCode: codigo,
      now: ahora,
    });

    const dc = r.discount_code;
    if (dc && dc.status === 'rejected') {
      return falla(422, {
        error: 'CODE_REJECTED',
        reason: motivoPublico(dc.reason ?? 'CODE_INVALID'),
        missing_amount: dc.missing_amount === null ? null : dc.missing_amount.toString(),
      });
    }
    if (dc?.customer_check_pending) throw new Error('límite por cliente sin verificar');
    if (!r.payment_method_available) {
      const m = r.messages.find((x) => x.code === 'PAYMENT_METHOD_UNAVAILABLE');
      return falla(422, { error: 'METHOD_UNAVAILABLE', reason: m?.reason ?? 'METHOD_DISABLED' });
    }

    const lineaPorVariante = new Map(r.lines.map((l) => [l.variant_id, l]));
    const items: FilaItem[] = carrito.lineas.map((l) => {
      const v = l.variante!;
      const pl = lineaPorVariante.get(l.variant_id)!;
      return {
        product_id: v.product_id,
        variant_id: v.variant_id,
        sku: v.sku,
        name_snapshot: v.nombre,
        variant_label: v.etiqueta,
        quantity: pl.quantity,
        unit_price: pl.unit_price.toString(),
        unit_compare_at: v.tachado === null ? null : v.tachado.toString(),
        unit_cost: v.costo === null ? null : v.costo.toString(),
        line_discount: pl.line_discount.toString(),
        weight_kg: v.peso_kg,
        mastershop_product_id: v.mastershop_product_id,
        mastershop_variant_id: v.mastershop_variant_id,
      };
    });
    const costoTotal = carrito.lineas.reduce((a, l) => a + (l.variante!.costo ?? 0n) * BigInt(l.max_quantity), 0n);
    const codigoId = dc?.status === 'applied' ? dc.id : null;

    // 4. Guardar antes de cualquier pasarela (§10.2), en una sola transacción de la base
    const fila = filaPedido(entrada, r, ubic, codigoId, costoTotal, ahora, politica, huella);
    const c = await fuente.crearPedido(fila, items);
    if (c.ok && !c.repetido) return respuesta(c.pedido, false, warnings);
    if (c.ok) {
      // La base encontró el pedido de la clave (carrera tras la lectura): se compara su contenido antes de
      // confirmarlo. Si no se puede releer, no se confirma a ciegas.
      const previo = await porIdempotencia(fuente, entrada, huella);
      return previo ?? falla(409, { error: 'CHECKOUT_IN_PROGRESS' });
    }
    switch (c.motivo) {
      case 'idempotencia_conflicto':
        return falla(409, { error: 'IDEMPOTENCY_CONFLICT' });
      case 'en_proceso':
        return falla(409, { error: 'CHECKOUT_IN_PROGRESS' });
      case 'politica_datos_desactualizada':
        // Cambió entre la lectura y la escritura: la versión que manda es la de la base.
        if (c.version_vigente) return falla(409, { error: 'DATA_POLICY_OUTDATED', current_version: c.version_vigente });
        console.error('[checkout] politica_datos_desactualizada sin version_vigente');
        return NO_DISPONIBLE();
      case 'sin_politica_datos':
        console.error(`[checkout] ${pais} sin política de tratamiento de datos publicada (al escribir)`);
        return NO_DISPONIBLE();
      case 'sin_stock':
        return falla(409, {
          error: 'STOCK_CHANGED',
          lines: (c.faltantes ?? [])
            .filter((x) => x.variant_id !== null)
            .map((x) => ({ variant_id: x.variant_id!, max_quantity: Math.max(0, Math.min(x.disponible, x.solicitado)) })),
        });
      default:
        if (c.motivo in MOTIVO_CANJE) {
          return falla(422, {
            error: 'CODE_REJECTED',
            reason: MOTIVO_CANJE[c.motivo as RedemptionRejectReason],
            missing_amount: null,
          });
        }
        // sin_items, totales_inconsistentes, datos_invalidos u otro: error del servidor, nada quedó escrito.
        console.error(`[checkout] crear_pedido_checkout rechazó: ${c.motivo}`);
        return NO_DISPONIBLE();
    }
  } catch (e) {
    registrar('checkout', e);
    return NO_DISPONIBLE();
  }
}
