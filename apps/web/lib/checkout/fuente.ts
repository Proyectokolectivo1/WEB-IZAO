/**
 * Fuente de datos del checkout (dueño: izao-pagos). La lógica de `vista-previa.ts` y `crear-pedido.ts`
 * solo habla con esta interfaz; `fuente-supabase.ts` la implementa con el cliente de servicio y las pruebas
 * con una fuente en memoria. Montos siempre `bigint` en unidad menor.
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';
import type {
  PricingCountrySettings,
  PricingDiscountCode,
  PricingPaymentMethod,
  PricingPaymentMethodSetting,
} from '@izao/core/pricing';
import type { OrderStatus } from '@izao/core/order-state';
import type { DatosSolicitud } from './huella';

/** Variante leída para un país, con lo necesario para precio, stock y la línea del pedido. */
export interface VarianteCheckout {
  variant_id: string;
  product_id: string;
  sku: string;
  nombre: string;
  /** Valores de opción unidos ("100 ml"); `null` si no hay. */
  etiqueta: string | null;
  category_ids: readonly string[];
  /** Producto activo y visible en el país, y variante activa con precio en el país. */
  vendible: boolean;
  /** `null` si la variante no tiene fila en `variant_countries` del país. */
  precio: bigint | null;
  tachado: bigint | null;
  costo: bigint | null;
  /** `max(stock − stock_reserved, 0)`. Nunca sale al navegador tal cual. */
  disponible: number;
  peso_kg: string | null;
  mastershop_product_id: number | null;
  mastershop_variant_id: number | null;
}

export interface ConfigPais {
  ajustes: PricingCountrySettings;
  metodos: readonly PricingPaymentMethodSetting[];
}

export interface UbicacionEnvio {
  region_id: string;
  region_nombre: string;
  city_id: string;
  city_nombre: string;
}

export interface LineaResumen {
  variant_id: string | null;
  name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: bigint;
  line_discount: bigint;
}

/** Lo que el cliente puede ver de un pedido creado (sin id interno ni datos personales). */
export interface PedidoCreado {
  id: string;
  number: string;
  public_token: string;
  status: OrderStatus;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  payment_method: PricingPaymentMethod;
  subtotal: bigint;
  discount: bigint;
  surcharge: bigint;
  total_customer: bigint;
  cod_deposit: bigint;
  cod_collect: bigint;
  lines: readonly LineaResumen[];
}

/** Fila de `orders` lista para insertar (montos en texto: JSON no transporta bigint). */
export type FilaPedido = Record<string, string | number | boolean | null>;
export type FilaItem = Record<string, string | number | boolean | null>;

/**
 * Resultado de `crear_pedido_checkout` (una transacción: pedido → líneas → reservar_stock → reservar_canje →
 * evento `created`; todo o nada). `motivo` llega tal cual de la base (`MotivoCrearPedido` y otros).
 */
export type ResultadoCrearPedido =
  | { ok: true; repetido: boolean; pedido: PedidoCreado }
  | {
      ok: false;
      motivo: string;
      faltantes?: readonly StockShortageLinea[];
      /** Solo con `politica_datos_desactualizada`: versión publicada que la base exige. */
      version_vigente?: string;
    };

export interface StockShortageLinea {
  variant_id: string | null;
  solicitado: number;
  disponible: number;
}

export interface FuenteCheckout {
  /** `null` si el país no existe o no tiene `country_settings`. */
  configPais(pais: CountryCode): Promise<ConfigPais | null>;
  /** Solo devuelve las variantes que existen; las demás faltan en el mapa. */
  variantes(pais: CountryCode, ids: readonly string[]): Promise<Map<string, VarianteCheckout>>;
  /** Código por texto exacto (ya en mayúsculas), de cualquier país; `customer_usage_count` llega `null`. */
  codigo(texto: string): Promise<PricingDiscountCode | null>;
  /** Usos `reserved|confirmed` del código por el mismo cliente (documento, celular o correo). */
  usosDelCliente(codigoId: string, documento: string, celularE164: string, correo: string | null): Promise<number>;
  /** `null` si la región no es del país o la ciudad no es de la región. */
  ubicacion(pais: CountryCode, regionId: string, cityId: string): Promise<UbicacionEnvio | null>;
  /**
   * Pedido con esa clave de idempotencia. `completo` = ya tiene el evento `created` (stock y canje
   * reservados); si no, otra petición lo está creando o quedó a medias y lo vencerá `pedidos_por_vencer`.
   * `huella` = `checkout_request_hash` guardado (`null` en pedidos anteriores a la columna); si falta, se compara
   * con `solicitud`, lo que el pedido guardado pidió.
   */
  pedidoPorIdempotencia(
    clave: string,
  ): Promise<(PedidoCreado & { completo: boolean; huella: string | null; solicitud: DatosSolicitud }) | null>;
  /**
   * Versión vigente de la política de tratamiento de datos del país: `politica_datos_vigente(país)` (página
   * `pages.kind = 'tratamiento_datos'` publicada), la misma que exige `crear_pedido_checkout`. `null` si no hay.
   */
  versionPoliticaDatos(pais: CountryCode): Promise<string | null>;
  /** `crear_pedido_checkout` (izao-db): atómico e idempotente por `checkout_idempotency_key`. */
  crearPedido(fila: FilaPedido, items: readonly FilaItem[]): Promise<ResultadoCrearPedido>;
}
