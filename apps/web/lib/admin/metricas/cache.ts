import 'server-only';
/**
 * Caché de 5 minutos en Redis para los tops del dashboard (§21.4). Falla abierta: si Redis no está o tarda, se calcula
 * directo y el panel sigue funcionando (la caché solo acelera). Los valores se guardan como JSON con los `bigint`
 * marcados, porque los montos del dashboard nunca pasan por `number` (regla 1).
 */
import { Redis } from 'ioredis';

export const TTL_TOPS_SEGUNDOS = 300;
const TIEMPO_MAX_MS = 800;

/** Lo mínimo que se usa de Redis (permite probar sin servidor). */
export interface AlmacenCache {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
}

const MARCA = '$bigint';

export function serializar(valor: unknown): string {
  return JSON.stringify(valor, (_k, v) => (typeof v === 'bigint' ? { [MARCA]: v.toString() } : v));
}

export function deserializar<T>(texto: string): T {
  return JSON.parse(texto, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as Record<string, unknown>)[MARCA] === 'string') {
      return BigInt((v as Record<string, string>)[MARCA]!);
    }
    return v;
  }) as T;
}

let conexion: Redis | null = null;
function almacenReal(): AlmacenCache | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  conexion ??= new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 1500, enableOfflineQueue: false, lazyConnect: false });
  conexion.on('error', () => {
    /* sin Redis se calcula directo; el error ya se refleja en Sistema */
  });
  return conexion as unknown as AlmacenCache;
}

function conTiempo<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const t = setTimeout(() => rechazar(new Error('cache lenta')), TIEMPO_MAX_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolver(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        rechazar(e instanceof Error ? e : new Error('cache'));
      },
    );
  });
}

/** Devuelve lo guardado bajo `clave` o calcula, guarda 5 min y devuelve. Nunca lanza por culpa de la caché. */
export async function conCache<T>(
  clave: string,
  calcular: () => Promise<T>,
  opciones: { ttl?: number; almacen?: AlmacenCache | null } = {},
): Promise<{ valor: T; desdeCache: boolean }> {
  const almacen = opciones.almacen === undefined ? almacenReal() : opciones.almacen;
  if (almacen) {
    try {
      const guardado = await conTiempo(almacen.get(clave));
      if (guardado !== null) return { valor: deserializar<T>(guardado), desdeCache: true };
    } catch {
      /* se calcula directo */
    }
  }
  const valor = await calcular();
  if (almacen) {
    try {
      await conTiempo(almacen.set(clave, serializar(valor), 'EX', opciones.ttl ?? TTL_TOPS_SEGUNDOS));
    } catch {
      /* no se pudo guardar: la próxima vez se calcula de nuevo */
    }
  }
  return { valor, desdeCache: false };
}

export const claveTops = (pais: string, desde: string, hasta: string) => `izao:metricas:tops:v1:${pais}:${desde}:${hasta}`;
