/**
 * Manejo HTTP de las rutas del checkout, separado de `app/api/checkout/**` para probarlo sin Next.
 * Orden: límite por IP → tipo de contenido y tamaño → JSON → zod → lógica. Respuestas sin caché y sin
 * detalles internos; los errores de la base no llegan al navegador.
 */
import { z } from 'zod';
import { crearPedidoCheckout } from './crear-pedido';
import type { FuenteCheckout } from './fuente';
import { ipCliente, type LimitadorTasa } from './limite-tasa';
import { prepararPagoWompi, type FuentePagos, type PedidoParaPago, type ResultadoPago } from './pago-wompi';
import { entradaVistaPreviaSchema, paisEntradaSchema, vistaPrevia } from './vista-previa';

export interface DepsPagos {
  fuente: () => FuentePagos;
  /** Origen https del sitio para el `redirect-url` (`SITE_URL`). */
  urlSitio: string;
}

export interface DepsCheckout {
  fuente: () => FuenteCheckout;
  limitador: LimitadorTasa;
  ahora?: () => Date;
  /** Tope de `max_quantity` en la vista previa. */
  topeCantidadVistaPrevia?: number;
  /** Si está, el checkout con Wompi deja listo el intento de pago (`payment`). */
  pagos?: DepsPagos;
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

const entradaPagoSchema = z.object({
  country: paisEntradaSchema,
  token: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const ESTADO_HTTP: Record<Exclude<ResultadoPago, { ok: true }>['motivo'], number> = {
  metodo: 409,
  estado: 409,
  pagado: 409,
  vencido: 410,
  conflicto: 409,
  sin_credenciales: 503,
};

/**
 * `POST /api/checkout/pago` `{country, token}`: deja listo (o devuelve) el intento de pago con Wompi del pedido
 * con ese `public_token`. 200 `{checkout_url, expires_at, reused}`; 404 si no existe; 409/410/503 con
 * `{error: 'PAYMENT_NOT_AVAILABLE', reason}`. El monto sale del pedido, nunca de la petición.
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
    const r = await prepararPagoWompi(fuente, pedido, {
      ahora: (deps.ahora ?? (() => new Date()))(),
      urlSitio: deps.pagos.urlSitio,
    });
    if (!r.ok) return json({ error: 'PAYMENT_NOT_AVAILABLE', reason: r.motivo }, ESTADO_HTTP[r.motivo]);
    return json({ checkout_url: r.pago.checkout_url, expires_at: r.pago.expires_at.toISOString(), reused: r.reutilizado }, 200);
  } catch (e) {
    return fallaInterna('pago', e);
  }
}
