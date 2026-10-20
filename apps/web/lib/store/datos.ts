import 'server-only';
import { repoEjemplo } from './repo-ejemplo';
import type { TiendaRepo } from './repo';
import { repoSupabase } from './repo-supabase';

/**
 * Origen de datos de la tienda. `STORE_DATOS=ejemplo|supabase` lo fuerza; sin él, producción siempre usa
 * Supabase y en desarrollo se usa Supabase solo si hay llaves (si no, datos de ejemplo tipados).
 */
export function tienda(): TiendaRepo {
  const forzado = process.env.STORE_DATOS;
  if (forzado === 'ejemplo' && process.env.NODE_ENV !== 'production') return repoEjemplo;
  if (forzado === 'supabase' || process.env.NODE_ENV === 'production') return repoSupabase;
  return process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? repoSupabase : repoEjemplo;
}
