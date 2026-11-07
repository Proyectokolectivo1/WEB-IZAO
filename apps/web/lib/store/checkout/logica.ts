/**
 * Lógica pura del checkout: validación por país, cuerpo para el servidor y resumen por método con el motor de
 * `@izao/core/pricing`. Todo lo que se muestra es PROVISIONAL: el servidor recalcula precios, descuentos, recargos,
 * abono y stock al crear el pedido (regla 2). Aquí no hay un solo porcentaje ni monto fijo: salen de `ConfigCheckout`.
 */
import { COUNTRY_CURRENCY } from '@izao/core/money';
import {
  calcularPrecios,
  type MethodUnavailableCode,
  type PricingDiscountCode,
  type PricingPaymentMethod,
} from '@izao/core/pricing';
import type { LineaCarrito } from '../carrito/logica';
import { aCodigoCore } from '../pais';
import type {
  CampoFormulario,
  ConfigCheckout,
  PoliticaLegal,
  ErroresFormulario,
  MetodoCheckout,
  MetodoReal,
  ValoresFormulario,
} from './tipos';

export const FORMULARIO_VACIO: ValoresFormulario = {
  nombre: '',
  apellido: '',
  celular: '',
  correo: '',
  tipoDocumento: '',
  numeroDocumento: '',
  regionId: '',
  ciudadId: '',
  barrio: '',
  direccion: '',
  complemento: '',
  indicaciones: '',
  metodo: '',
  terminos: false,
  whatsapp: false,
};

/** Orden en que se enfocan los errores (el mismo del formulario en pantalla). */
export const ORDEN_CAMPOS: readonly CampoFormulario[] = [
  'nombre',
  'apellido',
  'celular',
  'correo',
  'tipoDocumento',
  'numeroDocumento',
  'regionId',
  'ciudadId',
  'direccion',
  'metodo',
  'terminos',
  'whatsapp',
];

/** Método que queda cuando el panel no tiene ninguno activo en el país. */
export function metodoPorDefecto(config: ConfigCheckout): MetodoCheckout | '' {
  return config.metodos.length === 0 ? 'manual' : '';
}

/**
 * Actualiza lo que se muestra de la política tras `DATA_POLICY_OUTDATED`. La versión que manda es la que dio el servidor del
 * pedido (con ella compara); la leída después solo sirve si el servidor no la mandó. Los enlaces leídos reemplazan a los viejos.
 */
export function combinarPolitica(actual: PoliticaLegal, versionServidor: string | null, leida: Partial<PoliticaLegal> | null): PoliticaLegal {
  const versionLeida = typeof leida?.version === 'string' && leida.version !== '' ? leida.version : null;
  return {
    terminos: leida?.terminos ?? actual.terminos,
    datos: leida?.datos ?? actual.datos,
    version: versionServidor ?? versionLeida ?? actual.version,
  };
}

/** Rutas de error del servidor (`contact.phone`) → campos del formulario. */
const RUTA_A_CAMPO: Record<string, CampoFormulario> = {
  'contact.first_name': 'nombre',
  'contact.last_name': 'apellido',
  'contact.phone': 'celular',
  'contact.email': 'correo',
  'document.type': 'tipoDocumento',
  'document.number': 'numeroDocumento',
  'shipping.region_id': 'regionId',
  'shipping.city_id': 'ciudadId',
  'shipping.district': 'barrio',
  'shipping.address1': 'direccion',
  'shipping.address2': 'complemento',
  'shipping.notes': 'indicaciones',
  payment_method: 'metodo',
  'consents.terms_and_data': 'terminos',
  'consents.whatsapp': 'whatsapp',
};

export function erroresDelServidor(issues: readonly { path: string; message: string }[] | undefined): ErroresFormulario {
  const e: ErroresFormulario = {};
  for (const { path, message } of issues ?? []) {
    const campo = RUTA_A_CAMPO[path];
    if (campo && !e[campo]) e[campo] = message;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Resumen por método (motor de precios del paquete core)
// ---------------------------------------------------------------------------

export interface DescuentoServidor {
  codigo: string;
  /** Unidad menor, entero en texto, tal como lo devolvió la vista previa del servidor. */
  monto: string;
}

export interface ResumenCheckout {
  subtotal: bigint;
  descuento: bigint;
  recargo: bigint;
  /** Porcentaje del recargo para mostrarlo («10» o «10,5»); `null` si no hay financiación. */
  recargoPct: string | null;
  total: bigint;
  abono: bigint;
  recaudo: bigint;
  /** El código se retiró porque el método es de financiación. */
  codigoRetirado: boolean;
  metodoDisponible: boolean;
  motivo: MethodUnavailableCode | null;
  disponibilidad: Partial<Record<MetodoReal, { disponible: boolean; motivo: MethodUnavailableCode | null }>>;
}

/** 1000 → «10»; 1050 → «10,5» (centésimas de punto porcentual). */
export function formatearPct(centesimas: bigint): string {
  const entero = centesimas / 100n;
  const resto = centesimas % 100n;
  if (resto === 0n) return entero.toString();
  return `${entero},${resto.toString().padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * Resumen provisional con el motor de `@izao/core`. El descuento ya lo calculó el servidor en la vista previa:
 * se le pasa al motor como un código fijo con ese monto para que decida, con sus reglas, si se retira (financiación)
 * y cómo afecta abono y recaudo. Sin descuento del servidor (o sin servicio), el resumen va sin código.
 */
export function resumenCheckout(
  lineas: readonly LineaCarrito[],
  config: ConfigCheckout,
  metodo: MetodoCheckout | null,
  descuento: DescuentoServidor | null,
  ahora: Date,
): ResumenCheckout {
  const codigoPais = aCodigoCore(config.pais);
  const monto = descuento ? BigInt(descuento.monto) : 0n;
  const codigo: PricingDiscountCode | null =
    descuento && monto > 0n
      ? {
          id: 'vista-previa',
          code: descuento.codigo,
          country_code: codigoPais,
          type: 'fixed',
          value: monto,
          max_discount_amount: null,
          min_subtotal: 0n,
          starts_at: null,
          ends_at: null,
          is_active: true,
          applies_to: 'all',
          target_ids: [],
          exclude_ids: [],
          applies_to_sale_items: true,
          usage_limit_total: null,
          usage_count: 0,
          usage_limit_per_customer: null,
          customer_usage_count: 0,
        }
      : null;

  const r = calcularPrecios({
    items: lineas.map((l) => ({
      variant_id: l.variantId,
      product_id: l.productId,
      quantity: l.cantidad,
      unit_price: BigInt(l.precio),
      compare_at: l.tachado ? BigInt(l.tachado) : null,
      category_ids: [],
    })),
    countrySettings: {
      country_code: codigoPais,
      currency_code: COUNTRY_CURRENCY[codigoPais],
      cod_enabled: config.codHabilitado,
      cod_deposit_amount: BigInt(config.codAbono),
      cod_min_collect_amount: BigInt(config.codMinimoRecaudo),
      financing_surcharge_pct: config.recargoFinanciacion,
    },
    paymentMethod: metodo as PricingPaymentMethod | null,
    paymentMethodSettings: config.metodos.map((m, i) => ({ method: m.method, is_enabled: true, sort_order: i })),
    discountCode: codigo,
    now: ahora,
  });

  const disponibilidad: ResumenCheckout['disponibilidad'] = {};
  for (const a of r.available_methods) disponibilidad[a.method] = { disponible: a.available, motivo: a.reason };
  const msg = r.messages.find((m) => m.code === 'PAYMENT_METHOD_UNAVAILABLE');
  return {
    subtotal: r.subtotal,
    descuento: r.discount,
    recargo: r.surcharge,
    recargoPct: r.surcharge_pct_hundredths > 0n ? formatearPct(r.surcharge_pct_hundredths) : null,
    total: r.total_customer,
    abono: r.cod_deposit,
    recaudo: r.cod_collect,
    codigoRetirado: r.discount_code?.status === 'withdrawn',
    metodoDisponible: metodo === null ? true : r.payment_method_available,
    motivo: msg?.reason ?? null,
    disponibilidad,
  };
}

/** Totales del servidor para el método elegido (`totals` de la vista previa, aditivo de izao-pagos). */
export interface TotalesServidor {
  payment_method: string | null;
  payment_method_available: boolean;
  surcharge: string;
  total_customer: string;
  cod_deposit: string;
  cod_collect: string;
  available_methods: { method: string; available: boolean; reason: string | null }[];
  manual_allowed: boolean;
}

/**
 * Cuando el servidor responde para el método y el bolso actuales, sus montos mandan sobre el cálculo local
 * (que solo sirve para que el cambio de método se vea al instante). Mantiene el porcentaje mostrado del local.
 */
export function resumenConServidor(
  local: ResumenCheckout,
  t: TotalesServidor,
  subtotal: bigint,
  descuento: bigint,
  metodo: MetodoCheckout | null,
): ResumenCheckout {
  const disponibilidad: ResumenCheckout['disponibilidad'] = {};
  for (const m of t.available_methods) {
    if (m.method === 'wompi' || m.method === 'addi' || m.method === 'sistecredito' || m.method === 'cod') {
      disponibilidad[m.method] = { disponible: m.available, motivo: (m.reason as MethodUnavailableCode | null) ?? null };
    }
  }
  const surcharge = BigInt(t.surcharge);
  return {
    ...local,
    subtotal,
    descuento,
    recargo: surcharge,
    recargoPct: surcharge > 0n ? local.recargoPct : null,
    total: BigInt(t.total_customer),
    abono: BigInt(t.cod_deposit),
    recaudo: BigInt(t.cod_collect),
    metodoDisponible: metodo === 'manual' ? t.manual_allowed : t.payment_method_available,
    disponibilidad,
  };
}
