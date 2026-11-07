/**
 * Subtotal de vista previa del bolso con el motor de precios. Aparte de `logica.ts` a propósito: este módulo arrastra
 * `@izao/core/pricing` y solo lo necesitan el bolso abierto, el carrito y el checkout, no todas las páginas.
 */
import { calcularPrecios } from '@izao/core/pricing';
import { COUNTRY_CURRENCY, type CountryCode } from '@izao/core/money';
import type { LineaCarrito } from './logica';

export interface VistaPreviaPrecios {
  subtotal: bigint;
  /** Ahorro por precios tachados, solo informativo. */
  ahorro: bigint;
}

/** Subtotal con el motor de precios, sin método de pago ni código (esos los resuelve el servidor). */
export function vistaPrevia(lineas: readonly LineaCarrito[], pais: 'co' | 'ec', ahora: Date): VistaPreviaPrecios {
  const codigo = pais.toUpperCase() as CountryCode;
  if (lineas.length === 0) return { subtotal: 0n, ahorro: 0n };
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
      country_code: codigo,
      currency_code: COUNTRY_CURRENCY[codigo],
      cod_enabled: false,
      cod_deposit_amount: 0n,
      cod_min_collect_amount: 0n,
      financing_surcharge_pct: {},
    },
    paymentMethod: null,
    paymentMethodSettings: [],
    discountCode: null,
    now: ahora,
  });
  const ahorro = lineas.reduce((a, l) => {
    if (!l.tachado || BigInt(l.tachado) <= BigInt(l.precio)) return a;
    return a + (BigInt(l.tachado) - BigInt(l.precio)) * BigInt(l.cantidad);
  }, 0n);
  return { subtotal: r.subtotal, ahorro };
}
