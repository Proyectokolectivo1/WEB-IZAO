/**
 * Reúne lo que hace falta para decidir el acceso: sesión validada contra
 * Supabase Auth, fila de `admin_users` y vigencia de las 12 h. Lo usan el
 * middleware y los guardias de servidor. Las dependencias entran por parámetro
 * para poder probarlo con datos simulados.
 *
 * El panel entra solo con correo y contraseña (D-054): ya no se lee el nivel de
 * aseguramiento (`aal`) de Supabase. Un usuario que tenga un factor TOTP
 * inscrito de antes entra igual, con sesión `aal1`.
 */
import type { AdminInfo, SesionAuth } from './decision';
import { marcaVigente } from './marca-sesion';

/** Parte del cliente de Supabase que se necesita (permite simularlo en pruebas). */
export type ClienteAuth = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | null; app_metadata?: Record<string, unknown> } | null };
      error: unknown;
    }>;
  };
};

export type DependenciasContexto<A extends AdminInfo = AdminInfo> = {
  supabase: ClienteAuth;
  /** Busca la fila de `admin_users` con el rol de servicio. */
  buscarAdmin: (userId: string) => Promise<A | null>;
  /** Valor de la cookie de la marca de 12 h. */
  marca: string | undefined;
  ahoraMs: number;
  secreto: string;
};

export type ContextoCargado<A extends AdminInfo = AdminInfo> = {
  sesion: SesionAuth | null;
  admin: A | null;
  sesionVigente: boolean;
  email: string | null;
  userId?: string;
};

export async function cargarContexto<A extends AdminInfo = AdminInfo>(
  deps: DependenciasContexto<A>,
): Promise<ContextoCargado<A>> {
  const { data, error } = await deps.supabase.auth.getUser();
  const usuario = data.user;
  if (error || !usuario) {
    return { sesion: null, admin: null, sesionVigente: false, email: null };
  }

  const sesion: SesionAuth = { userId: usuario.id };
  const [admin, sesionVigente] = await Promise.all([
    deps.buscarAdmin(usuario.id),
    marcaVigente(deps.marca, usuario.id, deps.ahoraMs, deps.secreto),
  ]);

  return { sesion, admin, sesionVigente, email: usuario.email ?? null, userId: usuario.id };
}
