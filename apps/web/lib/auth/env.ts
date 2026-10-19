/**
 * Lectura de las variables de entorno del panel (nombres de §28).
 *
 * Los mensajes de error nombran la variable que falta, nunca su valor.
 * `SUPABASE_SECRET_KEY` y `APP_ENCRYPTION_KEY` solo se leen en el servidor.
 */
import 'server-only';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim() === '') {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}

export function urlSupabase(): string {
  return requerida('SUPABASE_URL');
}

export function llavePublicaSupabase(): string {
  return requerida('SUPABASE_PUBLISHABLE_KEY');
}

/** Solo servidor. No importar desde componentes de cliente. */
export function llaveSecretaSupabase(): string {
  return requerida('SUPABASE_SECRET_KEY');
}

/** Secreto con el que se firma la marca de sesión de 12 h. Solo servidor. */
export function secretoSesion(): string {
  return requerida('APP_ENCRYPTION_KEY');
}

export function esProduccion(): boolean {
  return process.env.NODE_ENV === 'production';
}
