/**
 * Límite por clave compartido entre réplicas de `web` (§26.1): ventana fija en Redis con `INCR` + `PEXPIRE`
 * (atómico en un script Lua). Si Redis no responde, cae al limitador en memoria del proceso para no dejar el
 * formulario sin defensa (el límite efectivo se multiplica por las réplicas, pero no se abre del todo).
 * SOLO SERVIDOR. La clave lleva prefijo y la IP; nunca datos del formulario.
 */
import 'server-only';
import { Redis } from 'ioredis';
import { crearLimitadorMemoria, type DecisionTasa } from '@/lib/checkout/limite-tasa';

export interface ClienteRedisTasa {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface LimitadorTasaAsync {
  consumir(clave: string): Promise<DecisionTasa>;
}

// Devuelve {conteo, ttl_ms}; fija la expiración solo al abrir la ventana.
const SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {c, t}`;

export function crearLimitadorRedis(o: {
  prefijo: string;
  limite: number;
  ventanaMs: number;
  cliente: () => ClienteRedisTasa;
}): LimitadorTasaAsync {
  const respaldo = crearLimitadorMemoria({ limite: o.limite, ventanaMs: o.ventanaMs });
  return {
    async consumir(clave) {
      try {
        const r = (await o.cliente().eval(SCRIPT, 1, `${o.prefijo}:${clave}`, o.ventanaMs)) as [number, number];
        const [conteo, ttl] = r;
        return { permitido: conteo <= o.limite, reintentarEnSeg: Math.max(1, Math.ceil(ttl / 1000)) };
      } catch {
        return respaldo.consumir(clave);
      }
    },
  };
}

let compartido: Redis | null = null;
/** Conexión perezosa; falla rápido (sin cola offline) para no colgar la petición. */
export function redisTasa(): Redis {
  if (compartido) return compartido;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  compartido = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2_000, enableOfflineQueue: false });
  compartido.on('error', () => undefined);
  return compartido;
}
