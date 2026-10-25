/**
 * Manejo HTTP de las rutas del checkout, separado de `app/api/checkout/**` para probarlo sin Next.
 * Orden: límite por IP → tipo de contenido y tamaño → JSON → zod → lógica. Respuestas sin caché y sin
 * detalles internos; los errores de la base no llegan al navegador.
 */
import { z } from 'zod';
import { crearPedidoCheckout } from './crear-pedido';
import type { FuenteCheckout } from './fuente';
import { ipCliente, type LimitadorTasa } from './limite-tasa';
import type { AddiCredentials, ClienteAddi } from '@izao/addi';
import { prepararPagoAddi, type FuentePagosAddi, type ResultadoPagoAddi } from './pago-addi';
import { prepararPagoWompi, type FuentePagos, type PedidoParaPago, type ResultadoPago } from './pago-wompi';
import { entradaVistaPreviaSchema, paisEntradaSchema, vistaPrevia } from './vista-previa';

export interface DepsPagos {
  fuente: () => FuentePagos;
  /** Origen https del sitio para el `redirect-url` (`SITE_URL`). */
  urlSitio: string;
  /** Si está, el checkout con Addi deja lista la solicitud de crédito (`payment` con la URL de Addi). */
  addi?: () => FuentePagosAddi;
  /** Solo pruebas: cliente de Addi con `fetch` falso. */
  clienteAddi?: (c: AddiCredentials) => ClienteAddi;
  /** Encola `metrics.recompute_day` tras una transición del pedido al preparar el cobro (best effort, D-033). */
  recalcularMetricas?: (orderId: string) => Promise<void>;
}

export interface DepsCheckout {
  fuente: () => FuenteCheckout;
  limitador: LimitadorTasa;
  ahora?: () => Date;
  /** Tope de `max_quantity` en la vista previa. */
  topeCantidadVistaPrevia?: number;
  /** Si está, el checkout con Wompi deja listo el intento de pago (`payment`). */
  pagos?: DepsPagos;
  /**
   * Contra entrega: encola `cod.iniciar` (id fijo por pedido; repetir no duplica). El worker crea el link del abono,
   * el token `/pagar/{token}` y envía el cobro por WhatsApp (D-025).
   */
  encolarCod?: (orderId: string) => Promise<void>;
  /** Encola `metrics.recompute_day` del pedido recién creado (best effort: nunca tumba la respuesta, D-033). */
  recalcularMetricas?: (orderId: string) => Promise<void>;
}

export interface DepsPago {
  pagos: DepsPagos;
  limitador: LimitadorTasa;
  ahora?: () => Date;
}

const MAX_BYTES_VISTA_PREVIA = 16 * 1024;
const MAX_BYTES_CHECKOUT = 32 * 1024;

function json(cuerpo: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

type Lectura = { ok: true; valor: unknown } | { ok: false; res: Response };

async function leerJson(req: Request, maxBytes: number): Promise<Lectura> {
  const tipo = req.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(tipo)) return { ok: false, res: json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415) };
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > maxBytes) return { ok: false, res: json({ error: 'PAYLOAD_TOO_LARGE' }, 413) };
  const texto = await req.text();
  if (new TextEncoder().encode(texto).byteLength > maxBytes) {
    return { ok: false, res: json({ error: 'PAYLOAD_TOO_LARGE' }, 413) };
  }
  try {
    return { ok: true, valor: JSON.parse(texto) as unknown };
  } catch {
    return { ok: false, res: json({ error: 'INVALID_INPUT' }, 400) };
  }
}

function limitar(req: Request, deps: DepsCheckout, ruta: string): Response | null {
  const d = deps.limitador.consumir(`${ruta}:${ipCliente(req.headers)}`);
  if (d.permitido) return null;
  return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': String(d.reintentarEnSeg) });
}

function fallaInterna(ruta: string, e: unknown): Response {
  console.error(`[checkout] ${ruta}: ${e instanceof Error ? e.name : 'error'}`);
  return json({ error: 'UNAVAILABLE' }, 503);
}

export async function manejarVistaPrevia(req: Request, deps: DepsCheckout): Promise<Response> {
  const limitado = limitar(req, deps, 'preview');
  if (limitado) return limitado;
  const lectura = await leerJson(req, MAX_BYTES_VISTA_PREVIA);
  if (!lectura.ok) return lectura.res;
  const entrada = entradaVistaPreviaSchema.safeParse(lectura.valor);
  if (!entrada.success) {
    return json(
      {
        error: 'INVALID_INPUT',
        issues: entrada.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      },
      400,
    );
  }
  try {
    const r = await vistaPrevia(deps.fuente(), entrada.data, (deps.ahora ?? (() => new Date()))(), {
      topeCantidad: deps.topeCantidadVistaPrevia ?? 10,
    });
    return r ? json(r, 200) : json({ error: 'UNAVAILABLE' }, 503);
  } catch (e) {
    return fallaInterna('preview', e);
  }
}

export async function manejarCheckout(req: Request, deps: DepsCheckout): Promise<Response> {
  const limitado = limitar(req, deps, 'checkout');
  if (limitado) return limitado;
  const lectura = await leerJson(req, MAX_BYTES_CHECKOUT);
  if (!lectura.ok) return lectura.res;
  const ahora = (deps.ahora ?? (() => new Date()))();
  let r: Awaited<ReturnType<typeof crearPedidoCheckout>>;
  try {
    r = await crearPedidoCheckout(deps.fuente(), lectura.valor, ahora);
  } catch (e) {
    return fallaInterna('checkout', e);
  }
  if (r.ok && !r.cuerpo.repeated && deps.recalcularMetricas) {
    try {
      await deps.recalcularMetricas(r.order_id);
    } catch (e) {
      console.error(`[checkout] metrics.recompute_day no encolado: ${e instanceof Error ? e.name : 'error'}`);
    }
  }
  if (r.ok && r.cuerpo.next_step === 'pay_cod_deposit') {
    // El pedido ya existe: si Redis falla, el barrido de pedidos `esperando_abono` sin link lo recupera.
    try {
      await deps.encolarCod?.(r.order_id);
    } catch (e) {
      console.error(`[checkout] cod.iniciar no encolado: ${e instanceof Error ? e.name : 'error'}`);
    }
    return json({ ...r.cuerpo, payment: null }, r.status);
  }
  if (r.ok && r.cuerpo.next_step === 'pay_addi' && deps.pagos?.addi) {
    // El pedido ya existe: si la solicitud no queda lista, `payment: null` y la página la reintenta.
    let payment: { checkout_url: string; expires_at: string } | null = null;
    try {
      const p = await pagoAddi(deps.pagos, r.order_id, ahora);
      if (p?.ok) payment = { checkout_url: p.pago.checkout_url, expires_at: p.pago.expires_at.toISOString() };
      else console.error(`[checkout] solicitud de Addi no preparada: ${p ? p.motivo : 'pedido_no_encontrado'}`);
    } catch (e) {
      console.error(`[checkout] solicitud de Addi no preparada: ${e instanceof Error ? e.name : 'error'}`);
    }
    return json({ ...r.cuerpo, payment }, r.status);
  }
  if (!r.ok || r.cuerpo.next_step !== 'pay_wompi' || !deps.pagos) return json(r.cuerpo, r.status);
  // El pedido ya existe: si el cobro no queda listo, se informa `payment: null` y la página lo reintenta.
  let payment: { checkout_url: string; expires_at: string } | null = null;
  try {
    const pedido = await deps.pagos.fuente().pedidoPorId(r.order_id);
    const p = pedido ? await prepararPagoWompi(deps.pagos.fuente(), pedido, { ahora, urlSitio: deps.pagos.urlSitio }) : null;
    if (p?.ok) payment = { checkout_url: p.pago.checkout_url, expires_at: p.pago.expires_at.toISOString() };
    else console.error(`[checkout] pago Wompi no preparado: ${p ? p.motivo : 'pedido_no_encontrado'}`);
  } catch (e) {
    console.error(`[checkout] pago Wompi no preparado: ${e instanceof Error ? e.name : 'error'}`);
  }
  return json({ ...r.cuerpo, payment }, r.status);
}

/** Solicitud de Addi del pedido (crear o reutilizar). `null` si el pedido no existe. */
async function pagoAddi(pagos: DepsPagos, orderId: string, ahora: Date): Promise<ResultadoPagoAddi | null> {
  if (!pagos.addi) return { ok: false, motivo: 'metodo' };
  const fuente = pagos.addi();
  const pedido = await fuente.pedidoAddiPorId(orderId);
  if (!pedido) return null;
  return prepararPagoAddi(fuente, pedido, {
    ahora,
    urlSitio: pagos.urlSitio,
    ...(pagos.clienteAddi ? { cliente: pagos.clienteAddi } : {}),
    ...(pagos.recalcularMetricas ? { recalcularMetricas: pagos.recalcularMetricas } : {}),
  });
}

const entradaPagoSchema = z.object({
  country: paisEntradaSchema,
  token: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const ESTADO_HTTP: Record<Exclude<ResultadoPago | ResultadoPagoAddi, { ok: true }>['motivo'], number> = {
  metodo: 409,
  estado: 409,
  pagado: 409,
  vencido: 410,
  conflicto: 409,
  sin_credenciales: 503,
  datos_cliente: 422,
  rechazado_entidad: 409,
  entidad_no_disponible: 503,
};

/**
 * `POST /api/checkout/pago` `{country, token}`: deja listo (o devuelve) el intento de pago del pedido con ese
 * `public_token`: Web Checkout de Wompi o solicitud de crédito de Addi, según `payment_method`.
 * 200 `{checkout_url, expires_at, reused}`; 404 si no existe; 409/410/422/503 con
 * `{error: 'PAYMENT_NOT_AVAILABLE', reason}` (Addi: `datos_cliente`, `rechazado_entidad` → la página ofrece otros
 * métodos; `entidad_no_disponible` → reintentar). El monto sale del pedido, nunca de la petición.
 */
export async function manejarPago(req: Request, deps: DepsPago): Promise<Response> {
  const d = deps.limitador.consumir(`pago:${ipCliente(req.headers)}`);
  if (!d.permitido) return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': String(d.reintentarEnSeg) });
  const lectura = await leerJson(req, 1024);
  if (!lectura.ok) return lectura.res;
  const entrada = entradaPagoSchema.safeParse(lectura.valor);
  if (!entrada.success) return json({ error: 'INVALID_INPUT' }, 400);
  try {
    const fuente = deps.pagos.fuente();
    const pedido: PedidoParaPago | null = await fuente.pedidoPorToken(entrada.data.country, entrada.data.token);
    if (!pedido) return json({ error: 'NOT_FOUND' }, 404);
    const ahora = (deps.ahora ?? (() => new Date()))();
    const r =
      pedido.payment_method === 'addi'
        ? await pagoAddi(deps.pagos, pedido.id, ahora)
        : await prepararPagoWompi(fuente, pedido, { ahora, urlSitio: deps.pagos.urlSitio });
    if (!r) return json({ error: 'NOT_FOUND' }, 404);
    if (!r.ok) return json({ error: 'PAYMENT_NOT_AVAILABLE', reason: r.motivo }, ESTADO_HTTP[r.motivo]);
    return json({ checkout_url: r.pago.checkout_url, expires_at: r.pago.expires_at.toISOString(), reused: r.reutilizado }, 200);
  } catch (e) {
    return fallaInterna('pago', e);
  }
}
