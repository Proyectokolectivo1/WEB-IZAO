/**
 * Resultados de las funciones atómicas de la base (izao-db, T1.13–T1.15). Todas
 * devuelven jsonb `{ok, estado, repetido?, motivo?, faltantes?[]}` y no lanzan por
 * falta de stock o de cupo: el llamador decide según `ok` y `motivo`.
 */

/** `orders.stock_state`. */
export type StockState = 'none' | 'reserved' | 'confirmed' | 'released';

export type StockShortageReason =
  | 'variante_inexistente'
  | 'sin_precio_en_pais'
  | 'variante_inactiva'
  | 'stock_insuficiente';

export interface StockShortage {
  variant_id: string | null;
  sku: string;
  solicitado: number;
  disponible: number;
  motivo: StockShortageReason;
}

/** `reservar_stock`, `liberar_stock`, `confirmar_stock`. */
export type StockFunctionResult =
  | { ok: true; estado: StockState; repetido?: true }
  | { ok: false; estado: null; motivo: 'pedido_inexistente' }
  | { ok: false; estado: StockState; motivo: 'sin_items' }
  | { ok: false; estado: StockState; motivo: 'sin_stock'; faltantes: StockShortage[] };

/** Estado del canje (`discount_redemptions.status`, `none` sin fila, `sin_codigo` sin código). */
export type RedemptionState = 'none' | 'reserved' | 'confirmed' | 'released' | 'sin_codigo';

export type RedemptionRejectReason =
  | 'codigo_inactivo'
  | 'codigo_de_otro_pais'
  | 'codigo_fuera_de_vigencia'
  | 'limite_total'
  | 'limite_por_cliente';

type OrderNotFound = { ok: false; estado: null; motivo: 'pedido_inexistente' };

/** `reservar_canje`: valida vigencia [starts_at, ends_at) y cupos (total y por cliente). */
export type ReserveRedemptionResult =
  | { ok: true; estado: RedemptionState; repetido?: true }
  | OrderNotFound
  | { ok: false; estado: RedemptionState; motivo: RedemptionRejectReason };

/**
 * `confirmar_canje` (M3): en un pago tardío no revalida vigencia ni cupo; confirma
 * siempre. Si con eso se supera un límite devuelve `advertencia: 'limite_superado'` y
 * el worker debe alertar al admin.
 */
export type ConfirmRedemptionResult =
  | {
      ok: true;
      estado: 'confirmed' | 'sin_codigo';
      repetido?: true;
      advertencia?: 'limite_superado';
    }
  | OrderNotFound;

/** `liberar_canje`. */
export type ReleaseRedemptionResult =
  | { ok: true; estado: RedemptionState; repetido?: true }
  | OrderNotFound;

/** Cualquiera de las tres funciones de canje. */
export type RedemptionFunctionResult =
  | ReserveRedemptionResult
  | ConfirmRedemptionResult
  | ReleaseRedemptionResult;

/** Fila de `pedidos_por_vencer(p_ahora, p_limite)`. */
export interface ExpiringOrderRow {
  order_id: string;
  number: string;
  country_code: string;
  payment_method: string;
  /** A2: `pago_rechazado` también vence (→ `expirado`). */
  estado_actual: 'pendiente_pago' | 'pago_rechazado' | 'esperando_abono' | 'pendiente_manual';
  nuevo_estado: 'expirado' | 'abandonado';
  stock_reserved_until: string;
  stock_state: StockState;
  tiene_codigo: boolean;
}
