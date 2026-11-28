import 'server-only';
import { clienteDb } from '@/lib/db/cliente';
import type { DatosMetaNavegador } from '@/lib/checkout/datos-meta';

/** Escribe `orders.meta_user_data` con la llave de servicio (solo lo lee el worker). */
export async function guardarDatosMeta(orderId: string, datos: DatosMetaNavegador): Promise<void> {
  const { error } = await clienteDb().from('orders').update({ meta_user_data: datos }).eq('id', orderId);
  if (error) throw new Error('meta_user_data');
}
