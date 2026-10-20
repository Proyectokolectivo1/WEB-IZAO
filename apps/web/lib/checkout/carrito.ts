/**
 * Cruce del carrito pedido con las variantes leídas en el servidor (§7.7, §10.2). Puro, sin I/O.
 * El navegador solo manda variantes y cantidades: precio, tachado y existencias salen de aquí.
 */
import type { PricingItem } from '@izao/core/pricing';
import type { CartItemInput } from '@izao/core/schemas';
import type { VarianteCheckout } from './fuente';

export interface LineaCruzada {
  variant_id: string;
  /** Cantidad pedida. */
  quantity: number;
  /** `min(existencias vendibles, pedida)`; 0 = agotado o no vendible en el país. */
  max_quantity: number;
  /** `null` si la variante no existe o no tiene precio en el país. */
  variante: VarianteCheckout | null;
}

export interface CarritoCruzado {
  lineas: LineaCruzada[];
  /** Líneas vendibles con la cantidad ajustada (`max_quantity`), listas para `calcularPrecios`. */
  items: PricingItem[];
  /** Hay alguna línea con menos existencias de las pedidas. */
  ajustado: boolean;
}

export function cruzarCarrito(
  pedidos: readonly CartItemInput[],
  variantes: ReadonlyMap<string, VarianteCheckout>,
): CarritoCruzado {
  const lineas: LineaCruzada[] = [];
  const items: PricingItem[] = [];
  let ajustado = false;
  for (const p of pedidos) {
    const v = variantes.get(p.variant_id) ?? null;
    const vendible = v !== null && v.vendible && v.precio !== null;
    const max = vendible ? Math.max(0, Math.min(v.disponible, p.quantity)) : 0;
    if (max < p.quantity) ajustado = true;
    lineas.push({ variant_id: p.variant_id, quantity: p.quantity, max_quantity: max, variante: v });
    if (vendible && max > 0) {
      items.push({
        variant_id: v.variant_id,
        product_id: v.product_id,
        quantity: max,
        unit_price: v.precio!,
        compare_at: v.tachado,
        category_ids: v.category_ids,
      });
    }
  }
  return { lineas, items, ajustado };
}
