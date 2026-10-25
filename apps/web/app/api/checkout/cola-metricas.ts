/**
 * Productor de `metrics.recompute_day` desde la web (SOLO SERVIDOR, §21.4, D-033): tras crear un pedido o
 * moverlo al preparar el cobro (rechazo o reintento de Addi) se encola el recálculo de los días que el pedido
 * puede mover. Mismo contrato que el worker (`@izao/core/metrics`, debounce de 1 min por fecha y país).
 * Best effort: quien llama captura el error; el nocturno `metrics.recompute_recent` corrige lo que falte.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_METRICAS, encolarRecalculoPedido, fechasPedidoDeFila } from '@izao/core/metrics';
import { clienteDb } from '@/lib/db/cliente';

let cola: Queue | null = null;

function obtenerCola(): Queue {
  if (cola) return cola;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  cola = new Queue(COLA_METRICAS, { connection: new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 }) });
  return cola;
}

export async function encolarRecalculoMetricas(orderId: string): Promise<void> {
  // Se lee el pedido después del cambio: `created_at` y `paid_at` son los que fijó la base.
  const { data, error } = await clienteDb().from('orders').select('country_code, created_at, paid_at').eq('id', orderId).maybeSingle();
  if (error) throw new Error('orders: lectura fallida');
  const fechas = fechasPedidoDeFila(data);
  if (!fechas) return;
  await encolarRecalculoPedido(obtenerCola(), fechas);
}
