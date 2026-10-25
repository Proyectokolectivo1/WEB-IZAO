/**
 * Reglas de negocio del pedido financiado con Sistecrédito (§11.2, §12.4), independientes del formato de la API.
 * Puro: no calcula dinero, solo comprueba lo que el servidor ya fijó con `@izao/core/pricing`
 * (`total_customer = subtotal + recargo`, sin códigos de descuento) y devuelve el monto a financiar.
 * El cuerpo de la petición a Sistecrédito se construye cuando exista la documentación oficial (D-032).
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';

export interface ItemSistecredito {
  sku: string;
  quantity: number;
  unit_price: bigint;
  line_discount: bigint;
}

export interface PedidoSistecredito {
  number: string;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  subtotal: bigint;
  discount_amount: bigint;
  financing_surcharge_amount: bigint;
  total_customer: bigint;
  items: ItemSistecredito[];
}

export type MotivoPedidoInvalido = 'moneda' | 'descuento' | 'totales';

export type ResultadoPedidoSistecredito =
  | { ok: true; montoFinanciado: bigint }
  | { ok: false; motivo: MotivoPedidoInvalido };

export function validarPedidoSistecredito(p: PedidoSistecredito): ResultadoPedidoSistecredito {
  if (p.country_code !== 'CO' || p.currency_code !== 'COP') return { ok: false, motivo: 'moneda' };
  if (p.discount_amount !== 0n || p.items.some((i) => i.line_discount !== 0n)) return { ok: false, motivo: 'descuento' };
  if (p.items.length === 0 || p.items.some((i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.unit_price < 0n)) {
    return { ok: false, motivo: 'totales' };
  }
  const sumaItems = p.items.reduce((s, i) => s + i.unit_price * BigInt(i.quantity), 0n);
  if (
    sumaItems !== p.subtotal ||
    p.financing_surcharge_amount < 0n ||
    p.subtotal + p.financing_surcharge_amount !== p.total_customer ||
    p.total_customer <= 0n
  ) {
    return { ok: false, motivo: 'totales' };
  }
  return { ok: true, montoFinanciado: p.total_customer };
}
