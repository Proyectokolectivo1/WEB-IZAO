/**
 * Cliente de Supabase con la llave secreta (rol de servicio). Se salta RLS.
 *
 * SOLO SERVIDOR: middleware, Server Actions, rutas API y scripts. Nunca se
 * importa desde un componente de cliente ni se devuelve su resultado sin filtrar.
 * No tiene sesión ni la persiste.
 */
import { createClient } from '@supabase/supabase-js';
import { llaveSecretaSupabase, urlSupabase } from '../env';

export function crearClienteServicio() {
  return createClient(urlSupabase(), llaveSecretaSupabase(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
