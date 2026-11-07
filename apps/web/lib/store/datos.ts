import 'server-only';
import { cache } from 'react';
import { ejemploPermitido } from './modo-datos';
import { repoEjemplo } from './repo-ejemplo';
import type { TiendaRepo } from './repo';
import { repoSupabase } from './repo-supabase';

/**
 * Origen de datos de la tienda. `STORE_DATOS=ejemplo|supabase` lo fuerza; sin él, producción siempre usa
 * Supabase y en desarrollo se usa Supabase solo si hay llaves (si no, datos de ejemplo tipados).
 */
// Fuera de React Server (pruebas con vitest) `cache` no existe: se usa la función tal cual.
const cacheoDeRender: <F extends (...a: never[]) => unknown>(f: F) => F = typeof cache === 'function' ? cache : (f) => f;

const envueltos = new WeakMap<TiendaRepo, TiendaRepo>();

/**
 * Cada lectura se envuelve en `cache()` de React: dentro de un mismo render (layout + `generateMetadata` + página + componentes
 * hermanos) la misma lectura con los mismos argumentos va una sola vez a la base. Con argumentos que son objetos (p. ej. la
 * consulta del catálogo) la identidad cuenta, así que solo deduplica lo que pasa la misma referencia; nunca devuelve algo distinto.
 */
function conCacheDeRender(repo: TiendaRepo): TiendaRepo {
  let e = envueltos.get(repo);
  if (!e) {
    const copia: Record<string, unknown> = {};
    for (const [nombre, valor] of Object.entries(repo)) {
      copia[nombre] = typeof valor === 'function' ? cacheoDeRender((valor as (...a: unknown[]) => unknown).bind(repo)) : valor;
    }
    e = copia as unknown as TiendaRepo;
    envueltos.set(repo, e);
  }
  return e;
}

function elegirRepo(): TiendaRepo {
  const forzado = process.env.STORE_DATOS;
  if (forzado === 'ejemplo' && ejemploPermitido()) return repoEjemplo;
  if (forzado === 'supabase' || process.env.NODE_ENV === 'production') return repoSupabase;
  return process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? repoSupabase : repoEjemplo;
}

export function tienda(): TiendaRepo {
  return conCacheDeRender(elegirRepo());
}
