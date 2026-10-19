/**
 * Cliente de Supabase para Server Components, Server Actions y rutas API.
 * Usa la llave publicable y la sesión de las cookies: respeta RLS.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { llavePublicaSupabase, urlSupabase } from '../env';
import { endurecerCookie, opcionesCookieSesion } from './cookies';

export async function crearClienteServidor() {
  const almacen = await cookies();
  return createServerClient(urlSupabase(), llavePublicaSupabase(), {
    cookieOptions: opcionesCookieSesion(),
    cookies: {
      getAll() {
        return almacen.getAll();
      },
      setAll(pendientes) {
        try {
          for (const { name, value, options } of pendientes) {
            almacen.set(name, value, endurecerCookie(options));
          }
        } catch {
          // En un Server Component no se pueden escribir cookies; el middleware
          // ya renueva la sesión en cada petición.
        }
      },
    },
  });
}
