/**
 * Manejo HTTP de las rutas del checkout, separado de `app/api/checkout/**` para probarlo sin Next.
 * Orden: límite por IP → tipo de contenido y tamaño → JSON → zod → lógica. Respuestas sin caché y sin
 * detalles internos; los errores de la base no llegan al navegador.
 */
import { crearPedidoCheckout } from './crear-pedido';
import type { FuenteCheckout } from './fuente';
import { ipCliente, type LimitadorTasa } from './limite-tasa';
import { entradaVistaPreviaSchema, vistaPrevia } from './vista-previa';

export interface DepsCheckout {
  fuente: () => FuenteCheckout;
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
    const r = await vistaPrevia(deps.fuente(), entrada.data, (deps.ahora ?? (() => new Date()))());
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
  try {
    const r = await crearPedidoCheckout(deps.fuente(), lectura.valor, (deps.ahora ?? (() => new Date()))());
    return json(r.cuerpo, r.status);
  } catch (e) {
    return fallaInterna('checkout', e);
  }
}
