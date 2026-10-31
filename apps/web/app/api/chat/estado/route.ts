import { enteroEnv, ipCliente } from '@/lib/checkout/limite-tasa';
import { crearLimitadorRedis, redisTasa } from '@/lib/limite-tasa-redis';
import { usarSupabase } from '@/lib/store/checkout-datos';
import { AJUSTES_DESARROLLO } from '@/lib/store/chat/ajustes-desarrollo';
import { conWhatsapp, crearProveedor, gastadoDelMes, herramientasDePais, leerAjustesChat, type AjustesChat } from '@/lib/store/chat/fuente-supabase';
import { nivelPresupuesto } from '@/lib/store/chat/presupuesto';
import { TI } from '@/lib/store/chat/textos';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';

/**
 * `GET /api/chat/estado?country=co`: lo que el widget necesita al abrirse — si Iza está activa o descansando (presupuesto
 * agotado), la bienvenida del país, el enlace de WhatsApp del asesor, los topes de entrada y la clave PÚBLICA de
 * Turnstile (la ficha es estática: se pide aquí y no al compilar). Sin secretos ni cifras de consumo.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitadorRedis({
  prefijo: 'rl:chat-estado',
  cliente: redisTasa,
  limite: enteroEnv(process.env.CHAT_STATE_RATE_LIMIT_PER_10MIN, 60),
  ventanaMs: 10 * 60_000,
});

/** Caché corta en el navegador: el widget lo pide al abrirse y no necesita el valor de este segundo. */
const CABECERAS = { 'Cache-Control': 'private, max-age=30' };

export async function GET(req: Request) {
  const decision = await limitador.consumir(ipCliente(req.headers));
  if (!decision.permitido) return Response.json({ estado: 'limite' }, { status: 429, headers: { 'Retry-After': String(decision.reintentarEnSeg), 'Cache-Control': 'no-store' } });
  const pais = new URL(req.url).searchParams.get('country')?.toLowerCase() ?? '';
  if (!esPais(pais)) return Response.json({ error: 'not_found' }, { status: 404 });
  const conBase = usarSupabase();
  let ajustes: AjustesChat;
  let gastado = 0n;
  try {
    ajustes = conBase ? await leerAjustesChat() : AJUSTES_DESARROLLO;
    if (conBase) gastado = await gastadoDelMes();
  } catch {
    return Response.json({ estado: 'desactivado' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const t = await tienda().ajustes(pais).catch(() => null);
  const enlace = conWhatsapp(herramientasDePais(pais), t?.whatsappAsesor ?? null, t?.nombreTienda ?? 'Izao').enlaceAsesor('');
  // Sin credencial utilizable (y sin permiso de ejemplo) Iza descansa: igual que `POST /api/chat`.
  const sinProveedor = ajustes.habilitado && !(await crearProveedor());
  const agotado = nivelPresupuesto({ gastado, presupuesto: ajustes.presupuestoMicros, degradarPct: ajustes.degradarPct }) === 'agotado';
  return Response.json(
    {
      estado: !ajustes.habilitado || sinProveedor ? 'desactivado' : agotado ? 'agotado' : 'activo',
      bienvenida: ajustes.bienvenida[pais.toUpperCase()] ?? TI.bienvenidaDefecto,
      whatsapp: enlace,
      whatsappNumero: t?.whatsappAsesor ?? null,
      maxEntrada: ajustes.maxEntrada,
      turnstileKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
    },
    { headers: CABECERAS },
  );
}
