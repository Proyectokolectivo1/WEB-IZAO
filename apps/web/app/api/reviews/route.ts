import { detectarTipo } from '@/lib/admin/media/validar';
import { enteroEnv, ipCliente } from '@/lib/checkout/limite-tasa';
import { crearLimitadorRedis, redisTasa } from '@/lib/limite-tasa-redis';
import { usarSupabase } from '@/lib/store/checkout-datos';
import { aCodigoCore, esPais } from '@/lib/store/pais';
import { MAX_BYTES_SOLICITUD_RESENA, MAX_FOTOS_RESENA, esquemaResena, type CampoResena, type RespuestaResena } from '@/lib/store/resenas/logica';
import { fuenteResenasSupabase } from '@/lib/store/resenas/fuente-supabase';
import { procesarResena } from '@/lib/store/resenas/proceso';
import { verificarTurnstile } from '@/lib/store/turnstile';

/**
 * `POST /api/reviews` (§9.6): reseña pública de un aroma (multipart). Valida con `zod`, Turnstile (si hay llaves) y un
 * límite por IP en Redis; marca «compra verificada» solo si pedido y celular coinciden con un pedido entregado que
 * incluya el aroma, sin delatarlo en la respuesta. Siempre entra como `pending`. Sin caché. Node: escribe archivos.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorRedis({
  prefijo: 'rl:resenas',
  cliente: redisTasa,
  limite: enteroEnv(process.env.REVIEWS_RATE_LIMIT_PER_10MIN, 5),
  ventanaMs: 10 * 60_000,
});

const ESTADO: Record<string, number> = { campos: 400, demasiados: 429, bot: 403, error: 503 };

function responder(cuerpo: RespuestaResena, extra?: ResponseInit['headers']): Response {
  const status = cuerpo.ok ? 201 : (ESTADO[cuerpo.motivo] ?? 400);
  return Response.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

export async function POST(req: Request) {
  // Solo vale X-Real-IP (la fija Nginx); X-Forwarded-For lo escribe el navegador.
  const ip = ipCliente(req.headers);
  const ipReal = /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;

  const decision = await limitador.consumir(ip);
  if (!decision.permitido) return responder({ ok: false, motivo: 'demasiados' }, { 'Retry-After': String(decision.reintentarEnSeg) });

  if (Number(req.headers.get('content-length') ?? '0') > MAX_BYTES_SOLICITUD_RESENA) {
    return responder({ ok: false, motivo: 'campos', campos: { fotos: 'foto_pesada' } });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder({ ok: false, motivo: 'campos', campos: { texto: 'texto' } });
  }

  // Campo trampa: las personas no lo ven ni lo llenan.
  if (String(form.get('sitio_web') ?? '') !== '') return responder({ ok: false, motivo: 'bot' });
  if (!(await verificarTurnstile(String(form.get('cf-turnstile-response') ?? '') || null, ipReal))) {
    return responder({ ok: false, motivo: 'bot' });
  }

  const pais = String(form.get('country') ?? '').toLowerCase();
  if (!esPais(pais)) return responder({ ok: false, motivo: 'campos', campos: { producto: 'producto' } });

  const analisis = esquemaResena(aCodigoCore(pais)).safeParse({
    producto: String(form.get('producto') ?? ''),
    nombre: String(form.get('nombre') ?? ''),
    ciudad: String(form.get('ciudad') ?? ''),
    estrellas: String(form.get('estrellas') ?? ''),
    texto: String(form.get('texto') ?? ''),
    pedido: String(form.get('pedido') ?? ''),
    celular: String(form.get('celular') ?? ''),
  });
  if (!analisis.success) {
    const campos: Partial<Record<CampoResena, string>> = {};
    for (const i of analisis.error.issues) {
      const campo = String(i.path[0]) as CampoResena;
      if (!(campo in campos)) campos[campo] = campo;
    }
    return responder({ ok: false, motivo: 'campos', campos });
  }

  const archivos = form.getAll('fotos').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  if (archivos.length > MAX_FOTOS_RESENA) return responder({ ok: false, motivo: 'campos', campos: { fotos: 'muchas_fotos' } });
  const fotos: { buffer: Buffer; nombre: string }[] = [];
  for (const f of archivos) {
    const buffer = Buffer.from(await f.arrayBuffer());
    if (!detectarTipo(buffer)) return responder({ ok: false, motivo: 'campos', campos: { fotos: 'tipo' } });
    fotos.push({ buffer, nombre: f.name });
  }

  // Sin base de datos (desarrollo con datos de ejemplo) no hay dónde guardar la reseña.
  if (!usarSupabase()) return responder({ ok: false, motivo: 'error' });

  try {
    return responder(await procesarResena(fuenteResenasSupabase, { pais: aCodigoCore(pais), datos: analisis.data, fotos, ahora: new Date() }));
  } catch (e) {
    console.error(`[reseñas] fallo: ${e instanceof Error ? e.name : 'error'}`);
    return responder({ ok: false, motivo: 'error' });
  }
}
