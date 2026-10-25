/**
 * Solicitud de crédito con Addi para `next_step = pay_addi` (§12.3, D-031). Puro sobre `FuentePagosAddi`.
 *
 * - El monto es `total_customer` del pedido (subtotal + recargo de financiación, sin descuento: §11.2), fijado
 *   por el servidor al crearlo; `construirSolicitudAddi` vuelve a verificar que cuadre y se niega si no.
 * - Se registra la fila `payments` (`provider addi`, `purpose financing`, `status created`, referencia
 *   `{número}-A{n}`) **antes** de llamar a Addi: el callback siempre encuentra a qué pago pertenece. Luego se
 *   guarda la URL que devuelve Addi (`Location` del 301) y se entrega al navegador.
 * - Idempotente: una solicitud vigente con URL se reutiliza; una recién registrada sin URL (otra petición la
 *   está creando) → `conflicto`; una sin URL de hace más de 1 min quedó colgada → `error` y se crea otra.
 * - Addi exige `orderId` único por compra: un reintento tras `pago_rechazado` vuelve a `pendiente_pago` con
 *   `transicionar` y crea `A{n+1}`.
 * - Rechazo de Addi al crear (409 cliente con crédito, 400 datos) → `pago_rechazado` (la página ofrece otros
 *   métodos). Caída, red o respuesta rara → el pedido sigue pendiente y se puede reintentar.
 */
import type { OrderStatus, OrderStatusEvent } from '@izao/core/order-state';
import { transicionar } from '@izao/core/order-state';
import type { CurrencyCode } from '@izao/core/money';
import type { PaymentStatus } from '@izao/core/contracts';
import {
  ErrorAddi,
  construirSolicitudAddi,
  crearClienteAddi,
  referenciaAddi,
  type AddiCredentials,
  type ClienteAddi,
  type CodigoErrorAddi,
  type MotivoSolicitudInvalida,
  type PedidoFinanciado,
} from '@izao/addi';
import type { MotivoSinPago, PagoListo } from './pago-wompi';

export interface PedidoAddiParaPago extends PedidoFinanciado {
  id: string;
  status: OrderStatus;
  payment_method: string;
  stock_reserved_until: Date | null;
}

export interface IntentoAddi {
  id: string;
  status: PaymentStatus;
  amount: bigint;
  provider_reference: string | null;
  checkout_url: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface NuevoIntentoAddi {
  order_id: string;
  amount: bigint;
  currency_code: CurrencyCode;
  provider_reference: string;
  expires_at: Date;
}

export interface FuentePagosAddi {
  /** Pedido con líneas, documento y dirección (lo que pide la solicitud de Addi). */
  pedidoAddiPorId(id: string): Promise<PedidoAddiParaPago | null>;
  /** Pagos de Addi (`purpose financing`) del pedido, del más antiguo al más reciente. */
  intentosAddi(orderId: string): Promise<IntentoAddi[]>;
  credencialesAddi(): Promise<AddiCredentials | null>;
  /** `duplicado` si ya existe un pago de Addi con esa referencia (índice único `provider, provider_reference`). */
  insertarIntentoAddi(n: NuevoIntentoAddi): Promise<{ ok: true; intento: IntentoAddi } | { ok: false; motivo: 'duplicado' }>;
  /** Guarda la URL de Addi o el fallo al crear la solicitud (código, nunca el cuerpo de la respuesta). */
  completarIntentoAddi(
    id: string,
    c: { status: 'created' | 'declined' | 'error'; checkout_url: string | null; error: CodigoErrorAddi | null },
  ): Promise<void>;
  /** `aplicar_transicion_pedido` atómico; `false` si otro proceso movió el pedido. */
  aplicarTransicion(orderId: string, evento: OrderStatusEvent): Promise<boolean>;
}

export interface OpcionesPagoAddi {
  ahora: Date;
  /** Origen público del sitio, https (`SITE_URL`). */
  urlSitio: string;
  /** Tiempo mínimo que debe quedarle a la reserva para ofrecer el pago (defecto 2 min). */
  margenMs?: number;
  /** Solo pruebas: cliente con `fetch` falso. */
  cliente?: (c: AddiCredentials) => ClienteAddi;
}

export type MotivoSinPagoAddi = MotivoSinPago | 'datos_cliente' | 'rechazado_entidad' | 'entidad_no_disponible';

export type ResultadoPagoAddi =
  | { ok: true; reutilizado: boolean; pago: PagoListo }
  | { ok: false; motivo: Exclude<MotivoSinPagoAddi, 'datos_cliente'> }
  | { ok: false; motivo: 'datos_cliente'; detalle: MotivoSolicitudInvalida };

const COBRABLES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['pendiente_pago', 'pago_rechazado']);
const PAGADOS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pagado',
  'enviado_transportadora',
  'error_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);
/** Más que dos llamadas de 10 s (token + solicitud) con un reintento de token. */
const EN_CURSO_MS = 60_000;

type Vigente = IntentoAddi & { checkout_url: string; expires_at: Date; provider_reference: string };

function vigente(i: IntentoAddi, limite: number): i is Vigente {
  return (
    (i.status === 'created' || i.status === 'pending') &&
    !!i.checkout_url?.startsWith('https://') &&
    !!i.provider_reference &&
    i.expires_at !== null &&
    i.expires_at.getTime() > limite
  );
}

export async function prepararPagoAddi(
  fuente: FuentePagosAddi,
  pedido: PedidoAddiParaPago,
  o: OpcionesPagoAddi,
): Promise<ResultadoPagoAddi> {
  const sitio = o.urlSitio.replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(sitio)) throw new RangeError('SITE_URL debe ser un origen https.');
  if (pedido.payment_method !== 'addi' || pedido.currency_code !== 'COP' || pedido.country_code !== 'CO') {
    return { ok: false, motivo: 'metodo' };
  }
  if (PAGADOS.has(pedido.status)) return { ok: false, motivo: 'pagado' };
  const intentos = await fuente.intentosAddi(pedido.id);
  if (intentos.some((i) => i.status === 'approved')) return { ok: false, motivo: 'pagado' };
  if (!COBRABLES.has(pedido.status)) return { ok: false, motivo: 'estado' };

  const limite = o.ahora.getTime() + (o.margenMs ?? 120_000);
  const vence = pedido.stock_reserved_until;
  if (!vence || vence.getTime() <= limite) return { ok: false, motivo: 'vencido' };

  const actual = intentos.at(-1);
  if (pedido.status === 'pendiente_pago' && actual) {
    if (vigente(actual, limite)) {
      return { ok: true, reutilizado: true, pago: { checkout_url: actual.checkout_url, expires_at: actual.expires_at, reference: actual.provider_reference } };
    }
    if (actual.status === 'created' && actual.checkout_url === null) {
      if (o.ahora.getTime() - actual.created_at.getTime() < EN_CURSO_MS) return { ok: false, motivo: 'conflicto' };
      // Colgado: nunca llegó al cliente. Se cierra y se crea otro.
      await fuente.completarIntentoAddi(actual.id, { status: 'error', checkout_url: null, error: null });
    }
  }

  const referencia = referenciaAddi(pedido.number, intentos.length + 1);
  const solicitud = construirSolicitudAddi(pedido, { urlSitio: sitio, referencia });
  if (!solicitud.ok) return { ok: false, motivo: 'datos_cliente', detalle: solicitud.motivo };

  const creds = await fuente.credencialesAddi();
  if (!creds) return { ok: false, motivo: 'sin_credenciales' };

  const rechazar = async (): Promise<boolean> => {
    const t = transicionar({ from: 'pendiente_pago', to: 'pago_rechazado', actor: 'system', payload: { motivo: 'addi_rechazo_solicitud', reference: referencia } });
    return t.ok && (await fuente.aplicarTransicion(pedido.id, t.event));
  };

  if (pedido.status === 'pago_rechazado') {
    const t = transicionar({ from: 'pago_rechazado', to: 'pendiente_pago', actor: 'system', payload: { motivo: 'reintento_pago' } });
    if (!t.ok) return { ok: false, motivo: 'estado' };
    if (!(await fuente.aplicarTransicion(pedido.id, t.event))) return { ok: false, motivo: 'conflicto' };
  }

  const ins = await fuente.insertarIntentoAddi({
    order_id: pedido.id,
    amount: pedido.total_customer,
    currency_code: pedido.currency_code,
    provider_reference: referencia,
    expires_at: vence,
  });
  if (!ins.ok) return { ok: false, motivo: 'conflicto' };

  const cliente = (o.cliente ?? ((c: AddiCredentials) => crearClienteAddi({ credenciales: c })))(creds);
  try {
    const { url } = await cliente.crearSolicitud(solicitud.cuerpo);
    await fuente.completarIntentoAddi(ins.intento.id, { status: 'created', checkout_url: url, error: null });
    return { ok: true, reutilizado: false, pago: { checkout_url: url, expires_at: vence, reference: referencia } };
  } catch (e) {
    const codigo: CodigoErrorAddi = e instanceof ErrorAddi ? e.codigo : 'RED';
    const status = codigo === 'CLIENTE_CON_CREDITO' ? 'declined' : 'error';
    await fuente.completarIntentoAddi(ins.intento.id, { status, checkout_url: null, error: codigo });
    console.error(`[checkout] solicitud de Addi no creada: ${codigo}`);
    switch (codigo) {
      case 'CLIENTE_CON_CREDITO':
      case 'VALIDACION':
        await rechazar();
        return { ok: false, motivo: 'rechazado_entidad' };
      case 'CREDENCIALES':
        return { ok: false, motivo: 'sin_credenciales' };
      default:
        return { ok: false, motivo: 'entidad_no_disponible' };
    }
  }
}
