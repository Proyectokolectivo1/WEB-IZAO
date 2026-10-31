import { usarSupabase } from '@/lib/store/checkout-datos';
import { AJUSTES_DESARROLLO } from '@/lib/store/chat/ajustes-desarrollo';
import { conWhatsapp, gastadoDelMes, herramientasDePais, leerAjustesChat, type AjustesChat } from '@/lib/store/chat/fuente-supabase';
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

export async function GET(req: Request) {
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
  const agotado = nivelPresupuesto({ gastado, presupuesto: ajustes.presupuestoMicros, degradarPct: ajustes.degradarPct }) === 'agotado';
  return Response.json(
    {
      estado: !ajustes.habilitado ? 'desactivado' : agotado ? 'agotado' : 'activo',
      bienvenida: ajustes.bienvenida[pais.toUpperCase()] ?? TI.bienvenidaDefecto,
      whatsapp: enlace,
      whatsappNumero: t?.whatsappAsesor ?? null,
      maxEntrada: ajustes.maxEntrada,
      turnstileKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
