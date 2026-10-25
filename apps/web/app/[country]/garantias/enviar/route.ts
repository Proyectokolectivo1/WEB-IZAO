import { aCodigoCore, esPais } from '@/lib/store/pais';
import { enteroEnv } from '@/lib/checkout/limite-tasa';
import { crearLimitadorRedis, redisTasa } from '@/lib/limite-tasa-redis';
import { detectarTipo } from '@/lib/admin/media/validar';
import { ajustesGarantia } from '@/lib/store/garantias/datos';
import { fuenteGarantiasSupabase } from '@/lib/store/garantias/fuente-supabase';
import {
  MAX_BYTES_SOLICITUD,
  MAX_FOTOS,
  esquemaGarantia,
  detectarVideo,
  type CampoGarantia,
  type RespuestaGarantia,
} from '@/lib/store/garantias/logica';
import { procesarGarantia } from '@/lib/store/garantias/proceso';
import { verificarTurnstile } from '@/lib/store/garantias/turnstile';
import { usarSupabase } from '@/lib/store/checkout-datos';

/**
 * `POST /{pais}/garantias/enviar` (§19): recibe el formulario público de garantías (multipart). Valida con `zod`,
 * Turnstile y un límite por IP; comprueba pedido, celular y plazo; guarda fotos o video y crea el caso con el rol de
 * servicio. Responde `RespuestaGarantia` (nunca datos del pedido). Sin caché. Node: escribe archivos en disco.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Redis compartido entre réplicas (con respaldo en memoria si Redis falla).
const limitador = crearLimitadorRedis({
  prefijo: 'rl:garantias',
  cliente: redisTasa,
  limite: enteroEnv(process.env.WARRANTY_RATE_LIMIT_PER_10MIN, 5),
  ventanaMs: 10 * 60_000,
});

const ESTADO: Record<string, number> = {
  campos: 400,
  pedido_no_encontrado: 404,
  sin_entrega: 409,
  vencido: 409,
  demasiados: 429,
  bot: 403,
  error: 503,
};

function responder(cuerpo: RespuestaGarantia, extra?: ResponseInit['headers']): Response {
  const status = cuerpo.ok ? 201 : (ESTADO[cuerpo.motivo] ?? 400);
  return Response.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

const ipDe = (req: Request): string | null =>
  req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

export async function POST(req: Request, { params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  if (!esPais(country)) return Response.json({ error: 'not_found' }, { status: 404 });
  const pais = aCodigoCore(country);
  const ip = ipDe(req);

  const decision = await limitador.consumir(ip ?? 'sin-ip');
  if (!decision.permitido) return responder({ ok: false, motivo: 'demasiados' }, { 'Retry-After': String(decision.reintentarEnSeg) });

  const largo = Number(req.headers.get('content-length') ?? '0');
  if (largo > MAX_BYTES_SOLICITUD) return responder({ ok: false, motivo: 'campos', campos: { adjuntos: 'video_pesado' } });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder({ ok: false, motivo: 'campos', campos: { pedido: 'pedido' } });
  }

  // Campo trampa: las personas no lo ven ni lo llenan.
  if (String(form.get('sitio_web') ?? '') !== '') return responder({ ok: false, motivo: 'bot' });
  if (!(await verificarTurnstile(String(form.get('cf-turnstile-response') ?? '') || null, ip))) {
    return responder({ ok: false, motivo: 'bot' });
  }

  const ajustes = await ajustesGarantia(country).catch(() => null);
  if (!ajustes) return responder({ ok: false, motivo: 'error' });

  const analisis = esquemaGarantia(pais, ajustes.motivos).safeParse({
    pedido: String(form.get('pedido') ?? ''),
    celular: String(form.get('celular') ?? ''),
    motivo: String(form.get('motivo') ?? ''),
    descripcion: String(form.get('descripcion') ?? ''),
  });
  if (!analisis.success) {
    const campos: Partial<Record<CampoGarantia, string>> = {};
    for (const i of analisis.error.issues) {
      const campo = String(i.path[0]) as CampoGarantia;
      if (!(campo in campos)) campos[campo] = campo;
    }
    return responder({ ok: false, motivo: 'campos', campos });
  }

  const archivos = form.getAll('adjuntos').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  if (archivos.length > MAX_FOTOS + 1) return responder({ ok: false, motivo: 'campos', campos: { adjuntos: 'muchas_fotos' } });
  const fotos: { buffer: Buffer; nombre: string }[] = [];
  const videos: { buffer: Buffer; nombre: string }[] = [];
  for (const f of archivos) {
    const buffer = Buffer.from(await f.arrayBuffer());
    if (detectarTipo(buffer)) fotos.push({ buffer, nombre: f.name });
    else if (detectarVideo(buffer)) videos.push({ buffer, nombre: f.name });
    else return responder({ ok: false, motivo: 'campos', campos: { adjuntos: 'tipo' } });
  }
  const codigoAdjuntos =
    fotos.length > 0 && videos.length > 0 ? 'mezcla' : fotos.length > MAX_FOTOS ? 'muchas_fotos' : videos.length > 1 ? 'muchos_videos' : null;
  if (codigoAdjuntos) return responder({ ok: false, motivo: 'campos', campos: { adjuntos: codigoAdjuntos } });

  // Sin base de datos (desarrollo con datos de ejemplo) no hay dónde guardar el caso.
  if (!usarSupabase()) return responder({ ok: false, motivo: 'error' });

  try {
    const r = await procesarGarantia(fuenteGarantiasSupabase, {
      pais,
      datos: analisis.data,
      fotos,
      video: videos[0] ?? null,
      ajustes: { diasPlazo: ajustes.diasPlazo, diasRespuesta: ajustes.diasRespuesta },
      ahora: new Date(),
    });
    return responder(r);
  } catch (e) {
    console.error(`[garantias] fallo: ${e instanceof Error ? e.name : 'error'}`);
    return responder({ ok: false, motivo: 'error' });
  }
}
