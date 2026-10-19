/**
 * Reúne lo que hace falta para decidir el acceso: sesión validada contra
 * Supabase Auth, nivel de MFA, fila de `admin_users` y vigencia de las 12 h.
 * Lo usan el middleware y los guardias de servidor. Las dependencias entran por
 * parámetro para poder probarlo con datos simulados.
 */
import type { AdminInfo, SesionAuth } from './decision';
import { marcaMfaVigente, marcaVigente } from './marca-sesion';

/** Parte del cliente de Supabase que se necesita (permite simularlo en pruebas). */
export type ClienteAuth = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | null; app_metadata?: Record<string, unknown> } | null };
      error: unknown;
    }>;
    mfa: {
      getAuthenticatorAssuranceLevel(): Promise<{
        data: { currentLevel: string | null; nextLevel: string | null } | null;
        error: unknown;
      }>;
    };
  };
};

export type DependenciasContexto<A extends AdminInfo = AdminInfo> = {
  supabase: ClienteAuth;
  /** Busca la fila de `admin_users` con el rol de servicio. */
  buscarAdmin: (userId: string) => Promise<A | null>;
  /** Valor de la cookie de la marca de 12 h. */
  marca: string | undefined;
  /** Valor de la cookie de MFA aprobado (ver `marca-sesion.ts`). */
  marcaMfa: string | undefined;
  ahoraMs: number;
  secreto: string;
};

export type ContextoCargado<A extends AdminInfo = AdminInfo> = {
  sesion: SesionAuth | null;
  admin: A | null;
  sesionVigente: boolean;
  email: string | null;
  /**
   * `true` si la sesión es aal2 pero no con el factor aprobado por el servidor:
   * el llamador debe cerrar la sesión local y auditarlo. `sesion` queda en `null`.
   */
  mfaNoAprobada: boolean;
  userId?: string;
};

export async function cargarContexto<A extends AdminInfo = AdminInfo>(
  deps: DependenciasContexto<A>,
): Promise<ContextoCargado<A>> {
  const { data, error } = await deps.supabase.auth.getUser();
  const usuario = data.user;
  if (error || !usuario) {
    return { sesion: null, admin: null, sesionVigente: false, email: null, mfaNoAprobada: false };
  }

  const { data: nivel } = await deps.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const sesion: SesionAuth = {
    userId: usuario.id,
    aal: nivel?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    siguienteNivel: nivel?.nextLevel === 'aal2' ? 'aal2' : 'aal1',
  };

  const [admin, sesionVigente] = await Promise.all([
    deps.buscarAdmin(usuario.id),
    marcaVigente(deps.marca, usuario.id, deps.ahoraMs, deps.secreto),
  ]);

  // A-3: una sesión aal2 solo vale si se verificó con el factor aprobado.
  if (sesion.aal === 'aal2') {
    const aprobado = usuario.app_metadata?.mfa_factor_aprobado;
    const factorAprobado = typeof aprobado === 'string' ? aprobado : null;
    const valida = await marcaMfaVigente(deps.marcaMfa, usuario.id, factorAprobado, deps.ahoraMs, deps.secreto);
    if (!valida) {
      return { sesion: null, admin, sesionVigente, email: usuario.email ?? null, mfaNoAprobada: true, userId: usuario.id };
    }
  }

  return { sesion, admin, sesionVigente, email: usuario.email ?? null, mfaNoAprobada: false, userId: usuario.id };
}
