/**
 * Cuerpo de `POST /v1/online-applications` (documentación oficial de Addi, `OnlineLoanApplicationRequest`).
 * Puro: no calcula dinero, solo traslada lo que el servidor ya fijó al crear el pedido con `@izao/core/pricing`
 * (`total_customer = subtotal + recargo`, sin descuento: §11.2) y se niega a enviar si algo no cuadra.
 *
 * - `orderId` = referencia del intento (`IZ-CO-000123-A1`): Addi la exige única por compra y un reintento tras
 *   un rechazo es una solicitud nueva (D-031).
 * - `totalAmount` = `total_customer` (con recargo). El recargo va como ítem "Cargo por financiación" para que
 *   la suma de los ítems sea igual al total.
 * - Addi solo recibe cédula de ciudadanía (`idType = CC`) y exige correo y celular a nombre del cliente.
 * - `client.address` usa la dirección de envío (la tienda no pide dirección de residencia).
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';
import { montoAddi } from './montos';

export interface ItemFinanciado {
  sku: string;
  name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: bigint;
  line_discount: bigint;
}

export interface PedidoFinanciado {
  number: string;
  public_token: string;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  subtotal: bigint;
  discount_amount: bigint;
  financing_surcharge_amount: bigint;
  total_customer: bigint;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string | null;
  contact_phone_e164: string;
  document_type: string | null;
  document_number: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city_name: string | null;
  items: ItemFinanciado[];
}

interface Direccion {
  lineOne: string;
  city: string;
  country: 'CO';
}

export interface SolicitudAddi {
  orderId: string;
  totalAmount: string;
  shippingAmount: string;
  currency: 'COP';
  items: { sku: string; name: string; quantity: string; unitPrice: string }[];
  client: {
    idType: 'CC';
    idNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    cellphone: string;
    cellphoneCountryCode: '+57';
    address: Direccion;
  };
  shippingAddress: Direccion;
  allyUrlRedirection: { callbackUrl: string; redirectionUrl: string };
}

export type MotivoSolicitudInvalida = 'moneda' | 'descuento' | 'totales' | 'documento' | 'correo' | 'celular' | 'direccion';

export type ResultadoSolicitud = { ok: true; cuerpo: SolicitudAddi } | { ok: false; motivo: MotivoSolicitudInvalida };

const REFERENCIA = /^[A-Za-z0-9-]{1,60}$/;
const ORIGEN_HTTPS = /^https:\/\/[^\s/?#]+$/;
const CELULAR_CO = /^\+57(3\d{9})$/;

/** Referencia del intento `n` (1, 2, …) del pedido. */
export function referenciaAddi(numero: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('Intento inválido.');
  const r = `${numero}-A${n}`;
  if (!REFERENCIA.test(r)) throw new RangeError('Número de pedido inválido.');
  return r;
}

export function construirSolicitudAddi(
  p: PedidoFinanciado,
  o: { urlSitio: string; referencia: string },
): ResultadoSolicitud {
  const sitio = o.urlSitio.replace(/\/+$/, '');
  if (!ORIGEN_HTTPS.test(sitio)) throw new RangeError('SITE_URL debe ser un origen https.');
  if (!REFERENCIA.test(o.referencia)) throw new RangeError('Referencia inválida.');
  if (p.country_code !== 'CO' || p.currency_code !== 'COP') return { ok: false, motivo: 'moneda' };

  if (p.discount_amount !== 0n || p.items.some((i) => i.line_discount !== 0n)) return { ok: false, motivo: 'descuento' };
  const sumaItems = p.items.reduce((s, i) => s + i.unit_price * BigInt(i.quantity), 0n);
  if (
    p.items.length === 0 ||
    p.items.some((i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.unit_price < 0n) ||
    sumaItems !== p.subtotal ||
    p.financing_surcharge_amount < 0n ||
    p.subtotal + p.financing_surcharge_amount !== p.total_customer ||
    p.total_customer <= 0n
  ) {
    return { ok: false, motivo: 'totales' };
  }

  const documento = p.document_number?.trim() ?? '';
  if (p.document_type !== 'CC' || !/^\d{5,15}$/.test(documento)) return { ok: false, motivo: 'documento' };
  const correo = p.contact_email?.trim() ?? '';
  if (correo === '') return { ok: false, motivo: 'correo' };
  const celular = CELULAR_CO.exec(p.contact_phone_e164);
  if (!celular) return { ok: false, motivo: 'celular' };
  const linea = [p.shipping_address1, p.shipping_address2].map((x) => x?.trim() ?? '').filter((x) => x !== '').join(' ');
  const ciudad = p.shipping_city_name?.trim() ?? '';
  if (!p.shipping_address1?.trim() || ciudad === '') return { ok: false, motivo: 'direccion' };
  const direccion: Direccion = { lineOne: linea, city: ciudad, country: 'CO' };

  const items = p.items.map((i) => ({
    sku: i.sku,
    name: [i.name, i.variant_label].filter((x) => x && x.trim() !== '').join(' '),
    quantity: String(i.quantity),
    unitPrice: montoAddi(i.unit_price),
  }));
  if (p.financing_surcharge_amount > 0n) {
    items.push({ sku: 'CARGO-FINANCIACION', name: 'Cargo por financiación', quantity: '1', unitPrice: montoAddi(p.financing_surcharge_amount) });
  }

  return {
    ok: true,
    cuerpo: {
      orderId: o.referencia,
      totalAmount: montoAddi(p.total_customer),
      shippingAmount: montoAddi(0n),
      currency: 'COP',
      items,
      client: {
        idType: 'CC',
        idNumber: documento,
        firstName: p.contact_first_name.trim(),
        lastName: p.contact_last_name.trim(),
        email: correo,
        cellphone: celular[1] as string,
        cellphoneCountryCode: '+57',
        address: direccion,
      },
      shippingAddress: direccion,
      allyUrlRedirection: {
        callbackUrl: `${sitio}/api/webhooks/addi`,
        redirectionUrl: `${sitio}/co/pedido/${encodeURIComponent(p.public_token)}`,
      },
    },
  };
}
