/**
 * Web Checkout de Wompi por redirección (§12.2, docs.wompi.co "Widget & Checkout Web", D-024).
 * `GET https://checkout.wompi.co/p/` con `public-key`, `currency`, `amount-in-cents`, `reference`,
 * `signature:integrity`, `redirect-url`, `expiration-time` y datos del cliente opcionales.
 * La expiración va firmada: Wompi no deja pagar después de que vence la reserva del pedido.
 */
import { CURRENCY_EXPONENT, type CurrencyCode } from '@izao/core/money';
import type { WompiCredentials } from './credentials';
import { firmaIntegridad } from './firmas';

export const WOMPI_CHECKOUT_URL = 'https://checkout.wompi.co/p/';

/** Referencia única por intento: `IZ-CO-000123-P1`, `-P2`… (§12.2). */
export function referenciaIntento(numeroPedido: string, intento: number): string {
  if (!numeroPedido || !/^[A-Za-z0-9-]+$/.test(numeroPedido)) throw new RangeError('Número de pedido inválido.');
  if (!Number.isSafeInteger(intento) || intento < 1) throw new RangeError('Intento inválido.');
  return `${numeroPedido}-P${intento}`;
}

/** Monto de la base (unidad menor) a centavos de Wompi. Wompi Colombia solo cobra en COP. */
export function montoEnCentavos(monto: bigint, moneda: CurrencyCode): bigint {
  if (moneda !== 'COP') throw new RangeError('Wompi solo admite COP.');
  if (typeof monto !== 'bigint' || monto <= 0n) throw new RangeError('Monto inválido.');
  return monto * 10n ** BigInt(2 - CURRENCY_EXPONENT[moneda]);
}

export interface ClienteCheckout {
  email?: string | null;
  nombreCompleto?: string | null;
  /** E.164; solo se prellena si es de Colombia (+57). */
  celularE164?: string | null;
}

export interface DatosWebCheckout {
  credenciales: Pick<WompiCredentials, 'llavePublica' | 'secretoIntegridad'>;
  referencia: string;
  /** Unidad menor de la base. */
  monto: bigint;
  moneda: CurrencyCode;
  expiraEn: Date;
  urlRetorno: string;
  cliente?: ClienteCheckout;
}

export interface WebCheckout {
  url: string;
  montoEnCentavos: bigint;
  expiracion: string;
}

export function urlWebCheckout(d: DatosWebCheckout): WebCheckout {
  if (!/^https:\/\/[^\s]+$/.test(d.urlRetorno)) throw new RangeError('La URL de retorno debe ser https.');
  if (!(d.expiraEn instanceof Date) || Number.isNaN(d.expiraEn.getTime())) throw new RangeError('Expiración inválida.');
  const centavos = montoEnCentavos(d.monto, d.moneda);
  const expiracion = d.expiraEn.toISOString();
  const firma = firmaIntegridad({
    referencia: d.referencia,
    montoEnCentavos: centavos,
    moneda: d.moneda,
    expiracion,
    secretoIntegridad: d.credenciales.secretoIntegridad,
  });
  const pares: [string, string][] = [
    ['public-key', d.credenciales.llavePublica],
    ['currency', d.moneda],
    ['amount-in-cents', centavos.toString()],
    ['reference', d.referencia],
    ['signature:integrity', firma],
    ['redirect-url', d.urlRetorno],
    ['expiration-time', expiracion],
  ];
  const c = d.cliente;
  if (c?.email) pares.push(['customer-data:email', c.email]);
  if (c?.nombreCompleto) pares.push(['customer-data:full-name', c.nombreCompleto]);
  const cel = c?.celularE164 ? /^\+57(\d{10})$/.exec(c.celularE164) : null;
  if (cel) {
    pares.push(['customer-data:phone-number', cel[1]!]);
    pares.push(['customer-data:phone-number-prefix', '+57']);
  }
  // Nombres de parámetro literales (incluyen ':'), valores codificados.
  const query = pares.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return { url: `${WOMPI_CHECKOUT_URL}?${query}`, montoEnCentavos: centavos, expiracion };
}
