import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { enteroEnv, ipCliente } from '@/lib/checkout/limite-tasa';
import { crearLimitadorRedis, redisTasa } from '@/lib/limite-tasa-redis';
import { usarSupabase } from '@/lib/store/checkout-datos';
import { decidirAcceso, limpiarMensaje } from '@/lib/store/chat/acceso';
import { conversar, type ResultadoTurno } from '@/lib/store/chat/conversar';
import {
  conWhatsapp,
  crearProveedor,
  crearSesion,
  gastadoDelMes,
  guardarTurno,
  herramientasDePais,
  historialSesion,
  leerAjustesChat,
  leerSesion,
  sumarUso,
  tarjetaDePais,
  type AjustesChat,
  type SesionChat,
} from '@/lib/store/chat/fuente-supabase';
import { preciosPorDefecto } from '@/lib/store/chat/presupuesto';
import { codificarSSE, type EventoSSE } from '@/lib/store/chat/sse';
import { AJUSTES_DESARROLLO } from '@/lib/store/chat/ajustes-desarrollo';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { verificarTurnstile } from '@/lib/store/turnstile';

/**
 * `POST /api/chat` (§20.2): un turno de conversación con Iza en streaming (SSE). Valida con `zod`; aplica límite por IP en
 * Redis, Turnstile al abrir la sesión, tope de mensajes por sesión y presupuesto mensual (modelo de respaldo al degradar;
 * al agotarse responde `{ estado: 'agotado' }` con el enlace de WhatsApp). Las herramientas son de solo lectura y
 * consultan únicamente el país de la conversación. Sin caché. Node: llama a OpenRouter solo desde el servidor.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorRedis({
  prefijo: 'rl:chat',
  cliente: redisTasa,
  limite: enteroEnv(process.env.CHAT_RATE_LIMIT_PER_10MIN, 20),
  ventanaMs: 10 * 60_000,
});

const MAX_CUERPO = 16 * 1024;
const entradaSchema = z.object({
  country: z.string().transform((v) => v.toLowerCase()).pipe(z.enum(['co', 'ec'])),
  visitor_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  session_id: z.guid().nullish(),
  message: z.string().max(4000),
  page: z.object({ producto: z.string().regex(/^[a-z0-9][a-z0-9-]{0,118}$/i).nullish() }).nullish(),
  cart: z.array(z.object({ nombre: z.string().max(120), cantidad: z.number().int().min(1).max(99) })).max(10).nullish(),
  turnstile: z.string().max(2048).nullish(),
});

const json = (cuerpo: unknown, status = 200, extra?: HeadersInit) =>
  Response.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

export async function POST(req: Request) {
  const ip = ipCliente(req.headers);
  const decision = await limitador.consumir(ip);
  if (!decision.permitido) return json({ estado: 'limite' }, 429, { 'Retry-After': String(decision.reintentarEnSeg) });

  if (Number(req.headers.get('content-length') ?? '0') > MAX_CUERPO) return json({ estado: 'entrada_larga' }, 413);
  let crudo: unknown;
  try {
    crudo = await req.json();
  } catch {
    return json({ estado: 'invalido' }, 400);
  }
  const p = entradaSchema.safeParse(crudo);
  if (!p.success) return json({ estado: 'invalido' }, 400);
  const e = p.data;
  const pais = e.country;
  if (!esPais(pais)) return json({ estado: 'invalido' }, 400);

  const conBase = usarSupabase();
  let ajustes: AjustesChat;
  let gastado = 0n;
  try {
    ajustes = conBase ? await leerAjustesChat() : AJUSTES_DESARROLLO;
    if (conBase) gastado = await gastadoDelMes();
  } catch {
    return json({ estado: 'desactivado' }, 503);
  }

  const mensaje = limpiarMensaje(e.message);
  const repo = tienda();
  const tiendaAjustes = await repo.ajustes(pais).catch(() => null);
  const enlaceAsesor = conWhatsapp(herramientasDePais(pais), tiendaAjustes?.whatsappAsesor ?? null, tiendaAjustes?.nombreTienda ?? 'Izao').enlaceAsesor('');

  let sesion: SesionChat | null = null;
  try {
    if (conBase && e.session_id) sesion = await leerSesion(e.session_id, pais, e.visitor_id);
  } catch {
    return json({ estado: 'desactivado' }, 503);
  }

  const veredicto = decidirAcceso({
    habilitado: ajustes.habilitado,
    presupuestoMicros: ajustes.presupuestoMicros,
    gastadoMicros: gastado,
    degradarPct: ajustes.degradarPct,
    mensaje,
    maxEntrada: ajustes.maxEntrada,
    mensajesSesion: sesion?.mensajes ?? 0,
    maxMensajesSesion: ajustes.maxMensajesSesion,
  });
  if (!veredicto.ok) return json({ estado: veredicto.estado, whatsapp: enlaceAsesor }, veredicto.status);

  // Sin credencial utilizable de OpenRouter (y sin permiso de ejemplo) Iza descansa: la persona va al asesor por WhatsApp.
  const proveedorTurno = await crearProveedor();
  if (!proveedorTurno) return json({ estado: 'desactivado', whatsapp: enlaceAsesor }, 503);

  // Turnstile al abrir la sesión (primer mensaje); los siguientes ya van con una sesión creada por este visitante.
  if (!sesion) {
    const ipReal = /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
    if (!(await verificarTurnstile(e.turnstile ?? null, ipReal))) return json({ estado: 'bot' }, 403);
    try {
      sesion = conBase ? await crearSesion(pais, e.visitor_id) : { id: randomUUID(), mensajes: 0 };
    } catch {
      return json({ estado: 'desactivado' }, 503);
    }
  }
  const sesionActiva = sesion;

  const herramientas = conWhatsapp(herramientasDePais(pais), tiendaAjustes?.whatsappAsesor ?? null, tiendaAjustes?.nombreTienda ?? 'Izao');
  const tarjeta = tarjetaDePais(pais);
  const productoActual = e.page?.producto ? await tarjeta(e.page.producto.toLowerCase()).catch(() => null) : null;
  const historial = conBase ? await historialSesion(sesionActiva.id, ajustes.turnos).catch(() => []) : [];
  const proveedor = proveedorTurno;

  const flujo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const enc = new TextEncoder();
      const enviar = (ev: EventoSSE) => controlador.enqueue(enc.encode(codificarSSE(ev)));
      enviar({ evento: 'sesion', datos: { id: sesionActiva.id } });
      let resultado: ResultadoTurno | null = null;
      try {
        for await (const ev of conversar(
          {
            proveedor,
            herramientas,
            tarjeta,
            precios: preciosPorDefecto(),
            registrar: async (r) => {
              resultado = r;
            },
          },
          {
            nivel: veredicto.nivel,
            modeloPrimario: ajustes.modeloPrimario ?? (proveedor.nombre === 'mock' ? 'mock' : null),
            modeloRespaldo: ajustes.modeloRespaldo,
            maxTokens: ajustes.maxTokens,
            contexto: {
              nombrePais: tiendaAjustes?.nombrePais ?? (pais === 'co' ? 'Colombia' : 'Ecuador'),
              moneda: tiendaAjustes?.moneda ?? (pais === 'co' ? 'COP' : 'USD'),
              instruccionesExtra: ajustes.instruccionesExtra,
              producto: productoActual ? { slug: productoActual.slug, nombre: productoActual.nombre } : null,
              ...(e.cart ? { carrito: e.cart } : {}),
            },
            historial,
            mensaje,
            senal: req.signal,
          },
        )) {
          if (ev.tipo === 'texto') enviar({ evento: 'texto', datos: { t: ev.texto } });
          else if (ev.tipo === 'tarjeta') enviar({ evento: 'tarjeta', datos: ev.tarjeta });
          else if (ev.tipo === 'asesor') enviar({ evento: 'asesor', datos: { enlace: ev.enlace } });
          else if (ev.tipo === 'error') enviar({ evento: 'error', datos: { codigo: ev.codigo } });
          else enviar({ evento: 'fin', datos: { restantes: Math.max(0, ajustes.maxMensajesSesion - sesionActiva.mensajes - 1) } });
        }
      } catch (err) {
        console.error(`[iza] turno falló: ${err instanceof Error ? err.name : 'error'}`);
        enviar({ evento: 'error', datos: { codigo: 'interno' } });
      } finally {
        // Se guarda siempre lo dicho y se suma lo gastado, aunque la persona haya cerrado el chat a medias.
        if (conBase) {
          const r = resultado as ResultadoTurno | null;
          await guardarTurno(sesionActiva, mensaje, r).catch((x) => console.error(`[iza] no se guardó el turno: ${x instanceof Error ? x.name : 'error'}`));
          if (r) await sumarUso(r.costoMicros).catch(() => undefined);
        }
        controlador.close();
      }
    },
  });

  return new Response(flujo, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
