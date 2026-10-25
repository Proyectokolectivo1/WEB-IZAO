import 'server-only';
/**
 * Estado de las colas BullMQ (§24.1 Sistema): conteos por cola y últimos jobs fallidos, con la opción de reintentar
 * uno. Los jobs de Izao son idempotentes (regla 5), así que reintentar es seguro. Si Redis no responde, el panel lo
 * dice en vez de colgarse: toda consulta tiene un tope de tiempo.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_CARRIER } from '@izao/mastershop';
import { COLA_COD, COLA_WHATSAPP } from '@izao/whatsapp';
import { COLA_PAGOS } from '@izao/wompi';

/** Mismas colas que `apps/worker/src/queues.ts` (QUEUE_NAMES). */
export const COLAS = [
  { nombre: 'sistema', etiqueta: 'Sistema (mantenimiento y métricas)' },
  { nombre: COLA_PAGOS, etiqueta: 'Pagos (Wompi y Addi)' },
  { nombre: COLA_COD, etiqueta: 'Contra entrega' },
  { nombre: COLA_WHATSAPP, etiqueta: 'WhatsApp' },
  { nombre: COLA_CARRIER, etiqueta: 'Transportadora (MasterShop)' },
] as const;

export type NombreCola = (typeof COLAS)[number]['nombre'];
export const NOMBRES_COLA: readonly string[] = COLAS.map((c) => c.nombre);

export function esNombreCola(v: unknown): v is NombreCola {
  return typeof v === 'string' && NOMBRES_COLA.includes(v);
}

const TIEMPO_MAX_MS = 4000;

/** Lo mínimo que se usa de una cola (permite probar sin Redis). */
export interface JobFallido {
  id?: string | undefined;
  name: string;
  failedReason?: string | undefined;
  attemptsMade: number;
  finishedOn?: number | undefined;
  retry(): Promise<void>;
}
export interface ColaMinima {
  getJobCounts(...tipos: string[]): Promise<Record<string, number>>;
  getFailed(inicio: number, fin: number): Promise<JobFallido[]>;
  getJob(id: string): Promise<(JobFallido & { isFailed(): Promise<boolean> }) | undefined | null>;
}
export type FabricaColas = (nombre: string) => ColaMinima;

let conexion: Redis | null = null;
const colas = new Map<string, Queue>();

/** Fábrica real: una conexión compartida, de poca paciencia, para que una caída de Redis no cuelgue el panel. */
export const fabricaReal: FabricaColas = (nombre) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  conexion ??= new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: true });
  let q = colas.get(nombre);
  if (!q) {
    q = new Queue(nombre, { connection: conexion });
    colas.set(nombre, q);
  }
  return q as unknown as ColaMinima;
};

function conTiempo<T>(p: Promise<T>, ms = TIEMPO_MAX_MS): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const t = setTimeout(() => rechazar(new Error('Redis no respondió a tiempo.')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolver(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        rechazar(e instanceof Error ? e : new Error('Error de Redis.'));
      },
    );
  });
}

export type EstadoCola = {
  nombre: string;
  etiqueta: string;
  conteos: { waiting: number; active: number; delayed: number; failed: number; completed: number };
  fallidos: { id: string; job: string; motivo: string; intentos: number; cuando: string | null }[];
};

export type EstadoColas = { disponible: true; colas: EstadoCola[] } | { disponible: false; motivo: string };

const MAX_MOTIVO = 200;

export async function estadoColas(fabrica: FabricaColas = fabricaReal): Promise<EstadoColas> {
  try {
    const colas = await Promise.all(
      COLAS.map(async (c): Promise<EstadoCola> => {
        const q = fabrica(c.nombre);
        const [conteos, fallidos] = await conTiempo(
          Promise.all([q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'), q.getFailed(0, 9)]),
        );
        return {
          nombre: c.nombre,
          etiqueta: c.etiqueta,
          conteos: {
            waiting: conteos.waiting ?? 0,
            active: conteos.active ?? 0,
            delayed: conteos.delayed ?? 0,
            failed: conteos.failed ?? 0,
            completed: conteos.completed ?? 0,
          },
          fallidos: fallidos
            .filter((j) => j.id !== undefined)
            .map((j) => ({
              id: String(j.id),
              job: j.name,
              motivo: (j.failedReason ?? 'Sin detalle').slice(0, MAX_MOTIVO),
              intentos: j.attemptsMade,
              cuando: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
            })),
        };
      }),
    );
    return { disponible: true, colas };
  } catch (e) {
    console.error('[sistema] no se pudo leer las colas:', e instanceof Error ? e.message : 'error');
    return { disponible: false, motivo: 'No se pudo consultar Redis. Revisa que el servicio esté en línea.' };
  }
}

export type ResultadoReintento = { ok: true } | { ok: false; mensaje: string };

/** Reintenta un job fallido de una cola conocida. */
export async function reintentarJobFallido(cola: string, jobId: string, fabrica: FabricaColas = fabricaReal): Promise<ResultadoReintento> {
  if (!esNombreCola(cola)) return { ok: false, mensaje: 'Cola no válida.' };
  if (!/^[\w:.-]{1,200}$/.test(jobId)) return { ok: false, mensaje: 'Identificador de job no válido.' };
  try {
    const job = await conTiempo(fabrica(cola).getJob(jobId));
    if (!job) return { ok: false, mensaje: 'Ese job ya no existe (puede haberse reintentado o vencido).' };
    if (!(await conTiempo(job.isFailed()))) return { ok: false, mensaje: 'Ese job no está fallido.' };
    await conTiempo(job.retry());
    return { ok: true };
  } catch (e) {
    console.error('[sistema] no se pudo reintentar el job:', e instanceof Error ? e.message : 'error');
    return { ok: false, mensaje: 'No se pudo reintentar. Revisa que Redis esté en línea.' };
  }
}
