import 'server-only';
/**
 * Modelos disponibles en OpenRouter (`GET https://openrouter.ai/api/v1/models`, campo `data` con `id` y `name`; documentado
 * en «List all models»). Sirven de sugerencias en los campos de modelo del panel: así ningún modelo va quemado en el
 * código y quien administra elige de la lista real. Falla abierta: sin red o con otra forma de respuesta, el campo
 * sigue siendo de texto libre. Se guarda 5 minutos en Redis.
 */
import { conCache } from '../metricas/cache';

export const URL_MODELOS_OPENROUTER = 'https://openrouter.ai/api/v1/models';
const MAX_MODELOS = 500;
const TIEMPO_MS = 5000;

export type ModeloOpenRouter = { id: string; nombre: string };

const ID_VALIDO = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

/** Extrae `{id, nombre}` de la respuesta; ignora lo que no tenga la forma esperada. */
export function leerModelos(cuerpo: unknown): ModeloOpenRouter[] {
  const lista = (cuerpo as { data?: unknown } | null)?.data;
  if (!Array.isArray(lista)) return [];
  const salida: ModeloOpenRouter[] = [];
  const vistos = new Set<string>();
  for (const m of lista) {
    const id = (m as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !ID_VALIDO.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    const nombre = (m as { name?: unknown }).name;
    salida.push({ id, nombre: typeof nombre === 'string' ? nombre.slice(0, 80) : id });
  }
  return salida.sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_MODELOS);
}

export async function modelosOpenRouter(opciones: { fetchImpl?: typeof fetch; cache?: Parameters<typeof conCache>[2] } = {}): Promise<ModeloOpenRouter[]> {
  const fetchImpl = opciones.fetchImpl ?? fetch;
  try {
    const { valor } = await conCache(
      'izao:openrouter:modelos:v1',
      async () => {
        const res = await fetchImpl(URL_MODELOS_OPENROUTER, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIEMPO_MS) });
        if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
        return leerModelos(await res.json());
      },
      opciones.cache,
    );
    return valor;
  } catch {
    return [];
  }
}
