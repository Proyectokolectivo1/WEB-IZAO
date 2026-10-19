/**
 * Cliente de Supabase para el middleware: lee las cookies de la petición y
 * escribe las renovadas en la respuesta.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { llavePublicaSupabase, urlSupabase } from '../env';
import { endurecerCookie } from './cookies';

export function crearClienteMiddleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(urlSupabase(), llavePublicaSupabase(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(pendientes) {
        for (const { name, value } of pendientes) request.cookies.set(name, value);
        respuesta = NextResponse.next({ request });
        for (const { name, value, options } of pendientes) {
          respuesta.cookies.set(name, value, endurecerCookie(options));
        }
      },
    },
  });

  return { supabase, obtenerRespuesta: () => respuesta };
}
