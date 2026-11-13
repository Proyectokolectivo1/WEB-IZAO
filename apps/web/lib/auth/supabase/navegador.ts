/**
 * Cliente de Supabase para componentes de cliente.
 *
 * El panel hoy no lo usa (el login y la sesión van por Server Actions),
 * pero queda disponible para módulos futuros. Recibe la URL y la llave
 * publicable como argumentos: el servidor las pasa como props en tiempo de
 * ejecución, sin necesidad de variables `NEXT_PUBLIC_*` en la construcción de la
 * imagen. La llave publicable es pública por diseño; la secreta jamás llega aquí.
 */
import { createBrowserClient } from '@supabase/ssr';
import { opcionesCookieSesion } from './cookies';

export function crearClienteNavegador(url: string, llavePublicable: string) {
  return createBrowserClient(url, llavePublicable, { cookieOptions: opcionesCookieSesion() });
}
