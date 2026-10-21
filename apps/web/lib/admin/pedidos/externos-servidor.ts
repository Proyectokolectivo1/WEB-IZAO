import 'server-only';
/**
 * Piezas externas que usan las acciones de pedidos: stock (funciones atómicas de la base) y cancelación en
 * MasterShop con la credencial activa descifrada solo en memoria (§26.3). Nada de esto llega al navegador.
 */
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { MasterShopCarrier, MasterShopClient, parseMasterShopCredentials } from '@izao/mastershop';
import { z } from 'zod';
import { llamarRpc } from '@/lib/db/cliente';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { modoIntegraciones } from '../integraciones/sondas';

const respuestaStock = z.object({ ok: z.boolean(), estado: z.string().nullable().optional() }).passthrough();

/** Descuenta definitivamente el stock reservado (pago confirmado). `false` si no hay existencias. */
export async function confirmarStockPedido(orderId: string): Promise<boolean> {
  const r = await llamarRpc('confirmar_stock', { p_order_id: orderId }, respuestaStock);
  return r.ok;
}

/** Libera la reserva de un pedido cancelado (idempotente; si el stock ya se descontó, no hace nada). */
export async function liberarStockPedido(orderId: string): Promise<void> {
  const r = await llamarRpc('liberar_stock', { p_order_id: orderId }, respuestaStock);
  if (!r.ok) throw new Error('liberar_stock respondió ok=false');
}

/** Llave activa de MasterShop (Colombia) descifrada en memoria; `null` si falta o no se puede leer. */
export async function llaveMasterShopActiva(
  cliente: Cliente,
  claveCifrado: string | undefined = process.env.APP_ENCRYPTION_KEY,
): Promise<string | null> {
  if (!claveCifrado) return null;
  const { data, error } = await cliente
    .from('integration_credentials')
    .select('environment,data_encrypted,iv,key_version')
    .eq('provider', 'mastershop')
    .eq('country_code', 'CO')
    .eq('is_active', true);
  if (error || !data || data.length !== 1) return null;
  const r = data[0] as Record<string, unknown>;
  const ambiente = r.environment === 'production' ? 'production' : 'sandbox';
  try {
    const valores = await descifrarCredenciales(
      claveCifrado,
      { provider: 'mastershop', country_code: 'CO', environment: ambiente },
      {
        data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
        iv: byteaDesdePostgrest(String(r.iv)),
        key_version: Number(r.key_version),
      },
    );
    return parseMasterShopCredentials(valores)?.apiKey ?? null;
  } catch (e) {
    console.error(`[mastershop] credenciales ilegibles: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

/**
 * Cancela el pedido en MasterShop (`PUT {idStatus: 9}`, idempotente). Con `INTEGRACIONES_MODO=mock` (ignorado en
 * producción por `modoIntegraciones`) no llama a la red.
 */
export function crearCancelarEnMasterShop(cliente: Cliente): (providerOrderId: number) => Promise<void> {
  return async (providerOrderId) => {
    if (modoIntegraciones() === 'mock') return;
    const llave = await llaveMasterShopActiva(cliente);
    if (!llave) throw new Error('No hay una llave de MasterShop activa y legible.');
    const carrier = new MasterShopCarrier({
      client: new MasterShopClient({ apiKey: llave }),
      resolveOrderOptions: () => {
        throw new Error('El panel no crea pedidos en MasterShop.');
      },
    });
    await carrier.cancelOrder(providerOrderId);
  };
}
