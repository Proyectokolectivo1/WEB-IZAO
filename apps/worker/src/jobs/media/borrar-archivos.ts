/**
 * Vacía la cola `media_file_deletions` (D-035, izao-db): borra del disco `<MEDIA_ROOT>/<base_path>` y cada ruta de
 * `variants`, y luego la fila. Idempotente: un archivo que ya no existe cuenta como borrado. Si algo falla, la fila
 * queda con `attempts + 1` y `last_error` (solo el código del error, sin rutas ni datos personales) y se reintenta
 * en la siguiente ejecución, hasta `MAX_INTENTOS`. Una ruta fuera de la raíz nunca se toca (queda como error).
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

export const JOB_MEDIA_BORRAR_ARCHIVOS = 'media.borrar_archivos';
export const CRON_MEDIA_BORRAR_ARCHIVOS = '*/15 * * * *';
export const MAX_INTENTOS = 10;
export const LOTE = 100;

export interface FilaBorrado {
  id: string;
  base_path: string;
  variants: Record<string, unknown> | null;
  attempts: number;
}

export interface FuenteBorrados {
  pendientes(limite: number): Promise<FilaBorrado[]>;
  eliminar(id: string): Promise<void>;
  registrarFallo(id: string, intentos: number, error: string): Promise<void>;
}

export interface DepsBorrados {
  fuente: FuenteBorrados;
  mediaRoot: string;
  borrar?: (ruta: string) => Promise<void>;
}

const borrarDisco = (ruta: string): Promise<void> => rm(ruta, { force: true });

/** Rutas relativas a borrar de una fila (base + variantes, sin repetir). */
export function rutasDeFila(f: FilaBorrado): string[] {
  const v = Object.values(f.variants ?? {}).filter((x): x is string => typeof x === 'string' && x !== '');
  return [...new Set([f.base_path, ...v])];
}

export function resolverDentro(raiz: string, relativa: string): string {
  const base = path.resolve(raiz);
  const destino = path.resolve(base, relativa);
  if (relativa === '' || !destino.startsWith(base + path.sep)) throw new Error('ruta_fuera_de_raiz');
  return destino;
}

export async function borrarArchivosPendientes(deps: DepsBorrados): Promise<{ borrados: number; fallidos: number }> {
  const borrar = deps.borrar ?? borrarDisco;
  let borrados = 0;
  let fallidos = 0;
  for (const fila of await deps.fuente.pendientes(LOTE)) {
    try {
      for (const r of rutasDeFila(fila)) await borrar(resolverDentro(deps.mediaRoot, r));
      await deps.fuente.eliminar(fila.id);
      borrados += 1;
    } catch (err) {
      fallidos += 1;
      const codigo = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : 'error');
      await deps.fuente.registrarFallo(fila.id, fila.attempts + 1, String(codigo).slice(0, 100));
    }
  }
  return { borrados, fallidos };
}

export function fuenteBorradosPostgrest(o: { supabaseUrl: string; secretKey: string; fetchImpl?: typeof fetch }): FuenteBorrados {
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1/media_file_deletions`;
  const doFetch = o.fetchImpl ?? fetch;
  const cab = { apikey: o.secretKey, authorization: `Bearer ${o.secretKey}`, 'content-type': 'application/json' };
  const pedir = async (op: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await doFetch(url, { ...init, headers: cab, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`media_file_deletions ${op} respondió HTTP ${res.status}`);
    return res;
  };
  return {
    async pendientes(limite) {
      const q = `select=id,base_path,variants,attempts&attempts=lt.${MAX_INTENTOS}&order=requested_at.asc&limit=${limite}`;
      return (await (await pedir('lectura', `${base}?${q}`)).json()) as FilaBorrado[];
    },
    async eliminar(id) {
      await pedir('borrado', `${base}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async registrarFallo(id, intentos, error) {
      await pedir('actualización', `${base}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ attempts: intentos, last_error: error }),
      });
    },
  };
}

export function dependenciasBorradosDesdeEnv(): DepsBorrados {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL no está definida');
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY no está definida');
  return { fuente: fuenteBorradosPostgrest({ supabaseUrl, secretKey }), mediaRoot: process.env.MEDIA_ROOT ?? '/srv/izao/media' };
}
