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

/** `reservar_canje`, `confirmar_canje`, `liberar_canje`. */
export type RedemptionFunctionResult =
  | { ok: true; estado: RedemptionState; repetido?: true }
  | { ok: false; estado: null; motivo: 'pedido_inexistente' }
  | { ok: false; estado: RedemptionState; motivo: RedemptionRejectReason };

/** Fila de `pedidos_por_vencer(p_ahora, p_limite)`. */
export interface ExpiringOrderRow {
  order_id: string;
  number: string;
  country_code: string;
  payment_method: string;
  estado_actual: 'pendiente_pago' | 'esperando_abono' | 'pendiente_manual';
  nuevo_estado: 'expirado' | 'abandonado';
  stock_reserved_until: string;
  stock_state: StockState;
  tiene_codigo: boolean;
}
